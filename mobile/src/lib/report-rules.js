/* Generated from shared/report-rules.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * What a report carries, and what it must never carry.
 *
 * "Add a way to submit the debug log. Keep the last 200 lines plus the last
 * 10 errors, only when they press send, cap it around 100KB, and attach the
 * versions, OS, device, connection and last error automatically. Let them see
 * it before it goes." And, separately: "a feedback and feature suggestion
 * section, separate from bug reports, with no debug log, an optional email,
 * and a different inbox."
 *
 * TWO KINDS AND THEY ARE NOT THE SAME THING, which is the rule everything
 * else here hangs off. A bug report is useless without the log; a feature
 * suggestion has no business carrying one. Somebody writing "it would be nice
 * if the tuner were bigger" has not consented to sending a transcript of
 * their evening, and would be right to be annoyed to find they had. So
 * `carriesLog` answers that question in one place and both apps ask it rather
 * than each deciding.
 *
 * WHY THE RULES LIVE HERE rather than in either app. The phone is where the
 * bad evenings happen and the browser is where they get read, and a phone
 * that trimmed the log differently would produce reports that look like a
 * different app's. The shape of a report is not a detail either end should
 * own.
 */

/** What a report can be. Two, because a third would only ever be "other". */
export const KINDS = ['bug', 'idea']

/** The longest message the table will take, mirrored so the box can say so. */
export const MAX_MESSAGE = 4000

/** The tail of the log that goes with a bug report. */
export const LOG_LINES = 200

/**
 * Plus the last errors, however far back they are.
 *
 * The 200-line window alone loses the thing that matters in exactly the case
 * that matters most: a crash early in a long session, followed by an hour of
 * ordinary traffic that pushes it out. Those ten are pulled back in wherever
 * they were, so a report about "it broke when I started and has been odd
 * since" carries both halves.
 */
export const LOG_ERRORS = 10

/**
 * And the whole thing fits in this.
 *
 * A number that exists because a text column with no ceiling is a text column
 * somebody eventually pastes a megabyte into. It is generous — 200 lines is
 * nowhere near it in normal use — so the cap only bites when a single line is
 * enormous, which is precisely when something has gone wrong enough to be
 * worth truncating rather than refusing.
 */
export const LOG_BYTES = 100_000

/** Whether a kind of report carries the log at all. Only one does. */
export const carriesLog = (kind) => kind === 'bug'

/** The lines that count as trouble, by the source they were written with. */
export const isTrouble = (entry) => entry?.source === 'error' || entry?.source === 'crash'

/**
 * Which lines go, given the whole log.
 *
 * The last `LOG_LINES`, plus any of the last `LOG_ERRORS` troubles that fell
 * outside that window, back in the order they happened. Never a copy of a
 * line already in the window — an error inside the last 200 is simply there.
 *
 * Takes the array rather than reading the log itself, so it can be tested
 * with a log nobody had to produce, and so the phone and the browser can each
 * hand it their own.
 */
export function pickForReport(lines = []) {
  const all = Array.isArray(lines) ? lines : []
  const from = Math.max(0, all.length - LOG_LINES)

  /* The two halves cannot overlap — one is taken from before `from` and the
     other from after it — so this needs no de-duplicating. Index order, not
     timestamp order: lines written in the same millisecond are common, and
     the array is already the order they happened in. */
  const older = all.slice(0, from).filter(isTrouble).slice(-LOG_ERRORS)
  return [...older, ...all.slice(from)]
}

/**
 * Cut text to the cap, from the FRONT.
 *
 * Which end to drop is the whole of this function. The lines just before a
 * failure are the ones that explain it; the ones an hour earlier are context
 * somebody might like. Truncating the end would throw away the answer and
 * keep the preamble, which is the wrong way round and is what a naive
 * `slice(0, cap)` does.
 *
 * What is dropped is said rather than silently gone, because a reader who
 * cannot tell a short log from a trimmed one will read the first surviving
 * line as the beginning of the story.
 */
export function trimToBytes(text, cap = LOG_BYTES) {
  const s = String(text ?? '')
  /* Bytes, not characters: the column's limit is bytes and a log full of
     em-dashes and arrows is not the length it looks. */
  const size = (v) => (typeof TextEncoder === 'undefined' ? v.length : new TextEncoder().encode(v).length)
  if (size(s) <= cap) return s

  const lines = s.split('\n')
  const kept = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = size(lines[i]) + 1
    if (bytes + cost > cap - 80) break
    kept.unshift(lines[i])
    bytes += cost
  }
  const gone = lines.length - kept.length
  return [`… ${gone} earlier line${gone === 1 ? '' : 's'} left out to fit`, ...kept].join('\n')
}

/**
 * What was going on, which is the part a person cannot be expected to type.
 *
 * The difference between a report that can be acted on and one that cannot is
 * almost always this: which version, which unit, how they were connected, and
 * what the last thing to go wrong was.
 *
 * NOTHING IDENTIFYING. No preset contents, no account details, nothing else
 * typed into the app. Every field is one the app already knows about itself,
 * and a field with nothing in it is left out rather than sent empty — an
 * `unit: ""` reads like a unit that answered with a blank name.
 */
export function contextFrom({
  version,
  macVersion,
  unit,
  role,
  platform,
  os,
  device,
  screen,
  language,
  lastError
} = {}) {
  const out = {}
  const put = (k, v) => {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  }
  put('version', version)
  /* Both ends, when there are two. "The phone is on 7.344 and the Mac is on
     7.191" is the answer to a surprising number of reports. */
  put('macVersion', macVersion)
  put('unit', unit)
  put('role', role)
  put('platform', platform)
  put('os', os)
  put('device', device)
  put('screen', screen)
  put('language', language)
  put('lastError', lastError)
  return out
}

/**
 * The last thing that went wrong, for the line above.
 *
 * Deliberately the message only. A stack trace belongs in the log, where it
 * is in order with everything around it; repeated at the top of the context
 * it is noise in the one place that should be readable at a glance.
 */
export function lastErrorFrom(lines = []) {
  const all = Array.isArray(lines) ? lines : []
  for (let i = all.length - 1; i >= 0; i--) {
    if (isTrouble(all[i])) return all[i].message || all[i].detail || ''
  }
  return ''
}

/**
 * Everything a report sends, assembled once so both apps send the same shape.
 *
 * Returns the log as `null` rather than an empty string when the kind does
 * not carry one — a column that is null says "no log was sent", and a column
 * holding "" says "a log was sent and it was empty", and those are different
 * answers to the question a reader is actually asking.
 */
export function buildReport({ kind, message, contact, context = {}, lines = [], format }) {
  const body = String(message ?? '').trim()
  if (!KINDS.includes(kind)) throw new Error('Say whether this is a bug or an idea.')
  if (!body) throw new Error('Write something first.')
  if (body.length > MAX_MESSAGE) throw new Error('That is longer than this box can send.')

  let log = null
  if (carriesLog(kind) && typeof format === 'function') {
    const picked = pickForReport(lines)
    log = trimToBytes(picked.map(format).join('\n'))
  }

  return {
    kind,
    message: body,
    contact: String(contact ?? '').trim() || null,
    context,
    log
  }
}
