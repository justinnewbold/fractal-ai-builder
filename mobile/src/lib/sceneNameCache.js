import { hydrate, sync } from './store'

/**
 * What each preset's scenes were called, the last time this phone saw them.
 *
 * "When you switch preset, it takes about 5 to 10 seconds for the scene names
 * to load." They come from the preset's summary, which makes the unit dump the
 * preset over serial — behind the chain read, which is another dump — so the
 * tiles sat numbered for the length of two dumps and a relay round trip.
 *
 * Names are the one thing on the stage screen that hardly ever change, so the
 * ones read last time are shown at once, and corrected only if the unit says
 * otherwise. Under the browser's own key and in its shape, per unit and per
 * slot: slot 97 on an AM4 is not slot 97 on an FM3.
 */
const KEY = 'fractal.sceneNames'

/** The key for one slot on one unit. */
export const sceneNameKey = (owner, number) => `${owner}:${number}`

const readAll = () => {
  try {
    const all = JSON.parse(sync.getItem(KEY) || '{}')
    return all && typeof all === 'object' ? all : {}
  } catch {
    return {}
  }
}

const clean = (names) =>
  Array.isArray(names) ? names.map((n) => (typeof n === 'string' ? n.trim() : '')) : []

/** The names kept for a slot, or an empty list. Waits for the disk once. */
export async function recallSceneNames(owner, number) {
  if (!owner || !Number.isInteger(number)) return []
  await hydrate()
  const hit = clean(readAll()[sceneNameKey(owner, number)])
  return hit.some((n) => n) ? hit : []
}

/** Write a slot's names down. Nothing is written for a slot with no names. */
export function rememberSceneNames(owner, number, names) {
  if (!owner || !Number.isInteger(number)) return false
  const kept = clean(names)
  if (!kept.some((n) => n)) return false
  const all = readAll()
  all[sceneNameKey(owner, number)] = kept
  sync.setItem(KEY, JSON.stringify(all))
  return true
}
