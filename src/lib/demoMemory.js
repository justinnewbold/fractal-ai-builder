/*
 * The demo's scene names, kept across a reload.
 *
 * A rename went into an array that was rebuilt from a literal on every page
 * load, so "Solo" was "4" again after a reload. The real-device cache
 * (fractal.sceneNames) is the wrong home for it — that is "names decoded off
 * a unit once", and a rename clears it on purpose — so the demo keeps its
 * own key, the way it already keeps its MIDI setting.
 */
export const DEMO_SCENE_NAMES = 'fractal.demo.sceneNames'
export const DEFAULT_SCENE_NAMES = ['Rhythm', 'Lead', 'Clean', '', '', '', '', '']

export const storedSceneNames = () => {
  try {
    const kept = JSON.parse(localStorage.getItem(DEMO_SCENE_NAMES) || 'null')
    return Array.isArray(kept) && kept.length === 8 && kept.every((n) => typeof n === 'string') ? kept : null
  } catch {
    return null
  }
}

export const keepSceneNames = (names) => {
  try {
    localStorage.setItem(DEMO_SCENE_NAMES, JSON.stringify(names))
  } catch {
    // A full or disabled localStorage costs the demo a name after a reload, nothing more.
  }
}
