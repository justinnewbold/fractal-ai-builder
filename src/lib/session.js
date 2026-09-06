/**
 * The conversation, kept somewhere a backgrounded phone cannot take it.
 *
 * "I was also in the middle of generating a tone and the chat and tone
 * disappeared."
 *
 * The transcript and the tone on screen lived in React state and nowhere else.
 * That is fine on a desktop, where a tab stays put for days, and it is wrong on
 * the device this app is mostly used from: iOS evicts a backgrounded web page
 * whenever it wants the memory, and the page that comes back is a fresh load
 * with fresh state. Switching to another app for ten seconds — to read the
 * message that just arrived — was enough to lose an entire conversation and the
 * tone it had just designed. Nothing warned anyone, because from the app's side
 * nothing had gone wrong; it had simply started.
 *
 * So it is written down on every change. Reloading is not the only thing this
 * survives — it is also what makes the tone still be there after a crash, after
 * iOS kills the tab under memory pressure, and after somebody taps a link and
 * comes back.
 *
 * ## What is not kept
 *
 * A generation that was in flight cannot be resumed. It is an HTTP request held
 * open by a page that no longer exists, and no amount of writing things down
 * brings that back — the request died with the page. What IS kept is the fact
 * that it was running, so the app can say so and offer to ask again rather than
 * coming back looking as though nothing had been happening. See `interrupted`.
 */

const KEY = 'fab.session.v1'

/**
 * How much of a conversation is worth keeping.
 *
 * Long enough that no real session is truncated, bounded because localStorage
 * is a few megabytes for the whole origin and a transcript with a spec in every
 * turn is not small. The newest turns are the ones kept: an old one that falls
 * off the end has already been acted on.
 */
export const MAX_TURNS = 60

/** Written on every change, so the write has to be cheap and total. */
export function saveSession(state, store = safeStore()) {
  if (!store) return false
  try {
    const turns = Array.isArray(state?.turns) ? state.turns.slice(-MAX_TURNS) : []
    store.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        at: Date.now(),
        turns,
        result: state?.result ?? null,
        withScenes: !!state?.withScenes,
        renamePreset: state?.renamePreset !== false,
        saveName: state?.saveName || '',
        lastPrompt: state?.lastPrompt || '',
        /*
         * What was running when the page went away. Set while a generation is
         * in flight and cleared when it settles, so finding it set on load is
         * exactly the signal that the page died mid-thought.
         */
        pending: state?.pending || null
      })
    )
    return true
  } catch {
    // A quota that is full or storage a browser refuses is not worth failing a
    // render over. The conversation carries on in memory, as it always did.
    return false
  }
}

/** What was on screen last time, or null. Never throws; a bad record is no record. */
export function loadSession(store = safeStore()) {
  if (!store) return null
  try {
    const saved = JSON.parse(store.getItem(KEY) || 'null')
    if (!saved || saved.v !== 1) return null
    if (!Array.isArray(saved.turns)) return null
    return {
      at: Number(saved.at) || 0,
      turns: saved.turns.slice(-MAX_TURNS),
      result: saved.result ?? null,
      withScenes: !!saved.withScenes,
      renamePreset: saved.renamePreset !== false,
      saveName: typeof saved.saveName === 'string' ? saved.saveName : '',
      lastPrompt: typeof saved.lastPrompt === 'string' ? saved.lastPrompt : '',
      pending: saved.pending || null
    }
  } catch {
    return null
  }
}

export function clearSession(store = safeStore()) {
  try {
    store?.removeItem(KEY)
  } catch {
    // Nothing to clear is the outcome we wanted.
  }
}

/**
 * The turn to add when a restored session was cut off mid-generation.
 *
 * Said in the transcript rather than in a banner, because that is where the
 * question was asked and where the answer should have appeared. It names the
 * ask, so the button that offers to run it again has something to be about.
 *
 * Null when nothing was running, which is the ordinary case — a session that
 * ended between thoughts comes back with no extra turn at all.
 */
export function interrupted(pending) {
  const asked = typeof pending?.description === 'string' ? pending.description.trim() : ''
  if (!asked) return null
  return {
    role: 'system',
    text:
      'That generation stopped when this page went to the background — the phone put it to sleep ' +
      'before the answer came back. Nothing reached the unit. Ask again to pick it up.'
  }
}

function safeStore() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // Private windows and blocked site data both throw on access, not on use.
    return null
  }
}
