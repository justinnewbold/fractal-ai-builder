/**
 * POST /api/generate
 *
 * Turns a plain-language tone description into a concrete preset spec.
 *
 * Built on the Vercel AI SDK. `generateObject` constrains the model to a Zod
 * schema, so a malformed reply is the SDK's problem rather than ours — no
 * fence-stripping, no JSON.parse in a try/catch, no "the model added a
 * preamble" failure mode.
 *
 * Routed through the Vercel AI Gateway, so the model is a plain string and
 * swapping providers is an environment variable, not a code change. The key
 * lives here and never reaches the browser.
 */
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

/**
 * Two ways in, because they fail differently.
 *
 * A direct Anthropic key is the default: it needs no gateway credit and works
 * on a fresh account. The Vercel AI Gateway is the alternative — one key for
 * every provider, and swapping models becomes an env var — but its free tier
 * returns 403 for every Anthropic model, so it can't be the default.
 *
 * Set ANTHROPIC_API_KEY for the direct path, or AI_GATEWAY_API_KEY (with
 * credit on the account) for the gateway.
 */
const MODEL_NAME = process.env.GENERATOR_MODEL || 'claude-sonnet-5'

function resolveModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return anthropic(process.env.GENERATOR_MODEL || 'claude-sonnet-5')
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return process.env.GENERATOR_MODEL || 'anthropic/claude-sonnet-4.5'
  }
  return null
}

const PresetSpec = z.object({
  presetName: z.string().describe('Short name, 12 characters or fewer, uppercase.'),
  summary: z.string().describe('One sentence on the approach taken.'),
  blocks: z
    .array(
      z.object({
        eid: z.number().int().describe('Effect id, copied from the supplied block list.'),
        bypassed: z.boolean().describe('Whether this block should be bypassed.'),
        type: z
          .number()
          .int()
          .nullable()
          .describe(
            'Numeric "value" of a model from this block supplied model list, or null to leave the model alone.'
          ),
        typeName: z.string().nullable().describe('Name of that model, or null.'),
        params: z
          .array(
            z.object({
              id: z.number().int().describe('Parameter id from this block supplied list.'),
              name: z.string().describe('That parameter name.'),
              value: z
                .number()
                .describe('Value in the parameter own units, inside its own min and max.')
            })
          )
          .describe('Parameters to set on this block. May be empty.')
      })
    )
    .describe('Only blocks you are changing.'),
  notes: z.string().describe('Anything the player should know. Empty string if nothing.')
})

const SYSTEM = `You are a Fractal Audio preset designer. You translate a guitarist's
description of a tone into concrete settings for the blocks in their currently
loaded preset.

HARD RULES

1. Only use effect ids that appear in the supplied block list.
2. For a model change, use only the numeric "value" of an entry in that block's
   supplied model list. Never invent a number.
3. Only set parameter ids that appear in that block's supplied parameter list.
4. Every value must sit inside that parameter's own min and max, in its own
   units. A gain that runs 0-10 takes 7.5, not 0.75.
5. Bypass blocks that don't belong in the tone rather than leaving them engaged
   and neutral.
6. Do not move blocks, add blocks, or change routing. Work with what is placed.

TONE JUDGEMENT

Dial values a working engineer would actually use for the description - not
defaults, not everything at noon. Consider the whole chain: a drive in front
changes how much amp gain the tone needs. If the player names a band, an era, or
a record, choose the amp model whose real-world counterpart made that sound.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const model = resolveModel()
  if (!model) {
    res.status(500).json({
      error:
        'No model key configured. Set ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY) in the Vercel project settings.'
    })
    return
  }

  const { description, device, blocks } = req.body || {}

  if (!description || typeof description !== 'string') {
    res.status(400).json({ error: 'Describe the tone you want.' })
    return
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    res.status(400).json({ error: 'No blocks were read from the device.' })
    return
  }

  // The request splits in two because the halves have very different lifetimes.
  //
  // Model rosters are ~80% of the payload and identical on every run — the amp
  // roster alone is around 11k tokens. Parameter values and bypass states change
  // constantly. Sending them as one blob means paying full price for the same
  // 11k tokens every generation.
  //
  // So rosters go in their own content part marked for caching, sorted by slug
  // so the text is byte-identical between runs and actually hits. Cached reads
  // bill at a tenth of base. The first run of a session pays a small write
  // premium; every run after is much cheaper.
  const rosters = {}
  for (const block of [...blocks].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (block.models?.length && !rosters[block.slug]) rosters[block.slug] = block.models
  }

  const state = {
    device: device?.name || 'FM3',
    grid: device?.capabilities?.grid,
    blocks: blocks.map((b) => ({
      eid: b.eid,
      name: b.name,
      slug: b.slug,
      currentlyBypassed: b.bypassed,
      channel: b.channel,
      params: b.params
    }))
  }

  try {
    const { object, usage, providerMetadata } = await generateObject({
      model,
      schema: PresetSpec,
      schemaName: 'preset_spec',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Models available on this unit, by block family. The numeric "value" is what you must use when changing a model:\n${JSON.stringify(
                rosters
              )}`,
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
            },
            {
              type: 'text',
              text: `Current state of the loaded preset:\n${JSON.stringify(
                state
              )}\n\nTone wanted: ${description}`
            }
          ]
        }
      ]
    })

    const anthropicMeta = providerMetadata?.anthropic || {}

    // Token counts come back to the browser so the app can price the run. The
    // input side is dominated by the model roster and block schema, which grow
    // with the preset — worth seeing rather than assuming.
    res.status(200).json({
      ...object,
      _usage: {
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        // Reported in different places depending on provider and SDK version.
        // Verified live: the gateway returns inputTokenDetails.cacheReadTokens,
        // while the Anthropic provider reports cacheReadInputTokens in metadata.
        // inputTokens is the total and already includes the cached portion.
        cachedInputTokens:
          usage?.cachedInputTokens ??
          usage?.inputTokenDetails?.cacheReadTokens ??
          anthropicMeta.cacheReadInputTokens ??
          null,
        cacheWriteTokens:
          usage?.inputTokenDetails?.cacheWriteTokens ??
          anthropicMeta.cacheCreationInputTokens ??
          null,
        model: typeof model === 'string' ? model : model?.modelId || MODEL_NAME
      }
    })
  } catch (err) {
    res.status(502).json({ error: `Generation failed: ${err.message}` })
  }
}
