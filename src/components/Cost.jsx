import { costOf, uncachedCostOf, formatCost, formatTokens, rateFor, splitUsage } from '../lib/cost'
import { today } from '../lib/ledger'

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

  /*
    The four numbers on the line below have to add up, which the old one did
    not: it printed the TOTAL input beside the cache write, and the write is
    already inside that total. Reading the two as separate is what made a run
    look like 78k tokens when it was 48.6k — and it is the same
    misunderstanding that was overcharging the figure above by forty-two per
    cent. Fresh plus written plus cached IS the total; now it says so.
  */
  const split = splitUsage(usage)
  const dollars = costOf(usage, usage.model)
  const full = uncachedCostOf(usage, usage.model)
  const rate = rateFor(usage.model)
  const saved = full !== null && dollars !== null ? full - dollars : null
  /* Read at render, which is when it is looked at: the panel is drawn once per
     tone and this is a handful of rows out of localStorage. */
  const day = today()

  return (
    <div className="cost">
      <div className="cost-row">
        <span className="silk-label">This run</span>
        <span className="cost-figure mono">{formatCost(dollars)}</span>
      </div>

      <div className="cost-detail mono">
        {formatTokens(split.fresh)} in · {formatTokens(split.output)} out
        {split.cached ? ` · ${formatTokens(split.cached)} cached` : ''}
        {split.written ? ` · ${formatTokens(split.written)} cache write` : ''}
        {' · '}
        {String(usage.model || '').split('/').pop()}
      </div>

      {runs > 1 ? (
        <div className="cost-detail mono">
          Session: {formatCost(sessionTotal)} over {runs} runs
        </div>
      ) : null}

      {/*
        And the day, which is the figure that can actually be checked.
        A session total resets when the page reloads and matches nothing on the
        bill. The ledger's day is UTC, the same as the console's columns, so
        this is the one number on screen with something to be compared against.
      */}
      {day && day.calls > 1 ? (
        <div className="cost-detail mono">
          Today: {formatCost(day.cost)} over {day.calls} call{day.calls === 1 ? '' : 's'} (UTC)
          {day.unknown ? ` · ${day.unknown} uncounted` : ''}
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
