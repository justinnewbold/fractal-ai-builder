/**
 * A running record of everything this app sent to the hardware.
 *
 * Kept because a preset is state you can't diff after the fact — once a value
 * is written there's no history on the unit, and "what did it actually change?"
 * is the first question when something sounds wrong.
 */
const MAX = 200

export function newEntry(kind, summary, detail = []) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date(),
    kind,
    summary,
    detail
  }
}

export function append(log, entry) {
  return [entry, ...log].slice(0, MAX)
}

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
