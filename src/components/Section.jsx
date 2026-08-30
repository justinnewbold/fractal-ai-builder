import Boundary from './Boundary'

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
      {/*
        Resizable through the browser's own handle rather than a custom one:
        it drags the way every other resizable box on the machine drags, needs
        no pointer maths, and can't leave a panel at a size the layout can't
        hold. Height only — width is the column's job, and a half-width panel in
        a stack is just a panel with a gap next to it.
      */}
      <div className="section-body">
        <Boundary label={title}>{children}</Boundary>
      </div>
    </details>
  )
}
