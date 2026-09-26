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

/*
 * WHERE IT IS KEPT. The browser has localStorage; the phone does not, and for
 * as long as this file reached for it by name every demo rename on a phone
 * went into a try/catch and was gone at the next launch. The phone hands in
 * its own synchronous store (mobile/src/lib/store.js) at start-up instead, the
 * same object its setlists and stars are written to.
 */
let handed = null

/** Keep the demo's memory in `storage` rather than in localStorage. */
export const useDemoStorage = (storage) => {
  handed = storage || null
}

const box = () => handed || (typeof localStorage !== 'undefined' ? localStorage : null)

const readAll = () => {
  try {
    const kept = JSON.parse(box()?.getItem(DEMO_SCENE_NAMES) || 'null')
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
    box()?.setItem(DEMO_SCENE_NAMES, JSON.stringify({ ...readAll(), [String(number)]: names }))
  } catch {
    // A full or disabled localStorage costs the demo a name after a reload, nothing more.
  }
}

/*
 * SAVED PRESETS, per demo unit.
 *
 * "Can we set it up for demos to actually save on their phone when they do
 * changes? So they can kind of really see how it would save."
 *
 * Save on a real rig asks the computer to write the slot. The demo has no
 * computer, so it answered Save with "The demo has no answer for PUT
 * /store/config/fractal.pendingSave…" — the one button a person trying the
 * app most wants to see work. Now Save in the demo writes the preset here, on
 * the phone (or in the browser), and the next launch opens it as it was left.
 *
 * Nothing leaves the device and no account is needed: this is somebody trying
 * the app, and a sign-in to keep a pretend preset would be the wrong price.
 *
 * PER UNIT, unlike the scene names above: slot 3 on the demo FM3 and slot 3 on
 * the demo AM4 are different presets, and a save on one must not appear on
 * the other.
 */
export const DEMO_SAVED = 'fractal.demo.saved'
const namesKey = (unit) => `${DEMO_SAVED}.${unit}`
/* Each rig in a document of its own: one is about 30 KB, and a single document
   holding every save a person makes would outgrow what one Android storage
   row holds long before the phone ran short of room. */
const rigKey = (unit, number) => `${DEMO_SAVED}.${unit}.${number}`

const readJson = (key) => {
  try {
    const kept = JSON.parse(box()?.getItem(key) || 'null')
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : null
  } catch {
    return null
  }
}

/** The names of every preset saved in the demo on this unit, by slot number. */
export const savedPresets = (unit) => {
  const names = readJson(namesKey(unit)) || {}
  return Object.fromEntries(Object.entries(names).filter(([, name]) => typeof name === 'string'))
}

/** What was saved in `number` on this demo unit, or null. */
export const savedRig = (unit, number) => readJson(rigKey(unit, number))

/** Keep `rig` under `name` as what the demo unit holds in `number`. */
export const keepSavedPreset = (unit, number, name, rig) => {
  try {
    box()?.setItem(rigKey(unit, number), JSON.stringify(rig))
    box()?.setItem(namesKey(unit), JSON.stringify({ ...savedPresets(unit), [String(number)]: String(name ?? '') }))
    return true
  } catch {
    return false
  }
}
