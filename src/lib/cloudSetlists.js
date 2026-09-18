/**
 * Setlists and stars, following the account rather than the browser.
 *
 * "This says that setlists stay in this browser. Can we set that up to save to
 * the database across the cloud if user is signed in?"
 *
 * They were browser storage for the same reason the stars were: a convenience
 * nobody would grieve. That was true when a setlist was a handful of taps. It
 * stopped being true the moment one was a night's running order — built at the
 * bench on the Mac, and then not on the phone that is actually on the stand.
 *
 * WHAT IS LEFT IN THIS FILE is the row: reading the account's copy and writing
 * it back. The deciding — which copy of a setlist wins, what a delete beats,
 * whether two sets of stars union or one replaces the other — moved to
 * lib/setlistMerge, because the phone needs exactly that and needs it to be
 * the same. See the top of that file for the rules; they did not change.
 *
 * The merge is pure and exported on its own. It is the part that can lose
 * somebody's work, so it is the part that is tested without a network.
 */
import { supabaseClient } from './remote.js'
import { localUnits, syncStage } from './setlistMerge.js'

/**
 * Something a person would recognise, for "last written from …".
 *
 * A user agent string is not that. This is the coarse shape of the device and
 * nothing identifying, because the only question it answers is "was that me on
 * the other thing?". It lived in lib/cloudChat.js, which synced the AI
 * conversation between machines; the setlists it was shared with outlived it.
 */
export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const s = String(ua || '')
  if (/iPhone/i.test(s)) return 'iPhone'
  if (/iPad/i.test(s)) return 'iPad'
  if (/Android/i.test(s)) return 'Android'
  if (/Macintosh|computer OS X/i.test(s)) return 'computer'
  if (/Windows/i.test(s)) return 'Windows'
  return 'a browser'
}

export {
  applyUnits,
  gained,
  localUnits,
  mergeUnit,
  mergeUnits,
  sameUnits
} from './setlistMerge.js'

const TABLE = 'stage_lists'

/** Whether syncing is possible at all right now. Signed out is not an error. */
export const setlistCloudReady = () => !!supabaseClient()

/**
 * What the account is holding, or null.
 *
 * Never throws. A phone opening on a dead network still has its own setlists,
 * and failing over a fetch would take the stage screen down with it.
 */
export async function loadCloudSetlists() {
  const client = supabaseClient()
  if (!client) return null
  try {
    const { data, error } = await client.from(TABLE).select('units,updated_at,device').maybeSingle()
    if (error || !data) return null
    return {
      units: data.units && typeof data.units === 'object' ? data.units : {},
      at: data.updated_at ? Date.parse(data.updated_at) : 0,
      device: data.device || null
    }
  } catch {
    return null
  }
}

/** Write this copy up, replacing whatever was there. Upserted, so no read first. */
export async function saveCloudSetlists(units, device = deviceName()) {
  const client = supabaseClient()
  if (!client) return false
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (!userId) return false
    const { error } = await client.from(TABLE).upsert(
      {
        user_id: userId,
        units: units && typeof units === 'object' ? units : {},
        device,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    return !error
  } catch {
    // Offline, or signed out between the check and the write. What is on this
    // device is whole; the next change tries again.
    return false
  }
}

/**
 * One round: read the account, merge it with this browser, write both back.
 *
 * Returns what changed here, so the app can say "picked up 2 setlists from
 * your Mac" rather than quietly rearranging a stage screen somebody is
 * standing in front of.
 */
export async function syncSetlists(storage) {
  if (!setlistCloudReady()) return null
  return syncStage(
    { load: loadCloudSetlists, save: (units) => saveCloudSetlists(units) },
    storage
  )
}

/* Kept so a caller that only wants to know what is here does not have to know
   where the merge lives. */
export { localUnits as localSetlistUnits }
