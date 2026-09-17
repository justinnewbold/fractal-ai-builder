/* Generated from src/lib/gigSize.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

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
 *
 * A scene is WIDER than an effect at every step, including the smallest — "try
 * making them wider". Two grids of identical tiles read as one grid however
 * they are coloured, and size is the difference you notice before you have
 * looked at anything.
 */
export const SIZES = [
  { name: 'Smallest', tile: 48, col: 88, scenes: 2, fx: 4 },
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

/*
 * Fit: not a step on the ladder, a different rule.
 *
 * "It would be nice just to have everything static on the screen without
 * being able to scroll." Every step above is a fixed height, so whether a rig
 * fits depends on how many scenes and blocks the preset has — Smallest fits
 * the demo and scrolls on a fourteen-block preset. Fit turns that round: the
 * screen decides the height. The Play screen measures what is left once its
 * own chrome is on, and this shares it out among the rows of tiles.
 */
const FIT_KEY = 'fractal.gigFit'

/**
 * How tall a tile can be for every scene and every block to be on screen at
 * once, and how many blocks to a row that takes.
 *
 * `available` is the height left for the two grids together. Blocks start at
 * `fxCols` to a row and go one wider each time the tile would otherwise drop
 * under the tap floor — five or six small tiles a row is still a rig you can
 * see whole, and a tile under 44px is one you cannot hit. Past six across it
 * stops widening and the floor wins: a preset that big scrolls, which is what
 * it did before.
 */
export function fitTiles({
  available,
  scenes = 0,
  blocks = 0,
  sceneCols = 2,
  fxCols = 4,
  gap = 8,
  min = 44,
  max = 96
} = {}) {
  const room = Math.max(0, Number(available) || 0)
  const sceneRows = Math.ceil(Math.max(0, scenes) / Math.max(1, sceneCols))
  let cols = Math.max(1, fxCols)
  for (;;) {
    const rows = sceneRows + Math.ceil(Math.max(0, blocks) / cols)
    if (!rows) return { tile: max, fxCols: cols }
    const tile = Math.floor((room - gap * (rows - 1)) / rows)
    if (tile >= min || cols >= 6) return { tile: Math.max(min, Math.min(max, tile)), fxCols: cols }
    cols += 1
  }
}

/** Whether Play fits itself to the screen on this device. */
export function loadFit(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    return store?.getItem(FIT_KEY) === '1'
  } catch {
    return false
  }
}

export function saveFit(on, storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    if (on) store?.setItem(FIT_KEY, '1')
    else store?.removeItem(FIT_KEY)
    return true
  } catch {
    return false
  }
}
