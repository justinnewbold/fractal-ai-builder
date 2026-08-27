/**
 * POST /api/command
 *
 * Turns "move the drive before the amp" or "turn up the gain a little and cut
 * the bass" into an ordered list of actions.
 *
 * Distinct from /api/generate, which designs a whole preset. This is for the
 * things a player would otherwise reach into the editor to do — one or two
 * changes, described the way you'd say them out loud.
 *
 * The model chooses actions; it does not perform them. Everything comes back as
 * a list, gets checked against what the device actually reported, and is shown
 * before anything is written.
 */
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const MODEL_NAME = process.env.GENERATOR_MODEL || 'claude-sonnet-5'

function resolveModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return anthropic(MODEL_NAME)
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return process.env.GENERATOR_MODEL || 'anthropic/claude-sonnet-4.5'
  }
  return null
}

const Action = z.object({
  kind: z
    .enum([
      'setParam',
      'setModel',
      'setBypass',
      'setChannel',
      'moveBlock',
      'placeBlock',
      'clearCell',
      'setScene',
      'setSceneBlock',
      'renamePreset',
      'setTempo',
      'savePreset',
      'loadPreset',
      'backupPreset'
    ])
    .describe('What to do.'),
  eid: z.number().int().nullable().describe('Effect id of the block, or null.'),
  paramId: z.number().int().nullable().describe('Parameter id, for setParam. Otherwise null.'),
  value: z
    .number()
    .nullable()
    .describe(
      'Numeric argument: the parameter value in its own units, a model ordinal, a scene index, ' +
        'a block type code, BPM, or a preset slot number for savePreset and loadPreset. ' +
        'Null when not needed.'
    ),
  flag: z.boolean().nullable().describe('For setBypass and setSceneBlock: true means bypassed.'),
  text: z
    .string()
    .nullable()
    .describe(
      'For renamePreset: the name. For setChannel: A/B/C/D. For savePreset: an optional name ' +
        'to save it under. Null otherwise.'
    ),
  fromRow: z.number().int().nullable().describe('Source row for moveBlock. Null otherwise.'),
  fromCol: z.number().int().nullable().describe('Source column for moveBlock. Null otherwise.'),
  row: z.number().int().nullable().describe('Target row for moveBlock, placeBlock, clearCell.'),
  col: z.number().int().nullable().describe('Target column for those same actions.'),
  scene: z.number().int().nullable().describe('Scene index for setSceneBlock. Null otherwise.'),
  why: z.string().describe('One short line the player will read, in plain language.')
})

const Plan = z.object({
  understood: z
    .string()
    .describe(
      'Your reply to the player, in one or two plain sentences. This is read as conversation, ' +
        'so answer questions here too, not just describe changes.'
    ),
  actions: z.array(Action).describe('Ordered. Empty if the request cannot be done.'),
  refused: z
    .string()
    .describe('If nothing can be done, why — otherwise an empty string.')
})

const SYSTEM = `You are the way a guitarist operates their Fractal unit. They talk to
you; you do the thing. Anything they could reach in and change by hand, you can
change, including saving and loading presets.

WHAT YOU ARE GIVEN

The blocks currently placed, their grid positions, their parameters with real
ranges, and the models each block family offers on this specific unit.

HARD RULES

1. Only use effect ids, parameter ids and model ordinals that appear in the
   supplied data. Never invent one.
2. Parameter values are in that parameter's own units and must sit inside its
   min and max.
3. Grid positions use the same row and column numbers as the supplied block
   list.
4. Do not set anything named Level, Balance, Pan or Output — those are the
   player's gain staging, not yours.
5. If the request is ambiguous or cannot be done with the blocks present, return
   no actions and say why in "refused". Guessing is worse than asking.
6. Never save or load a preset unless you were asked to. Saving overwrites a
   slot and loading discards unsaved work — neither is a tidy finishing touch to
   add on your own initiative.

CONVERSATION

You may be given earlier turns. Use them: "make it darker still" means darker
than the change you just made, and "put that back" refers to what you just did.
If someone asks a question rather than requesting a change — what amp is this,
what does that control do, is this saved — answer it in "understood" and return
no actions. A question is not a failure, so leave "refused" empty for it.

Slots are addressed by the numbers the unit uses. "Save this to 67" is
savePreset with value 67. "Save it" with no number means the slot that is
already loaded, which you are given.

READING INTENT

"A little" is a small move — roughly a tenth of the range. "A lot" or "much
more" is roughly a third. "Cut the bass" means reduce it, not set it to zero.
Relative words act on the current value, which you have.

Ordering matters. Structural changes come before the values that depend on
them: a block must be in place before its parameters are set, and changing a
model resets that block's parameters, so set the model before its values.

Reply with the actions and nothing else.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const model = resolveModel()
  if (!model) {
    res.status(500).json({ error: 'No model key configured.' })
    return
  }

  const { instruction, device, blocks, grid, scene, presetName, presetNumber, history } =
    req.body || {}

  if (!instruction || typeof instruction !== 'string') {
    res.status(400).json({ error: 'Say what you want changed.' })
    return
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    res.status(400).json({ error: 'No blocks were read from the device.' })
    return
  }

  const rosters = {}
  for (const block of [...blocks].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (block.models?.length && !rosters[block.slug]) rosters[block.slug] = block.models
  }

  const state = {
    device: device?.name,
    slotModel: device?.capabilities?.slotModel,
    grid: device?.capabilities?.grid || { slots: device?.capabilities?.slotCount },
    presetName,
    presetNumber,
    activeScene: scene,
    blocks: blocks.map((b) => ({
      eid: b.eid,
      name: b.name,
      slug: b.slug,
      row: b.row,
      col: b.col,
      bypassed: b.bypassed,
      channel: b.channel,
      params: (b.params || []).map(({ does, ...rest }) => rest)
    })),
    placeable: grid?.palette || []
  }

  try {
    const { object, usage } = await generateObject({
      model,
      schema: Plan,
      schemaName: 'command_plan',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Models on this unit:\n${JSON.stringify(rosters)}`,
              providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
            }
          ]
        },
        // Earlier turns, so "a bit more" and "put that back" mean something.
        // Trimmed to the last few: the preset state below is always current, and
        // stale block data from ten turns ago is worse than no memory at all.
        ...(Array.isArray(history) ? history : [])
          .slice(-8)
          .filter((m) => m && typeof m.text === 'string' && m.text.trim())
          .map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.text.slice(0, 1200)
          })),
        {
          role: 'user',
          content: `Preset right now:\n${JSON.stringify(state)}\n\nInstruction: ${instruction}`
        }
      ]
    })

    res.status(200).json({
      ...object,
      _usage: {
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        cachedInputTokens:
          usage?.cachedInputTokens ?? usage?.inputTokenDetails?.cacheReadTokens ?? null,
        model: typeof model === 'string' ? model : model?.modelId || MODEL_NAME
      }
    })
  } catch (err) {
    res.status(502).json({ error: `Could not work that out: ${err.message}` })
  }
}
