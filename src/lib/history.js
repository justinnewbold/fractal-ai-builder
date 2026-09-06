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

/**
 * What identifies one tone across the stores it might be in.
 *
 * Not the id: a preset copied to an account gets a fresh one, and its times
 * differ by however long the copy took. Name plus description is what survives
 * the move — and keeps two takes on the same prompt apart, which two rows with
 * the same name would not.
 *
 * Exported because the copy-up has to ask the same question this list asks. A
 * migration that deduplicates differently from the list showing the result is a
 * migration that appears to have done nothing, or to have done it twice.
 */
export function signatureOf(entry) {
  return `${entry?.name || ''} ${entry?.description || ''}`
}

/**
 * How many tones on this device are not on the account.
 *
 * Beside the other two on purpose: this asks the same question the list and the
 * copy-up ask, and three places asking it three ways is how a panel comes to
 * say "12 to copy" over a button that copies nothing.
 *
 * A folder entry can only be matched on its name — its description is inside
 * the file, and this runs on every render. So the number is exact for what is
 * in browser storage and a good-faith estimate for what is in a folder; the
 * copy itself opens each file and matches properly, which is why it can report
 * having sent fewer than this said. Overstating what is stranded is the safe
 * direction: the correction arrives as "3 were already there", not as a library
 * quietly left behind.
 */
export function notOnAccount(local = [], cloud = []) {
  if (!cloud.length) return local.length
  const signatures = new Set(cloud.map(signatureOf))
  const names = new Set(cloud.map((e) => e?.name || ''))
  return local.filter((e) =>
    e?.spec ? !signatures.has(signatureOf(e)) : !names.has(e?.name || '')
  ).length
}

/**
 * Several stores, one list, newest first and each preset once.
 *
 * A preset is very often in two places: copying this browser's presets to an
 * account is a copy rather than a move, so anyone who used that migration
 * holds every one of them twice. Shown twice it is a list that looks broken;
 * counted twice it makes a habit look twice as settled as it is.
 *
 * Sorted before deduplicating, so the surviving copy is the newest one.
 */
export function newestFirst(...groups) {
  const seen = new Set()
  const names = new Set()
  const out = []
  for (const entry of groups.flat().sort((a, b) => (b?.at || 0) - (a?.at || 0))) {
    if (!entry) continue
    /*
     * A folder listing carries a name and a time, not the tone — opening forty
     * files to draw a list nobody has clicked is not worth it. So a folder
     * entry can only be matched on its name, which is all it has, and without
     * that it survives every dedupe: the same tone appears once as a file and
     * again as an account row, which is exactly what copying to the account
     * produces on a Mac with a folder set.
     */
    const duplicate = entry.spec ? seen.has(signatureOf(entry)) : names.has(entry.name || '')
    if (duplicate) continue
    seen.add(signatureOf(entry))
    names.add(entry.name || '')
    out.push(entry)
  }
  return out
}

export function buildEntry({ name, description, summary, spec, usage, device, blockNames, ms }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    name: (name || 'Untitled').trim(),
    description: description || '',
    summary: summary || '',
    spec,
    usage: usage || null,
    device: device || null,
    blockNames: blockNames || [],
    /**
     * How long this one took, start to finish.
     *
     * Recorded because the app kept telling people a generation was "longer
     * than usual" without ever having measured one. See typicalMs below.
     */
    ms: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null
  }
}

/**
 * How long a generation usually takes HERE, from the ones that already have.
 *
 * "Every tone generator says it takes longer than usual. How long is usual? If
 * it takes longer than usual, why does it always say that?"
 *
 * Because "usual" was a literal 60 seconds that nobody measured. It came from
 * an old server ceiling that has since been raised — this app's own timing now
 * calls ninety seconds before the first token "slow, not broken" — so the
 * warning fired on runs the rest of the code considers perfectly normal.
 *
 * A number the app made up cannot be corrected by the app. One it measures can:
 * a median over the last dozen runs on this device, on this person's presets,
 * with their model. Null until there are enough of them to mean anything, and
 * everything that reads it must be prepared to say nothing at all.
 */
export function typicalMs(entries = read(), { least = 3, over = 12 } = {}) {
  const times = entries
    .map((e) => e?.ms)
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .slice(0, over)
    .sort((a, b) => a - b)
  if (times.length < least) return null
  // A median, not a mean: one run that timed out at two and a half minutes
  // should not move what "usual" means.
  const mid = Math.floor(times.length / 2)
  return times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2)
}

export function savePreset(fields) {
  const entry = buildEntry(fields)
  write([entry, ...read()])
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
