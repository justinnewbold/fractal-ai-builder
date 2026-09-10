/**
 * A door with several panels behind it.
 *
 * Setup had twelve folds in one column, every one of them the same size, the
 * same colour and the same weight — button size sitting level with the debug
 * log. A screen where everything is equally loud is a screen you have to read
 * end to end every time, and this one is read on a phone, in a hurry, with the
 * lights down.
 *
 * So the twelve are sorted into four: the screen, the rig, something's wrong,
 * and what the AI knows. A group is a heading you open; the panels inside it
 * are rows in a list rather than boxes on a box, which is what tells you at a
 * glance which level you are looking at.
 *
 * Built on <details> for the same reasons Section is: it opens on click, takes
 * a keyboard, is findable by the browser's own search, and needs no state.
 * Nesting one inside another is exactly what the element is for.
 */
export default function Group({ title, note, defaultOpen = false, children }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="group-head">
        <span className="group-title">{title}</span>
        {note ? <span className="group-note">{note}</span> : null}
      </summary>
      <div className="group-body">{children}</div>
    </details>
  )
}
