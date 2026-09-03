/**
 * A tuner that behaves like one. The first mock picked a new random string
 * and a new random ±15 cents every 400 ms, so the display never settled and
 * looked broken. This one holds a string, drifts a little and settles toward
 * pitch, moves to another string now and then, and sometimes goes quiet —
 * an empty note, which is what a real unit gives you between strings and
 * what the tuner panel already knows how to show.
 */
export function createTunerStream(random = Math.random) {
  const strings = [['E', 2], ['A', 2], ['D', 3], ['G', 3], ['B', 3], ['E', 4]]
  let [note, octave] = strings[0]
  let cents = 6
  let quiet = 0
  return {
    next() {
      if (quiet > 0) {
        quiet--
        return { type: 'tuner', note: '', octave: undefined, cents: null }
      }
      if (random() < 0.03) {
        quiet = 6 + Math.floor(random() * 8)
        return { type: 'tuner', note: '', octave: undefined, cents: null }
      }
      if (random() < 0.04) {
        ;[note, octave] = strings[Math.floor(random() * strings.length)]
        cents = (random() - 0.5) * 24
      }
      cents += (random() - 0.5) * 1.5
      cents += (0 - cents) * 0.04
      return { type: 'tuner', note, octave, cents: Math.round(cents) }
    }
  }
}
