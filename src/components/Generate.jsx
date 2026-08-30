export function Preview({ result, onApply, onDiscard, busy, writeCount }) {
  if (!result) return null

  const { changes, problems, repairs = [], summary, notes, presetName } = result

  if (changes.length === 0) {
    return (
      <div className="notice" data-kind="fault">
        <h2>Nothing to apply</h2>
        <p>Every setting the generator produced was rejected during checking.</p>
        {problems.map((p, i) => (
          <p key={i} className="mono problem">
            {p}
          </p>
        ))}
      </div>
    )
  }

  return (
    <section className="preview">
      <div className="preview-head">
        <div>
          <p className="silk-label">Proposed</p>
          <h2 className="preset-name">{presetName || 'UNTITLED'}</h2>
          {summary ? <p className="summary">{summary}</p> : null}
        </div>
        <div className="preview-actions">
          <button onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          {/* Blurred before the write for the same reason the assistant box is:
              a focused control is something iOS scrolls back into view on every
              layout change, and writing a preset changes the layout for several
              seconds. The button has done its job the moment it's pressed. */}
          <button
            className="primary"
            onClick={(e) => {
              e.currentTarget.blur()
              onApply()
            }}
            disabled={busy}
          >
            {busy ? 'Writing…' : `Send ${writeCount} changes to the unit`}
          </button>
        </div>
      </div>

      <div className="diff">
        {changes.map((change) => (
          <div className="diff-block" key={change.eid}>
            <div className="diff-block-head">
              <span className="block-name">{change.name}</span>
              {change.bypassed !== undefined ? (
                <span className={`tag ${change.bypassed ? 'off' : 'on'}`}>
                  {change.bypassed ? 'bypass' : 'engage'}
                </span>
              ) : null}
            </div>

            {change.typeName ? (
              <div className="diff-row">
                <span className="diff-label">Model</span>
                <span className="diff-value mono">{change.typeName}</span>
                {change.typeBasedOn ? <span className="based-on">{change.typeBasedOn}</span> : null}
              </div>
            ) : null}

            {change.params.map((param) => (
              <div className="diff-row" key={param.id}>
                <span className="diff-label">{param.name}</span>
                <span className="diff-value mono">
                  <span className="from">{round(param.from)}</span>
                  <span className="arrow">→</span>
                  <span className="to">
                    {round(param.to)}
                    {param.unit}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {notes ? <p className="notes">{notes}</p> : null}

      {problems.length > 0 ? (
        <div className="problems">
          <p className="silk-label">Rejected during checking</p>
          {problems.map((p, i) => (
            <p key={i} className="mono problem">
              {p}
            </p>
          ))}
        </div>
      ) : null}

      {/* Kept, not lost — but you should know the control isn't the one the
          generator addressed, because that is worth doubting. */}
      {repairs.length > 0 ? (
        <div className="problems">
          <p className="silk-label">Matched by name</p>
          {repairs.map((p, i) => (
            <p key={i} className="mono problem repair">
              {p}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function round(n) {
  if (typeof n !== 'number') return '—'
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
}
