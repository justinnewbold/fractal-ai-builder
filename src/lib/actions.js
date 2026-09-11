/**
 * Checking and running a command plan.
 *
 * The model proposes; this decides. Same contract as generated presets: every id
 * is checked against what the device reported, every value against its real
 * range, and anything that fails is dropped and named rather than sent.
 *
 * Ordering is enforced here rather than trusted from the model. Structure has to
 * settle before values that depend on it, and a model swap resets the block's
 * parameters — a plan that sets gain then swaps the amp silently discards the
 * gain.
 */
import { isForbiddenParam, levelLimits } from './guardrails.js'

/**
 * The device functions are loaded when an action runs, not when this module
 * does.
 *
 * Checking a plan is pure — it compares ids and ranges — so it shouldn't drag in
 * the transport, the simulator and its captured rosters just to be imported.
 * Keeping it lazy means the validation logic can be tested on its own, which
 * for the layer that decides what reaches the hardware is worth the indirection.
 */
const device = () => import('./forgefx.js')

/**
 * Lower runs first.
 *
 * Loading replaces everything, so it goes before any edit; saving makes the
 * result permanent, so it goes after. Asking to "load 12, drop the gain and save
 * it back" in one breath then does those three things in the only order that
 * means anything, whatever order they were said in.
 */
/**
 * What goes into an empty preset when nobody says which blocks.
 *
 * Drive into amp into cab is the spine of almost every electric guitar sound;
 * delay and reverb are the two everyone reaches for next. A unit that lacks any
 * of them just gets fewer.
 */
const DEFAULT_CHAIN = ['drive', 'amp', 'cab', 'delay', 'reverb']

/**
 * Where a new block should land when nobody said.
 *
 * The first free column on the row the chain lives on. "Free" is judged
 * against every placed block including input and output rows — the same
 * raw-versus-editable distinction that bit the empty-slot detection, applied
 * in the opposite direction: for occupancy, everything counts.
 */
export function firstFreeCell(blocks, rows, cols) {
  const chainRow =
    [...(blocks || [])]
      .filter((b) => typeof b.row === 'number')
      .sort(
        (a, b) =>
          (blocks || []).filter((x) => x.row === b.row).length -
          (blocks || []).filter((x) => x.row === a.row).length
      )[0]?.row ?? 0
  const taken = new Set(
    (blocks || []).filter((b) => b.row === chainRow && typeof b.col === 'number').map((b) => b.col)
  )
  for (let col = 0; col < (cols || 4); col++) {
    if (!taken.has(col)) return { row: chainRow, col }
  }
  return null
}

/**
 * Where a chain, its input and its output go on a row that already has things
 * on it.
 *
 * Pure, and apart from the action that runs it, because getting this wrong is
 * silent: every value lands, the unit reads them back, the preset saves, and
 * the player hears nothing. That has happened twice — once by building over
 * the output block, and once by building a chain into a genuinely empty preset
 * with no Input block in it, so the guitar never reached the first pedal.
 *
 * Columns are 0-based, the convention the whole app uses inside itself; the
 * client adds the wire's +1 at the boundary.
 *
 * `onRow` is what is already there. `canInput` and `canOutput` say whether the
 * unit offers those as blocks to place at all — a unit that routes its signal
 * some other way gets neither invented for it.
 */
export function chainPlan({ onRow = [], width = 12, count = 0, canInput = false, canOutput = false } = {}) {
  const placed = onRow.filter((b) => Number.isInteger(b?.col))
  const columnOf = (slug) => {
    const found = placed.find((b) => b.slug === slug)
    return found ? found.col : null
  }
  const inputCol = columnOf('input')
  const outputCol = columnOf('output')
  const held = new Set(placed.map((b) => b.col))

  /* Between the two, never over either. */
  const free = []
  for (let col = 0; col < width; col++) {
    if (held.has(col)) continue
    if (inputCol !== null && col < inputCol) continue
    if (outputCol !== null && col > outputCol) continue
    free.push(col)
  }

  /* The input first, because the chain starts to its right. */
  let input = inputCol
  if (input === null && canInput && free.length) input = free.shift()

  const cols = free.slice(0, count)
  let output = outputCol
  if (output === null && canOutput && free.length > cols.length) output = free[cols.length]

  /* Where the cabling has to reach: the output where there is one, the end of
     what was placed where there isn't — the signal has to get there either way. */
  const last = cols.length ? cols[cols.length - 1] : input ?? 0
  return { input, cols, output, wireTo: output ?? Math.max(last, width - 1) }
}

/**
 * What a player calls a block, against what the unit calls it.
 *
 * "Whammy" is a Pitch block with the Whammy type on it; "overdrive" is a
 * Drive; "octaver" is Pitch again. A design that says it wanted a "pitch
 * shifter / whammy" and a chat asked to "add a whammy" both have to land on
 * the one block the unit actually offers, or the answer is "this unit has no
 * block called whammy" — which is false, and was said. Keys are the player's
 * words with everything but letters removed, the way `resolvePlaceable`
 * reads them; values are the unit's slugs, in the order to try.
 */
export const BLOCK_ALIASES = {
  whammy: ['pitch'],
  pitchshifter: ['pitch'],
  pitchshift: ['pitch'],
  shifter: ['pitch'],
  octaver: ['pitch'],
  octave: ['pitch'],
  harmonizer: ['pitch'],
  harmoniser: ['pitch'],
  detune: ['pitch'],
  overdrive: ['drive'],
  distortion: ['drive'],
  fuzz: ['drive'],
  boost: ['drive'],
  od: ['drive'],
  dist: ['drive'],
  comp: ['compressor', 'comp'],
  compression: ['compressor', 'comp'],
  noisegate: ['gate'],
  noise: ['gate'],
  vibrato: ['chorus'],
  leslie: ['rotary'],
  univibe: ['phaser'],
  vibe: ['phaser'],
  trem: ['tremolo'],
  echo: ['delay'],
  verb: ['reverb'],
  room: ['reverb'],
  hall: ['reverb'],
  spring: ['reverb'],
  graphiceq: ['geq'],
  parametriceq: ['peq'],
  equalizer: ['geq', 'peq', 'eq'],
  eq: ['geq', 'peq', 'eq'],
  volume: ['volpan', 'volume'],
  volpan: ['volpan', 'volume'],
  loop: ['looper']
}

/** A placeable entry by name or slug, however the model said it. */
export function resolvePlaceable(palette, text) {
  if (!text) return null
  const list = palette || []
  const want = String(text).toLowerCase().replace(/[^a-z]/g, '')
  if (!want) return null
  const exact = (w) =>
    list.find((b) => b.slug === w) ||
    list.find((b) => (b.name || '').toLowerCase().replace(/[^a-z]/g, '') === w) ||
    null
  const direct = exact(want)
  if (direct) return direct
  // "pitch shifter / whammy" — each half is tried on its own.
  for (const part of String(text).toLowerCase().split(/[\/,]|\bor\b/)) {
    const w = part.replace(/[^a-z]/g, '')
    if (!w || w === want) continue
    const hit = exact(w) || (BLOCK_ALIASES[w] || []).map(exact).find(Boolean)
    if (hit) return hit
  }
  const alias = (BLOCK_ALIASES[want] || []).map(exact).find(Boolean)
  if (alias) return alias
  // "Delay 1" is the first delay; the unit lists it as delay, page N.
  const first = list.find((b) => b.slug.startsWith(want))
  if (first) return first
  // The other way round: "pitch" for "pitchshifter"-style wording the aliases missed.
  return list.find((b) => want.startsWith(b.slug) && b.slug.length >= 3) || null
}

const ORDER = {
  loadPreset: -3,
  buildChain: -2.5,
  backupPreset: -2,
  clearCell: 0,
  moveBlock: 1,
  placeBlock: 2,
  // The channel comes before the model, not after it: a channel holds its own
  // model and its own values, so choosing one after setting a model would put
  // the model on whichever channel was live and then walk away from it.
  setChannel: 2.5,
  setModel: 3,
  setParam: 5,
  setBypass: 6,
  setSceneBlock: 7,
  setScene: 8,
  renameScene: 8.5,
  renamePreset: 9,
  setTempo: 10,
  savePreset: 20,
  keepInLibrary: 21
}

/**
 * What the reply says when the plan has been checked.
 *
 * "Turn the volume down a little" came back as "Nothing to change." — the
 * model had returned no actions and no words, and that was the app's default
 * for a silence. It read as a verdict on the request. The model is now told
 * never to answer with silence, and this is the app's side of the same
 * promise: a reply with nothing in it says so honestly and says what would
 * work, and a plan whose every change was refused says that it was refused,
 * with the reasons listed beneath.
 */
export function replyFor({ understood, refused, actions = [], problems = [] } = {}) {
  if (understood) return understood
  if (refused) return refused
  if (actions.length) return `${actions.length} change${actions.length === 1 ? '' : 's'} ready.`
  if (problems.length) return 'I couldn’t make that change:'
  return 'I couldn’t work out what to change for that. Name the control — “amp level down a little”, “less gain on the drive”, “more reverb”.'
}

export function validatePlan(plan, blocks, capabilities) {
  const problems = []
  const actions = []
  const byEid = new Map(blocks.map((b) => [b.eid ?? b.effectId, b]))

  const rows = capabilities?.slotModel === 'linear' ? 1 : capabilities?.grid?.rows ?? 4
  const cols =
    capabilities?.slotModel === 'linear'
      ? capabilities?.slotCount ?? 4
      : capabilities?.grid?.cols ?? 12

  /*
   * Which scene the unit is in, and what the scenes are called — so a plan
   * aimed at another scene is written there or refused, never quietly landed
   * in the live one. "Brighten scene 2" with scene 3 live used to nudge the
   * amp on scene 3: what a scene remembers per block is its bypass and its
   * channel, and a value belongs to the channel, so a value written "for
   * scene 2" reaches every scene playing that same channel.
   */
  /*
   * Whether the unit is being driven over the relay rather than from the Mac
   * it is plugged into.
   *
   * Two of the actions below reach routes the host refuses from a distance —
   * see REMOTE_FORBIDDEN in shared/relay-rules.mjs. Proposing one anyway meant
   * a plan that applied a whole tone and then failed on the step that would
   * have kept it, reported afterwards as one line among the successes. A tone
   * you can hear and did not keep reads as "it worked", right up until the
   * next preset change takes it away.
   *
   * So they are refused while the plan is still a proposal, in words, before
   * anything is written. The save the manual button does over the relay is a
   * different mechanism (parkSave — the Mac carries it out) and is untouched.
   */
  const remote = capabilities?.remote === true

  const activeScene = typeof capabilities?.activeScene === 'number' ? capabilities.activeScene : null
  const sceneNames = Array.isArray(capabilities?.sceneNames) ? capabilities.sceneNames : []
  const sceneCount = capabilities?.sceneCount ?? 8
  const sceneLabel = (i) => (sceneNames[i] ? `scene ${i + 1} · ${sceneNames[i]}` : `scene ${i + 1}`)
  const aimedElsewhere = (raw) =>
    typeof raw.scene === 'number' && activeScene !== null && raw.scene !== activeScene

  for (const raw of plan?.actions || []) {
    const block = raw.eid !== null && raw.eid !== undefined ? byEid.get(raw.eid) : null
    const need = (ok, message) => {
      if (!ok) problems.push(message)
      return ok
    }

    switch (raw.kind) {
      case 'setParam': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        const param = (block.params || []).find((p) => p.id === raw.paramId)
        if (!need(param, `${block.name}: no parameter ${raw.paramId}.`)) break
        if (!need(typeof raw.value === 'number', `${block.name} / ${param.name}: no value given.`))
          break
        if (
          !need(
            !aimedElsewhere(raw),
            `${block.name} / ${param.name}: a value belongs to the channel this block is on, not to ${sceneLabel(
              raw.scene
            )}, so writing it there would change every scene playing that channel. Give that scene its own channel for ${
              block.name
            } first, then set the value on it — or change it for the whole preset.`
          )
        )
          break
        if (
          !need(
            !isForbiddenParam(param.name),
            `${block.name} / ${param.name}: balance and output routing are yours to set.`
          )
        )
          break
        if (
          typeof param.min === 'number' &&
          !need(
            raw.value >= param.min && raw.value <= param.max,
            `${block.name} / ${param.name}: ${raw.value} is outside ${param.min}–${param.max}.`
          )
        )
          break
        /*
         * A block's own level may move, but only by a nudge. "The amp should be
         * louder when it's on than when it's off" is a real ask and the one
         * control that answers it; walking that same control to its floor hands
         * back a preset that looks right and makes no sound.
         */
        const window = levelLimits(param)
        if (
          window &&
          !need(
            raw.value >= window.floor && raw.value <= window.ceiling,
            `${block.name} / ${param.name}: levels can be nudged, not reset — ${
              raw.value
            } is outside ${round(window.floor)} to ${round(window.ceiling)}.`
          )
        )
          break

        actions.push({
          ...raw,
          label: `${block.name} · ${param.name} ${round(param.value)} → ${round(raw.value)}${
            param.unit || ''
          }`,
          run: async () => {
            const d = await device()
            const eid = block.eid ?? block.effectId
            const res = await d.setParamConfirmed(eid, param.id, raw.value, param)
            // Confirmed by read-back inside setParamConfirmed, so recording it
            // saves re-reading the whole block to learn a number we already had.
            if (res?.ok) d.patchSchemaValue(eid, param.id, raw.value)
            return res
          }
        })
        break
      }

      case 'setModel': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        const model = (block.models || []).find((m) => m.value === raw.value)
        if (!need(model, `${block.name}: model ${raw.value} isn't on this unit.`)) break
        /*
         * With what it is in real life, where that is known.
         *
         * "Amp 1 → Brit 800 2204 High" is the unit's own word for it and means
         * nothing to somebody who has not memorised the roster. This row is
         * where a person decides whether to accept the change, so it is the one
         * place the translation is worth the width.
         */
        const gear = model.basedOn || model.manufacturer || null
        actions.push({
          ...raw,
          label: `${block.name} → ${model.name}${gear ? ` (${gear})` : ''}`,
          run: async () => {
            const d = await device()
            const eid = block.eid ?? block.effectId
            const res = await d.setType(eid, model.value)
            // A model swap resets this block's parameters and their ranges, so
            // anything cached about it is now fiction.
            d.invalidateSchema(eid)
            return res
          }
        })
        break
      }

      case 'setBypass': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        if (!need(typeof raw.flag === 'boolean', `${block.name}: bypass needs true or false.`)) break
        const scene = typeof raw.scene === 'number' ? raw.scene : null
        if (scene !== null && !need(scene >= 0 && scene < sceneCount, `There's no scene ${scene + 1}.`))
          break
        const eid = block.eid ?? block.effectId
        if (scene !== null && scene !== activeScene) {
          // A scene the unit is not in: switch there, write, come back.
          actions.push({
            ...raw,
            label: `${block.name} ${raw.flag ? 'off' : 'on'} in ${sceneLabel(scene)}`,
            run: async () => (await device()).setSceneBlock(scene, eid, { bypassed: !!raw.flag })
          })
          break
        }
        // The scene the unit is in — said out loud, because that is where it lands.
        const where = activeScene !== null ? ` in ${sceneLabel(activeScene)}` : ''
        actions.push({
          ...raw,
          label: `${block.name} ${raw.flag ? 'off' : 'on'}${where}`,
          run: async () => (await device()).setBypass(eid, raw.flag)
        })
        break
      }

      case 'setChannel': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        const channels = capabilities?.channelNames || ['A', 'B', 'C', 'D']
        if (!need(channels.includes(raw.text), `${block.name}: no channel "${raw.text}".`)) break
        const chanScene = typeof raw.scene === 'number' ? raw.scene : null
        if (
          chanScene !== null &&
          !need(chanScene >= 0 && chanScene < sceneCount, `There's no scene ${chanScene + 1}.`)
        )
          break
        const eid = block.eid ?? block.effectId
        /*
         * A channel belongs to a scene, exactly as a bypass does — that pair is
         * what a scene is. So "put the lead scene on channel B" is written by
         * standing in that scene, not in whichever one the unit is in.
         */
        if (chanScene !== null && chanScene !== activeScene) {
          actions.push({
            ...raw,
            label: `${block.name} → channel ${raw.text} in ${sceneLabel(chanScene)}`,
            run: async () => {
              const d = await device()
              const res = await d.setSceneBlock(chanScene, eid, { channel: raw.text })
              // Each channel carries its own values — the cached ones belong to
              // the channel we just left.
              d.invalidateSchema(eid)
              return res
            }
          })
          break
        }
        const inScene = activeScene !== null ? ` in ${sceneLabel(activeScene)}` : ''
        actions.push({
          ...raw,
          label: `${block.name} → channel ${raw.text}${inScene}`,
          run: async () => {
            const d = await device()
            const res = await d.setChannel(eid, raw.text)
            d.invalidateSchema(eid)
            return res
          }
        })
        break
      }

      case 'moveBlock': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        if (!need(inGrid(raw.row, raw.col, rows, cols), `Row ${raw.row}, column ${raw.col} is off the grid.`))
          break
        if (
          !need(
            !blocks.some((b) => b.row === raw.row && b.col === raw.col),
            `Row ${raw.row}, column ${raw.col} is already taken.`
          )
        )
          break

        const from = { row: block.row, col: block.col }
        actions.push({
          ...raw,
          label: `Move ${block.name} to row ${raw.row}, column ${raw.col}`,
          run: async () => {
            const { clearCell: clear, placeBlock: place } = await device()
            // Clear first: a block instance exists once, so placing it in a
            // second cell while it holds the first is undefined. Put it back if
            // the placement is refused rather than losing it.
            await clear(from.row, from.col)
            const res = await place(raw.row, raw.col, block.eid ?? block.effectId)
            if (res?.ok === false) {
              await place(from.row, from.col, block.eid ?? block.effectId)
              throw new Error(`${block.name} could not move — it was put back.`)
            }
          }
        })
        break
      }

      case 'placeBlock': {
        /*
         * "Add a reverb" arrives as a name, because names are what the model
         * can know — type codes differ per unit and the catalog lives here.
         * Resolution and cell-picking happen at run time against the actual
         * device; the model's job is intent, not id arithmetic.
         */
        actions.push({
          ...raw,
          label: raw.text
            ? `Add a ${raw.text}${typeof raw.col === 'number' ? ` in slot ${raw.col + 1}` : ''}`
            : `Place a block at row ${raw.row}, column ${raw.col}`,
          run: async () => {
            const d = await device()
            let typeCode = typeof raw.value === 'number' ? raw.value : null
            if (typeCode === null) {
              const list = await d.placeableBlocks()
              const hit = resolvePlaceable(list, raw.text)
              if (!hit) throw new Error(`This unit has no block called "${raw.text}".`)
              typeCode = hit.page ?? hit.effectId
            }
            let { row, col } = raw
            if (typeof col !== 'number') {
              const cell = firstFreeCell(blocks, rows, cols)
              if (!cell) throw new Error('Every slot is in use — remove something first.')
              row = cell.row
              col = cell.col
            }
            if (!inGrid(row, col, rows, cols)) {
              throw new Error(`Row ${row}, column ${col} is off the grid.`)
            }
            const res = await d.placeBlock(row, col, typeCode)
            // The chain changed; which blocks exist is no longer what we cached.
            d.invalidateSchema()
            return res
          }
        })
        break
      }

      case 'clearCell': {
        if (!need(inGrid(raw.row, raw.col, rows, cols), `Row ${raw.row}, column ${raw.col} is off the grid.`))
          break
        const occupant = blocks.find((b) => b.row === raw.row && b.col === raw.col)
        actions.push({
          ...raw,
          label: `Remove ${occupant?.name || 'the block'} from row ${raw.row}, column ${raw.col}`,
          destructive: true,
          run: async () => {
            const d = await device()
            const res = await d.clearCell(raw.row, raw.col)
            // The chain changed; which blocks exist is no longer what we cached.
            d.invalidateSchema()
            return res
          }
        })
        break
      }

      case 'setScene': {
        const count = capabilities?.sceneCount ?? 8
        if (!need(raw.value >= 0 && raw.value < count, `There's no scene ${raw.value + 1}.`)) break
        actions.push({
          ...raw,
          label: `Switch to scene ${raw.value + 1}`,
          run: async () => (await device()).setScene(raw.value)
        })
        break
      }

      case 'setSceneBlock': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        if (!need(raw.scene >= 0 && raw.scene < sceneCount, `There's no scene ${raw.scene + 1}.`)) break
        actions.push({
          ...raw,
          label: `${block.name} ${raw.flag ? 'off' : 'on'} in ${sceneLabel(raw.scene)}`,
          run: async () =>
            (await device()).setSceneBlock(raw.scene, block.eid ?? block.effectId, {
              bypassed: !!raw.flag
            })
        })
        break
      }

      case 'renameScene': {
        /*
         * Naming a scene, by saying so.
         *
         * The chat could rename the preset and nothing else, so "change scene
         * name to Dimebag" came back as "I don't have a way to rename an
         * individual scene" — which was true, and the reason was that this case
         * did not exist. It is a different write from renamePreset and lands in
         * a different place: the preset keeps its name.
         */
        const sceneName = (raw.text || '').trim().slice(0, 31)
        if (!need(sceneName, 'No name given for the scene.')) break
        const which = typeof raw.scene === 'number' ? raw.scene : activeScene
        if (!need(typeof which === 'number', 'Say which scene to name.')) break
        if (!need(which >= 0 && which < sceneCount, `There's no scene ${which + 1}.`)) break
        actions.push({
          ...raw,
          label: `Name ${sceneLabel(which)} "${sceneName}"`,
          run: async () => (await device()).setSceneName(which, sceneName)
        })
        break
      }

      case 'renamePreset': {
        const name = (raw.text || '').trim().slice(0, 31)
        if (!need(name, 'No name given.')) break
        actions.push({
          ...raw,
          label: `Rename the preset to "${name}"`,
          run: async () => (await device()).setPresetName(name)
        })
        break
      }

      case 'setTempo': {
        if (!need(raw.value >= 20 && raw.value <= 400, `${raw.value} BPM is out of range.`)) break
        actions.push({
          ...raw,
          label: `Tempo → ${raw.value} BPM`,
          run: async () => (await device()).setTempo(raw.value)
        })
        break
      }

      /*
       * Saving, loading and backing up are here for the same reason every other
       * action is: anything reachable by hand should be sayable. "Save this to
       * 67" was the obvious hole — the model could rebuild an entire preset and
       * then had no way to keep it.
       */
      case 'savePreset': {
        const number = raw.value
        if (!need(Number.isInteger(number) && number >= 0, `${number} isn't a slot number.`)) break
        if (
          !need(
            !remote,
            `Saving to a slot only works at the Mac, so slot ${number} was left alone.`
          )
        )
          break
        const name = (raw.text || '').trim().slice(0, 31)
        actions.push({
          ...raw,
          label: name
            ? `Save "${name}" to slot ${number}`
            : `Save to slot ${number}`,
          // Overwrites whatever is in that slot, so it asks first.
          destructive: true,
          run: async () => {
            const d = await device()
            if (name) await d.setPresetName(name)
            return d.storePreset(number)
          }
        })
        break
      }

      case 'loadPreset': {
        const number = raw.value
        if (!need(Number.isInteger(number) && number >= 0, `${number} isn't a slot number.`)) break
        actions.push({
          ...raw,
          label: `Load slot ${number}`,
          // Anything unsaved in the edit buffer goes with it.
          destructive: true,
          run: async () => {
            const d = await device()
            const res = await d.selectPreset(number)
            // Different preset, different everything.
            d.invalidateSchema()
            return res
          }
        })
        break
      }

      case 'backupPreset': {
        if (!need(!remote, 'Backing up to a file only works at the Mac.')) break
        actions.push({
          ...raw,
          label: 'Back up this preset to a file',
          run: async () => {
            const d = await device()
            const dump = await d.backupPreset(raw.value ?? undefined)
            const bytes = dump?.bytes
            if (!Array.isArray(bytes) || !bytes.length) {
              throw new Error('The unit returned no data.')
            }
            const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            const safe = (dump.name || 'preset').trim().replace(/[^\w-]+/g, '_')
            a.href = url
            a.download = `${String(raw.value ?? 0).padStart(3, '0')}-${safe}.syx`
            a.click()
            URL.revokeObjectURL(url)
          }
        })
        break
      }

      /*
       * Keeping a tone as a file on disk. Unlike savePreset this overwrites
       * nothing on the unit, so it doesn't stop to ask — a file appearing in a
       * folder is not a loss.
       */
      case 'keepInLibrary': {
        const name = (raw.text || '').trim().slice(0, 60)
        actions.push({
          ...raw,
          label: name ? `Keep "${name}" as a file` : 'Keep this preset as a file',
          run: async () => {
            // Writes into the folder chosen with the picker, the same one the
            // Library panel uses. There is no path to pass anywhere: a folder
            // handle grants access without revealing where the folder lives.
            const { savedFolder, writePresetFile } = await import('./localFolder.js')
            const folder = await savedFolder()
            if (!folder || folder.needsPermission) {
              throw new Error(
                'No preset folder chosen yet — pick one in Library first, under "Presets on this Mac".'
              )
            }
            const d = await device()
            const dump = await d.backupPreset(raw.value ?? undefined)
            const bytes = dump?.bytes
            if (!Array.isArray(bytes) || !bytes.length) {
              throw new Error('The unit returned no data.')
            }
            return writePresetFile(folder, name || dump.name || 'preset', bytes)
          }
        })
        break
      }

      /*
       * Build a chain into an empty preset.
       *
       * The grid editor could already do this and the assistant could not, so
       * an empty slot was a dead end you had to leave the conversation to get
       * out of. Named blocks in order, or a sensible default chain.
       *
       * The catalog is fetched at run time rather than validated against here:
       * which blocks a unit offers is a device question, and an AM4's four
       * slots hold a different chain than an FM3's grid.
       */
      case 'buildChain': {
        const wanted = (raw.text || '')
          .split(/[,>\s]+/)
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean)
        const order = wanted.length ? wanted : DEFAULT_CHAIN
        actions.push({
          ...raw,
          label: `Build a chain: ${order.join(' → ')}`,
          run: async () => {
            const d = await device()
            const list = await d.placeableBlocks()
            const chain = order
              .map((slug) => list.find((b) => b.slug === slug))
              .filter(Boolean)
            if (!chain.length) throw new Error('This unit offers none of those blocks.')

            const width = cols || chain.length
            const linear = capabilities?.slotModel === 'linear'

            /*
             * WHAT IS ALREADY IN THE ROW, WHICH IS NOT NOTHING.
             *
             * A slot this app calls empty is a slot with nothing EDITABLE in
             * it: the input and the output are filtered out of that count on
             * purpose, because they are not blocks a player tunes. They are
             * still cells on the grid — and the chain was being written
             * straight over the top of them from column 0.
             *
             * A preset with no output block cannot make a sound and has no
             * level for the volume slider to move, which is exactly what came
             * back from the stage: "the volume slider disappeared and no
             * presets have sound". The slider is fed by the output block; it
             * had been built over.
             *
             * So the chain goes in the free cells between the two, and
             * neither of them is touched.
             */
            let existing = []
            if (!linear) {
              try {
                existing = await d.presetBlocks()
              } catch {
                // A grid that will not read is not a reason to refuse to build
                // one; it only means placing from the left, as this always did.
                existing = []
              }
            }
            const onRow = existing.filter((b) => b.row === 1)

            /*
             * WHAT IS ALREADY IN THE ROW, WHICH IS NOT NOTHING — and what is
             * missing from it, which on an empty preset is everything.
             *
             * A slot this app calls empty is a slot with nothing EDITABLE in
             * it: the input and the output are filtered out of that count on
             * purpose, because they are not blocks a player tunes. They are
             * still cells on the grid. Where they go, and where the chain goes
             * between them, is worked out by chainPlan — pure, tested, and in
             * one place, because both halves of this have been wrong in
             * production and both were silent.
             */
            const has = (slug) => list.some((b) => b.slug === slug)
            const plan = chainPlan({
              onRow,
              width,
              count: linear ? Math.min(chain.length, width) : chain.length,
              canInput: !linear && has('input') && !existing.some((b) => b.slug === 'input'),
              canOutput: !linear && has('output') && !existing.some((b) => b.slug === 'output')
            })

            /*
             * Columns are 0-based here — the client converts to the wire's
             * 1-based convention at the boundary, once. This loop used to
             * 1-base them too, so every placement landed one slot right and
             * the last one asked an AM4 for column 5, which it refuses.
             * GridEditor, which passes readGrid's coordinates straight
             * through, was the convention's proof all along.
             */
            const cells = linear
              ? chain.slice(0, width).map((block, i) => [i, block])
              : chain.slice(0, plan.cols.length).map((block, i) => [plan.cols[i], block])
            if (!cells.length) throw new Error('This preset has no free cells to build into.')

            /*
             * THE INPUT GOES IN FIRST, IF THIS PRESET HASN'T GOT ONE.
             *
             * The output half of this was already here, because a preset with
             * no output makes no sound and the volume slider has nothing to
             * move. The input half was missing and it is the same fault from
             * the other end: on the FM3 the guitar arrives through an Input
             * block that sits on the grid, so a preset that had been genuinely
             * cleared — every cell empty, which is what a brand new preset
             * often is — got a drive in column 0 with nothing feeding it.
             *
             * A refused placement is not fatal: the chain is still worth
             * building, and the wiring report below is what tells the player
             * the row has a gap in it.
             */
            let inputAt = plan.input
            if (!linear && plan.input !== null && !onRow.some((b) => b.slug === 'input')) {
              const into = list.find((b) => b.slug === 'input')
              if (into) {
                const res = await d.placeBlock(1, plan.input, into.page ?? into.effectId)
                if (res?.ok === false) inputAt = null
              }
            }

            for (const [col, block] of cells) {
              const res = await d.placeBlock(1, col, block.page ?? block.effectId)
              if (res?.ok === false) throw new Error(`The unit refused ${block.name}.`)
            }

            /*
             * And an output block, if this preset hasn't got one.
             *
             * Nothing reaches the jack without it. A unit that doesn't offer
             * one as a placeable block routes its output some other way and is
             * left alone.
             */
            let outputAt = plan.output
            if (!linear && plan.output !== null && !onRow.some((b) => b.slug === 'output')) {
              const out = list.find((b) => b.slug === 'output')
              if (out) {
                const res = await d.placeBlock(1, plan.output, out.page ?? out.effectId)
                if (res?.ok === false) outputAt = null
              }
            }

            /*
             * And WIRE it, which is the difference between a chain and five
             * blocks that make no sound.
             *
             * An empty preset has no cabling, so blocks placed into one sit
             * outside the signal path: every value lands, the unit reads them
             * back, the preset saves, and the player hears nothing. That is
             * exactly what happened to every tone built from an empty slot.
             *
             * A linear unit has no grid and nothing to wire — an AM4's four
             * slots are in the path by being slots.
             */
            let wiring = null
            if (!linear) {
              wiring = await d.wireRow(1, outputAt ?? plan.wireTo)
            }
            // Which blocks exist is the thing that just changed.
            d.invalidateSchema()
            /*
             * A refused cable is reported, not thrown. The blocks are in and
             * the tone that follows is still worth having; what the player
             * needs is to be told that the row has a gap in it, which is the
             * one thing that would make the finished preset silent. Throwing
             * here would abandon the design over a wire he can join himself.
             */
            return { ok: true, placed: cells.length, wiring, input: inputAt, output: outputAt }
          }
        })
        break
      }

      default:
        problems.push(`Don't know how to "${raw.kind}".`)
    }
  }

  actions.sort((a, b) => (ORDER[a.kind] ?? 99) - (ORDER[b.kind] ?? 99))

  return {
    understood: plan?.understood || '',
    refused: plan?.refused || '',
    usage: plan?._usage || null,
    actions,
    problems
  }
}

/** Run a checked plan in order, collecting failures rather than stopping. */
export async function runPlan(actions, onProgress) {
  const failures = []
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    onProgress?.(i + 1, actions.length, action.label)
    try {
      const res = await action.run()
      if (res?.ok === false) failures.push(`${action.label} — the unit refused it.`)
    } catch (err) {
      failures.push(`${action.label} — ${err.message}`)
    }
  }
  return failures
}

/**
 * Which of those actually landed, given what runPlan handed back.
 *
 * "Did 2 things — Amp 1 · Treble 1 6 → 5, Amp 1 · Presence 1 5 → 4, Amp 1 ·
 * Treble 1 6 → 5 — the unit refused it., Amp 1 · Presence 1 5 → 4 — the unit
 * refused it." Both changes listed as done and then both listed as refused, in
 * the debug log, which is the one place anybody goes to find out what a session
 * really did. Nothing was wrong on the unit; the line was written by pasting
 * every label next to every failure and calling the total a result.
 *
 * runPlan reports a failure as the action's own label with a reason on the end,
 * so a label that appears in no failure is a change that took.
 */
export function landedOf(actions, failures) {
  const said = failures.map((f) => String(f))
  return actions.filter((a) => !said.some((f) => f.startsWith(`${a.label} — `)))
}

function inGrid(row, col, rows, cols) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 1 && row <= rows && col >= 0 && col <= cols
}

function round(n) {
  if (typeof n !== 'number') return '—'
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
}
