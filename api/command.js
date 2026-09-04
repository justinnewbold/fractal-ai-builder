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
import { cors } from './_cors.js'

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
      'backupPreset',
      'keepInLibrary',
      'designTone',
      'buildChain'
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
      'For renamePreset: the name. For setChannel: A/B/C/D. For savePreset and keepInLibrary: ' +
        'an optional name to save it under. For designTone: the tone description in the ' +
        'player own words. For buildChain: the block slugs in signal order, comma separated, ' +
        'or null for a sensible default. Null otherwise.'
    ),
  fromRow: z.number().int().nullable().describe('Source row for moveBlock. Null otherwise.'),
  fromCol: z.number().int().nullable().describe('Source column for moveBlock. Null otherwise.'),
  row: z.number().int().nullable().describe('Target row for moveBlock, placeBlock, clearCell.'),
  col: z.number().int().nullable().describe('Target column for those same actions.'),
  scene: z
    .number()
    .int()
    .nullable()
    .describe(
      'Scene index, 0-based, for setSceneBlock — and for setBypass and setChannel when the ' +
        'player named a scene other than the one the unit is in. Null means the scene the unit ' +
        'is in. Zero-based: 0 is the scene the player calls scene 1, so "scene 2" is index 1.'
    ),
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

AN EMPTY PRESET

To add one block: kind placeBlock with text = its name from the placeable list,
value null, row and col null — the app resolves the type code and finds a free
slot on the device itself. Only give row and col when the player named a slot.
To remove one: clearCell with the block's row and col from the blocks list.

A preset with no blocks has nothing to adjust. buildChain places blocks into it
in signal order -- "build a drive, amp, cab and delay chain" is buildChain with
those slugs, and asking for a chain without saying which blocks gets the default.

You do not need to build before designing. A tone description on an empty preset
is still just designTone; the chain gets put there first automatically.

DESCRIBING A TONE IS NOT A LIST OF CHANGES

If the request describes a sound to build rather than controls to change --
"tight modern metal rhythm in drop A", "warm clean with a bit of shimmer",
"something like a Vox on the edge of breakup" -- return exactly one action,
designTone, with their words in "text" and nothing else. A whole tone gets
designed and shown for approval before anything is written. That is a different
and slower path than nudging a control, and it is the right one.

The difference is whether they named what to change. "Turn the gain up" and "set
high cut to 5k" are changes. "Make it heavier" is a change if the current tone is
close and a design if they want a different sound entirely -- when it is
genuinely unclear, prefer designTone, because it stops to show its work.

There are two places a preset can be kept and they are not the same. A slot is
on the unit, numbered, and saving to one overwrites what was there. The library
is a folder of files on the player's own computer, named rather than numbered,
and nothing is lost by adding to it. "Save this to 67" is a slot. "Save this to
my library" or "keep this as Drop A Rhythm" is keepInLibrary.

Slots are addressed by the numbers the unit uses. "Save this to 67" is
savePreset with value 67. "Save it" with no number means the slot that is
already loaded, which you are given.

SCENES AND CHANNELS

A scene remembers two things about every block: whether it is on, and which of
its channels it is playing. Channels are A to D and each one holds its own
model and its own values. You are given the scene the unit is in (activeScene,
0-based) and the scene names (sceneNames, by index), so "the lead scene" means
the scene whose name is Lead. The player counts from 1 and these are indexed
from 0: their "scene 2" is index 1, the second entry in sceneNames — the
"scenes" list spells this out per scene. Every scene number you return is an
index.

Both halves are per scene: to switch a block on or off, or to put it on a
different channel, in a scene the unit is not in, give setBypass or setChannel
that scene's index in "scene".

A value is not per scene — it belongs to the channel the block is on, so
setting it changes every scene playing that channel. Asked for a tone change in
one scene, that is what channels are for: if the block is on the same channel
everywhere, put that scene on a free channel with setChannel and say in
"understood" that you have done so, then set the values, which now belong to
that scene alone. If the player would rather not spend a channel, say so in
"refused" and offer the preset-wide change instead. Never present a change that
lands on a shared channel as a change to one scene.

READING INTENT

"A little" is a small move — roughly a tenth of the range. "A lot" or "much
more" is roughly a third. "Cut the bass" means reduce it, not set it to zero.
Relative words act on the current value, which you have.

Ordering matters. Structural changes come before the values that depend on
them: a block must be in place before its parameters are set, and changing a
model resets that block's parameters, so set the model before its values.

Reply with the actions and nothing else.`

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
    res.status(500).json({ error: 'No model key configured.' })
    return
  }

  const { instruction, device, blocks, grid, scene, sceneNames, sceneCount, presetName, presetNumber, history } =
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
    sceneNames: Array.isArray(sceneNames) ? sceneNames : undefined,
    // The same names, numbered the way the player says them: "scene 2" is
    // index 1. Without this the model read "scene 2" as sceneNames[2].
    scenes: Array.isArray(sceneNames)
      ? sceneNames.map((name, i) => `scene ${i + 1} = index ${i}${name ? ` (${name})` : ''}`)
      : undefined,
    sceneCount: sceneCount ?? device?.capabilities?.sceneCount ?? 8,
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
