import { costOf, formatCost, formatTokens, rateFor } from '../lib/cost'

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
  const rate = rateFor(usage.model)

  return (
    <div className="cost">
      <div className="cost-row">
        <span className="silk-label">This run</span>
        <span className="cost-figure mono">{formatCost(dollars)}</span>
      </div>

      <div className="cost-detail mono">
        {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
        {usage.cachedInputTokens ? ` · ${formatTokens(usage.cachedInputTokens)} cached` : ''}
        {' · '}
        {String(usage.model || '').split('/').pop()}
      </div>

      {runs > 1 ? (
        <div className="cost-detail mono">
          Session: {formatCost(sessionTotal)} over {runs} runs
        </div>
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
