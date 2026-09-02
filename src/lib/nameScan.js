/**
 * The scan that reads preset names when nobody is asking for them.
 *
 * On a gen-3 unit a stored name costs a preset dump down a serial port that
 * serialises every request, so reading all 512 is minutes of the unit's
 * attention. Pressing ⟳ and waiting was the only way to get them, and the
 * picker opened empty until someone did. This walks the unread slots on its
 * own, in one of two paces:
 *
 *  - quiet: between slots it leaves the port alone for a moment, and before
 *    each one it asks `hold()` whether someone is using the unit — a knob
 *    being turned, a generation landing, a finger on the screen — and waits
 *    while they are. The names arrive while nobody is looking.
 *  - eager: the picker is open and someone is waiting for the list, so it
 *    reads back to back, the way ⟳ always did.
 *
 * Pure: the slots, the reads and the clock are handed in, so the whole
 * state machine runs in a unit test with no unit and no time.
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createNameScan({
  total,
  isKnown,
  read,
  onProgress,
  onDone,
  sleep = wait,
  quietGap = 600,
  holdPoll = 250,
  giveUpAfter = 6
}) {
  let running = false
  let stopped = false
  let eager = false
  let hold = () => false

  async function run() {
    if (running) return 'running'
    running = true
    stopped = false
    let strikes = 0
    let outcome = 'done'
    try {
      for (let number = 0; number < total; number++) {
        if (stopped) {
          outcome = 'stopped'
          break
        }
        if (isKnown(number)) {
          // Already known: worth showing a resumed scan moving through them,
          // not worth a redraw per slot when it skips four hundred in a row.
          if (number % 32 === 0) onProgress?.(number + 1, total)
          continue
        }
        while (!eager && !stopped && hold()) await sleep(holdPoll)
        if (stopped) {
          outcome = 'stopped'
          break
        }
        try {
          await read(number)
          strikes = 0
        } catch {
          // One slot going wrong is one slot. A run of them is a unit that
          // has stopped answering, and 500 more questions won't help.
          if (++strikes >= giveUpAfter) {
            outcome = 'failed'
            break
          }
        }
        onProgress?.(number + 1, total)
        if (!eager && number + 1 < total) await sleep(quietGap)
      }
    } finally {
      running = false
    }
    onDone?.(outcome)
    return outcome
  }

  return {
    run,
    /** Stop after the read in flight. A later run() resumes from what is known. */
    stop() {
      stopped = true
    },
    /** Back to back (someone is waiting) or with the port left alone between slots. */
    setEager(on) {
      eager = !!on
    },
    /** Asked before each quiet read: true while the unit is someone else's. */
    setHold(fn) {
      hold = typeof fn === 'function' ? fn : () => false
    },
    get running() {
      return running
    },
    get eager() {
      return eager
    }
  }
}
