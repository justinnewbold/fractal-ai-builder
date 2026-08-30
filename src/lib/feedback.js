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
export function beatFlash(el) {
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
  try {
    navigator.vibrate?.(15)
  } catch {
    // Blocked or unsupported — the flash carries it alone.
  }
}
