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

/** Lower runs first. */
const ORDER = {
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
  setTempo: 10
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
          run: async () =>
            (await device()).setParamConfirmed(
              block.eid ?? block.effectId,
              param.id,
              raw.value,
              param
            )
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
          run: async () => (await device()).setType(block.eid ?? block.effectId, model.value)
        })
        break
      }

      case 'setBypass': {
        if (!need(block, `No block with effect id ${raw.eid}.`)) break
        if (!need(typeof raw.flag === 'boolean', `${block.name}: bypass needs true or false.`)) break
        actions.push({
          ...raw,
          label: `${block.name} ${raw.flag ? 'bypassed' : 'engaged'}`,
          run: async () => (await device()).setBypass(block.eid ?? block.effectId, raw.flag)
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
          run: async () => (await device()).setChannel(block.eid ?? block.effectId, raw.text)
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
        if (!need(typeof raw.value === 'number', 'No block type given to place.')) break
        if (!need(inGrid(raw.row, raw.col, rows, cols), `Row ${raw.row}, column ${raw.col} is off the grid.`))
          break
        actions.push({
          ...raw,
          label: `Place a block at row ${raw.row}, column ${raw.col}`,
          run: async () => (await device()).placeBlock(raw.row, raw.col, raw.value)
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
          run: async () => (await device()).clearCell(raw.row, raw.col)
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
        const count = capabilities?.sceneCount ?? 8
        if (!need(raw.scene >= 0 && raw.scene < count, `There's no scene ${raw.scene + 1}.`)) break
        actions.push({
          ...raw,
          label: `${block.name} ${raw.flag ? 'off' : 'on'} in scene ${raw.scene + 1}`,
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
