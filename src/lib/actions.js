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
import { isSilencingParam } from './guardrails.js'

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

/** A placeable entry by name or slug, however the model said it. */
export function resolvePlaceable(palette, text) {
  if (!text) return null
  const want = String(text).toLowerCase().replace(/[^a-z]/g, '')
  return (
    (palette || []).find((b) => b.slug === want) ||
    (palette || []).find((b) => (b.name || '').toLowerCase().replace(/[^a-z]/g, '') === want) ||
    (palette || []).find((b) => b.slug.startsWith(want)) ||
    null
  )
}

const ORDER = {
  loadPreset: -3,
  buildChain: -2.5,
  backupPreset: -2,
  clearCell: 0,
  moveBlock: 1,
  placeBlock: 2,
  setModel: 3,
  setChannel: 4,
  setParam: 5,
  setBypass: 6,
  setSceneBlock: 7,
  setScene: 8,
  renamePreset: 9,
  setTempo: 10,
  savePreset: 20,
  keepInLibrary: 21
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
   * amp on scene 3: parameter values are shared by every scene on this
   * hardware, and only bypass and channel are per scene.
   */
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
            `${block.name} / ${param.name}: parameter values are shared by every scene on this unit, so this can't be changed for ${sceneLabel(
              raw.scene
            )} alone. Switch a block on or off in that scene, or change it for the whole preset.`
          )
        )
          break
        if (
          !need(
            !isSilencingParam(param.name),
            `${block.name} / ${param.name}: output levels are yours to set.`
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
        actions.push({
          ...raw,
          label: `${block.name} → ${model.name}`,
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
        actions.push({
          ...raw,
          label: `${block.name} → channel ${raw.text}`,
          run: async () => {
            const d = await device()
            const eid = block.eid ?? block.effectId
            const res = await d.setChannel(eid, raw.text)
            // Each channel carries its own values — the cached ones belong to
            // the channel we just left.
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
              const palette = await d.blockCatalog()
              const list = Array.isArray(palette) ? palette : palette?.blocks || []
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

      case 'renamePreset': {
        const name = (raw.text || '').trim().slice(0, 31)
        if (!need(name, 'No name given.')) break
        actions.push({
          ...raw,
          label: `Rename to "${name}"`,
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
            const palette = await d.blockCatalog()
            const list = Array.isArray(palette) ? palette : palette?.blocks || []
            const chain = order
              .map((slug) => list.find((b) => b.slug === slug))
              .filter(Boolean)
            if (!chain.length) throw new Error('This unit offers none of those blocks.')

            const width = cols || chain.length
            const fits = chain.slice(0, width)
            for (const [i, block] of fits.entries()) {
              /*
               * Columns are 0-based here — the client converts to the wire's
               * 1-based convention at the boundary, once. This loop used to
               * 1-base them too, so every placement landed one slot right and
               * the last one asked an AM4 for column 5, which it refuses.
               * GridEditor, which passes readGrid's coordinates straight
               * through, was the convention's proof all along.
               */
              const res = await d.placeBlock(1, i, block.page ?? block.effectId)
              if (res?.ok === false) throw new Error(`The unit refused ${block.name}.`)
            }
            // Which blocks exist is the thing that just changed.
            d.invalidateSchema()
            return { ok: true, placed: fits.length }
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

function inGrid(row, col, rows, cols) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 1 && row <= rows && col >= 0 && col <= cols
}

function round(n) {
  if (typeof n !== 'number') return '—'
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
}
