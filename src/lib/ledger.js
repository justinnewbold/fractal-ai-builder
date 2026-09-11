/**
 * Every call to the model, written down and kept.
 *
 * "It's actually spending a lot more than what the app says."
 *
 * It was, and the app had no way to notice. Two things were wrong at once and
 * only one of them was arithmetic.
 *
 * The first: the cost panel only ever counted DESIGNS. Every message on the Ask
 * screen — every question, every "make it heavier", every "yes write it" — went
 * to the model, came back with its own token count attached, and that count was
 * read into a field nothing looked at. Those turns are not small either: a chat
 * message carries the whole model roster AND the transcript so far, so they get
 * bigger the longer a conversation runs. Until today they also ran on a model
 * two and a half times the price. A session could spend most of its money
 * somewhere the screen never mentioned.
 *
 * The second: a run that failed spent real tokens and left no trace at all. The
 * model had been asked, had thought, and in some failures had answered — then
 * the error replaced everything and the count went with it.
 *
 * So this is the ledger: one row per call, kept in the browser across sessions,
 * totalled by UTC day because that is how the Anthropic console groups it. Two
 * columns of figures that can be put side by side is the only way to find out
 * whether the app's arithmetic is right, and the app's arithmetic has been
 * wrong twice already.
 *
 * ## What is honest about this
 *
 * A row with no token counts is still a row. Where a request died before the
 * model reported anything — the connection dropped, the function was cut off —
 * there genuinely is no number, and recording the attempt with nothing in it is
 * what lets a gap between this and the console be explained rather than
 * puzzled over.
 */
import { costOf, splitUsage } from './cost.js'

const KEY = 'fab.tokens.v1'

/**
 * How many calls are worth keeping.
 *
 * Enough for a month of heavy use, bounded because localStorage is a few
 * megabytes for the whole origin. A row is small — five numbers, a model name
 * and a label — so this is a few hundred kilobytes at worst.
 */
export const MAX_ROWS = 1000

function safeStore() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // Private windows and blocked site data both throw on access, not on use.
    return null
  }
}

/**
 * The UTC day a call belongs to, as the console writes it.
 *
 * UTC deliberately, and said out loud wherever it is shown. The console's
 * columns are "Sep 10 (UTC)"; a ledger that grouped by the phone's own midnight
 * would disagree with it by a few hours' worth of runs every single day, and
 * the whole point of this is to be comparable.
 */
export function utcDay(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * Write down one call.
 *
 * `usage` may be null — see the note above about a request that died before the
 * model reported anything. `kind` is what was asked for: design, refine, chat.
 */
export function recordUsage(kind, usage, extra = {}, store = safeStore()) {
  const split = splitUsage(usage)
  const row = {
    at: Date.now(),
    kind,
    model: usage?.model ? String(usage.model).split('/').pop() : null,
    fresh: split?.fresh ?? null,
    cached: split?.cached ?? null,
    written: split?.written ?? null,
    output: split?.output ?? null,
    total: split?.total ?? null,
    cost: usage ? costOf(usage, usage.model) : null,
    ...(extra.failed ? { failed: String(extra.failed).slice(0, 200) } : {}),
    ...(extra.note ? { note: String(extra.note).slice(0, 120) } : {})
  }
  if (!store) return row
  try {
    const rows = readLedger(store)
    rows.push(row)
    store.setItem(KEY, JSON.stringify({ v: 1, rows: rows.slice(-MAX_ROWS) }))
  } catch {
    // A full quota is not worth failing a generation over. The run still ran.
  }
  return row
}

/** Every row, oldest first. A record that will not parse is no record. */
export function readLedger(store = safeStore()) {
  if (!store) return []
  try {
    const saved = JSON.parse(store.getItem(KEY) || 'null')
    if (!saved || saved.v !== 1 || !Array.isArray(saved.rows)) return []
    return saved.rows.filter((r) => r && typeof r.at === 'number')
  } catch {
    return []
  }
}

export function clearLedger(store = safeStore()) {
  try {
    store?.removeItem(KEY)
  } catch {
    // Nothing to clear is the outcome we wanted.
  }
}

/**
 * The rows totalled by UTC day, newest day first.
 *
 * `unknown` counts the calls that spent something and reported nothing, because
 * that number is the difference between "the app is calculating wrong" and "the
 * app never saw these" — and those two have completely different fixes.
 */
export function byDay(rows = readLedger()) {
  const days = new Map()
  for (const row of rows) {
    const day = utcDay(row.at)
    if (!days.has(day)) {
      days.set(day, {
        day,
        calls: 0,
        unknown: 0,
        cost: 0,
        fresh: 0,
        cached: 0,
        written: 0,
        output: 0,
        kinds: {},
        models: {}
      })
    }
    const d = days.get(day)
    d.calls += 1
    d.kinds[row.kind] = (d.kinds[row.kind] || 0) + 1
    if (row.total === null || row.total === undefined) {
      d.unknown += 1
      continue
    }
    d.fresh += row.fresh || 0
    d.cached += row.cached || 0
    d.written += row.written || 0
    d.output += row.output || 0
    if (typeof row.cost === 'number') d.cost += row.cost
    if (row.model) {
      const m = (d.models[row.model] = d.models[row.model] || { calls: 0, cost: 0 })
      m.calls += 1
      m.cost += typeof row.cost === 'number' ? row.cost : 0
    }
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
}

/** One day's totals, for the line that says what today has cost. */
export function today(rows = readLedger()) {
  return byDay(rows).find((d) => d.day === utcDay()) || null
}

/**
 * The ledger as text, for putting beside the console.
 *
 * A day per line with the four buckets and what this app thinks it cost, then
 * every call under it. Plain enough to paste into a message and read on a
 * phone, which is where the comparison actually gets made.
 */
export function ledgerText(rows = readLedger()) {
  const days = byDay(rows)
  if (!days.length) return 'No model calls recorded yet.'

  const money = (n) => `$${(n || 0).toFixed(4)}`
  const out = [
    'Token usage as this app recorded it. Days are UTC, to match the console.',
    'Compare each day against platform.claude.com → Usage, grouped by day.',
    ''
  ]
  for (const d of days) {
    const kinds = Object.entries(d.kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')
    out.push(
      `${d.day} — ${money(d.cost)} · ${d.calls} call${d.calls === 1 ? '' : 's'} (${kinds})` +
        (d.unknown ? ` · ${d.unknown} with no count reported` : '')
    )
    out.push(
      `  in ${d.fresh} fresh · ${d.cached} cached · ${d.written} cache write · out ${d.output}`
    )
    for (const [model, m] of Object.entries(d.models)) {
      out.push(`  ${model}: ${m.calls} call${m.calls === 1 ? '' : 's'} · ${money(m.cost)}`)
    }
    for (const row of rows.filter((r) => utcDay(r.at) === d.day)) {
      const when = new Date(row.at).toISOString().slice(11, 19)
      out.push(
        `  ${when}Z ${row.kind}` +
          (row.model ? ` ${row.model}` : '') +
          (row.total === null || row.total === undefined
            ? ' — no count reported'
            : ` — ${row.fresh}+${row.cached}c+${row.written}w in, ${row.output} out, ${money(row.cost)}`) +
          (row.failed ? ` — failed: ${row.failed}` : '')
      )
    }
    out.push('')
  }
  return out.join('\n')
}
