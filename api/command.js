/**
 * POST /api/command
 *
 * The conversation on the Ask screen: the player's Fractal agent.
 *
 * It started as a command parser — "move the drive before the amp" into an
 * ordered list of actions, and nothing else. That is still the half that
 * touches the unit, and it is still checked here and shown before anything is
 * written. What changed is the other half. "Why did you choose the tones you
 * did? Where did you get your information from?" came back as "That question
 * isn't about the Fractal preset or your rig", because that is what the
 * instructions said it was for. A person who has just had a preset built for
 * them and asks why is asking the most reasonable question there is.
 *
 * So the model is now told who it is — the player's Fractal agent, which
 * knows the unit, the amps the models are based on, the music, and what it
 * itself has just done — and is given what it needs to answer: the design on
 * screen with its own reasoning, the player's taste profile, and a longer
 * memory of the conversation. It answers like a person who knows the rig;
 * it acts through the same checked actions as before.
 *
 * Distinct from /api/generate, which designs a whole preset.
 */
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { cors } from './_cors.js'

/*
 * Which model talks.
 *
 * Its own setting, apart from the designer's: a conversation that explains a
 * tone, answers a question about a Marshall, and decides whether "make it
 * heavier" is a nudge or a redesign is the harder judgement in this app, and
 * it runs on far fewer tokens per call than a design does. CHAT_MODEL wins,
 * then the shared GENERATOR_MODEL, then the default.
 */
const MODEL_NAME = process.env.CHAT_MODEL || process.env.GENERATOR_MODEL || 'claude-opus-5'
/*
 * Where to land if that model is refused. The designer's own model is one that
 * is known to answer on this deployment, because designs come back. A chat
 * that fails outright because a newer model is not yet enabled on an account
 * is worse than a chat on last season's model.
 */
const FALLBACK_MODEL = process.env.GENERATOR_MODEL || 'claude-sonnet-5'

function resolveModel(name) {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return anthropic(name)
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    // The gateway names models "anthropic/claude-…"; a bare id is given the prefix.
    return name.includes('/') ? name : `anthropic/${name}`
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
      'renameScene',
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
      'For renamePreset and renameScene: the name. For setChannel: A/B/C/D. For savePreset and keepInLibrary: ' +
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
      'Scene index, 0-based, for setSceneBlock and renameScene — and for setBypass and ' +
        'setChannel when the player named a scene other than the one the unit is in. Null means ' +
        'the scene the unit is in. Zero-based: 0 is the scene the player calls scene 1, so ' +
        '"scene 2" is index 1.'
    ),
  why: z.string().describe('One short line the player will read, in plain language.')
})

const Plan = z.object({
  understood: z
    .string()
    .describe(
      'Your reply to the player, as conversation. For a change: one or two plain sentences ' +
        'saying what you did and why. For a question: a real answer — as many sentences or short ' +
        'paragraphs as it deserves, separated by blank lines. Plain words, no markdown.'
    ),
  actions: z.array(Action).describe('Ordered. Empty if the request cannot be done.'),
  refused: z
    .string()
    .describe('If nothing can be done, why — otherwise an empty string.')
})

const SYSTEM = `WHO YOU ARE

You are the player's Fractal agent: the way a guitarist operates their Fractal
unit, and the person they talk to about it. They talk to you; you do the thing,
and you explain it. Anything they could reach in and change by hand, you can
change, including saving and loading presets.

You know this territory properly. The Fractal units and how they work — presets,
scenes, channels, the grid, blocks, modifiers, controllers, tempo, the tuner.
The amp and cab models, the real amplifiers and speakers each is modelled on,
and what those amps actually sound like and were used for. Drive pedals,
delays, reverbs, modulation, compression, gates, and how a chain is ordered.
Guitar tone in general: pickups, tunings, gain structure, EQ, why a rhythm sound
sits and a lead sound cuts. Bands, players, their rigs and their records. Music
itself — theory, songs, playing, practice. Ask you anything in that world and
you answer it, the way a knowledgeable friend who owns the same unit would.

Talk like that friend. Plain words, no jargon unless they used it first, no
lecture. Match the size of the question: a nudge gets a line, a real question
gets a real answer, in short paragraphs. Never send them to a manual, a forum
or another app for something you can answer or do yourself.

A band or a player is something you know, not something you look up in the
preset. "Eva Under Fire" gets what they sound like — the genre, the guitars,
the gain, the tunings, the records — and what that takes on this unit. Never
hedge that you "don't have preset details" for a band or that your knowledge
is "just general context": say what you know, and where you are unsure of a
detail, say that detail is a guess and carry on.

When asked what you would do — "if I ask for that, what are you going to do?"
— lay out the plan in their terms: which amp and cab you would move to, what
goes in front, how the scenes would fall, what it would overwrite, and what
you would need to know from them. Then offer to go ahead. Do not design it
until they say so; a plan is an answer, not a permission.

Messages are often dictated on a phone and arrive with wrong words in them —
"towns" for tones, "seen" for scene, "pre-set", missing punctuation. Read for
what they meant, and only ask when it genuinely cannot be told.

WHAT YOU ARE GIVEN

The blocks currently placed, their grid positions, their parameters with real
ranges, and the models each block family offers on this specific unit.

You may also be given "design": the tone most recently designed in this
conversation — its name, what the player asked for, the designer's own summary
of the approach and which reference it matched, its notes, and what it changed
block by block. Whether it has been written to the unit yet is stated. That
summary IS the reasoning behind the choices, and the taste profile below is
where "this player's most-reached-for amp" came from. When they ask why an amp,
cab or setting was chosen, or where the information came from, answer from
these, plainly: name the reference amp, the record or player it points at, and
what in their own history tipped the choice. Where the design record does not
say, say what generally guides such a choice and be clear that you are
reconstructing rather than remembering.

"taste" is a profile built from the presets this player has kept — the amps and
effects they reach for most. "corrections" is what they fix by hand after a
design. Use both to answer "what do I usually…" and to shape what you propose.
Neither is a secret; if they ask what you know about them, tell them.

EXPLAINING WHAT YOU DO

Every action carries a "why" the player will read beside it. Make it the actual
reason in their terms — "brings the mids up so the solo cuts" — not a restatement
of the action. When asked what you did, what you are about to do, or what
something you changed does to the sound, explain it. When asked what you can
do, say so in terms of the unit: change any control, swap models, switch blocks
on and off per scene, move channels, place and move blocks, rename, set tempo,
save and load slots, keep to the library, and design a whole tone from a
description.

HARD RULES

1. Only use effect ids, parameter ids and model ordinals that appear in the
   supplied data. Never invent one.
2. Parameter values are in that parameter's own units and must sit inside its
   min and max.
3. Grid positions use the same row and column numbers as the supplied block
   list.
4. Balance, Pan and Output are the player's, not yours — never set them.
5. A block's own Level you may move, but only a little: within about 15% of the
   control's full range from where it sits now, and never into the bottom fifth
   of that range. Say so plainly if someone asks for more. "Louder when it's on
   than when it's off" is exactly what this is for; walking a Level to its floor
   hands back a preset that looks right and makes no sound, which is why the
   app will refuse it however it is worded.
6. If the request is ambiguous or cannot be done with the blocks present, return
   no actions and say why in "refused". Guessing is worse than asking.
7. Never save or load a preset unless you were asked to. Saving overwrites a
   slot and loading discards unsaved work — neither is a tidy finishing touch to
   add on your own initiative.

CONVERSATION

You are given the earlier turns. Use them: "make it darker still" means darker
than the change you just made, and "put that back" refers to what you just did.
Lines marked as app notes are things the app did or reported — a save that
landed, a chain that went in, a tone that was written — and lines marked as hand
edits are changes the player made on the unit or in the editor themselves.

If someone asks a question rather than requesting a change — what amp is this,
what does that control do, is this saved, why did you pick that, what did Angus
actually use — answer it in "understood" and return no actions. A question is
never a failure and is never off topic: leave "refused" empty for it. "refused"
is only for a change that cannot be made, and it says why and what would work
instead. Never tell the player a question is not about the preset or the rig.

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

A scene has a name of its own, and renameScene changes it: the index in "scene"
(null means the scene the unit is in) and the name in "text". That is a
different thing from renamePreset, which names the whole preset — "call this
scene Dimebag" is renameScene and must never be answered with renamePreset.

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

VOLUME

"Turn it down a little", "quieter", "louder", "more volume" — with no block
named — is the loudness of the whole preset, and the control for it is the amp
block's Level (the block whose slug is amp), moved within what rule 5 allows:
about a tenth of its range for "a little". With no amp on the grid, use the
Level of the last block in the chain that has one. Output and its level are the
player's (rule 4) — never answer a volume request by touching them, and never
refuse one because of them. If a scene is named, the channel rule below applies
exactly as for any other value.

NEVER ANSWER WITH SILENCE

Every reply carries words. "understood" says what you did, in the player's
terms — "Amp level down a touch, 6.2 to 5.4". With no actions, "refused" says
why not and what would work instead. An empty reply reads to the player as
"nothing to change", which is never true of a request they made.

Ordering matters. Structural changes come before the values that depend on
them: a block must be in place before its parameters are set, and changing a
model resets that block's parameters, so set the model before its values.

Reply with the actions and nothing else.`

/** Older turns as the model should read them: who said what, and what was a note. */
export function historyTurns(history, { keep = 24, chars = 2400 } = {}) {
  return (Array.isArray(history) ? history : [])
    .slice(-keep)
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const text = m.text.slice(0, chars)
      if (m.role === 'assistant') return { role: 'assistant', content: text }
      if (m.role === 'user') return { role: 'user', content: text }
      if (m.role === 'hand') return { role: 'user', content: `(Hand edit, by me: ${text})` }
      return { role: 'user', content: `(App note: ${text})` }
    })
}

/**
 * The last design, said small enough to sit beside the preset.
 *
 * Fifty-two parameter values are not what "why" is about; the block, the model
 * it was given and how many settings moved are. The summary and notes go
 * whole — they are the reasoning.
 */
export function describeDesign(design) {
  if (!design || typeof design !== 'object') return undefined
  const changes = Array.isArray(design.changes) ? design.changes : []
  return {
    name: design.name || undefined,
    askedFor: design.description || undefined,
    summary: design.summary || undefined,
    notes: design.notes || undefined,
    applied: design.applied === true ? 'written to the unit' : 'designed, not yet written',
    changes: changes.slice(0, 40).map((c) => {
      const params = Array.isArray(c.params) ? c.params : []
      return {
        block: c.name,
        model: c.typeName || undefined,
        bypassed: c.bypassed === true ? true : undefined,
        settings: params.slice(0, 12).map((p) => `${p.name} ${p.to ?? p.value}${p.unit || ''}`),
        more: params.length > 12 ? params.length - 12 : undefined
      }
    })
  }
}

export default async function handler(req, res) {
  // Local mode serves this app from the player's own machine, so the page is a
  // cross-origin caller here. Preflight is answered and nothing else runs.
  if (cors(req, res)) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const model = resolveModel(MODEL_NAME)
  if (!model) {
    res.status(500).json({ error: 'No model key configured.' })
    return
  }

  const {
    instruction,
    device,
    blocks,
    grid,
    scene,
    sceneNames,
    sceneCount,
    presetName,
    presetNumber,
    history,
    design,
    taste,
    corrections
  } = req.body || {}

  if (!instruction || typeof instruction !== 'string') {
    res.status(400).json({ error: 'Say what you want changed.' })
    return
  }
  /*
   * An empty preset is a thing to answer, not a thing to refuse.
   *
   * This used to require at least one block, and that single line defeated a
   * feature that was already finished: buildChain exists precisely to lay a
   * chain into an empty preset, the instructions below already explain it, and
   * they already tell the model that a tone description on an empty preset is
   * still designTone because the chain gets put there first. None of it could
   * ever run, because the request was refused before the model was asked.
   *
   * "Still need to fix the issue when generating on an empty preset."
   *
   * So only the shape is checked. A preset with no blocks reaches the model
   * with an empty list, which is exactly what the instructions describe.
   */
  if (!Array.isArray(blocks)) {
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
    placeable: grid?.palette || [],
    /*
     * The tone this conversation designed, with the designer's reasoning.
     *
     * Without this the chat could see that "52 changes" were written and
     * nothing about why — so "why did you choose those amps" had no answer
     * anywhere on the server. The App keeps the last design even after the
     * panel has been cleared; `applied` says whether it reached the unit.
     */
    design: describeDesign(design),
    taste: typeof taste === 'string' && taste.trim() ? taste : undefined,
    corrections: typeof corrections === 'string' && corrections.trim() ? corrections : undefined
  }

  /*
   * The same request, in two shapes: the chat's model with room to think,
   * and — only if that is refused — the designer's model, plain.
   *
   * Room to think, at a modest effort: "is 'make it heavier' a nudge or a
   * redesign" and "why did this design pick a 2204" are judgement, and a
   * moment of it is cheap next to the roster the request already carries.
   * Passed only to the Anthropic provider directly; the gateway route is a
   * plain model string and its defaults stand.
   */
  const attempts = [
    {
      model,
      ...(typeof model === 'string'
        ? {}
        : {
            providerOptions: {
              anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' }
            }
          })
    }
  ]
  if (FALLBACK_MODEL !== MODEL_NAME) attempts.push({ model: resolveModel(FALLBACK_MODEL) })

  const ask = (attempt, nudge = null) =>
    generateObject({
      ...attempt,
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
        // Earlier turns, so "a bit more" and "put that back" mean something —
        // and so "why did you do that" has the that. Trimmed rather than whole:
        // the preset state below is always current, and stale block data from
        // an hour ago is worse than no memory at all. Notes the app wrote into
        // the transcript are labelled, so the model does not read "Chain in:
        // Amp (3), Cab (4)" as something the player said.
        ...historyTurns(history),
        {
          role: 'user',
          content: `Preset right now:\n${JSON.stringify(state)}\n\nInstruction: ${instruction}`
        },
        ...(nudge ? [{ role: 'user', content: nudge }] : [])
      ]
    })

  /*
   * Nothing back is not an answer, and the app has a line for it — "I couldn't
   * work out what to change for that. Name the control…" — which is the line
   * a player saw after asking what the agent would do for a band. The
   * instructions say never to answer with silence; this is the route holding
   * the model to it, once, before the app's fallback shows.
   */
  const silent = (o) =>
    !(o?.understood || '').trim() && !(o?.refused || '').trim() && !(o?.actions || []).length
  const NUDGE =
    '(Your reply had no words in it. Answer the player in "understood" — the question above ' +
    'deserves a real answer in plain language, even if there is nothing to change.)'

  /*
   * A fallback that ran is said, not hidden. The reply carries which model
   * was tried first and why it was refused, so the cost panel can show it
   * and a person reading the logs can tell "the account has no Opus" from
   * "the chat is set to Sonnet".
   */
  let last = null
  let fellBackFrom = null
  for (const attempt of attempts) {
    try {
      let { object, usage } = await ask(attempt)
      if (silent(object)) {
        console.warn('command: empty reply, asking once more')
        ;({ object, usage } = await ask(attempt, NUDGE))
      }
      const used = attempt.model
      res.status(200).json({
        ...object,
        _usage: {
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          cachedInputTokens:
            usage?.cachedInputTokens ?? usage?.inputTokenDetails?.cacheReadTokens ?? null,
          model: typeof used === 'string' ? used : used?.modelId || MODEL_NAME,
          configured: MODEL_NAME,
          ...(fellBackFrom
            ? { fellBackFrom, fallbackReason: String(last?.message || '').slice(0, 300) }
            : {})
        }
      })
      return
    } catch (err) {
      last = err
      const tried = attempt.model
      fellBackFrom = typeof tried === 'string' ? tried : tried?.modelId || MODEL_NAME
      console.warn(`command: ${fellBackFrom} refused — ${String(err?.message || err).slice(0, 300)}`)
    }
  }
  res.status(502).json({ error: `Could not work that out: ${last?.message || 'no answer'}` })
}
