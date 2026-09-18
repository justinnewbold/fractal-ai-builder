/* Generated from src/lib/demoMemory.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/*
 * The demo's scene names, kept across a reload, per preset.
 *
 * A rename went into an array that was rebuilt from a literal on every page
 * load, so "Solo" was "4" again after a reload. The real-device cache
 * (fractal.sceneNames) is the wrong home for it — that is "names decoded off
 * a unit once", and a rename clears it on purpose — so the demo keeps its
 * own key, the way it already keeps its MIDI setting.
 *
 * PER PRESET, because the demo holds twelve of them now (src/data/demo-presets.json)
 * and each carries its own four named scenes. One global list of eight meant
 * renaming a scene on "Drop D Chug" renamed it on every other preset too, and
 * the seeded names — Verse, Chorus, Bridge, Lead on one preset, Jangle, Room,
 * Bite, Hall on another — would all have been flattened into whichever list
 * was saved last. The real-device path is already keyed this way; see
 * storedSceneNames(slug, number) in mobile/src/lib/device.js.
 *
 * A value left over from the single-list shape is simply not recognised and
 * the seeded names stand. That costs a demo rename made before this change and
 * nothing else.
 */
export const DEMO_SCENE_NAMES = 'fractal.demo.sceneNames'
export const DEFAULT_SCENE_NAMES = ['Rhythm', 'Lead', 'Clean', '', '', '', '', '']

const readAll = () => {
  try {
    const kept = JSON.parse(localStorage.getItem(DEMO_SCENE_NAMES) || 'null')
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
  } catch {
    return {}
  }
}

const eight = (v) => Array.isArray(v) && v.length === 8 && v.every((n) => typeof n === 'string')

export const storedSceneNames = (number) => {
  const kept = readAll()[String(number)]
  return eight(kept) ? kept : null
}

export const keepSceneNames = (number, names) => {
  try {
    localStorage.setItem(DEMO_SCENE_NAMES, JSON.stringify({ ...readAll(), [String(number)]: names }))
  } catch {
    // A full or disabled localStorage costs the demo a name after a reload, nothing more.
  }
}
