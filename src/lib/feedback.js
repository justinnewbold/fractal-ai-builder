/**
 * A beat you can see, and where the hardware allows it, feel.
 *
 * Tap tempo is played, not clicked: eyes on the band, thumb on the button.
 * Without feedback per tap there is no way to tell a registered tap from a
 * missed one until the number changes half a second later, which is exactly
 * too late to fix your timing. Each call flashes the element to the signal
 * colour for one blink and asks the OS for a short tick of vibration.
 *
 * The vibration is best-effort by nature: Android browsers honour
 * navigator.vibrate, iOS Safari exposes no vibration API to web pages at all
 * — no permission to ask for, no fallback to reach for — so on an iPhone the
 * flash IS the feedback.
 */
/**
 * Whether motion is wanted at all.
 *
 * Read per call rather than once at load: the setting can change under a
 * running app, and this is cheap. The CSS honours the preference in eleven
 * places; this was the one path that flashed and buzzed regardless.
 */
export const wantsStillness = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Bring something into view, at the speed the reader asked for.
 *
 * A smooth scroll is motion like any other, and these fire on their own — after
 * a generation lands, after the assistant changes a block. Under a reduced-motion
 * setting they jump instead, which still puts the thing on screen.
 */
export function bringIntoView(el, options = {}) {
  if (!el) return
  try {
    el.scrollIntoView({ ...options, behavior: wantsStillness() ? 'auto' : 'smooth' })
  } catch {
    // An engine without smooth scrolling still scrolled.
  }
}

export function beatFlash(el) {
  // The flash is motion; the buzz isn't. Someone who has asked for stillness on
  // screen has not asked to stop feeling the beat under their thumb.
  if (!wantsStillness()) {
    try {
      el?.animate?.(
        [
          {
            background: 'var(--signal)',
            borderColor: 'var(--signal)',
            color: 'var(--on-signal)'
          },
          {
            background: 'var(--signal)',
            borderColor: 'var(--signal)',
            color: 'var(--on-signal)',
            offset: 0.4
          },
          {}
        ],
        { duration: 200, easing: 'ease-out' }
      )
    } catch {
      // An engine without the Web Animations API just skips the flash.
    }
  }
  try {
    navigator.vibrate?.(15)
  } catch {
    // Blocked or unsupported — the flash carries it alone.
  }
}
