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
export const color = {
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
  signalWash: 'rgba(240, 167, 60, 0.12)',
  liveHalo: 'rgba(95, 191, 209, 0.2)',
  faultHalo: 'rgba(224, 104, 79, 0.2)'
}

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
