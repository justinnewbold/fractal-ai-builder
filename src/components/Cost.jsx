import { costOf, uncachedCostOf, formatCost, formatTokens, rateFor } from '../lib/cost'

/**
 * What the last run cost, and what the session has cost.
 *
 * Shown next to the result rather than buried, because the input side scales
 * with how much of the preset gets sent — a big preset is a more expensive
 * generation, and that relationship should be visible while you're deciding
 * whether to run it again.
 */
export default function Cost({ usage, sessionTotal, runs }) {
  if (!usage) return null

  const dollars = costOf(usage, usage.model)
  const full = uncachedCostOf(usage, usage.model)
  const rate = rateFor(usage.model)
  const saved = full !== null && dollars !== null ? full - dollars : null

  return (
    <div className="cost">
      <div className="cost-row">
        <span className="silk-label">This run</span>
        <span className="cost-figure mono">{formatCost(dollars)}</span>
      </div>

      <div className="cost-detail mono">
        {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
        {usage.cachedInputTokens ? ` · ${formatTokens(usage.cachedInputTokens)} cached` : ''}
        {usage.cacheWriteTokens ? ` · ${formatTokens(usage.cacheWriteTokens)} cache write` : ''}
        {' · '}
        {String(usage.model || '').split('/').pop()}
      </div>

      {runs > 1 ? (
        <div className="cost-detail mono">
          Session: {formatCost(sessionTotal)} over {runs} runs
        </div>
      ) : null}

      {saved !== null && saved > 0.00001 ? (
        <div className="cost-detail mono cost-saved">
          Cache saved {formatCost(saved)} on this run
        </div>
      ) : null}
      {usage.cacheWriteTokens && !usage.cachedInputTokens ? (
        <p className="cost-note">
          First run of this session primes the cache, so it costs slightly more. Runs after this
          one against the same preset bill the rosters at a tenth.
        </p>
      ) : null}

      {rate?.note ? <p className="cost-note">{rate.note}</p> : null}
      {!rate ? (
        <p className="cost-note">
          No published rate on file for this model, so the cost above is blank rather than guessed.
        </p>
      ) : null}
    </div>
  )
}
