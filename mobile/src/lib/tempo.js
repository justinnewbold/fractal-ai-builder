/* Generated from shared/tempo.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * A tempo typed by hand, checked before it reaches the unit.
 *
 * Tap gets you close; typing gets you exact. "On the tap button, let's do
 * where they hold the tap button they can manually enter in the beats per
 * minute they want." Both apps offer that box, so both apps have to agree on
 * what counts as a tempo — and the unit's own range is the whole of the rule:
 * 20 to 400 BPM. Anything outside it is refused here, in words, rather than
 * clamped somewhere downstream into a number nobody typed.
 */
export const BPM_MIN = 20
export const BPM_MAX = 400

/**
 * What typed text means as a tempo.
 *
 *   { bpm }    — a whole number the unit will take
 *   { empty }  — nothing typed; the caller leaves the tempo alone
 *   { error }  — a sentence for the person, never a code
 */
export function checkBpm(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { empty: true }
  const n = Math.round(Number(raw.replace(/[^0-9.]/g, '')))
  if (!Number.isFinite(n) || !/^\d+(\.\d+)?$/.test(raw.replace(/\s+/g, ''))) {
    return { error: 'Type a tempo as a number, like 120.' }
  }
  if (n < BPM_MIN || n > BPM_MAX) {
    return { error: `${n} BPM is out of range — the unit takes ${BPM_MIN} to ${BPM_MAX}.` }
  }
  return { bpm: n }
}

/**
 * WHY TAPPING USED TO ANSWER WITH A TEMPO NOBODY PLAYED.
 *
 * "Right now after I tap it a few times slowly, it'll send a number and then
 * I'm done tapping and it sends back a different one … I understand it's
 * going over wifi and stuff, so but there's gotta be way to do it and make it
 * work."
 *
 * There is, and the wifi is the whole of it. Every press used to be forwarded
 * to the unit as a TAP — POST /tempo/tap, one per press — and the unit worked
 * the tempo out from the spacing between the taps AS THEY ARRIVED THERE.
 *
 * That spacing is not the spacing of a thumb. A tap leaving a phone crosses a
 * wifi network, a relay server somewhere on the internet, and a computer's own
 * queue before the unit sees it, and each of those adds a delay that is
 * different every time. Tap four times exactly one second apart and the unit
 * might receive them 1.00, 0.88, 1.15 and 0.97 seconds apart. It then reports,
 * correctly, the tempo of what it actually heard — which is not what was
 * played. The slower the taps, the longer the burst, the more room for the
 * jitter to add up.
 *
 * Nothing at the far end can fix that, because the information is destroyed
 * on the way. The only clock that knows what was tapped is the one in the
 * hand doing the tapping.
 *
 * SO THE TAPS NEVER LEAVE. The gaps are measured here, the tempo is worked
 * out here, and what goes to the unit is the NUMBER — the same call a typed
 * tempo uses. "Whatever it shows is what should get sent to the device", and
 * now it is, exactly. A read-back that follows can only confirm it: the unit
 * was told 132, so it says 132.
 */

/**
 * How long after the last tap to ask the unit what tempo it is on.
 *
 * Only a confirmation now. The unit has been told an exact number rather than
 * asked to work one out, so this can no longer come back with a surprise —
 * which is the point. What it still catches is a unit that refused the write
 * or rounded it, and that is worth one small read.
 *
 * It waits for the burst to end rather than following each press, because a
 * read mid-burst answers about the number sent one tap ago.
 */
export const TAP_REREAD_MS = 900

/**
 * The tempo your taps mean, worked out here instead of waited for.
 *
 * "It must be waiting to hear back from the device to change the number …
 * right now it takes a few seconds after doing the tap, so you can't even tell
 * the tempo you're tapping at."
 *
 * Exactly right, and the delay was designed in. The number on the button only
 * ever came from the unit, and the unit can only be asked once tapping stops —
 * TAP_REREAD_MS above explains why — so the figure lagged the last tap by
 * nearly a second. Which defeats the point: you tap to FIND a tempo, and a
 * tempo you cannot see while tapping is one you cannot aim.
 *
 * And since 7.365.0 it is also what gets SENT — see the note above on why
 * forwarding the taps themselves could never work over a network.
 *
 * HOW MANY TAPS. "It should basically take the last three taps and use that
 * to calculate the tempo." Three taps, which is two gaps between them,
 * averaged. Two gaps is enough to take the edge off an unsteady hand and
 * short enough that changing your mind about the tempo shows up on the very
 * next press rather than three presses later.
 */
export const TAP_AVERAGE = 3

/**
 * A gap longer than this starts a new count rather than joining the old one.
 *
 * At 20 BPM — the slowest the unit takes — beats are three seconds apart, so
 * anything past that is not part of the same rhythm. Without this, tapping
 * four times, stopping to listen, then tapping again averages the pause into
 * the tempo and answers with something nobody played.
 */
export const TAP_GAP_MAX_MS = 3200

/**
 * @param {number[]} taps  when each tap happened, oldest first, in ms
 * @returns {number|null}  whole BPM, or null while there is not yet a rhythm
 */
export function tappedBpm(taps = []) {
  const times = (Array.isArray(taps) ? taps : []).filter((t) => Number.isFinite(t))
  if (times.length < 2) return null

  /* Gaps, newest first, stopping at the first one too long to belong. */
  const gaps = []
  for (let i = times.length - 1; i > 0 && gaps.length < TAP_AVERAGE - 1; i -= 1) {
    const gap = times[i] - times[i - 1]
    if (gap <= 0 || gap > TAP_GAP_MAX_MS) break
    gaps.push(gap)
  }
  if (!gaps.length) return null

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const bpm = Math.round(60000 / mean)
  /* Outside what the unit accepts is not a tempo, it is a mis-tap. Saying
     nothing leaves the last good figure up, which is the honest answer. */
  return bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : null
}

/**
 * The tap list to keep after a press at `now`.
 *
 * Trimmed here rather than by each caller so both ends forget at the same
 * rate, and a pause drops the old rhythm instead of blending into it.
 */
export function keepTaps(taps = [], now = Date.now()) {
  const times = (Array.isArray(taps) ? taps : []).filter((t) => Number.isFinite(t))
  const last = times[times.length - 1]
  const fresh = last != null && now - last > TAP_GAP_MAX_MS ? [] : times
  return [...fresh, now].slice(-TAP_AVERAGE)
}

/**
 * Send tempo numbers without letting them pile up behind each other.
 *
 * Every tap past the second has a number to send, and a burst is several taps
 * in a couple of seconds. Firing all of them at a computer across a relay
 * queues writes behind writes: the last one — the only one that matters — is
 * then the last to land, possibly after the read-back that was meant to
 * confirm it.
 *
 * So: one write in the air at a time, and while one is in the air the newest
 * number replaces whatever was waiting rather than joining a queue. An
 * intermediate tempo nobody held their thumb still for is not worth a round
 * trip; the newest one always is. What this guarantees, which a plain queue
 * does not, is that THE LAST NUMBER SHOWN IS THE LAST NUMBER SENT.
 *
 * `send` is the app's own write — setTempo, whatever that means at this end.
 * `onError` gets anything it throws, once, rather than each caller wrapping
 * every press in a try.
 */
export function tempoSender(send, onError) {
  let inFlight = false
  let waiting = null
  let sent = null

  const pump = async () => {
    if (inFlight) return
    while (waiting != null) {
      const bpm = waiting
      waiting = null
      inFlight = true
      try {
        await send(bpm)
        sent = bpm
      } catch (err) {
        onError?.(err)
      } finally {
        inFlight = false
      }
    }
  }

  return {
    /** Put this number next in line, replacing any that has not gone yet. */
    push(bpm) {
      waiting = bpm
      return pump()
    },
    /** Nothing in the air and nothing waiting: safe to read the unit back. */
    get idle() {
      return !inFlight && waiting == null
    },
    /** The last number that actually reached the unit, or null. */
    get sent() {
      return sent
    }
  }
}
