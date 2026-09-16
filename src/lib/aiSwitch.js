/**
 * Two switches over the AI, kept on this device.
 *
 * "When I said a button to turn the AI on off I meant have the chat still
 * available but keep everything local. Maybe we can add a button for both."
 *
 * CHAT is whether the conversation is offered at all: the ✦ Ask button on
 * Play and the Ask tab on a wide screen. Off, they are gone.
 *
 * MODEL is whether a request may go to the model. Off, the chat stays and the
 * app does what it can by itself — a scene, the tempo, a block on or off, a
 * channel, a control to a number or up a bit, the volume, a rename, a band
 * the book already knows — and says plainly when a request is more than that.
 *
 * Both on by default, and anything unreadable is on: a switch that came back
 * "off" because a value could not be parsed would look like the feature
 * vanishing. 7.224.0 shipped one switch, "AI", stored as fractal.aiOn; what it
 * meant was the model, so that key is read as the model's until it is next
 * written.
 */
const CHAT_KEY = 'fractal.chatOn'
const MODEL_KEY = 'fractal.modelOn'
const LEGACY_KEY = 'fractal.aiOn'

const store = (storage) => storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)

export function loadChatOn(storage) {
  try {
    return store(storage)?.getItem(CHAT_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveChatOn(on, storage) {
  try {
    const s = store(storage)
    if (on) s?.removeItem(CHAT_KEY)
    else s?.setItem(CHAT_KEY, '0')
    return true
  } catch {
    return false
  }
}

export function loadModelOn(storage) {
  try {
    const s = store(storage)
    const own = s?.getItem(MODEL_KEY)
    if (own !== null && own !== undefined) return own !== '0'
    return s?.getItem(LEGACY_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveModelOn(on, storage) {
  try {
    const s = store(storage)
    s?.setItem(MODEL_KEY, on ? '1' : '0')
    s?.removeItem(LEGACY_KEY)
    return true
  } catch {
    return false
  }
}
