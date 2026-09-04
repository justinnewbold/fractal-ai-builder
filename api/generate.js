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
import { generateObject, streamObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { cors } from './_cors.js'

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
  presetName: z
    .string()
    .describe(
      'Name for the preset, 31 characters or fewer. Mixed case is fine. Make it descriptive of ' +
        'the sound rather than generic — a player scrolling a list of 512 should know what this is.'
    ),
  summary: z.string().describe('One sentence on the approach taken.'),
  blocks: z
    .array(
      z.object({
        eid: z.number().int().describe('Effect id, copied from the supplied block list.'),
        bypassed: z.boolean().describe('Whether this block should be bypassed.'),
        channel: z
          .string()
          .nullable()
          .describe(
            'Channel letter — A, B, C or D — that this model and these values belong to, or null ' +
              'for the channel the block is already on. Only for blocks whose entry in the list ' +
              'has a channel. List the same block twice with two channels to dial two sounds out ' +
              'of it, then point scenes at whichever they need.'
          ),
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
  scenes: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .describe('Scene number, zero-based. 0 is scene 1 on the unit front panel.'),
        name: z
          .string()
          .describe('Short name for this scene — "Clean", "Rhythm", "Lead". Eight characters or fewer reads best on the unit.'),
        engaged: z
          .array(z.number().int())
          .describe(
            'Effect ids that are ON in this scene. Every other block placed in the preset is off. ' +
              'Copy ids from the supplied block list.'
          ),
        channels: z
          .array(
            z.object({
              eid: z.number().int().describe('Effect id from the supplied block list.'),
              channel: z.string().describe('Channel letter A, B, C or D this scene plays.')
            })
          )
          .describe(
            'Blocks that play a particular channel in this scene. Leave a block out to keep it ' +
              'on the channel it is already on. Empty array if every block stays put.'
          )
      })
    )
    .describe(
      'Optional. One rig, several usable states of it — different blocks switched in, and ' +
        'different channels where the sound needs to change. Empty array if the request is for ' +
        'a single sound.'
    ),
  notes: z.string().describe('Anything the player should know. Empty string if nothing.')
})

const SYSTEM = `You are a Fractal Audio preset designer. You translate a guitarist's
description of a tone into concrete settings for the blocks in their currently
loaded preset.

HARD RULES

1. Only use effect ids that appear in the supplied block list.
2. For a model change, use only the numeric "value" of an entry in that block's
   supplied model list. Never invent a number.
3. Only set parameter ids that appear in that block's supplied parameter list,
   and give each one the exact "name" it carries in that list. The name is
   checked against the unit's own list and decides which control is written when
   it and the id disagree, so copy it rather than paraphrasing it.
4. Every value must sit inside that parameter's own min and max, in its own
   units. A gain that runs 0-10 takes 7.5, not 0.75.
5. Bypass blocks that don't belong in the tone rather than leaving them engaged
   and neutral.
6. Do not move blocks, add blocks, or change routing. Work with what is placed.

SCENES AND CHANNELS

A preset holds one set of blocks. A scene is a saved snapshot of two things per
block: whether it is ON, and which of its channels it is playing. Channels are
A to D, and each channel of a block holds its own model and its own values. So
scenes give a player several genuinely different sounds out of one rig,
switched by footswitch without a gap.

7. A scene can change two things: which blocks are on, and which channel each
   block plays. It cannot change anything else on its own — a model or a value
   belongs to the channel it was written to, so writing it in one scene changes
   every scene playing that channel.
8. That is how a lead scene gets a hotter amp: dial the lead sound on a second
   channel of the amp block (list the block twice in "blocks", once per
   channel), then point the lead scene at that channel in its "channels".
   Use a channel where it earns one — a real change of sound — and leave a
   block where it is when switching it in or out does the job. Only a block
   whose entry in the list carries a "channel" has channels at all; leave the
   field null for every other block.
9. List in "engaged" every effect id that should be ON in that scene. Anything
   placed in the preset and not listed is off in that scene. Amp and cab
   belong in every scene — leaving them out silences it.
10. Offer scenes when the request implies more than one sound — a song, a set,
    a band whose parts differ, or any mention of rhythm and lead. For a single
    specific sound, return an empty array rather than padding it out.
11. Three or four well-judged scenes beat eight. Do not fill every slot for the
    sake of it.

TONE JUDGEMENT

Dial values a working engineer would actually use for the description - not
defaults, not everything at noon. Consider the whole chain: a drive in front
changes how much amp gain the tone needs.

REFERENCES

Every model in the roster carries "manufacturer" and "basedOn" - the real amp or
pedal it was modelled on. Use them. When the player names a band, a record, an
era, or a piece of gear, work out what hardware actually made that sound and pick
the model whose basedOn matches it. A request for a Mesa Mark IIC+ tone should
land on the model built from a Mark IIC+, not on whatever is named most
suggestively.

Say which reference you matched, and why, in the summary. If nothing in the
roster is a close counterpart, pick the nearest and say plainly what it is not -
a player who knows the reference would rather hear that than be told a
substitute is the real thing.`

export default async function handler(req, res) {
  // Local mode serves this app from the player's own machine, so the page is a
  // cross-origin caller here. Preflight is answered and nothing else runs.
  if (cors(req, res)) return

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

  const { description, device, blocks, previous, mode, sceneNames, taste } = req.body || {}

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
  const reference = {}
  for (const block of [...blocks].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (block.models?.length && !rosters[block.slug]) rosters[block.slug] = block.models
    if (!reference[block.slug]) {
      const params = {}
      for (const p of block.params || []) if (p.does) params[p.name] = p.does
      if (block.about || Object.keys(params).length) {
        reference[block.slug] = { about: block.about || undefined, params }
      }
    }
  }

  const state = {
    device: device?.name || 'FM3',
    grid: device?.capabilities?.grid,
    // How many scenes exist to fill, and what they are called now. Without the
    // count the model has to guess how many it may write, and eight is not
    // universal across the family.
    sceneCount: device?.capabilities?.sceneCount ?? 8,
    sceneNames: Array.isArray(sceneNames) ? sceneNames : undefined,
    blocks: blocks.map((b) => ({
      eid: b.eid,
      name: b.name,
      slug: b.slug,
      currentlyBypassed: b.bypassed,
      channel: b.channel,
      params: (b.params || []).map(({ does, ...rest }) => rest)
    }))
  }

  // Refining is a different job from designing. The player has heard the tone
  // and is reacting to it — "too dark", "more bite" — so the previous spec is
  // the subject and the instruction is an adjustment, not a fresh brief.
  const task =
    mode === 'refine' && previous
      ? `You designed this preset:\n${JSON.stringify(previous)}\n\nThe player has now heard it ` +
        `and wants a change: ${description}\n\nAdjust it. Return the full spec again, not just ` +
        `the differences — keep everything that isn't being changed. Make a real, audible move in ` +
        `the direction asked for rather than a token nudge, but change as little else as possible.`
      : `Tone wanted: ${description}`

  /*
   * What this player has tended to keep, when the browser has enough history
   * to say. It settles the questions a short request leaves open — which of
   * four fitting amps, what "a lot of gain" means to this person — so the
   * first attempt lands nearer their taste instead of the middle of the road.
   *
   * Client-supplied and therefore capped. It is prose assembled by
   * src/lib/taste.js from the player's own presets, but this endpoint cannot
   * verify that, and an unbounded string from a request body is a way to make
   * every generation expensive. 4000 characters is several times what the
   * builder produces at its most verbose.
   *
   * It goes after the request rather than before it. The request is the job;
   * this is background, and background that arrives first reads as the brief.
   */
  const context = typeof taste === 'string' && taste.trim() ? taste.trim().slice(0, 4000) : null

  /*
   * The output ceiling is set here rather than left to the provider default.
   *
   * The AI SDK's Anthropic provider has to send `max_tokens` on every request,
   * so an unset one is not "no limit" — it is whatever the provider picked,
   * which is 4096. A full chain with a dozen blocks and their parameter lists
   * runs past that, and hitting the ceiling truncates the JSON mid-object: the
   * schema then fails to validate and the whole generation is lost at the very
   * end, after the player has watched it build. The cap is a ceiling, not a
   * reservation, so a generous one costs nothing on the presets that don't
   * need it.
   */
  const args = {
    model,
    maxOutputTokens: 16000,
    schema: PresetSpec,
    schemaName: 'preset_spec',
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Models available on this unit, by block family. The numeric "value" is what ` +
              `you must use when changing a model:\n${JSON.stringify(rosters)}\n\n` +
              `What each block and control actually does, from the device's own reference:\n` +
              `${JSON.stringify(reference)}`,
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
          },
          {
            type: 'text',
            text:
              `Current state of the loaded preset:\n${JSON.stringify(state)}\n\n${task}` +
              (context ? `\n\n${context}` : '')
          }
        ]
      }
    ]
  }

  // Streaming exists so the wait isn't a black box. The model decides blocks in
  // order, so partials arrive as a chain being built — which is worth watching,
  // and is also the only honest progress indicator available for a call whose
  // duration nothing can predict.
  if (req.query?.stream === '1' || req.headers?.['x-stream'] === '1') {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Accel-Buffering', 'no')

    /*
     * Say hello before the model is asked anything.
     *
     * Node holds the whole response until the first write, so a browser
     * awaiting `fetch` learns nothing at all until the first partial — and
     * waiting for the first partial IS the wait. One frame up front costs
     * nothing and splits a failure that used to be a single word into two with
     * different fixes: the server never answered, or the model never started.
     * It also settles, from the browser, whether anything in between is
     * buffering the stream — which is not a question a server log can answer.
     */
    res.write(JSON.stringify({ type: 'open' }) + '\n')
    if (typeof res.flush === 'function') res.flush()

    try {
      const result = streamObject(args)
      for await (const partial of result.partialObjectStream) {
        res.write(JSON.stringify({ type: 'partial', object: partial }) + '\n')
      }

      const object = await result.object
      const usage = await result.usage
      const meta = (await result.providerMetadata)?.anthropic || {}

      res.write(
        JSON.stringify({
          type: 'done',
          object: {
            ...object,
            _usage: {
              inputTokens: usage?.inputTokens ?? null,
              outputTokens: usage?.outputTokens ?? null,
              cachedInputTokens:
                usage?.cachedInputTokens ??
                usage?.inputTokenDetails?.cacheReadTokens ??
                meta.cacheReadInputTokens ??
                null,
              cacheWriteTokens:
                usage?.inputTokenDetails?.cacheWriteTokens ??
                meta.cacheCreationInputTokens ??
                null,
              model: typeof model === 'string' ? model : model?.modelId || MODEL_NAME
            }
          }
        }) + '\n'
      )
    } catch (err) {
      res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n')
    }
    res.end()
    return
  }

  /*
   * The same request, unstreamed. `args` rather than a second copy of it.
   *
   * It was a second copy, and the copy had drifted: it never carried
   * `maxOutputTokens`, so the path taken when streaming is refused — a proxy
   * that buffers, a network that won't do chunked — ran against the provider's
   * 4096 default and truncated exactly the presets the ceiling above exists to
   * protect. Building the arguments once is why that cannot happen again.
   */
  try {
    const { object, usage, providerMetadata } = await generateObject(args)

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
