/**
 * Which Fractal the demo is pretending to be.
 *
 * "Demo for all Fractal units with real default presets and scenes."
 *
 * The demo was an FM3 and only ever an FM3, which is the wrong shape of
 * answer for somebody deciding whether this app is worth buying. An AM4 owner
 * opening it saw eight scene tiles their unit has not got, five hundred slots
 * it has not got, and a preset list sharing no names with theirs. The whole
 * point of a demo is that it can be checked against the thing on the desk.
 *
 * WHAT IS REAL HERE AND WHAT IS THE SIMULATION'S OWN SHAPE. Worth saying
 * plainly, because the rule this project runs on is that a wrong fact about
 * gear is worse than a missing one.
 *
 *   REAL, from data/factory-presets.csv and the source behind it: how many
 *   scenes a preset has, how many slots the unit holds, how many of those
 *   ship full, the channel letters, and every preset and scene name.
 *
 *   THE DEMO'S OWN: the block layout. A real unit reports its grid and this
 *   app reads it; nothing here has measured an FM9 or an Axe-Fx III, so
 *   rather than print a grid size nobody checked, the three grid units share
 *   the layout the demo's own twelve-block chain occupies. It is a simulation
 *   and says so on every screen. The AM4 and the VP4 report no grid at all,
 *   which is what an AM4 really does — see lib/gearCatalog on why "grid ×"
 *   is not a fact about one.
 *
 * There is deliberately no model id. Nothing outside the mock reads one, so
 * five invented numbers would be five things to be wrong about for no gain.
 */

/*
 * The layout the demo's chain occupies. Not a claim about anybody's hardware
 * beyond the FM3, whose grid this genuinely is.
 */
const DEMO_GRID = { rows: 4, cols: 12 }

export const UNITS = [
  {
    key: 'fm3',
    name: 'FM3',
    grid: DEMO_GRID,
    scenes: 8,
    channels: ['A', 'B', 'C', 'D'],
    slots: 512,
    amps: true
  },
  {
    key: 'fm9',
    name: 'FM9',
    grid: DEMO_GRID,
    scenes: 8,
    channels: ['A', 'B', 'C', 'D'],
    slots: 512,
    amps: true
  },
  {
    key: 'axefx3',
    name: 'Axe-Fx III',
    grid: DEMO_GRID,
    scenes: 8,
    channels: ['A', 'B', 'C', 'D'],
    slots: 512,
    amps: true
  },
  {
    key: 'am4',
    name: 'AM4',
    /* A four-block chain, not a grid, and it reports none. */
    grid: null,
    scenes: 4,
    channels: ['A', 'B', 'C', 'D'],
    /* A1 to Z4. 88 of them ship full; the last sixteen are yours. */
    slots: 104,
    amps: true
  },
  {
    key: 'vp4',
    name: 'VP4',
    grid: null,
    scenes: 4,
    channels: ['A', 'B', 'C', 'D'],
    slots: 104,
    /*
     * NO AMP AND NO CAB. The VP4 is a virtual pedalboard — four effects in
     * front of, or after, an amp you already own. A demo that gave it an amp
     * block would teach somebody the wrong thing about a unit they may be
     * deciding whether to buy, which is the one job a demo has.
     */
    amps: false
  }
]

const BY_KEY = new Map(UNITS.map((u) => [u.key, u]))

/** The one the demo starts as, and falls back to. */
export const DEFAULT_UNIT = 'fm3'

/** A unit by key, never undefined — the mock cannot draw an absent one. */
export const unitByKey = (key) => BY_KEY.get(key) || BY_KEY.get(DEFAULT_UNIT)

/** Every key, for a picker that must not offer one the catalog has no bank for. */
export const UNIT_KEYS = UNITS.map((u) => u.key)

/**
 * The demo's one sentence, naming the unit it is actually pretending to be.
 *
 * Written here rather than at each place that says it, because it was said in
 * three — the banner, the word in the top bar, and the phone's Settings —
 * and two of them had "Simulated FM3" typed into them as a literal. Those two
 * went on saying FM3 to somebody looking at a simulated AM4, which is exactly
 * the kind of confident wrong fact about gear this project refuses everywhere
 * else. The third read the unit and was right, so the bug looked like a phone
 * and a browser disagreeing about what was on screen.
 */
export const demoSentence = (key) =>
  `Simulated ${unitByKey(key).name} — nothing here reaches hardware. Real models and parameter ranges, real write behaviour including the silent clamp.`
