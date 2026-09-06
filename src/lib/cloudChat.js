/**
 * The conversation, following the account rather than the browser.
 *
 * "Also chats should persist and save across the cloud when signed in."
 *
 * lib/session.js already keeps the transcript through a backgrounded phone;
 * this is the other half of the same complaint. Browser storage is per device
 * and per browser: a chat started on the phone was not there on the Mac, and a
 * phone that cleared its site data had nothing anywhere.
 *
 * ## One transcript, not a filing system
 *
 * There is one row per person, because the app has one running conversation —
 * the thing on the Ask screen. Somebody asking for chats to sync wants that
 * conversation to be the same on both devices, not a list of past ones to pick
 * from. A table shaped that way says so and cannot quietly grow into something
 * else.
 *
 * ## Which copy wins
 *
 * The newest one, by the clock on the write. That is the honest rule for a
 * transcript nobody edits in the middle: turns are only ever appended, so the
 * longer, later copy is the one that contains the other. Merging two branches
 * turn by turn would be guessing at an order that no longer exists, and would
 * produce a conversation neither person had.
 *
 * Deliberately not realtime. A transcript that rewrote itself under someone
 * mid-sentence because another device spoke would be worse than one that is a
 * minute stale; this is read when the app opens and written as it changes.
 */
import { supabaseClient } from './remote.js'

const TABLE = 'chats'

/** Whether syncing is possible at all right now. Signed out is not an error. */
export const chatCloudReady = () => !!supabaseClient()

/**
 * This account's transcript, or null when there is none or nobody is signed in.
 *
 * Never throws. A phone opening the app offline, or with an expired session,
 * has a local transcript that is perfectly good — failing the boot over a
 * network hiccup would lose the thing this exists to protect.
 */
export async function loadCloudChat() {
  const client = supabaseClient()
  if (!client) return null
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('turns,updated_at,device')
      .maybeSingle()
    if (error || !data) return null
    return {
      turns: Array.isArray(data.turns) ? data.turns : [],
      at: data.updated_at ? Date.parse(data.updated_at) : 0,
      device: data.device || null
    }
  } catch {
    return null
  }
}

/**
 * Write this device's transcript up, replacing whatever was there.
 *
 * Upserted on the primary key, so the first write for an account creates the
 * row and every one after updates it — no read to decide which, and no race
 * between two devices both finding it absent.
 */
export async function saveCloudChat(turns, device = deviceName()) {
  const client = supabaseClient()
  if (!client) return false
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (!userId) return false
    const { error } = await client.from(TABLE).upsert(
      {
        user_id: userId,
        turns: Array.isArray(turns) ? turns : [],
        device,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    return !error
  } catch {
    // Offline, or signed out between the check and the write. The local copy
    // is still whole and the next change tries again.
    return false
  }
}

/**
 * Which of the two copies to open with.
 *
 * Returns the transcript to use and where it came from, so the app can say
 * "picked up from your Mac" rather than silently replacing what was on screen.
 *
 * A local transcript with turns in it beats an empty cloud one whatever the
 * clocks say — an account that has never synced should not wipe the
 * conversation somebody is in the middle of, and "no row yet" carries a
 * timestamp of zero anyway. Beyond that it is the later write, which for an
 * append-only transcript is the one that contains the other.
 */
export function pickChat(local, cloud) {
  const localTurns = local?.turns?.length ? local.turns : []
  const cloudTurns = cloud?.turns?.length ? cloud.turns : []
  if (!cloudTurns.length) return { turns: localTurns, from: 'here' }
  if (!localTurns.length) return { turns: cloudTurns, from: 'cloud' }
  const localAt = Number(local?.at) || 0
  const cloudAt = Number(cloud?.at) || 0
  return cloudAt > localAt ? { turns: cloudTurns, from: 'cloud' } : { turns: localTurns, from: 'here' }
}

/**
 * Something a person would recognise, for "last written from …".
 *
 * A user agent string is not that. This is the coarse shape of the device and
 * nothing identifying, because the only question it answers is "was that me on
 * the other thing?".
 */
export function deviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const s = String(ua || '')
  if (/iPhone/i.test(s)) return 'iPhone'
  if (/iPad/i.test(s)) return 'iPad'
  if (/Android/i.test(s)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac'
  if (/Windows/i.test(s)) return 'Windows'
  return 'a browser'
}
