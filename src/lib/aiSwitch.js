/**
 * Whether the AI is on at all, on this device.
 *
 * "Can we add a toggle on settings to turn the AI on and off?" Play mode hides
 * the Ask button on the stage screen and nothing else; this is the bigger
 * switch. Off, nothing this app does can reach the model: the Ask button and
 * the Ask tab are gone, and the two places a request is sent — the designer
 * and the chat — answer with one plain line instead. Everything that does not
 * need the model still works: scenes, knobs, presets, the band book, the
 * volume, renaming.
 *
 * On by default, and anything unreadable is on: a switch that came back "off"
 * because a value could not be parsed would look like the feature vanishing.
 */
const KEY = 'fractal.aiOn'

export function loadAiOn(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    return store?.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function saveAiOn(on, storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    if (on) store?.removeItem(KEY)
    else store?.setItem(KEY, '0')
    return true
  } catch {
    return false
  }
}
