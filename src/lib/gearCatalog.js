/**
 * The whole lineage catalog, as something you can read rather than something
 * the app quotes at you one model at a time.
 *
 * "Add an info page like this to settings listing the real life equivalents of
 * each amp and effects pedals."
 *
 * lib/lineage.js already answers "what is this one model really" — the line
 * under the model picker, the amp named in a scene plan. What it could not do
 * is answer "what have I got", because every route into it needs a model name
 * you already know. This turns the same data the other way round: every model
 * the catalog holds, grouped the way the unit groups them, for somebody who has
 * just bought an FM3 and is looking at a menu full of names that are nearly the
 * amps they mean.
 *
 * Nothing new is written down here. Every line comes back through lineageFor(),
 * so the sheet and the model picker cannot disagree — and the rule that keeps
 * lineage.js honest (nothing invented, silence over a plausible guess) is the
 * rule this inherits.
 *
 * Cabinets are the visible absence, and deliberately so. All 45 of them have a
 * blank lineage in the data, so a Cabs tab would be 45 rows of nothing; the
 * catalog says which families it covers rather than offering an empty one.
 */
import ampTypes from '../data/amp-types.json' with { type: 'json' }
import driveTypes from '../data/drive-types.json' with { type: 'json' }
import effectFamilies from '../data/effect-lineage.json' with { type: 'json' }
import { lineageFor } from './lineage.js'

/**
 * Plain alphabetical, the way a dictionary is.
 *
 * Not numeric collation: that reads the leading digits of "5F1 Tweed" as 5 and
 * of "59 Bassguy" as 59, and files every 5F, 5E and 5C amp ahead of the
 * Bassman — which is not where anybody goes looking for it.
 */
const byName = (a, b) => a.name.localeCompare(b.name)

/**
 * A model list from the per-model catalogs, resolved through lineage.
 *
 * Names are de-duplicated: the same amp appears under more than one `value` on
 * some units, and a reference sheet that lists "Brit 800 2204 High" twice looks
 * like a bug in the sheet rather than a fact about the unit.
 */
function fromCatalog(slug, list) {
  const seen = new Set()
  const out = []
  for (const model of list) {
    const name = model?.name?.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const found = lineageFor(slug, name)
    out.push({ name, gear: found?.basedOn || found?.manufacturer || null })
  }
  return out.sort(byName)
}

/** The family lists, which are the only catalog those blocks have. */
function fromFamilies(slug) {
  return (effectFamilies[slug] || [])
    .filter((e) => e?.family && (e.basedOn || e.manufacturer))
    .map((e) => ({ name: e.family, gear: e.basedOn || e.manufacturer }))
    .sort(byName)
}

/**
 * What the sheet offers, in the order it offers it.
 *
 * Amps and drives first because they are the two anybody came here for and the
 * two with a per-model catalog; the three family lists after, small but real.
 */
export const GEAR_GROUPS = [
  { key: 'amp', label: 'Amps', entries: fromCatalog('amp', ampTypes) },
  { key: 'drive', label: 'Drives', entries: fromCatalog('drive', driveTypes) },
  { key: 'wah', label: 'Wahs', entries: fromFamilies('wah') },
  { key: 'comp', label: 'Compressors', entries: fromFamilies('comp') },
  { key: 'delay', label: 'Delays', entries: fromFamilies('delay') }
].filter((g) => g.entries.length)

/**
 * Search both sides of the arrow.
 *
 * Somebody looking for their Tube Screamer types "tube screamer", which is the
 * REAL name and appears nowhere in the unit's own word for it ("TS808 OD"). A
 * search that only read the left-hand column would answer nothing for every
 * query a person actually has, which is the whole reason this sheet exists.
 */
export function searchGear(entries, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return entries
  const words = q.split(/\s+/)
  return entries.filter((e) => {
    const hay = `${e.name} ${e.gear || ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/**
 * Every group searched at once, with its hits.
 *
 * The counts on the tabs have to move with the search or they mislead: typing
 * "tube screamer" while Amps is open finds nothing, and a row of tabs still
 * reading "Amps 331 · Drives 86" gives no hint that the five answers are one
 * tap away. Searching all five costs a pass over 430 strings, which is nothing.
 */
export function searchAll(query) {
  return GEAR_GROUPS.map((g) => ({ ...g, hits: searchGear(g.entries, query) }))
}

/** How many models the sheet can name the real gear for, for the note at the top. */
export const GEAR_TOTAL = GEAR_GROUPS.reduce((n, g) => n + g.entries.filter((e) => e.gear).length, 0)
