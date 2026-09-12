/**
 * One log for everything, in the order it happened.
 *
 * "Make a unified debug log with a copy log button to send back to you for
 * debugging." Until now the record of a bad evening was in four places: the
 * wire log and the verification log in forgefx.js, the generation log in
 * stream.js, the app's own change log in App, and whatever the browser
 * console had — which on a phone is nowhere. Each was a table of one kind of
 * thing, and none of them said what happened BETWEEN the things, so "the
 * tone took four minutes and then the write said ok:false" could not be read
 * off any of them in that order.
 *
 * Every one of those sources now also writes a line here, with the time and
 * where it came from, and errors and crashes that never reached any of them
 * land here too. The panel in Setup shows it and copies it — the whole thing,
 * with the version and the unit at the top — so the report is one paste.
 *
 * Plain arrays, no React: this is written to from library code that must
 * not know about components, and read by one panel that subscribes.
 */

const MAX = 400
const lines = []
const listeners = new Set()

/** How much of a detail is worth keeping on one line. */
const DETAIL_CHARS = 320

function compact(detail) {
  if (detail === undefined || detail === null || detail === '') return ''
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) return detail.message || String(detail)
  try {
    const s = JSON.stringify(detail)
    return s.length > DETAIL_CHARS ? `${s.slice(0, DETAIL_CHARS)}…` : s
  } catch {
    return String(detail)
  }
}

/**
 * Write a line. `source` is where it came from — ai, wire, check, unit, app,
 * error, crash — and is the first thing a reader filters by.
 */
export function logDebug(source, message, detail) {
  const entry = { at: Date.now(), source: String(source || 'app'), message: String(message ?? ''), detail: compact(detail) }
  lines.push(entry)
  if (lines.length > MAX) lines.splice(0, lines.length - MAX)
  for (const fn of listeners) {
    try {
      fn(entry)
    } catch {
      // A listener that throws must not take the log down with it.
    }
  }
  return entry
}

/** Oldest first — the order a person reads a story in. */
export const getDebugLog = () => lines.slice()

export function clearDebugLog() {
  lines.length = 0
  for (const fn of listeners) {
    try {
      fn(null)
    } catch {
      // As above.
    }
  }
}

/** Hear every new line. Returns the function that stops listening. */
export function onDebugLog(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function stamp(at) {
  const d = new Date(at)
  const two = (n) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function formatLine(entry) {
  return `${stamp(entry.at)} [${entry.source}] ${entry.message}${entry.detail ? ` — ${entry.detail}` : ''}`
}

/**
 * The whole log as text, with what a reader needs first at the top: which
 * build, which unit, which end of the link, what kind of screen.
 */
export function formatDebugLog(header = {}, extra = '') {
  const head = Object.entries(header)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  const body = lines.length ? lines.map(formatLine) : ['(nothing logged yet this session)']
  return [...head, '', `${lines.length} lines, oldest first`, ...body, ...(extra ? ['', extra] : [])].join('\n')
}

/**
 * What the Mac's device server said about itself, as lines for the report.
 *
 * The shape is ForgeFX's /diag: whether its port to the unit is open and
 * which, what it resolved, the serial ports it can see, the last ten times
 * it found its port closed and opened it again (`reopens`), and the last
 * lines it said (`recent`). A port lost once is a cable; a port lost every
 * few seconds is something else; and the phone's own log shows both as
 * "port not open".
 */
export function formatMacDiag(d) {
  if (!d || typeof d !== 'object') return ''
  const serial = Array.isArray(d.ports?.serial) ? d.ports.serial : []
  const ports = serial.map((p) => `${p.id}${p.fractal ? ' (Fractal)' : ''}`).join(', ') || 'none'
  // Neither field exists on a Mac app older than 7.191.0, and "0 times" is
  // not what that means.
  const reopens = Array.isArray(d.reopens) ? d.reopens : null
  const recent = Array.isArray(d.recent) ? d.recent : null
  const traffic = d.traffic
  return [
    "MAC'S DEVICE SERVER",
    `port to the unit: ${d.transportOpen ? 'open' : 'NOT OPEN'}${d.transportLabel ? ` · ${d.transportLabel}` : ''}`,
    `resolved: ${d.resolved ? `${d.resolved.transport} ${d.resolved.id}` : 'no unit found'}`,
    `serial ports: ${ports}`,
    `detected: ${d.detected ? 'yes' : 'no'} · profile ${d.profile?.key || '?'} · telemetry ${d.telemetryMode || '?'}`,
    typeof d.uptime === 'number' ? `server up: ${Math.round(d.uptime / 60)} min` : null,
    traffic ? `traffic: ${traffic.txMsgs ?? '?'} sent, ${traffic.rxMsgs ?? '?'} received since ${traffic.since || '?'}` : null,
    d.listError ? `port listing error: ${d.listError}` : null,
    reopens
      ? `port lost and reopened: ${reopens.length} time${reopens.length === 1 ? '' : 's'}`
      : 'port lost and reopened: this Mac app does not say (older than 7.191.0)',
    ...(reopens || []).map((r) => `  ${r.at} ${r.label} — ${r.reason}`),
    ...(recent ? (recent.length ? ['', `server log, last ${recent.length} lines:`, ...recent] : ['server log: nothing said yet']) : ['server log: this Mac app does not keep one (older than 7.191.0)'])
  ]
    .filter((l) => l !== null)
    .join('\n')
}

/**
 * Things that never reached any log before: a script error, a promise nobody
 * caught. On a phone these went to a console nobody can open. Installed once
 * by the app; harmless where there is no window.
 */
let installed = false
export function installCrashCapture(target = typeof window !== 'undefined' ? window : null) {
  if (installed || !target?.addEventListener) return () => {}
  installed = true
  const onError = (e) => {
    logDebug('crash', e?.message || 'script error', e?.error?.stack || e?.filename || '')
  }
  const onRejection = (e) => {
    const r = e?.reason
    logDebug('crash', 'unhandled promise', r?.stack || r?.message || compact(r))
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    installed = false
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
