/**
 * Saving to a slot from a phone, which a phone cannot do.
 *
 * "After a chain or setting has been updated there needs to be a save button
 * that actually writes it and saves it to the unit."
 *
 * The computer refuses POST /preset/store from a phone — see REMOTE_FORBIDDEN
 * in relay-rules — and it is right to: a stray tap on a dark stage must not
 * overwrite slot 67. What a phone CAN do is leave a request in the computer's
 * store, and the app at the computer has been carrying those out for weeks:
 * it looks every six seconds, checks the request is fresh and that the unit
 * is still on the preset the phone was editing, writes the slot, and leaves
 * an answer in the store under the request's id. The browser on a phone has
 * used this since the Save sheet said "the computer writes it". The phone app
 * never did; now it does, through the same two documents, so the two ends
 * cannot drift.
 *
 * Pure: the store reads and writes and the clock are handed in.
 */

/** How long to wait for the computer before saying it has not picked it up. */
export const SAVE_WAIT_MS = 3 * 60 * 1000
/** How often to look for the answer. */
export const SAVE_POLL_MS = 3000

/** The documents both ends use, by the unit's slug. */
export const pendingSaveDoc = (slug) => `fractal.pendingSave.${slug}`
export const saveResultDoc = (slug) => `fractal.saveResult.${slug}`

/** A request id nobody else will produce. */
export const saveId = (now = Date.now(), random = Math.random) =>
  `p${now.toString(36)}${Math.floor(random() * 1e6).toString(36)}`

/**
 * Ask the computer to save what the unit is playing over `slot`, and wait for
 * its answer.
 *
 * Resolves `{ ok: true, slot }` when the computer says it wrote it, `{ ok:
 * false, error }` when it says it could not or when it has not answered
 * within the wait. Never throws for a slow computer: a save that has not
 * happened yet is a state to say, not a fault.
 */
export async function askComputerToSave({
  park,
  readResult,
  slot,
  name = '',
  id = saveId(),
  waitMs = SAVE_WAIT_MS,
  pollMs = SAVE_POLL_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now
}) {
  if (!Number.isInteger(slot)) return { ok: false, error: 'No preset is loaded to save.' }
  try {
    /* `fromSlot` is what lets the computer refuse a save if the unit has moved
       on to another preset by the time it looks. */
    await park({ id, slot, name: String(name || '').trim(), fromSlot: slot, fromName: name || null })
  } catch (err) {
    return { ok: false, error: `Couldn’t leave the request for the computer: ${err?.message || err}` }
  }
  const until = now() + waitMs
  while (now() < until) {
    await sleep(pollMs)
    let res = null
    try {
      res = await readResult()
    } catch {
      res = null
    }
    if (res && res.id === id) {
      return res.ok
        ? { ok: true, slot: Number.isInteger(res.slot) ? res.slot : slot }
        : { ok: false, error: res.error || 'The computer could not save it.' }
    }
  }
  return {
    ok: false,
    error:
      'The computer has not picked this up. It carries out a save only while its app window is open — open it there, and the request is still waiting for it.'
  }
}
