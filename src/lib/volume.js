/**
 * The volume slider on the Play screen.
 *
 * "Add volume slider to the play screen to quickly turn volume up or down."
 *
 * The control it moves is the Output block's Level — the one knob on the unit
 * that is the whole preset's volume, and the one lib/guardrails keeps away from
 * the model for exactly that reason: it can silence a preset. That rule is
 * about a generator working from a text description. A thumb on a slider,
 * between songs, is the player, and the player's is who Output belongs to.
 *
 * What lives here is the part that can be tested without a browser: which
 * parameter the slider drives, how it reads, and how a stream of drag values
 * turns into writes a serial port can keep up with.
 */
import { isLevelParam } from './guardrails.js'

const usable = (p) =>
  p && typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min

/**
 * The parameter the slider drives, out of the Output block's own list.
 *
 * "Level" by name first — that is what the FM3 calls it and what the demo
 * unit calls it. Failing that, anything the guardrails would call a level,
 * which covers a driver that says "Out Level". Null means no slider: a unit
 * whose output block has no level the app can move is not given a control
 * that can only disappoint.
 */
export function outputLevelParam(named) {
  const list = Array.isArray(named) ? named : []
  return (
    list.find((p) => usable(p) && /^Level$/i.test(String(p.name || '').trim())) ||
    list.find((p) => usable(p) && isLevelParam(p.name)) ||
    null
  )
}

/** One notch of the slider, in the parameter's own units. Half a dB is audible; a tenth is not. */
export function volumeStep(param) {
  if (!usable(param)) return 1
  if (/db/i.test(String(param.unit || ''))) return 0.5
  const span = param.max - param.min
  return span >= 100 ? 1 : span >= 10 ? 0.1 : 0.01
}

/**
 * One press of the − or + beside the slider, in the parameter's own units.
 *
 * "Do a plus minus on the sides of the volume slider that does 1 dB at a
 * time." A dB is the unit a soundperson talks in, and a whole one is the
 * smallest change worth a button press; the slider is there for the sweep,
 * the buttons for landing on a number. On a control that is not in dB the
 * step is ten notches of the slider, which is the same idea.
 */
export function volumeNudge(param) {
  if (!usable(param)) return 1
  if (/db/i.test(String(param.unit || ''))) return 1
  return volumeStep(param) * 10
}

/** A value the − or + lands on: moved, rounded to the notch, and kept in range. */
export function nudged(value, param, delta) {
  if (!usable(param)) return value
  const from = typeof value === 'number' && Number.isFinite(value) ? value : param.min
  const step = volumeStep(param)
  const next = Math.round((from + delta) / step) * step
  return Math.max(param.min, Math.min(param.max, Math.round(next * 1000) / 1000))
}

/** Where the thumb sits, 0-100, for the fill drawn behind it. */
export function volumePercent(value, param) {
  if (!usable(param) || typeof value !== 'number' || !Number.isFinite(value)) return 0
  const pos = (value - param.min) / (param.max - param.min)
  return Math.round(Math.max(0, Math.min(1, pos)) * 100)
}

/**
 * "+2.0 dB", "−6.5 dB", "0.0 dB" — a sign on anything that has one, because
 * from arm's length "6.5" and "-6.5" are the same number.
 */
export function volumeLabel(value, param) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const unit = param?.unit ? ` ${param.unit}` : ''
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1)}${unit}`
}

const NONE = Symbol('none')

/**
 * One write on the wire at a time, and the newest value wins.
 *
 * A slider reports every pixel of a drag — sixty values a second on a mouse.
 * The unit takes one request at a time down a serial port, and the relay to a
 * phone adds a round trip to each. Sent as they come, a two-second drag would
 * queue a hundred writes that the unit works through for the next ten seconds,
 * landing on the value you let go of long after you let go of it, and blocking
 * the scene you pressed next behind them.
 *
 * So: while a write is out, the values that arrive replace each other, and
 * only the last one goes when the wire comes back. Nothing waits longer than
 * one round trip, and the value the unit ends on is the one under your thumb.
 *
 * A write that fails does not stop the ones behind it — mid-drag, the next
 * value is the fix — but it is kept, and settled() hands back the last one so
 * the release can say so once rather than the drag saying so sixty times.
 */
export function latestWriter(write) {
  let busy = null // the write on the wire
  let next = NONE // the value waiting behind it
  let waiting = [] // callers waiting for the wire to go quiet
  let lastError = null

  const quiet = () => {
    const w = waiting
    waiting = []
    for (const done of w) done()
  }

  const go = (value) => {
    // On the wire now, not a microtask later: the first value of a drag is
    // the one that makes the slider feel connected to the unit.
    let out
    try {
      out = Promise.resolve(write(value))
    } catch (err) {
      out = Promise.reject(err)
    }
    busy = out
      .catch((err) => {
        lastError = err
      })
      .then(() => {
        busy = null
        if (next !== NONE) {
          const v = next
          next = NONE
          go(v)
        } else {
          quiet()
        }
      })
  }

  return {
    /** Put a value on the wire, or behind the one already there. */
    send(value) {
      if (busy) next = value
      else go(value)
    },
    /** Resolves once nothing is in flight, with the last failure since the previous settle, or null. */
    settled() {
      const answer = () => {
        const err = lastError
        lastError = null
        return err
      }
      if (!busy) return Promise.resolve(answer())
      return new Promise((done) => waiting.push(() => done(answer())))
    },
    /** Whether a write is out right now. */
    get busy() {
      return busy !== null
    }
  }
}
