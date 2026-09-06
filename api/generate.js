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
import { sceneInstruction } from './_scenes.js'

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

/**
 * The id field, narrowed to the ids this preset actually holds.
 *
 * Rule 1 has always said "only use effect ids that appear in the supplied block
 * list", and a model that reads it still invented three. On a four-slot AM4
 * holding compressor, drive, amp and reverb, one run asked for 70, 82 and 94 —
 * blocks the unit has never heard of in this preset — and every change riding
 * on them was dropped at the validator, so the player got a partial tone and a
 * wall of red.
 *
 * A rule is a request. An enum is not: a structured-output schema that lists
 * the four legal numbers cannot express a fifth, so the failure stops being
 * possible rather than being caught after the fact. The validator keeps its own
 * check regardless — a schema is the model's constraint, not a guarantee about
 * what arrives over a network.
 *
 * `z.literal([...])` rather than a union of literals on purpose: it emits
 * `{type: 'number', enum: [...]}`, which is the shape a tool schema constrains
 * against, where a union emits `anyOf` and is honoured more loosely.
 */
const eidField = (eids, what) =>
  eids.length ? z.literal(eids).describe(what) : z.number().int().describe(what)

/**
 * An array that cannot be filled when the preset holds no blocks.
 *
 * The narrowing above has a hole exactly where it matters most. `z.literal([])`
 * cannot be built — an enum with no members can never be satisfied — so an
 * empty preset falls back to a plain integer, and the one case where EVERY id
 * is invalid is the one case with no constraint on it at all. The model then
 * did what it always does with an open number: on a preset with nothing in it,
 * it asked to change effects 94, 118, 58, 58, 58 and 66, and the validator
 * threw all six away and printed six identical rejections.
 *
 * `maxItems: 0` is the constraint that CAN be expressed for an empty set. The
 * request has one outlet left then — "wanted", which names the families the
 * tone needs — and that is the only useful answer about a preset with no
 * blocks in it.
 */
const onlyWhenPlaced = (eids, array, whenEmpty) =>
  eids.length ? array : array.max(0).describe(whenEmpty)

const buildPresetSpec = (eids = []) =>
  z.object({
  presetName: z
    .string()
    .describe(
      'Name for the preset, 31 characters or fewer. Mixed case is fine. Make it descriptive of ' +
        'the sound rather than generic — a player scrolling a list of 512 should know what this is.'
    ),
  summary: z.string().describe('One sentence on the approach taken.'),
  /*
   * Somewhere to put a block the tone needs and the preset does not have.
   *
   * The other half of narrowing the id. A model that wants a delay and cannot
   * name one has to do something with the intent, and the something it would
   * otherwise do is hang delay settings on whichever block it can name — which
   * is worse than the invented id it replaced, because nothing rejects it. This
   * field is that intent's proper home: the tone is dialled with what is
   * placed, and what was missing is said out loud instead of faked.
   */
  wanted: z
    .array(z.string())
    .describe(
      'Block families this tone wants that the preset does not have — "delay", "wah". Names ' +
        'only, no ids and no settings: dial the tone with the blocks that ARE placed and list ' +
        'the gaps here. Empty array when the placed chain covers it.'
    ),
  blocks: onlyWhenPlaced(
    eids,
    z.array(
      z.object({
        eid: eidField(eids, 'Effect id, copied from the supplied block list.'),
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
  , 'This preset is EMPTY — it holds no blocks, so there is nothing to change and this MUST stay []. Name every family the tone needs in "wanted" instead.')
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
        engaged: onlyWhenPlaced(
          eids,
          z.array(eidField(eids, 'An effect id that is ON in this scene.')),
          'This preset is EMPTY — there is nothing to switch on, so this MUST stay [].'
        )
          .describe(
            'Effect ids that are ON in this scene. Every other block placed in the preset is off. ' +
              'Copy ids from the supplied block list.'
          ),
        channels: onlyWhenPlaced(
          eids,
          z.array(
            z.object({
              eid: eidField(eids, 'Effect id from the supplied block list.'),
              channel: z.string().describe('Channel letter A, B, C or D this scene plays.')
            })
          ),
          'This preset is EMPTY — there are no blocks to put on a channel, so this MUST stay [].'
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

1. Only use effect ids that appear in the supplied block list. If the tone needs
   a block this preset does not have, name its family in "wanted" and dial the
   tone with what is placed. Never hang that block's settings on a different
   block to stand in for it.
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
7. Balance, Pan and Output are the player's gain staging, not yours — never set
   them. A block's own Level you may move, but only a little: within about 15%
   of the control's full range from where it sits now, and never into the
   bottom fifth of that range. It is there for real asks — a lead sound that
   has to be louder than the rhythm one — not for balancing the mix, and a
   Level walked to its floor hands back a preset that looks right and makes no
   sound, which the app refuses however it is worded.

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
12. Name every scene you return. The name is written to the unit and is what
    the player reads on the front panel and on their footswitch — an unnamed
    scene keeps whatever name was there before, which is somebody else's.

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

  const {
    description,
    device,
    blocks,
    previous,
    mode,
    sceneNames,
    taste,
    corrections,
    wantScenes,
    /*
     * How many scenes the player asked for, when they said. Null or absent
     * leaves it to the model's own judgement, which is rule 11's three or four.
     */
    sceneBudget,
    trace
  } =
    req.body || {}

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
  /*
   * A model, with nothing on it that says nothing.
   *
   * A roster entry arrives as {value, name, manufacturer, basedOn}, and for
   * most families both lineage fields are null on every single entry — the unit
   * does not carry them. Sent as-is that is `"manufacturer":null,"basedOn":null`
   * three hundred and thirty-one times in the amp roster alone: a fifth of the
   * biggest part of the request, spent saying nothing, and read by a model that
   * has to decide those fields are not worth attending to.
   *
   * Dropping them puts the rosters back to what they measured before any
   * lineage was added, WITH the lineage on the entries that have it.
   */
  const trim = (models) =>
    models.map((m) => ({
      value: m.value,
      name: m.name,
      ...(m.manufacturer ? { manufacturer: m.manufacturer } : {}),
      ...(m.basedOn ? { basedOn: m.basedOn } : {})
    }))

  const rosters = {}
  const reference = {}
  for (const block of [...blocks].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (block.models?.length && !rosters[block.slug]) rosters[block.slug] = trim(block.models)
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
   * Whether the player was asked, and what they said.
   *
   * A preset with no scene named yet has nothing to lose, so the app asks
   * before it builds: one sound, a few, or every scene the unit has. An answer
   * is a decision and overrides rule 10's judgement in both directions - "just
   * the one sound" must not come back with four scenes the player then has to
   * switch off, and "a set" must not come back with none. A number overrides
   * rule 11 too. See ./_scenes.js, which the app shares so that the question
   * and the instruction cannot disagree about what "all of them" means.
   */
  const asked = sceneInstruction({ wantScenes, sceneBudget, sceneCount: state.sceneCount })

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
   * What this player has already had to fix by hand.
   *
   * The other half of the same idea, and the sharper one. Taste says what they
   * choose; this says what we keep getting wrong for them — a control they
   * always end up turning down, a word they always end up saying. It is only
   * ever assembled once the same correction has happened enough times to be a
   * habit rather than a mood (src/lib/corrections.js), so an empty string here
   * is the normal case and costs nothing.
   *
   * Capped like the taste block, and for the same reason: it arrives in a
   * request body this endpoint cannot verify.
   */
  const fixes =
    typeof corrections === 'string' && corrections.trim()
      ? corrections.trim().slice(0, 2000)
      : null

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
  /*
   * Everything the model was given, for a person trying to work out why a tone
   * missed.
   *
   * "Can you look into how the AI actually is figuring out what tones to
   * generate and what knobs to do, where the source is coming from? A lot of
   * the tones don't really match up very well."
   *
   * The honest answer is worth being able to see rather than take on trust:
   * apart from the unit's own model names and parameter ranges, there is no
   * reference material here at all. No corpus of real presets, no per-artist
   * data, nothing retrieved. The model is working from what it knows about
   * amps and pedals, aimed by the rules below and by this player's own
   * history. When a tone misses, it missed for a reason that is in here.
   *
   * Off unless asked for. The rosters alone are ~11k tokens and there is no
   * sense paying to send them back to every player who will never look.
   * Summarised even then — the counts and the names are what tells you whether
   * the model could have picked the thing you wanted; the full roster is
   * already on screen in the block pickers.
   */
  const traced = trace
    ? {
        model: MODEL_NAME,
        system: SYSTEM,
        task: task + asked,
        taste: context,
        corrections: fixes,
        // What it was told is on the unit right now.
        state,
        // What it was allowed to choose from, by family.
        rosters: Object.fromEntries(
          Object.entries(rosters).map(([slug, models]) => [
            slug,
            { count: models.length, names: models.map((m) => m.name ?? m.label ?? String(m)) }
          ])
        ),
        // What the unit says its own controls do, which is the only tone
        // knowledge in the request that did not come from the model itself.
        reference
      }
    : null

  const args = {
    model,
    maxOutputTokens: 16000,
    /*
     * How hard the model thinks before it says anything, set rather than left
     * to the default.
     *
     * "The AI accepted the request and then sent nothing back for 90 seconds,
     * twice." That was not the AI being slow in a way nobody could help — it
     * was this request asking for the deepest thinking the model does. Claude
     * Sonnet 5 runs adaptive thinking whether or not `thinking` is passed, at
     * effort `high` when none is named, and returns its reasoning with the text
     * omitted by default. None of that produces an object partial, so a phone
     * watching `partialObjectStream` sees nothing at all for the whole thinking
     * phase — on a request carrying every roster the unit has, comfortably past
     * the ninety seconds the browser waits.
     *
     * Medium, because of what this call actually is: the tone judgement lives
     * in a long and very prescriptive system prompt, and the model's job here
     * is to apply it and emit a constrained object. That is nearer extraction
     * than open reasoning, and the top of the effort range earns its latency on
     * problems that are neither. An env var so it can be tuned against real
     * tones without a deploy.
     */
    providerOptions: { anthropic: { effort: process.env.GENERATOR_EFFORT || 'medium' } },
    // Narrowed to this preset's own ids, so an id it does not hold cannot be
    // returned at all. Built per request because every preset holds a different
    // four (or twelve) of them.
    schema: buildPresetSpec(blocks.map((b) => b.eid).filter((e) => Number.isInteger(e))),
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
              `you must use when changing a model. "basedOn" and "manufacturer" name the real ` +
              `amp or pedal each one is modelled on — the unit cannot print those names, so ` +
              `"Brit 800 2204 High" is a Marshall JCM 800 and "Rat Distortion" is a Pro Co RAT. ` +
              `Use them to answer a request that names real gear, and say the model's own name ` +
              `back rather than the real one, because that is what is written on the unit:\n` +
              `${JSON.stringify(rosters)}\n\n` +
              `What each block and control actually does, from the device's own reference:\n` +
              `${JSON.stringify(reference)}`,
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
          },
          {
            type: 'text',
            text:
              `Current state of the loaded preset:\n${JSON.stringify(state)}\n\n${task}${asked}` +
              (context ? `\n\n${context}` : '') +
              (fixes ? `\n\n${fixes}` : '')
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
    /*
     * Every frame is pushed, not just the first.
     *
     * This flushed the hello and nothing after it, and that is a difference
     * that only shows up in production: whatever sits between this function and
     * a phone can hold a few hundred bytes of ndjson waiting for more to
     * accumulate, and a partial is a few hundred bytes. So the hello arrived
     * instantly — proving the route was open — and then the model streamed into
     * a buffer while the browser sat on a clock that gives up after ninety
     * seconds with no partial.
     *
     * Reported as exactly that shape: "the AI accepted the request and then
     * sent nothing back for 90 seconds, twice". The stream was almost certainly
     * running the whole time.
     *
     * One helper, so a frame added later cannot be the unflushed one.
     */
    const send = (frame) => {
      res.write(JSON.stringify(frame) + '\n')
      if (typeof res.flush === 'function') res.flush()
    }

    send({ type: 'open' })

    /*
     * Proof of life while the model is thinking.
     *
     * The hello says the route is open and the first partial says the model has
     * started; between them there was nothing, and the browser cannot tell a
     * model deep in thought from a pipe that died. It waited ninety seconds and
     * then said so — correctly, on the evidence it had.
     *
     * A frame every ten seconds is that evidence. It costs nothing, it keeps
     * whatever sits in between from deciding the connection is idle, and it
     * carries how long the wait has been so the screen can say it out loud
     * rather than going quiet and hoping.
     */
    const startedAt = Date.now()
    let beating = setInterval(() => {
      send({ type: 'waiting', ms: Date.now() - startedAt })
    }, 10000)
    const stopBeating = () => {
      if (beating) clearInterval(beating)
      beating = null
    }

    try {
      const result = streamObject(args)
      for await (const partial of result.partialObjectStream) {
        // The model has started; the wait this covers is over.
        stopBeating()
        send({ type: 'partial', object: partial })
      }

      const object = await result.object
      const usage = await result.usage
      const meta = (await result.providerMetadata)?.anthropic || {}

      send({
        type: 'done',
        object: {
          ...object,
          // Same trace as the non-streaming path, so a person looking at why
          // a tone missed sees the same thing whichever route it came by.
          ...(traced ? { _trace: traced } : {}),
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
      })
    } catch (err) {
      send({ type: 'error', error: err.message })
    } finally {
      /*
       * Cleared on every way out, not only the happy one. A timer left running
       * writes into a response that has already ended, which on a serverless
       * function is an unhandled error on a request nobody is listening to any
       * more — and holds the invocation open until its own ceiling.
       */
      stopBeating()
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
      ...(traced ? { _trace: traced } : {}),
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
