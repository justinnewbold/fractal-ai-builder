/* Generated from src/lib/factoryPresets.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * What every current Fractal unit ships with, by slot.
 *
 * "Here are all the preset names and scene names for all of the current
 * fractal units for you to put in the demos."
 *
 * The demo's twelve hand-built presets are good ones — real amps, real cabs,
 * scenes that genuinely differ — but they are not what anybody's unit says
 * when they switch it on. Somebody trying the demo is holding it up against
 * the rig in front of them, and a preset list sharing no names with theirs is
 * a list they cannot check the app against. These are the real ones: 384
 * slots on an Axe-Fx III, FM9 and FM3, 104 on an AM4 and VP4.
 *
 * Generated from data/factory-presets.csv by scripts/factory-presets.mjs. Do
 * not edit the JSON.
 *
 * TWO RULES ABOUT WHAT IS NOT THERE, both his:
 *
 *   An unnamed scene is called "Scene 5", because that is what the unit shows.
 *   A great many factory scenes have no name of their own, and inventing a
 *   plausible one for each would make the demo look better and be wrong.
 *
 *   An empty slot is empty. The AM4 ships 88 presets in 104 slots and the VP4
 *   80; the rest are yours. A demo that fills them teaches that they come
 *   full.
 */
import factory from '../data/factory-presets.json' with { type: 'json' }

/** The units this catalog covers, by the key the mock's profile uses. */
export const UNITS = Object.keys(factory)

/** Every slot on a unit, in order, each `{ number, name, scenes? }`. */
export const presetsFor = (unit) => factory[unit] || []

/** What the unit would report for a slot, or '' for an empty one. */
export function nameFor(unit, slot) {
  const found = factory[unit]?.[slot]
  return found?.name || ''
}

/**
 * The scene names inside a slot, or null where there is no preset in it.
 *
 * Null rather than an array of blanks: a caller that gets a list assumes
 * there are scenes to show, and an empty slot has none.
 */
export function scenesFor(unit, slot) {
  const found = factory[unit]?.[slot]
  return found?.name && found.scenes ? found.scenes.slice() : null
}

/** How many of a unit's slots ship with something in them. */
export const namedCount = (unit) => presetsFor(unit).filter((p) => p.name).length
