/**
 * One history ledger for everything that pushes an entry.
 *
 * There is no router here. A sheet pushes an entry when it opens so the back
 * gesture closes it, and takes the entry with it when closed by a button. The
 * screens push an entry when they change so Back moves between them instead
 * of leaving the app. Two writers on one stack need one set of books, or a
 * sheet's own teardown pop is taken for a back gesture by whoever hears it —
 * which is exactly how the introduction once closed itself a third of a
 * second after opening.
 *
 * The books: `listening` counts sheets with a popstate listener up (the
 * screens do not count — they read the entry's state and never swallow pops),
 * and `selfPops` is how many pops a closing sheet has caused that a listening
 * sheet should ignore. A pop is owed only if a sheet is there to be owed it:
 * an unconditional debt sat waiting to eat someone's real Back.
 */
let selfPops = 0
let listening = 0

const win = () => (typeof window !== 'undefined' ? window : globalThis.window)

/** Push an entry. Returns whether the history took it. */
export function pushEntry(state) {
  try {
    win().history.pushState(state, '')
    return true
  } catch {
    return false
  }
}

/** Rewrite the current entry — the one the app opened on. */
export function replaceEntry(state) {
  try {
    win().history.replaceState(state, '')
  } catch {
    // A history the page isn't allowed to touch is not worth failing over.
  }
}

/** A sheet starts listening for the back gesture. Returns the way to stop. */
export function listen(handler) {
  const w = win()
  w.addEventListener('popstate', handler)
  listening++
  return () => {
    w.removeEventListener('popstate', handler)
    listening--
  }
}

/** On a pop: was it a closing sheet's own teardown rather than a gesture? */
export function swallowedPop() {
  if (selfPops > 0) {
    selfPops--
    return true
  }
  return false
}

/**
 * A closed sheet takes its entry with it — one task later, and that is the
 * whole trick. React flushes every cleanup before any setup, so at the instant
 * a sheet hands over to another, asking "is anyone still listening?" always
 * answers no. One task later it answers correctly.
 */
export function popSelf(defer = (fn) => setTimeout(fn, 0)) {
  defer(() => {
    try {
      if (listening > 0) selfPops++
      win().history.back()
    } catch {
      if (listening > 0) selfPops--
    }
  })
}

/** Tests only. */
export const _resetNav = () => {
  selfPops = 0
  listening = 0
}
export const _ledger = () => ({ selfPops, listening })
