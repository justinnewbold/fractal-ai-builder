/**
 * What a generation costs.
 *
 * Worth tracking here specifically: each run sends the whole model roster and
 * every placed block's parameters, so the input side is large and grows with
 * the preset. That makes cost per generation much less obvious than it looks.
 *
 * Rates are per million tokens, input/output. Verified against published
 * Anthropic pricing, August 2026.
 */

const RATES = {
  'claude-sonnet-5': { in: 2, out: 10, note: 'promotional through 31 Aug 2026, then $3/$15' },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 }
}

/** Cached reads bill at a tenth of base; writing the cache costs a premium. */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/** Strip a gateway prefix and any date suffix so 'anthropic/claude-sonnet-5' matches. */
function normalizeModel(model) {
  if (!model) return ''
  const bare = String(model).split('/').pop()
  return bare.replace(/-\d{8}$/, '')
}

export function rateFor(model) {
  return RATES[normalizeModel(model)] || null
}

/**
 * Cost in dollars for one generation.
 *
 * Returns null rather than a guess when the model isn't in the table — a
 * confidently wrong number is worse than an honest blank.
 */
export function costOf(usage, model) {
  const rate = rateFor(model)
  if (!rate || !usage) return null

  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cached = usage.cachedInputTokens ?? 0
  const written = usage.cacheWriteTokens ?? 0

  const fresh = Math.max(0, input - cached)

  return (
    (fresh / 1e6) * rate.in +
    (cached / 1e6) * rate.in * CACHE_READ_MULTIPLIER +
    (written / 1e6) * rate.in * CACHE_WRITE_MULTIPLIER +
    (output / 1e6) * rate.out
  )
}

/** What this run would have cost with no cache, for showing the saving. */
export function uncachedCostOf(usage, model) {
  const rate = rateFor(model)
  if (!rate || !usage) return null
  const billable =
    (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  return (billable / 1e6) * rate.in + ((usage.outputTokens ?? 0) / 1e6) * rate.out
}

/** Cents below a dollar, dollars above — reading $0.0431 takes a beat too long. */
export function formatCost(dollars) {
  if (dollars === null || dollars === undefined) return '—'
  if (dollars < 0.01) return `${(dollars * 100).toFixed(2)}¢`
  if (dollars < 1) return `${(dollars * 100).toFixed(1)}¢`
  return `$${dollars.toFixed(2)}`
}

export function formatTokens(n) {
  if (typeof n !== 'number') return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
