import { Platform } from 'react-native'

import { supabaseClient } from './relay'
import { sync, watch } from './store'
import { syncStage } from './setlistMerge'

/**
 * Setlists and stars, shared with the Mac.
 *
 * This is the point of the whole thing. A night's running order is built at the
 * bench, on a Mac, with a keyboard — and then played from a phone on a stand.
 * A setlist that only existed on whichever machine made it would be a setlist
 * you had to build twice.
 *
 * WHAT IS IN THIS FILE is only the row: reading the account's copy and writing
 * it back. The deciding — which copy of a setlist wins, what a delete beats,
 * whether two sets of stars union or one replaces the other — is
 * `lib/setlistMerge`, which is the browser's own file copied here by
 * `npm run sync:rules`. That split is deliberate: the merge is the part that
 * can lose somebody's work, so it is the part neither app gets to have its own
 * opinion about. The transport is the part that is allowed to differ, because
 * the two apps reach Supabase through different modules and nothing depends on
 * how.
 *
 * NOTHING HERE THROWS. A phone opening on a dead network still has the setlist
 * it is holding, and failing over a fetch would take the stage screen down with
 * it. Every failure reads as "the account had nothing to add", which is the
 * same thing as a first run.
 */

const TABLE = 'stage_lists'

/**
 * What to call this device in the "picked up 2 setlists from…" line.
 *
 * The browser reads it off the user agent and says iPhone, iPad, Android, Mac
 * or Windows. There is no user agent here and no guessing needed — the app
 * knows which build it is.
 */
export const deviceName = () => (Platform.OS === 'ios' ? 'iPhone' : 'Android')

/** Whether syncing is possible at all right now. Signed out is not an error. */
export const setlistCloudReady = () => !!supabaseClient()

/** What the account is holding, or null. */
async function load() {
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
async function save(units) {
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
        device: deviceName(),
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    return !error
  } catch {
    // Offline, or signed out between the check and the write. What is on this
    // phone is whole; the next change tries again.
    return false
  }
}

/** One round: read the account, merge it with this phone, write both back. */
export async function syncSetlists() {
  if (!setlistCloudReady()) return null
  try {
    return await syncStage({ load, save }, sync)
  } catch {
    return null
  }
}

/**
 * Keep it in step for as long as the app is open.
 *
 * One round now, and another two seconds after anything is written here. The
 * delay is what stops every drag through a running order being its own round
 * trip — moving a song three places up is three writes and one sync.
 *
 * The browser does this on its two change events; the phone has one, because
 * every write to setlists and stars alike passes through lib/store.
 *
 * Returns the stop, so signing out takes the loop with it.
 */
export function keepSetlistsInStep(onSynced) {
  let timer = null
  let alive = true

  const round = async () => {
    if (!alive) return
    const res = await syncSetlists()
    /* Only when something actually arrived. A sync that changed nothing is the
       ordinary case and is not news. */
    if (alive && (res?.gained?.lists || res?.gained?.stars)) onSynced?.(res)
  }

  round()

  const stop = watch(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(round, 2000)
  })

  return () => {
    alive = false
    if (timer) clearTimeout(timer)
    stop()
  }
}
