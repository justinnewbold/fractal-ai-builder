/**
 * Which build is running.
 *
 * Version is MAJOR.PHASE.PATCH: major is the architecture (2 = the ForgeFX
 * rewrite; 1 was the Electron and Computer Use app), phase tracks the roadmap
 * in the README, patch is everything since.
 *
 * The commit matters as much as the version — a stale deployment has been
 * mistaken for a code bug more than once, and "2.3.0" alone can't tell you
 * whether the fix you're looking for is in the bundle you're running.
 */
export const VERSION = __APP_VERSION__
export const COMMIT = __COMMIT__
export const BUILT_AT = __BUILT_AT__

export const FULL = `v${VERSION} · ${COMMIT}`
