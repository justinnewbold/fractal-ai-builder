/**
 * A few labelled facts, one to a line — the answers on Justin's own tools
 * (Customer lookup, Sales at a glance). The words come from shared/admin.mjs;
 * this only lays them out. The browser's copy of the phone's
 * mobile/src/components/Facts.js.
 */
export default function Facts({ title, rows }) {
  if (!rows?.length) return null
  return (
    <div>
      {title ? <p className="facts-title">{title}</p> : null}
      <dl className="facts">
        {rows.map((row, i) => (
          <div className="facts-row" key={`${row.label}-${i}`}>
            {row.label ? <dt>{row.label}</dt> : null}
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
