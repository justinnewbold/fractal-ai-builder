/**
 * Saved presets.
 *
 * What's stored is the generated *spec* — the blocks, models and target values
 * — not the diff that was applied. A diff is only meaningful against the preset
 * it was computed from, so replaying one onto a different preset would write
 * values derived from ranges that no longer apply. A spec can be re-validated
 * against whatever is loaded now, which is what makes reloading safe.
 *
 * Kept in localStorage: this is one player's own bench, and a saved tone is
 * worth nothing to anyone else's unit.
 */
const KEY = 'fab.history.v1'
const MAX = 60

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)))
    return true
  } catch {
    // Quota, private browsing, or a disabled store. Losing history is not worth
    // interrupting someone mid-session over.
    return false
  }
}

export function listPresets() {
  return read().sort((a, b) => (b.at || 0) - (a.at || 0))
}

export function savePreset({ name, description, summary, spec, usage, device, blockNames }) {
  const entries = read()
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    name: (name || 'Untitled').trim(),
    description: description || '',
    summary: summary || '',
    spec,
    usage: usage || null,
    device: device || null,
    blockNames: blockNames || []
  }
  write([entry, ...entries])
  return entry
}

export function renamePreset(id, name) {
  write(read().map((e) => (e.id === id ? { ...e, name: name.trim() || e.name } : e)))
}

export function deletePreset(id) {
  write(read().filter((e) => e.id !== id))
}

export function clearHistory() {
  write([])
}

/** A saved tone is portable between machines even though the store isn't. */
export function exportHistory() {
  return JSON.stringify({ version: 1, exported: new Date().toISOString(), presets: read() }, null, 2)
}

export function importHistory(json) {
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const incoming = Array.isArray(parsed?.presets) ? parsed.presets : null
  if (!incoming) throw new Error('No presets found in that file.')

  const existing = read()
  const seen = new Set(existing.map((e) => e.id))
  const merged = [...existing, ...incoming.filter((e) => e?.id && !seen.has(e.id))]
  write(merged.sort((a, b) => (b.at || 0) - (a.at || 0)))
  return incoming.length
}

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
