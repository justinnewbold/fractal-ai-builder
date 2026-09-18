/**
 * When something happened, said the way a person would say it.
 *
 * Today is a time; anything older carries its date. It lived in lib/history.js,
 * which was the library of tones the AI designer had made — when that went, the
 * preset version list still wanted this one function, and a file called
 * "history" holding nothing but a date formatter would have been a worse home
 * than a new one.
 */
export function formatWhen(ts) {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
