/**
 * The colours Fractal paints its blocks, so this app's blocks match the unit.
 *
 * The point is recognition on a dark stage: on the AM4's own screen the drive
 * is red and the delay is blue, and a screen pretending to be that hardware
 * should agree with it.
 *
 * Two grades of confidence live here, deliberately. drive, amp, delay and
 * reverb are read straight off an AM4's display. Everything else carries the
 * hue this app has always used for that family — continuity for families the
 * photo doesn't show — and is meant to be tuned by holding the app next to the
 * unit, not defended.
 *
 * Keys are the slugs ForgeFX reports. Unknown families get the neutral the app
 * used everywhere before colours existed.
 */
const VERIFIED = {
  drive: { fill: '#c23b26', ink: '#ffffff' },
  amp: { fill: '#b9bec6', ink: '#15181d' },
  delay: { fill: '#2857c9', ink: '#ffffff' },
  reverb: { fill: '#5a3fc0', ink: '#ffffff' }
}

const APPROXIMATE = {
  wah: { fill: '#3f63c8', ink: '#ffffff' },
  filter: { fill: '#3f63c8', ink: '#ffffff' },
  cab: { fill: '#3f8f5c', ink: '#ffffff' },
  comp: { fill: '#2f8f8f', ink: '#ffffff' },
  compressor: { fill: '#2f8f8f', ink: '#ffffff' },
  geq: { fill: '#c07a2a', ink: '#ffffff' },
  peq: { fill: '#c07a2a', ink: '#ffffff' },
  eq: { fill: '#c07a2a', ink: '#ffffff' },
  chorus: { fill: '#4a5fb8', ink: '#ffffff' },
  flanger: { fill: '#4a5fb8', ink: '#ffffff' },
  phaser: { fill: '#5a4fb8', ink: '#ffffff' },
  tremolo: { fill: '#8a5fb0', ink: '#ffffff' },
  rotary: { fill: '#8a5fb0', ink: '#ffffff' },
  pitch: { fill: '#a04f8a', ink: '#ffffff' },
  synth: { fill: '#a04f8a', ink: '#ffffff' },
  multitap: { fill: '#2a7f9c', ink: '#ffffff' },
  megatap: { fill: '#2a7f9c', ink: '#ffffff' },
  plex: { fill: '#2a7f9c', ink: '#ffffff' },
  gate: { fill: '#6f7480', ink: '#ffffff' },
  ingate: { fill: '#6f7480', ink: '#ffffff' },
  volume: { fill: '#6f7480', ink: '#ffffff' },
  volpan: { fill: '#6f7480', ink: '#ffffff' },
  mixer: { fill: '#6f7480', ink: '#ffffff' },
  looper: { fill: '#6f7480', ink: '#ffffff' },
  enhancer: { fill: '#4a8f7a', ink: '#ffffff' },
  input: { fill: '#555b66', ink: '#ffffff' },
  output: { fill: '#555b66', ink: '#ffffff' }
}

const FAMILIES = { ...APPROXIMATE, ...VERIFIED }

const NEUTRAL = { fill: 'var(--panel-hi)', ink: 'var(--silk)' }

/** The colour for a block, by its slug. Unknown families stay neutral. */
export function blockColor(slug) {
  if (!slug) return NEUTRAL
  const key = String(slug).toLowerCase()
  if (FAMILIES[key]) return FAMILIES[key]
  // Slugs sometimes carry an instance suffix — delay2, drive1.
  const bare = key.replace(/\d+$/, '')
  return FAMILIES[bare] || NEUTRAL
}
