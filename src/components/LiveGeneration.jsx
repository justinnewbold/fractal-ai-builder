import { useEffect, useRef, useState } from 'react'
import { blockName, progressFor } from '../lib/liveProgress'

/**
 * What the line says when there is nothing true to say yet.
 *
 * "Instead of saying working out what that means just say 'Thinking' whenever
 * it's not saying exactly what it's doing."
 *
 * This replaces a list of eight stages on a three-second timer — "Choosing an
 * amp", "Shaping the EQ" — that read as progress and were not. Nothing
 * consulted the model; the script simply advanced with the clock, so the line
 * claiming to choose a cabinet appeared whether or not a cabinet was ever
 * touched. It was the same woolliness as the message this change was asked
 * about, only more confident, and confident is worse.
 *
 * The real messages are still specific and still win over this the moment they
 * arrive: what was sent, how many blocks have been built, which parameter is
 * being verified. This fills the second or two before the first of them lands,
 * and says only what is actually known then.
 */
export const THINKING = 'Thinking'

/* Lives in lib so the test runner can import it — this file is JSX and node
   cannot read that. Re-exported because it is read as part of this screen. */
export { progressFor }

/**
 * What the model is producing, as it produces it.
 *
 * Partials arrive in the order the model decides things, so the chain appears
 * block by block. Collapsed by default — most of the time the summary line is
 * enough, and the detail is for when a result surprises you.
 */
export function LiveGeneration({ partial, open, onToggle, chip = true, nameOf = null }) {
  const scroller = useRef(null)

  useEffect(() => {
    if (open && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [partial, open])

  if (!partial) return null

  const blocks = partial.blocks || []
  const scenes = partial.scenes || []

  return (
    <div className="live-gen">
      {/* Hidden while the run is live: the working line above owns the toggle
          then, and two controls for one panel is one too many. */}
      {chip ? (
        <button className="chip" onClick={onToggle} aria-expanded={open}>
          {open ? 'Hide live output' : `Live output · ${blocks.length} block${blocks.length === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {open ? (
        <div className="live-body" ref={scroller}>
          {partial.presetName ? (
            <p className="live-name">{partial.presetName}</p>
          ) : (
            <p className="hint">Naming it…</p>
          )}

          {partial.summary ? <p className="live-summary">{partial.summary}</p> : null}

          {blocks.map((block, i) => (
            <div className="live-block" key={block?.eid ?? i}>
              <div className="live-block-head mono">
                {/* The block's own name where the preset has one. "eid 58" is
                    the unit's word for it and nobody else's. */}
                <span>{blockName(block?.eid, nameOf)}</span>
                {block?.typeName ? <span className="live-model">{block.typeName}</span> : null}
                {block?.bypassed === true ? <span className="tag off">bypass</span> : null}
              </div>
              {(block?.params || []).map((param, j) => (
                <div className="live-param mono" key={param?.id ?? j}>
                  {param?.name || `#${param?.id ?? '…'}`}
                  {param?.value !== undefined ? ` → ${param.value}` : ''}
                </div>
              ))}
            </div>
          ))}

          {/*
            And the scenes, which is where the songs are.

            "If it's designing a tone model after each song, could it say which
            song it's creating that off of while it's doing it." It can: an
            eight-scene build names each scene after the song it is voicing, so
            the scene list IS that answer — as it arrives, one at a time.
          */}
          {scenes.length ? (
            <div className="live-scenes">
              {scenes.map((scene, i) => (
                <div className="live-scene mono" key={scene?.index ?? i}>
                  <span className="live-scene-n">{(scene?.index ?? i) + 1}</span>
                  <span>{scene?.name || '…'}</span>
                  {(scene?.engaged || []).length ? (
                    <span className="live-scene-on">
                      {scene.engaged.map((eid) => blockName(eid, nameOf)).join(' · ')}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {partial.notes ? <p className="live-summary">{partial.notes}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The one line that says what is happening, and how long it has been happening.
 *
 * There were three of them. The conversation printed `progress` as a plain
 * hint, this printed the identical string again with meter bars beside it, and
 * a third row — a hand-built copy of these same bars wrapped around a `Stages`
 * component — printed a scripted guess and a clock. Three lines, stacked, two
 * of them word-for-word the same, and the only one carrying the elapsed time
 * was the one that knew least about what the model was actually doing.
 *
 * So there is one line now and it owns both halves: the message, which comes
 * from the events the request really emits, and the clock, which is the fact
 * nothing else can supply. `STAGES` remains as the opening guess — it fills the
 * second or two before the first event lands, and nothing more.
 *
 * The old script kept talking long after it had anything to say: it ran out
 * after half a minute, parked on "Nearly there…", and said that identical thing
 * whether the model was a token from finishing or had died two minutes earlier.
 * A real message always wins over it here, and past a minute the line says
 * plainly that this is no longer normal.
 */
/**
 * When to stop showing only a clock, and what to say instead.
 *
 * This said "longer than usual" at sixty seconds, every time, for a reason that
 * had nothing to do with what usual is: sixty was an old server ceiling, and
 * when that ceiling moved this line did not. The app's own timing now calls
 * ninety seconds before the first token "slow, not broken" — so the warning was
 * firing on runs the rest of the code considers ordinary, and a warning that
 * always fires is one nobody reads.
 *
 * "Every tone generator says it takes longer than usual. How long is usual? If
 * it takes longer than usual, why does it always say that?"
 *
 * So there are two questions and they are answered separately.
 *
 * IS MY RIG SAFE is the one somebody actually has while waiting, and it does
 * not depend on knowing a norm — the answer is the same at forty seconds and at
 * two minutes, and it is worth saying once the wait is long enough to worry
 * anybody. That is REASSURE_AT, and it is a fact rather than a comparison.
 *
 * IS THIS ONE SLOW needs a norm, and is only said where there is a measured one
 * — this person's own median, from history.js. Half again as long as usual is a
 * real outlier and worth naming; with no measurements yet it says nothing,
 * because the honest answer to "is this longer than usual" with three runs of
 * data is that we do not know.
 */
const REASSURE_AT = 40
const SLOW_MULTIPLE = 1.5

function aside(seconds, typicalMs) {
  const usual = Number.isFinite(typicalMs) && typicalMs > 0 ? Math.round(typicalMs / 1000) : null
  const slow = usual !== null && seconds > Math.max(usual * SLOW_MULTIPLE, usual + 15)

  if (slow) return ` · longer than your usual ${usual}s — nothing has been sent to your unit yet`
  if (seconds >= REASSURE_AT) return ' · nothing has been sent to your unit yet'
  return ''
}

export function Thinking({
  message,
  active,
  startedAt,
  typicalMs = null,
  /*
   * The way into the live feed, on the line people are already staring at.
   *
   * "Would be nice if tapping on thinking shows actually more of the output
   * while it's happening, like a live feed of everything." The feed already
   * existed and hid behind a separate chip below this line, which is one more
   * thing to notice while waiting. So the line becomes the control the moment
   * there is anything to show — and stays a plain line before that, because a
   * button that opens nothing is worse than no button.
   */
  live = false,
  open = false,
  onToggle = null
}) {
  const [now, setNow] = useState(Date.now())
  const running = !!(active || message)

  useEffect(() => {
    if (!running || !startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running, startedAt])

  if (!running) return null

  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : null
  const text = message || `${THINKING}…`

  /*
   * The time and the sentence after it are two spans, because they wrap
   * differently. The figure must never break across a line — "4m" on one row
   * and "20s" on the next reads as two numbers. The sentence must ALWAYS be
   * allowed to: held to one line with the figure, "nothing has been sent to
   * your unit yet" ran off the right edge of a phone and dragged the whole
   * conversation sideways with it.
   */
  let clock = null
  let more = ''
  if (seconds !== null) {
    clock = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
    more = aside(seconds, typicalMs)
  }

  const body = (
    <>
      <span className="thinking-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="mono thinking-text">
        {text}
        {clock ? (
          <span className="thinking-clock">
            {' · '}
            <span className="thinking-time">{clock}</span>
            {more}
          </span>
        ) : null}
      </span>
      {live ? (
        <span className="thinking-more">{open ? 'Hide' : 'Watch it'}</span>
      ) : null}
    </>
  )

  if (live && onToggle) {
    return (
      <button
        type="button"
        className="thinking thinking-tap"
        onClick={onToggle}
        aria-expanded={open}
        role="status"
        aria-live="polite"
      >
        {body}
      </button>
    )
  }

  return (
    <div className="thinking" role="status" aria-live="polite">
      {body}
    </div>
  )
}
