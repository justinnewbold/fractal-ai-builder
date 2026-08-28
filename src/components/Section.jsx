/**
 * A panel you can fold away.
 *
 * Edit had twelve panels stacked in a column and Library nine. Everything was
 * visible at once, which sounds helpful and isn't: a screen where nothing is
 * hidden is a screen where nothing stands out, and most of those panels are
 * things you touch once a month.
 *
 * Built on <details> rather than state and a chevron, so it opens on click,
 * responds to keyboard, is findable by browser search, and needs no JavaScript
 * to work at all.
 */
export default function Section({ title, note, defaultOpen = false, children }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary className="section-head">
        <span className="section-title silk-label">{title}</span>
        {note ? <span className="section-note">{note}</span> : null}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  )
}
