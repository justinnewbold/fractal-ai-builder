/* Generated from shared/relay-rules.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * What may travel over the relay, how long to wait for it, and what to say
 * when it can't.
 *
 * These rules used to live in `src/lib/remote.js`, which was fine while the
 * browser was the only thing at the far end of the channel. It isn't any more:
 * the phone apps in `mobile/` speak the same protocol to the same host, and a
 * second copy of an allowlist is a second copy that drifts. That has already
 * happened once inside this repo — eight routes disagreed with ForgeFX by the
 * time anyone compared them — and the two failure modes are both bad. Allowing
 * something the host refuses turns a friendly sentence into a bare status code
 * mid-song; refusing something the host allows leaves a dead panel with no
 * explanation at all.
 *
 * So one file, imported by both ends, in the shape `desktop/lib/project.mjs`
 * already proved works: zero imports, plain ESM, readable by Node in the
 * launchers, by Vite for the web bundle, and by Metro for the phone.
 */

/**
 * A verbatim port of the host's own rule — ForgeFX server/src/remote.ts,
 * remoteAllowed(). Keep the two in lockstep, character for character where the
 * shapes allow.
 *
 * ForgeFX refuses everything outside this with a 403 and it is right to: a
 * phone on a dark stage should not be able to overwrite slot 67 or move
 * firmware around. Naming the rule here lets both apps say so plainly instead
 * of surfacing a status code halfway through a song.
 */
export function hostAllows(method, p) {
  if (method === 'GET') return !p.startsWith('/cloud') && !p.startsWith('/remote') && p !== '/debug/raw'
  if (method === 'PUT')
    return (
      /^\/preset\/blocks\/\d+\/params(\/\d+)?$/.test(p) ||
      /^\/preset\/grid\/cell$/.test(p) ||
      /^\/am4\/param$/.test(p) ||
      /^\/device\/param$/.test(p) ||
      p === '/telemetry/config' ||
      /^\/store\/config\/[^/]+$/.test(p)
    )
  if (method === 'POST')
    return (
      /^\/preset\/blocks\/\d+\/(bypass|channel|type|read|readrange)$/.test(p) ||
      p === '/preset/meters' ||
      p === '/preset/select' ||
      p === '/preset/grid/cable' ||
      p === '/preset/grid/select' ||
      p === '/scene' ||
      p === '/tempo' ||
      p === '/tempo/tap' ||
      p === '/tuner' ||
      p === '/mod/bind' ||
      p === '/preset/name' ||
      p === '/scene/name' ||
      /^\/am4\/(bypass|scene|preset)$/.test(p)
    )
  return false
}

/** Friendly phrasings for the refusals people will actually hit. */
export const REMOTE_FORBIDDEN = [
  { match: (m, p) => m === 'POST' && p === '/preset/store', why: 'save to a slot' },
  { match: (m, p) => p.startsWith('/preset/backup'), why: 'back up a preset' },
  { match: (m, p) => p.startsWith('/preset/restore'), why: 'restore a preset' },
  { match: (m, p) => p.startsWith('/backup'), why: 'back up the device' },
  { match: (m, p) => p.startsWith('/version'), why: 'load or restore a version' },
  { match: (m, p) => p.startsWith('/local'), why: 'reach the library on your Mac' },
  { match: (m, p) => m !== 'GET' && p.startsWith('/ports'), why: 'change which port is used' },
  { match: (m, p) => p.startsWith('/firmware'), why: 'touch firmware' },
  { match: (m, p) => p.startsWith('/debug/raw'), why: 'send raw SysEx' }
]

/** One path, one shape, whatever the caller wrote — query strings and trailing slashes off. */
export const cleanPath = (path) => (String(path).split('?')[0] || '').replace(/\/+$/, '') || '/'

/** Why this request can't travel, or null if it can. */
export function forbiddenRemotely(method, path) {
  const clean = cleanPath(path)
  const m = method.toUpperCase()
  if (hostAllows(m, clean)) return null
  // The host will refuse it; say why in words if we have them.
  return (
    REMOTE_FORBIDDEN.find((r) => r.match(m, clean))?.why ||
    'do that from a distance — it only works at the Mac'
  )
}

/**
 * How long to wait for the host, by what was asked of it.
 *
 * Fifteen seconds was fine for the requests that motivated it — a scene change,
 * a parameter write, a preset select. It is not fine for a read that makes the
 * unit dump its whole preset over serial before answering. On an AM4 the block
 * list is exactly that read, and the relay was giving up on it mid-answer,
 * which the gig screen then showed as a preset with no blocks in it.
 *
 * The cost of waiting longer is only ever waiting longer. The cost of giving up
 * early is being told something false about the unit.
 */
const SLOW_READS = [
  /^\/preset\/blocks$/,
  /^\/preset\/blocks\/\d+\/(params|raw|cab)$/,
  /^\/preset\/grid$/,
  /^\/presets\/\d+(\/|$)/,
  /^\/preset\/locations$/,
  /^\/device\/cache/
]

export function timeoutFor(method, path) {
  return SLOW_READS.some((re) => re.test(cleanPath(path))) ? 45000 : 20000
}

/**
 * How long a request waits for a dropped relay before giving up on it.
 *
 * Long enough for realtime-js's own rejoin, which is a couple of seconds on a
 * phone that just came back; short enough that a Mac genuinely gone still says
 * so while someone is still looking at the screen.
 */
export const RELAY_GRACE = 8000

/**
 * Requests that must not be sent twice.
 *
 * Everything else the app relays is a statement of where something should end
 * up — this parameter is 4.5, this block is on channel B, load preset 12 — and
 * arriving twice leaves the unit exactly where arriving once did. Tap tempo is
 * the one that is not: it is a beat, and a resend is a beat that never
 * happened. So the retry covers the whole relay except this.
 */
const NOT_REPEATABLE = [/^\/tempo\/tap$/]

export const repeatable = (path) => !NOT_REPEATABLE.some((re) => re.test(cleanPath(path)))

/**
 * Why this account's requests cannot be trusted right now, or null.
 *
 * Always null: this app no longer refuses to drive a unit because more than
 * one host answered.
 *
 * The detection was never wrong. A host is anything signed into the account
 * that answers a broadcast within the census window — it does not need a unit
 * attached, or to be the Mac in front of you. So an old install, a stray tab
 * left open, or a machine signed in months ago answers exactly like the Mac
 * doing the work, and the banner was right that two things replied.
 *
 * It was the consequence that was wrong. What it protected against is a write
 * landing on two units at once, which needs two hosts each with an amp plugged
 * into it. Answering a census is not that, and the two were treated as the
 * same thing — so a setup with one amp was told to choose between two Macs,
 * repeatedly, with no choice that settled it and a stage in front of it.
 *
 * Removed deliberately and by the owner's decision, for a rig with one unit.
 * The cost is named rather than hidden: with two hosts each holding an amp, a
 * write now reaches both and nothing here will say so. Host addressing is
 * untouched and still narrows a request to the chosen Mac where the hosts are
 * new enough to honour it — this only stops the refusal.
 *
 * The signature is kept so callers and the host-picker still work unchanged.
 */
export function hostConflict() {
  return null
}

/**
 * Supabase's auth errors are terse and one of them is actively misleading.
 *
 * An unconfirmed account fails with wording that sounds like a wrong password,
 * which sends you off changing credentials that were right all along.
 */
export function explainAuth(message) {
  const m = (message || '').toLowerCase()
  if (m.includes('not confirmed') || m.includes('email not confirmed')) {
    return 'That email hasn’t been confirmed yet. Look for the confirmation email, then try again.'
  }
  if (m.includes('invalid login')) {
    return 'Email or password didn’t match.'
  }
  return message
}

/**
 * Turn the answers to a roll call into names, one per Mac that replied.
 *
 * An answer that cannot be read still counts. The count is the part that
 * matters — it is what decides whether anything may be written — and a Mac that
 * answered in a shape we did not expect is still a Mac that would carry out the
 * next write. Losing it from the list would turn a fault back into silence.
 */
export async function hostNamesFrom(answers, read) {
  const named = []
  for (const answer of answers) {
    let name = null
    try {
      const body = JSON.parse(await read(answer))
      name = body?.data?.name || body?.name || null
    } catch {
      // Unreadable, but present. See above.
    }
    named.push(typeof name === 'string' && name.trim() ? name.trim() : 'a Mac')
  }
  return named
}
