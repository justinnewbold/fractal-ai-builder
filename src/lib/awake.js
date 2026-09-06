/**
 * Keep the screen on while the app is talking to the unit.
 *
 * "Disconnected from phone remote when sending presets to FM3."
 *
 * Sending a preset is three hundred round trips down one serial port, and it
 * takes minutes. For all of those minutes the phone is doing nothing a phone
 * recognises as activity — no taps, no scrolling, just a progress line
 * changing — so iOS dims it and then locks it on the ordinary auto-lock timer.
 * A locked iPhone suspends the page, the websocket behind the relay closes,
 * and the send stops somewhere in the middle of a preset. Everything else in
 * this change makes that survivable; this is the part that stops it happening.
 *
 * Screen Wake Lock is the browser API for exactly this. Safari has had it
 * since iOS 16.4 and it is the same call on Android. Where it is missing, or
 * refused, the answer is to carry on without it — the relay's own patience
 * covers the lock that happens anyway.
 */

/*
 * A lock is dropped by the system whenever the page is hidden, and it is NOT
 * given back when the page returns. So it has to be re-taken on the way back,
 * or one glance at a notification silently ends the protection for the rest of
 * a send — which is the same failure again, arriving quietly.
 */
export function keepAwake({ nav = typeof navigator !== 'undefined' ? navigator : null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  const request = nav?.wakeLock?.request
  if (typeof request !== 'function') return () => {}

  let sentinel = null
  let done = false

  const take = async () => {
    if (done || sentinel) return
    try {
      sentinel = await nav.wakeLock.request('screen')
      // Released by the system, not by us: forget it so the next return to
      // the page takes a fresh one rather than believing it still holds this.
      sentinel.addEventListener?.('release', () => {
        sentinel = null
      })
    } catch {
      // Low battery, an unsupported context, a user setting. The send goes on.
      sentinel = null
    }
  }

  const onVisible = () => {
    if (!doc?.hidden) take()
  }

  take()
  doc?.addEventListener?.('visibilitychange', onVisible)

  return () => {
    done = true
    doc?.removeEventListener?.('visibilitychange', onVisible)
    const held = sentinel
    sentinel = null
    held?.release?.().catch?.(() => {})
  }
}
