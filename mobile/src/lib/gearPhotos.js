/* Generated from src/lib/gearPhotos.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * A photograph of the real amp, and the credit that has to travel with it.
 *
 * "All the amp/cabs/drive photos have been uploaded to GitHub so you can get
 * those wired up."
 *
 * WHY THE CREDIT IS NOT OPTIONAL AND NOT SEPARABLE. Every photograph here is
 * Creative Commons, and both CC BY and CC BY-SA require the photographer be
 * named wherever the picture is shown. So `photoFor` never answers with a
 * picture alone — the holder, the licence and the link to it come back in the
 * same object, and a caller that draws the image has the credit already in its
 * hand. There is no shape of this function that returns a URL by itself,
 * deliberately: that is the shape somebody renders without the attribution.
 *
 * MATCHED BY FAMILY, THE SAME WAY LINEAGE IS. One photograph of a Super Lead
 * serves "1959SLP Normal", "1959SLP Treble" and "1959SLP Jumped", because they
 * are one amplifier described three ways. The rule is a prefix on the slug and
 * it is deliberately strict about the boundary: `texas-star` matches
 * `texas-star-clean` and `texas-star-lead`, and does not match `texas-starlet`
 * if somebody ever adds one. Matching loosely here would put a photograph of
 * the wrong amp under a model name, which is the exact failure that threw away
 * the first batch of two hundred.
 *
 * A model with no photograph answers null, and the screen shows nothing rather
 * than a placeholder. The catalog is about a quarter covered; three quarters of
 * the time the honest answer is silence.
 */
import photos from '../data/gear-photos.json' with { type: 'json' }

/**
 * Where the files are served from.
 *
 * `public/` is copied to the site root, so a page served by the app — the
 * hosted site, or the computer with the cable — finds them one level down
 * from wherever it is. A relative path is right for both of those and wrong
 * for exactly one caller: the PHONE app, which is not a web page and has no
 * site root to be relative to.
 *
 * Bundling the files into the phone was the other option and is the wrong
 * one: 55 photographs is already 7MB and a full roster would be four times
 * that, downloaded again by every phone on every over-the-air update, to show
 * pictures somebody looks at twice. So the phone passes the hosted origin and
 * the images come over the network. With no internet it shows the words and
 * no picture, which is what it does for three quarters of the roster anyway.
 */
export const GEAR_BASE = '/gear'

/** The same spelling rule the photo files were named with. */
export function photoSlug(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/*
 * Longest slug first, so a specific photograph beats a general one.
 *
 * `princetone-reverb` and a future `princetone` would both match a Princetone
 * Reverb, and the Reverb is a different amplifier from the amp the shorter one
 * would show. Sorting once here means every lookup takes the better answer
 * without each caller having to know that.
 */
const SLUGS = Object.keys(photos).sort((a, b) => b.length - a.length)

/**
 * The photograph for a model name, with everything needed to show it legally.
 *
 * Returns null when there is none, which is most of the roster.
 */
export function photoFor(name, base = GEAR_BASE) {
  const slug = photoSlug(name)
  if (!slug) return null
  const hit = SLUGS.find((s) => slug === s || slug.startsWith(`${s}-`))
  if (!hit) return null
  const p = photos[hit]
  return {
    src: `${base}/${p.file}`,
    /* What to print under the picture. One string, because every caller wants
       the same sentence and three of them would word it three ways. */
    credit: `${p.holder} · ${p.licence}`,
    holder: p.holder,
    licence: p.licence,
    rights: p.rights,
    alt: `${name}, the amplifier it is modelled on`
  }
}

/** How much of a roster has one, for a screen that wants to say so. */
export const photoCount = Object.keys(photos).length
