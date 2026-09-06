/**
 * A tuner that behaves like one.
 *
 * The first mock picked a new random string and a new random ±15 cents every
 * 400 ms, so the display never settled and looked broken. The second held a
 * string and drifted toward pitch, which was most of the way there — but it
 * could also swap strings at any poll, on a 4% roll, mid-note. Reported as
 * "the note hops randomly, E2 → D3 → E4; looks broken", which is the same
 * complaint the first fix was for, arriving less often.
 *
 * A real tuner does not do that. It cannot: while a string is ringing there is
 * one pitch to detect, and the detector holds it. The note only changes after
 * the note stops — you mute, you play another string, and it reads the new one.
 *
 * So the note is fixed for the life of a ring, and a new one is chosen only
 * coming out of a quiet gap. Which keeps the quiet state (a real unit gives you
 * an empty note between strings, and the panel already knows how to show it),
 * keeps the demo showing more than one string, and makes a mid-note jump
 * impossible rather than unlikely.
 */
export function createTunerStream(random = Math.random) {
  const strings = [['E', 2], ['A', 2], ['D', 3], ['G', 3], ['B', 3], ['E', 4]]
  let [note, octave] = strings[0]
  let cents = 6
  let quiet = 0
  const silent = () => ({ type: 'tuner', note: '', octave: undefined, cents: null })
  return {
    next() {
      if (quiet > 0) {
        quiet--
        // The last poll of the gap picks what gets played next, so the note
        // that comes back is already the new one rather than the old one for a
        // frame.
        if (quiet === 0) {
          ;[note, octave] = strings[Math.floor(random() * strings.length)]
          cents = (random() - 0.5) * 24
        }
        return silent()
      }
      // A ring ends now and then. Long enough to read as a pause rather than a
      // dropout: at 400 ms a poll, two and a half to five and a half seconds.
      if (random() < 0.03) {
        quiet = 6 + Math.floor(random() * 8)
        return silent()
      }
      cents += (random() - 0.5) * 1.5
      cents += (0 - cents) * 0.04
      return { type: 'tuner', note, octave, cents: Math.round(cents) }
    }
  }
}
