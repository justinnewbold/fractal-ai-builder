/**
 * Sending a bug report or an idea, from the phone.
 *
 * THE PHONE IS WHERE THE BAD EVENINGS HAPPEN, and until now it was the one
 * surface with nowhere to say so. The browser has had this for a while; a
 * handset on a dark stage had a log it could copy and no way to send it, which
 * meant the report only ever arrived if somebody remembered to paste it into a
 * message later, from a different device, after the gig.
 *
 * What a report contains is decided in shared/report-rules.mjs, copied here by
 * `npm run sync:rules`. This file is only the part that is genuinely the
 * phone's: which client, which account, and what a handset knows about itself.
 *
 * The table is insert-only — anybody can write one and nobody can read them
 * back with the key that ships in the app — and works signed out, which
 * matters because a phone that cannot reach its computer often cannot reach
 * its account either, and that is exactly when somebody wants to complain.
 */
import { Dimensions, Platform } from 'react-native'

import {
  KINDS,
  MAX_MESSAGE,
  buildReport,
  carriesLog,
  contextFrom,
  lastErrorFrom,
  pickForReport,
  trimToBytes
} from './report-rules'
import { DEFAULT_PROJECT, supabaseClient } from './relay'
import { APP_VERSION } from './version'
import { formatLine, getDebugLog } from './debugLog'
import { linkState } from './link'

export { KINDS, MAX_MESSAGE, carriesLog }

/**
 * What was going on when they wrote it.
 *
 * Nothing identifying. No preset contents, no account details, nothing else
 * typed into the app — what someone chose to write, and what shape of setup
 * they were on.
 */
export function context({ deviceName } = {}) {
  const link = linkState()
  const win = Dimensions.get('window')
  return contextFrom({
    version: APP_VERSION,
    /* The computer's version as well. "The phone is on 7.344 and the Mac is on
       7.191" is the answer to a surprising number of reports, and it is the one
       fact nobody would think to type. */
    macVersion: link?.hostVersion,
    /* The phone tracks the unit as a name off the rig, not an object — see
       lib/rig.js, where `deviceName` is caps.short or caps.name. */
    unit: deviceName,
    role: link?.link,
    platform: 'phone',
    /* No expo-device here, so this is what a handset can honestly say about
       itself: which OS and which version of it. Enough to tell an iOS 17 bug
       from an Android one, which is the whole of what a layout report needs. */
    os: `${Platform.OS} ${Platform.Version}`,
    screen: win?.width ? `${Math.round(win.width)}x${Math.round(win.height)}` : undefined,
    lastError: lastErrorFrom(getDebugLog())
  })
}

/**
 * Exactly the log that would be sent, as text — for showing somebody first.
 *
 * The same two functions the send path calls, in the same order, so what is
 * shown cannot drift from what goes. Empty string for a kind that carries no
 * log, so a caller can show nothing without asking a second question.
 */
export function logPreview(kind) {
  if (!carriesLog(kind)) return ''
  return trimToBytes(pickForReport(getDebugLog()).map(formatLine).join('\n'))
}

/**
 * Post one report.
 *
 * Throws with something a person can read. The failure that matters is having
 * no network at all — common on a stage, and it must not lose what they typed,
 * so the caller keeps the text on screen when this rejects.
 */
export async function sendReport({ kind, message, contact, context: ctx = {}, withLog = true }) {
  const row = buildReport({
    kind,
    message,
    contact,
    context: ctx,
    /* Read at send and at no other moment. Nothing is gathered while somebody
       types, so a report abandoned half-written leaves no copy anywhere. */
    lines: withLog ? getDebugLog() : [],
    format: withLog ? formatLine : null
  })

  let c = supabaseClient()
  let userId = null
  if (c) {
    try {
      const { data } = await c.auth.getUser()
      userId = data?.user?.id || null
    } catch {
      // No session is not a problem; it goes as an anonymous report.
    }
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    c = createClient(DEFAULT_PROJECT.url, DEFAULT_PROJECT.anonKey)
  }

  const { error } = await c.from('feedback').insert({ ...row, user_id: userId })

  if (error) {
    throw new Error(
      /fetch|network/i.test(error.message || '')
        ? "Couldn't reach the internet to send that. What you wrote is still here — try again in a moment."
        : `That didn't send: ${error.message}`
    )
  }
  return true
}
