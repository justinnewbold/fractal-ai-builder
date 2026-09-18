/**
 * What to try when it isn't working, in the order worth trying it.
 *
 * Written for somebody standing in front of a rig that has stopped answering,
 * possibly on a stage, possibly in the dark. So: the thing most likely to fix
 * it first, no jargon, and never "check your configuration" — every step is a
 * thing you can physically do.
 *
 * ONE COPY, BOTH ENDS. The browser and the phone show the same guide, because
 * a fix that exists on one and not the other is a fix somebody cannot find
 * from wherever they happen to be standing. mobile/src/lib/troubleshooting.js
 * is generated from this file by `npm run sync:rules`.
 *
 * Each fix has an `id` because the error notices link to one: a message that
 * says what went wrong and offers nothing to do about it is where this started.
 */
import { isOlder } from './versions.mjs'

export const FIXES = [
  {
    id: 'frozen',
    title: 'The unit stopped answering',
    when: 'Everything was working, and now nothing moves.',
    steps: [
      'Turn the unit off, wait five seconds, and turn it back on. An FM3 or AM4 does occasionally lock up; this clears it and costs nothing.',
      'Give it about ten seconds to finish starting before expecting this app to find it again.',
      'If the app still says nothing is connected, unplug the USB cable at both ends and plug it back in.'
    ]
  },
  {
    id: 'connect',
    title: 'It will not connect at all',
    when: 'The app has never found the unit, or stopped finding it after a restart.',
    steps: [
      'Check the USB cable is a data cable. A charge-only cable fits perfectly and carries nothing — this is the single most common cause.',
      'Try a different USB port, straight into the computer rather than through a hub.',
      'Make sure the computer app is actually running. It lives in the menu bar, not the Dock.',
      'If the phone cannot reach the computer, check both are on the same wifi, and that a firewall or a VPN on the computer is not blocking it.'
    ]
  },
  {
    id: 'versions',
    title: 'The app and the computer disagree',
    when: 'Things half-work: a screen is blank, a button does nothing, or something that worked yesterday does not.',
    steps: [
      'Check the versions below. The app and the computer app should be on the same number.',
      'If the computer app is behind, let it update — it checks on its own, and there is an Updates panel in Setup.',
      'Reload this page, or force-quit and reopen the phone app, once the computer has updated.'
    ]
  },
  {
    id: 'preset',
    title: 'A preset will not load, or loads wrong',
    when: 'The name is stale, the blocks are from the preset before, or nothing changes when you pick one.',
    steps: [
      'Pick the preset again. The computer holds what it last read for a few seconds, and asking twice gets past it.',
      'Use Read the unit again, under Setup, to throw away everything cached and start from the hardware.',
      'If the names in the list are wrong or missing, scan the preset list again from the preset sheet.'
    ]
  }
]

/** A fix by id, for the notices that link to one. */
export const fixById = (id) => FIXES.find((f) => f.id === id) || null

/**
 * Which fix an error message points at.
 *
 * Deliberately a small set of plain signals rather than a parser. An error
 * this cannot place gets no link, which is honest — a wrong fix offered
 * confidently costs more than no fix offered at all.
 */
export function fixFor(message) {
  const said = String(message || '').toLowerCase()
  if (!said) return null
  /*
   * WHICH THING IS NAMED DECIDES IT, and that ordering is the whole subtlety.
   * "The unit stopped answering" and "the computer is not answering" are the
   * same words about different boxes, and they want opposite advice: power
   * cycle the one in front of you, or go and look at the cable and the app on
   * the computer. So the computer is asked about first, and silence from
   * anything else falls through to the unit.
   */
  const quiet = /timed out|timeout|no answer|not answering|stopped answering|not responding|unreachable/.test(said)
  const computer = /computer|mac|host|helper|server/.test(said)
  /* Before the computer, because "the computer app is older than this one"
     names the computer only to say whose version it is talking about. */
  if (/version|older than|out of date|update/.test(said)) return 'versions'
  if (computer) return 'connect'
  if (/not connected|no unit|cannot find|no device|disconnected|gone/.test(said)) return 'connect'
  if (quiet) return 'frozen'
  if (/preset|slot|name/.test(said)) return 'preset'
  return null
}

/**
 * Whether the pieces are on the same version, said in a sentence.
 *
 * TWO OF THE THREE, and the third is named rather than guessed at. The app
 * knows its own version and the computer tells it one (see link.js), so those
 * two can be compared. The unit's FIRMWARE is not something either end can
 * read — no route on the device server reports it — so this says so instead of
 * leaving a row that looks like a check nobody ran.
 *
 * `null` for the computer's version is its own answer, not an error: a
 * computer app older than 7.205.0 never sent one, and so did every phone
 * running on the relay before that.
 */
export function versionsInSync({ app, host }) {
  if (!app) return { state: 'unknown', says: 'This app cannot tell what version it is.' }
  if (!host)
    return {
      state: 'unknown',
      says: 'The computer has not said which version it is running. That is normal on older versions of the computer app.'
    }
  if (app === host) return { state: 'ok', says: `Both on v${app}.` }
  const behind = isOlder(host, app)
  if (behind === null) return { state: 'unknown', says: `This app is v${app}; the computer said "${host}".` }
  return behind
    ? {
        state: 'behind',
        says: `The computer app is v${host} and this one is v${app}. Let the computer update, then reload this app.`
      }
    : {
        state: 'ahead',
        says: `The computer app is v${host} and this one is v${app}. Reload this app to catch up.`
      }
}

/** What the guide says about the one version nobody can read. */
export const FIRMWARE_NOTE =
  'The unit’s own firmware version is not something this app can read — check it on the unit itself, under Setup.'
