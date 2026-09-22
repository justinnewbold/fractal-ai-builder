import amp from '../../assets/icons/amp.png'
import cab from '../../assets/icons/cab.png'
import comp from '../../assets/icons/comp.png'
import delay from '../../assets/icons/delay.png'
import drive from '../../assets/icons/drive.png'
import flanger from '../../assets/icons/flanger.png'
import phaser from '../../assets/icons/phaser.png'
import reverb from '../../assets/icons/reverb.png'
import wah from '../../assets/icons/wah.png'

/**
 * The picture on a block's tile.
 *
 * These are cut out of Justin's own mockup of the play screen — the nine he
 * drew there, at the sizes he drew them. They are stored as white silhouettes
 * and tinted at the tile, so a drive's flame comes out the drive's red and a
 * delay's dots the delay's blue without a second copy of either picture.
 *
 * Nothing is invented. A family he did not draw gets no icon and the tile
 * falls back to its three letters, which is what the whole grid was before.
 * Keys match blockColors' slugs so the two maps can be read side by side.
 */
const ICONS = {
  amp,
  cab,
  comp,
  compressor: comp,
  delay,
  drive,
  flanger,
  phaser,
  reverb,
  wah
}

/** The icon for a block, by its slug, or null where there isn't one. */
export function blockIcon(slug) {
  if (!slug) return null
  const key = String(slug).toLowerCase()
  if (ICONS[key]) return ICONS[key]
  // Slugs sometimes carry an instance suffix — delay2, drive1.
  const bare = key.replace(/\d+$/, '')
  if (ICONS[bare]) return ICONS[bare]
  // Display names arrive with spaces, hyphens and slashes.
  return ICONS[bare.replace(/[^a-z]/g, '')] || null
}
