import { useRef, useState } from 'react'
import { describeLink } from '../lib/link'
import { useDismiss } from '../lib/dismiss'

/**
 * The state of the phone remote, in the bar, on every screen.
 *
 * Pure: it is handed the link state and draws it. The previous chip read the
 * connection module at render time and polled it on a timer, so it was
 * right only when something else had caused a re-render, and it went red
 * over a working link because a dead presence check kept resetting the fact
 * it was reading.
 *
 * The colour says whether things are good; the word says which state; the
 * popover carries the sentence and the one action that state calls for.
 */
export default function LinkChip({
  link,
  compact,
  onAction,
  busy,
  /*
   * Whether the word needs to name what it is about.
   *
   * "The phone app says it has lost the unit, but also says it's connected in
   * the right hand corner." Both were true and neither said which thing it
   * meant: the left of the bar is the UNIT, this is the MAC, and read together
   * at opposite ends of one bar they look like the app contradicting itself.
   *
   * Only while something is wrong, which is the only time the two can be read
   * as disagreeing — and also the only time there is room, because the bar
   * carries no preset unless the unit is answering.
   */
  sayMac
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  // A tap outside or Escape closes it, and focus returns to the chip.
  useDismiss(wrap, () => setOpen(false), { open, ignore: '.phone-chip' })

  // Nothing to say until the role is known, and nothing worth a chip in the
  // wifi role either — that link has no state to watch.
  if (!link || link.role === 'unknown' || link.role === 'wifi') return null

  const said = describeLink(link)
  if (!said.word) return null

  /** The single thing this state wants done. */
  const action =
    link.role === 'remote'
      ? link.link === 'connected'
        ? { label: 'Disconnect', kind: 'disconnect' }
        : link.link === 'no-answer'
          ? { label: 'Try now', kind: 'retry' }
          : link.link === 'joining'
            ? null
            : { label: 'Connect', kind: 'connect' }
      : link.link === 'connected'
        ? { label: 'Turn off', kind: 'mac-off' }
        : link.link === 'signed-out'
          ? // A phone in the demo wears this role and can never host: "Set up"
            // would call a helper on localhost that cannot exist.
            link.canHost
            ? { label: 'Set up', kind: 'mac-setup' }
            : { label: 'Connect', kind: 'leave-demo' }
          : { label: 'Turn on', kind: 'mac-on' }

  /*
   * In the bar, a mark rather than a word.
   *
   * "Make the connected button just a round green checkmark when it is
   * connected and a red X when it's not, the same size as the settings
   * gear." The word was the widest thing in a bar whose width belongs to the
   * preset name, and "connected" beside a teal lamp said the same thing
   * twice. A green tick is up; a red cross is not; the amber dots are on
   * the way. The sentence is still what a screen reader hears, and the
   * popover still carries it in words.
   */
  const mark = said.tone === 'good' ? 'ok' : said.tone === 'busy' ? 'wait' : 'no'
  /*
   * In the bar, one word in the colour of the state. This was a round green
   * tick or red cross for a while — "the same size as the settings gear" —
   * and then asked to be the word again: "just the word connected (green),
   * disconnected (red)". Three states, because a link on its way is neither.
   */
  const state = mark === 'ok' ? 'connected' : mark === 'wait' ? 'connecting' : 'disconnected'
  const word = sayMac ? `Mac ${state}` : state

  return (
    <span className="phone-link" ref={wrap}>
      <button
        className={`phone-chip ${compact ? 'compact' : ''} ${said.tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${said.sentence} — phone remote options`}
      >
        {compact ? (
          <span className={`phone-word ${mark}`} aria-hidden="true">
            {word}
          </span>
        ) : (
          <>
            <span className="lamp" data-state={said.tone === 'good' ? 'live' : said.tone === 'bad' ? 'fault' : 'idle'} />
            {said.sentence}
          </>
        )}
      </button>

      {open ? (
        <div className="phone-pop">
          <p className="hint">{said.sentence}.</p>
          {action ? (
            <div className="phone-pop-actions">
              <button
                className="chip"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onAction?.(action.kind)
                }}
              >
                {action.label}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}
