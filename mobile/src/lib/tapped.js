import { logTap } from './debugLog'

/**
 * Press it, and write down that it was pressed.
 *
 * "Can we add more, like what buttons get tapped and what the app does, how
 * long it takes to activate what the button was suppose to do?"
 *
 * Here rather than at four hundred call sites, because a log that depends on
 * somebody remembering to add a line is a log with a hole exactly where the
 * interesting thing happened. Every button in this app is `Press` or `Tile`, so
 * every button is in the log for free — and stays there when a new screen is
 * written by somebody who has never read this file.
 *
 * AWAITED, so the second line can say how long it took. Most handlers return a
 * promise that IS the work — loading a preset, flipping a block — and the thing
 * worth knowing is the gap between the finger and the unit, which is not
 * something the wire log can see on its own: it knows how long a request took,
 * and not how long anybody was standing there.
 *
 * A handler that throws is logged and goes no further. Swallowing an error is
 * normally the wrong trade; on a stage it is the right one, and it is not
 * silent — the line is in the log with the message on it, which is more than a
 * dead app gives anybody.
 */
export async function fire(what, run) {
  const done = logTap(what)
  try {
    await run?.()
    done()
  } catch (err) {
    done(err?.message || 'threw')
  }
}

/** What to call a button in the log: what is written on it. */
export const said = (...parts) => parts.filter(Boolean).join(' ') || 'button'
