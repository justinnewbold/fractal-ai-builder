/**
 * The unit itself: anodized black chassis, warm silkscreen lettering, and the
 * two lights the hardware actually shows you — amber for signal, cyan for
 * connection.
 *
 * The same palette as the web app's `:root`, and for the same reason: nothing
 * is coloured for decoration. Colour here means something is on.
 *
 * Sizes are the stage's, not the desk's. Everything you press is at least 56pt
 * because it is pressed in the dark, at arm's length, sometimes mid-song, and
 * Apple's 44pt floor is a minimum for a phone held six inches from your face.
 */
const DARK = {
  chassis: '#0d0f12',
  panel: '#15181d',
  panelHi: '#1c2027',
  rule: '#262b33',
  silk: '#e6e3dc',
  silkDim: '#878d97',
  silkFaint: '#7a8189',

  /* semantic, not decorative */
  signal: '#f0a73c', // the audio path, and only that
  live: '#5fbfd1', // the Mac is answering
  fault: '#e0684f',
  ok: '#63c68c',

  onSignal: '#14161a', // ink on an amber ground
  /* Ink on the red of a destructive ground. White in BOTH themes, unlike
     onSignal: amber is light and takes dark ink, and both of these reds
     are dark enough to need the opposite. */
  onFault: '#fff6f3',
  signalWash: 'rgba(240, 167, 60, 0.12)',
  liveHalo: 'rgba(95, 191, 209, 0.2)',
  faultHalo: 'rgba(224, 104, 79, 0.2)',
  okHalo: 'rgba(99, 198, 140, 0.2)'
}

/**
 * The same rig under stage lighting that is actually on.
 *
 * "I'm not seeing where the light/dark/auto theme buttons are anymore. Please
 * put that back on Setup." The browser has had all three for a long time; the
 * phone never had any of them and was dark whatever the handset was set to,
 * which is wrong in a lit room and wrong on a phone in light mode.
 *
 * NOT AN INVERSION. The four semantic colours are darkened rather than
 * swapped, because their whole job is to mean something at a glance — amber
 * is the audio path, cyan is the computer answering, red is a fault, green is
 * good — and amber at #f0a73c on white is a colour you cannot read. Same
 * meanings, enough contrast to carry them.
 */
const LIGHT = {
  chassis: '#f4f2ee',
  panel: '#ffffff',
  panelHi: '#e9e6e0',
  rule: '#d5d1c9',
  silk: '#1b1e23',
  silkDim: '#5b626c',
  silkFaint: '#767d87',

  signal: '#a8650a',
  live: '#1d6b7a',
  fault: '#b23c26',
  ok: '#2c7a4b',

  onSignal: '#fffaf2',
  onFault: '#fff6f3',
  signalWash: 'rgba(168, 101, 10, 0.12)',
  liveHalo: 'rgba(29, 107, 122, 0.18)',
  faultHalo: 'rgba(178, 60, 38, 0.18)',
  okHalo: 'rgba(44, 122, 75, 0.18)'
}

/**
 * The palette every screen reads, MUTATED IN PLACE when the mode changes.
 *
 * This is the whole trick, and it is worth saying why rather than leaving
 * somebody to find it. There are 252 reads of `color.something` across 25
 * files, every one of them inline in a render — this app has no
 * StyleSheet.create anywhere, which is usually a small inefficiency and here
 * is the thing that makes a theme possible at all. Inline styles are read
 * fresh on every render, so swapping the VALUES on this object and then
 * re-rendering repaints the app without a single call site changing.
 *
 * The alternative was a context and a hook, and 252 edits across 25 files on
 * the evening before a build. The object is exported frozen-shaped and never
 * replaced: `import { color }` anywhere still points at this one.
 */
export const color = { ...DARK }

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 }

export const font = {
  micro: 11,
  small: 13,
  body: 15,
  lead: 18,
  title: 24,
  hero: 34,
  /** The preset name, read from a stand. */
  display: 40
}

/** Nothing pressable is smaller than this. */
export const TAP = 56

/**
 * A monospace face that exists on both platforms.
 *
 * Slot numbers, BPM and cents are all things you compare at a glance, and
 * proportional digits move under you while they change.
 */
export const mono = { ios: 'Menlo', android: 'monospace', default: 'monospace' }


/* ------------------------------------------------------------------ */
/* Light, dark, or whatever the phone is set to                        */
/* ------------------------------------------------------------------ */

/** The three, in the order the buttons show them. */
export const MODES = ['auto', 'light', 'dark']

const KEY = 'fractal.theme'

let mode = 'auto'
let systemDark = true
const watchers = new Set()

/** Which of the three is chosen. Not which one is being shown — see `isDark`. */
export const getMode = () => mode

/** Whether the dark palette is the one on screen right now. */
export const isDark = () => (mode === 'auto' ? systemDark : mode === 'dark')

/**
 * Put the right palette into `color`, and tell anybody watching.
 *
 * Every key is written every time rather than only the ones that differ: a
 * palette that gained a colour in one theme and not the other would otherwise
 * leave the old theme's value behind on it, and that bug shows up as one
 * wrong-coloured thing on one screen in one mode.
 */
function paint() {
  const next = isDark() ? DARK : LIGHT
  for (const key of Object.keys(next)) color[key] = next[key]
  for (const tell of watchers) tell()
}

/** Choose one. Remembered on this phone. */
export function setMode(next, storage) {
  mode = MODES.includes(next) ? next : 'auto'
  try {
    storage?.setItem(KEY, mode)
  } catch {
    /* Costs the next launch, not this press. */
  }
  paint()
}

/** What was chosen last time. Anything unreadable is Auto. */
export function loadMode(storage) {
  try {
    const saved = storage?.getItem(KEY)
    mode = MODES.includes(saved) ? saved : 'auto'
  } catch {
    mode = 'auto'
  }
  paint()
  return mode
}

/**
 * What the handset itself is set to, which Auto follows.
 *
 * Passed in rather than read here so this file stays free of react-native
 * imports — it is loaded by the test suite under plain Node, where
 * `Appearance` does not exist.
 */
export function setSystemDark(dark) {
  systemDark = dark !== false
  paint()
}

/** Re-render on a change. Returns the unsubscribe, for useSyncExternalStore. */
export function watchTheme(tell) {
  watchers.add(tell)
  return () => watchers.delete(tell)
}

/** A version that changes whenever the palette does, for a store subscription. */
let painted = 0
watchers.add(() => {
  painted += 1
})
export const themeVersion = () => painted
