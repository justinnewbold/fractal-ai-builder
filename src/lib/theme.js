/**
 * Light, dark, or follow the system.
 *
 * Auto is the default and is genuinely useful here rather than a checkbox for
 * its own sake: this gets used at a desk in daylight and on a dark stage, and
 * the phone already knows which.
 */
const KEY = 'fab.theme'
const MODES = ['auto', 'light', 'dark']

export function getMode() {
  const stored = localStorage.getItem(KEY)
  return MODES.includes(stored) ? stored : 'auto'
}

export function resolve(mode) {
  if (mode === 'light' || mode === 'dark') return mode
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function apply(mode) {
  const theme = resolve(mode)
  document.documentElement.dataset.theme = theme

  // The browser chrome should match, or a light page sits under a black status
  // bar and the phone looks broken.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f2efe9' : '#0d0f12')
  return theme
}

export function setMode(mode) {
  if (mode === 'auto') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, mode)
  return apply(mode)
}

/** Follow the system while on auto, so it changes at sunset without a reload. */
export function watchSystem(onChange) {
  const query = window.matchMedia?.('(prefers-color-scheme: light)')
  if (!query) return () => {}
  const handler = () => getMode() === 'auto' && onChange(apply('auto'))
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}

export { MODES }
