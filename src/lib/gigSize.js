/**
 * How much of the stage screen one button gets.
 *
 * The Play screen has always been one size, chosen once, for a phone held at
 * arm's length in the dark. That is the right default and the wrong rule: a
 * preset with eight scenes and nine blocks does not fit at that size, and a
 * preset with two scenes wastes most of the screen at it. Which of those you
 * have is not something the app can know, and it changes with the preset.
 *
 * So it is a setting, and the setting is two buttons. Bigger trades how much
 * you can see for how easily you can hit it; smaller trades back. Nobody has
 * to be told which they want — they press one and look.
 *
 * The steps are concrete pixel pairs rather than a multiplier on a base,
 * because the two numbers do not scale together: the column floor decides how
 * many fit across a row, and it has to clear a scene NAME at the size the tile
 * is drawn, not a proportion of it.
 */

/**
 * `tile` is the button's min-height; `col` the grid's column floor, which is
 * what actually decides how many land on a row.
 *
 * STEP 1 IS THE DEFAULT, and it is now the layout he chose from a screenshot:
 * scenes two across in colour, effects four across in three letters. It was
 * "today's screen, exactly" before that, which is the right instinct for a
 * control that changes what you reach for mid-song — but the whole point of
 * this change is that the default look moved.
 *
 * `scenes` and `fx` are how many land on a ROW ON A PHONE, which is the thing
 * the layout he asked for is actually about: scenes two across in colour, the
 * effects four across underneath in three letters. A pixel floor could not say
 * that — it says "at least this wide" and lets the viewport decide the rest,
 * which is why the default came out three across and never two.
 *
 * Phone only. On a desktop the grids stay on the pixel floors and auto-fit,
 * because two scene buttons across 1200px is not a design, it is a mistake.
 */
export const SIZES = [
  { name: 'Smallest', tile: 48, col: 88, scenes: 4, fx: 4 },
  { name: 'Small', tile: 62, col: 110, scenes: 2, fx: 4 },
  { name: 'Medium', tile: 78, col: 132, scenes: 2, fx: 3 },
  { name: 'Large', tile: 96, col: 158, scenes: 2, fx: 2 },
  { name: 'Largest', tile: 120, col: 190, scenes: 1, fx: 1 }
]

export const DEFAULT_SIZE = 1

const KEY = 'fractal.gigSize'

/** Clamp to a real step. Anything unreadable is the default, never a crash. */
export const clampSize = (n) => {
  // Number(null) is 0, which is a real step — so an absent value would read as
  // the smallest size rather than as no choice at all.
  if (n === null || n === undefined || n === '') return DEFAULT_SIZE
  const i = Math.round(Number(n))
  if (!Number.isFinite(i)) return DEFAULT_SIZE
  return Math.min(SIZES.length - 1, Math.max(0, i))
}

/**
 * The CSS the Play screen is drawn with at a given step.
 *
 * Blocks sit in wider columns than scenes at every size — a block carries a
 * name, a state and a channel where a scene carries a number and a name — so
 * the gap between them is kept rather than recomputed.
 */
export const sizeVars = (n) => {
  const i = clampSize(n)
  const s = SIZES[i]
  return {
    '--gig-tile': `${s.tile}px`,
    '--gig-col': `${s.col}px`,
    /*
     * A block column is wider than a scene column at every size but the bottom
     * one, where the extra 20px is what puts blocks three to a row instead of
     * four — and a fourteen-block preset five rows deep instead of four. The
     * name inside is clipped to one line at this size, so the width no longer
     * has to hold a whole name; it holds a state and a channel.
     */
    '--gig-col-block': `${s.col + (i === 0 ? 4 : 20)}px`,
    '--gig-scene-cols': String(s.scenes),
    '--gig-fx-cols': String(s.fx)
  }
}

/** What was chosen last time, on this device. */
export function loadSize(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    const raw = store?.getItem(KEY)
    return raw === null || raw === undefined ? DEFAULT_SIZE : clampSize(raw)
  } catch {
    // Private windows and blocked site data both throw on read. A stage screen
    // that renders at the default beats one that does not render.
    return DEFAULT_SIZE
  }
}

/** Remember it. A failure here costs the next reload, not this press. */
export function saveSize(n, storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    store?.setItem(KEY, String(clampSize(n)))
    return true
  } catch {
    return false
  }
}
