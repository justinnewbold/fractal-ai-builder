import { useEffect, useMemo, useRef, useState } from 'react'
import { useAsks } from '../lib/asks'

/**
 * Things worth saying, typed out one at a time in the empty box.
 *
 * These used to be a row of buttons under the input as well. Two copies of the
 * same list, one of them a wall of grey pills sitting between the chat box and
 * the rest of the screen — the suggestions were doing more to clutter the page
 * than to teach anything.
 *
 * Rotating them through the placeholder does the teaching without taking any
 * room, so all of them are here rather than the first six. The point is to show
 * the range — a control by name, a whole tone, a question, saving, structure —
 * because that is the real answer to "what can I say to it".
 */
const SUGGESTIONS = [
  'Change gain to 7 on the amp',
  'Tight modern metal rhythm in drop A',
  'Turn up the gain a little and cut the bass',
  'Save this to slot 67',
  'What amp is this?',
  'Bypass the reverb',
  'Move the drive before the amp',
  'Warm clean with a bit of shimmer',
  'Set the tempo to 96',
  'Keep this as Drop A Rhythm',
  'Rename this to something that describes it',
  'Set high cut to 5k',
  'Make the delay slower',
  'Re-read the preset',
  'Build a drive, amp, cab and delay chain'
]

const TYPE_MS = 55
const DELETE_MS = 28
const HOLD_MS = 1900

/**
 * Type one suggestion, hold it, wipe it, move to the next.
 *
 * Stops the moment there's anything to stop for: text in the box, focus in the
 * box, or a system that has asked for less motion. A placeholder animating under
 * someone's cursor while they think is a distraction, not a hint.
 */
function useTypedSuggestion(active, own = []) {
  /*
   * The player's own past requests first, then the general examples.
   *
   * These are the "suggestions based on what they have done in the past" —
   * shown here, in the one line that already rotates, rather than as a row of
   * buttons. This app tried the row and removed it: two copies of one list,
   * and a wall of grey pills between the box and the page. A personal
   * suggestion does not earn that back.
   *
   * Theirs go first because they are the ones worth reading; the general ones
   * still follow, since the point of the rotation is to show the range of what
   * can be said, and a player's own history only shows what they already know
   * how to ask for.
   */
  const lines = useMemo(
    () => (own.length ? [...own, ...SUGGESTIONS] : SUGGESTIONS),
    [own.join('\u0000')]
  )
  const [text, setText] = useState('')
  // Start somewhere random. With the buttons gone this is the only place the
  // suggestions appear, and always opening on the same one would make fourteen
  // of them invisible to anyone who doesn't sit and watch.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * lines.length))
  const [phase, setPhase] = useState('typing')

  // Live, not read once: flipping the setting mid-session stops the typing now.
  const reduced = useAsks('(prefers-reduced-motion: reduce)')

  useEffect(() => {
    if (!active || reduced) return undefined

    const full = lines[index % lines.length]

    // One timeout per step, phase in state. An interval would be fought by this
    // effect re-running on every character it wrote.
    if (phase === 'typing') {
      if (text.length >= full.length) {
        setPhase('holding')
        return undefined
      }
      const t = setTimeout(() => setText(full.slice(0, text.length + 1)), TYPE_MS)
      return () => clearTimeout(t)
    }

    if (phase === 'holding') {
      const t = setTimeout(() => setPhase('deleting'), HOLD_MS)
      return () => clearTimeout(t)
    }

    if (text.length === 0) {
      setIndex((i) => (i + 1) % lines.length)
      setPhase('typing')
      return undefined
    }
    const t = setTimeout(() => setText(full.slice(0, text.length - 1)), DELETE_MS)
    return () => clearTimeout(t)
  }, [text, index, phase, active, reduced])

  if (reduced) return lines[index % lines.length]
  if (!active) return lines[index % lines.length]
  return text
}

export default function Assistant({
  turns,
  onAsk,
  onConfirm,
  onCancel,
  busy,
  /*
   * Never rendered here. The working line is <Thinking>, which App passes
   * as a child so it lands in the conversation that asked — this used to
   * print the same string a second time, plainly, directly above it. It is
   * still taken because the transcript scrolls on every tick of it.
   */
  progress,
  onStop,
  /*
   * Starting points drawn from this player's own kept presets — their past
   * requests, verbatim, and one derived line. Empty until there is enough
   * history to say anything, which is most of the time for a new player, so
   * the general examples have to stand on their own without them.
   */
  suggestions = [],
  /*
   * What is happening now: the working line, the chain arriving, and what a
   * write did. Rendered after everything said, because that is when it is
   * happening — the tone itself is no longer among them.
   */
  children
}) {
  const [text, setText] = useState('')
  /*
   * What was said while the model was working.
   *
   * Sending used to return early when busy and the box was disabled, so a
   * thought you had mid-generation was simply lost. "Maybe queue messages sent
   * while generating?" — so they wait here and go in order once the run ends.
   */
  const [queue, setQueue] = useState([])
  const [focused, setFocused] = useState(false)
  const tail = useRef(null)
  const box = useRef(null)

  // Only animate in an idle, empty box.
  /*
   * The suggestions keep moving while a tone is being built.
   *
   * They used to stop on `busy`, which is the whole of a generation — so the
   * one moment there is nothing else happening on screen is the moment the
   * screen went still, and a thirty-second wait looked like a hang. "When
   * generating a new tone the suggestion typewriter stops and freezes. Can we
   * keep the live suggestions going?"
   *
   * Still stops for the things it should: something typed, the box focused, or
   * a reduced-motion setting.
   */
  const typed = useTypedSuggestion(!text && !focused, suggestions)

  useEffect(() => {
    /*
     * Keep the conversation pinned to its latest turn — but only inside the
     * log's own scrollbox. This used to be scrollIntoView, which scrolls every
     * scrollable ancestor including the page: each new turn or progress tick
     * yanked the whole screen down to this element, and during a generation it
     * kept doing it against the player's own scrolling. The page is not this
     * component's to move.
     */
    const log = tail.current?.parentElement
    if (log) log.scrollTop = log.scrollHeight
  }, [turns, progress])

  /*
   * The box is as tall as what is in it.
   *
   * A textarea has one fixed height and scrolls inside it, which for two lines
   * of typing means the first line disappears upwards — no better than the
   * single-line field this replaced. Measured rather than counted: `scrollHeight`
   * after collapsing to `auto` is the height the content actually wants, at
   * whatever width the row happens to be, so it stays right when the window is
   * resized or a phone is turned. The ceiling is CSS's, and past it the box
   * scrolls instead of swallowing the conversation.
   */
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const submit = (value) => {
    const instruction = (value ?? text).trim()
    if (!instruction) return
    // Mid-run: keep it rather than dropping it, and clear the box so it is
    // plainly taken rather than looking ignored.
    if (busy) {
      setQueue((q) => [...q, instruction])
      setText('')
      return
    }
    /*
     * Let go of the box before the work starts.
     *
     * On iOS a focused field is a magnet: Safari scrolls it back into view on
     * every layout change, and a generation changes the layout continuously —
     * progress lines, the design, the diff. The page kept snapping back to the
     * input, and scrolling away only bought a moment before the next render
     * dragged it down again. React makes it worse by restoring focus to the
     * last focused element after each commit (the box is disabled while busy
     * and re-enabled after), so the magnet survives the whole run.
     *
     * Sending is also the moment a player is done typing, so dropping focus
     * dismisses the keyboard — which is what you want on a phone anyway.
     */
    /*
     * Hold the page still across the keyboard closing.
     *
     * Dismissing the keyboard hands back the space it occupied, and iOS
     * resolves that by moving the document — which is why this only ever
     * happened after typing, never after tapping a button. Blurring is what
     * makes the send predictable; keeping the scroll is what makes it not
     * lurch. Restored over the next few frames because the resize lands after
     * the blur, then left alone: past that, any scrolling is the player's.
     */
    const keep = window.scrollY
    box.current?.blur()
    let frames = 0
    const hold = () => {
      if (Math.abs(window.scrollY - keep) > 8) window.scrollTo(0, keep)
      if (++frames < 12) requestAnimationFrame(hold)
    }
    requestAnimationFrame(hold)

    onAsk(instruction)
    setText('')
  }

  /*
   * Send what was waiting, one at a time.
   *
   * Held in a ref so that a new onAsk identity on every render cannot re-fire
   * a send, and shifted one per run so each answer lands against the state the
   * previous one left behind — sending them all at once would ask the model
   * three questions about a preset that changed underneath it.
   */
  const ask = useRef(onAsk)
  useEffect(() => {
    ask.current = onAsk
  })
  useEffect(() => {
    if (busy || !queue.length) return
    const [next, ...rest] = queue
    setQueue(rest)
    ask.current(next)
  }, [busy, queue])

  /** One turn, drawn the same wherever it falls relative to the design. */
  const renderTurn = (turn, i) => (
          <div key={i} className={`turn turn-${turn.role}`}>
            {/* Hand edits are events, not speech: "Named scene 4 Solo" is a
                thing that happened, and prefixing it with the player's name
                read as words put in their mouth. They keep their role — the
                model is still told which turns were hand edits, and the row
                keeps its own quiet style — but nothing here wears a label.
                The only turns that are the player's are the ones they typed. */}
            <p className="turn-text">{turn.text}</p>

            {turn.actions?.length ? (
              <ul className="turn-actions">
                {turn.actions.map((a, j) => (
                  <li key={j} className="mono">
                    {turn.pending ? a.label : `${turn.failed?.includes(a.label) ? '×' : '✓'} ${a.label}`}
                  </li>
                ))}
              </ul>
            ) : null}

            {turn.pending ? (
              <div className="turn-confirm">
                <span className="hint">
                  {turn.reason === 'broad'
                    ? `That's ${turn.actions.length} changes — worth a look first.`
                    : turn.actions.some((a) => a.kind === 'savePreset')
                      ? 'This overwrites whatever is in that slot.'
                      : turn.actions.some((a) => a.kind === 'loadPreset')
                        ? 'Anything unsaved goes with it.'
                        : 'This removes something.'}
                </span>
                <button className="save-now" onClick={() => onConfirm(i)} disabled={busy}>
                  Do it
                </button>
                <button className="chip" onClick={() => onCancel(i)} disabled={busy}>
                  Leave it
                </button>
              </div>
            ) : null}

            {turn.problems?.length ? (
              <ul className="turn-problems">
                {turn.problems.map((p, j) => (
                  <li key={j} className="mono problem">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
  )

  return (
    <section className="assistant">
      <div className="assistant-log" role="log" aria-live="polite">
        {turns.length === 0 ? (
          <p className="hint assistant-empty">
            Tell me what you want and I&rsquo;ll do it &mdash; change a control, move a block,
            rename it, save it to a slot. Ask a question and I&rsquo;ll just answer.
          </p>
        ) : null}

        {turns.map(renderTurn)}

        {/*
          What is waiting its turn.
          Shown as turns, because that is what they are about to become — a
          person who typed three things while a tone was building should see
          all three, in the order they will be asked.
        */}
        {queue.map((q, i) => (
          <div key={`q${i}`} className="turn turn-user turn-queued">
            <p className="turn-text">{q}</p>
            <p className="hint">Waiting for the tone to finish</p>
          </div>
        ))}

        {/*
          What is happening now, after everything said. The tone a run produces
          is not here any more — it is its own panel under the conversation, so
          this is the working line, the chain arriving, and what a write did.
        */}
        {children}

        <div ref={tail} />
      </div>

      <div className="refine-row assistant-row">
        {/*
          A box you can write a paragraph in.

          It was a single-line text field, so a request longer than about forty
          characters scrolled away to the left as you typed it \u2014 and describing
          a tone is exactly the kind of thing people write two sentences of.
          It grows with what is in it and stops at a height the CSS sets, past
          which it scrolls rather than eating the conversation above it.
        */}
        <textarea
          ref={box}
          rows={1}
          className="refine-input"
          value={text}
          placeholder={typed ? `${typed}\u258f` : ''}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          /*
           * Enter sends, Shift+Enter starts a line \u2014 which is what every chat
           * does, and what a person who has used one will try first.
           */
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return
            /*
             * Except mid-word. Enter is also how an IME commits the character
             * being composed, and sending there would post half a sentence and
             * swallow the word someone was in the middle of.
             */
            if (e.nativeEvent?.isComposing) return
            e.preventDefault()
            submit()
          }}
          // So a phone keyboard offers Send rather than a return arrow, which
          // in a box this shape reads as "this will start a new line".
          enterKeyHint="send"
          // The placeholder moves, so it can't be what a screen reader is told
          // this box is for.
          aria-label="What you want done"
        />
        {/* While the model has the request, the useful button is the one that
            takes it back. "Working…" disabled is a dead end when the thing has
            hung, which is exactly when someone reaches for a button. */}
        {/*
          One round button at the end of the box, the shape every chat uses.

          "Instead of a send button below the chat box, put a send arrow on the
          right side of it." It was already beside the box rather than under it
          — a word in a rectangle, taking a fifth of the row from the thing you
          type into. An arrow says the same thing in a circle and gives the
          width back.

          The same button becomes Stop while the model has the request, because
          that is the one place it belongs: the thing you reach for when a
          generation hangs is where the thing you pressed to start it was.
          Labelled for a screen reader either way — a glyph is not a name.
        */}
        {onStop ? (
          <button className="send-btn stopping" onClick={onStop} aria-label="Stop">
            <span aria-hidden="true">■</span>
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={() => submit()}
            disabled={!text.trim()}
            aria-label={busy ? 'Send when the current tone finishes' : 'Send'}
          >
            <span aria-hidden="true">↑</span>
          </button>
        )}
      </div>

    </section>
  )
}
