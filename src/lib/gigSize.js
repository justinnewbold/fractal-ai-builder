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
 * STEP 1 IS TODAY'S SCREEN, exactly — 62px tiles in 110px columns. A player
 * who never touches this sees what they have always seen, which is the only
 * honest default for a control that changes the thing you reach for mid-song.
 */
export const SIZES = [
  { name: 'Smallest', tile: 48, col: 88 },
  { name: 'Small', tile: 62, col: 110 },
  { name: 'Medium', tile: 78, col: 132 },
  { name: 'Large', tile: 96, col: 158 },
  { name: 'Largest', tile: 120, col: 190 }
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
  const s = SIZES[clampSize(n)]
  return {
    '--gig-tile': `${s.tile}px`,
    '--gig-col': `${s.col}px`,
    '--gig-col-block': `${s.col + 20}px`
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
