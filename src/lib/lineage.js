/**
 * What a model is in real life.
 *
 * Fractal cannot print "Marshall JCM800" on a menu, so the unit calls it "Brit
 * 800 2204 High". Everybody who plays one knows the translation; nobody who has
 * just bought one does. "Add the real life names for the amps and the effects
 * pedals and things like that so that people can see what they actually relate
 * to."
 *
 * The app has carried this since the beginning and has never once shown it on a
 * real unit. `src/data/amp-types.json` and `drive-types.json` hold a maker and a
 * lineage for each model, but they were only ever read by the demo — the roster
 * the app draws from comes off the device, and the device does not carry any of
 * it. ForgeFX's AM4 driver says so outright: "manufacturer/basedOn are
 * gen-3-only catalog fields the AM4 tables don't carry, hence null", and even on
 * an FM3 the ordinary read path returns nulls. So the line under the model
 * picker existed, worked in the demo, and was blank on every unit anyone owns.
 *
 * Hence a catalog on this side, joined to whatever the unit reports by the one
 * thing both ends agree on: the model's name.
 *
 * ## What is not here
 *
 * Nothing invented. A wrong attribution in a guitar app is worse than a blank
 * one — the person reading it knows the gear better than the app does — so
 * every string below comes from the data files, and the only thing computed is
 * described under "voicings" and is deliberately timid about it.
 *
 * Cabinets have no lineage recorded at all, and the other families (delay,
 * reverb, chorus) have no catalog on this side yet. They say nothing rather
 * than something plausible.
 */
import ampTypes from '../data/amp-types.json' with { type: 'json' }
import driveTypes from '../data/drive-types.json' with { type: 'json' }
import ampFamilies from '../data/amp-lineage.json' with { type: 'json' }
import effectFamilies from '../data/effect-lineage.json' with { type: 'json' }

/** The families we have a catalog for. A slug not in here has no lineage. */
const CATALOGS = { amp: ampTypes, drive: driveTypes }

/**
 * The amp behind a whole run of models, rather than one model at a time.
 *
 * The per-model catalog left two thirds of the roster saying only "Mesa/Boogie"
 * — true, and not the thing anyone wanted to know from "Recto2 Orange Vintage".
 * The names are built the same way throughout: a family, then the channel and
 * the mode. "Recto2" is the Dual Rectifier; "Orange Vintage" is which of its
 * channels, in which mode. So the family is the part worth translating, and one
 * line covers every model built on it.
 *
 * The docstring above warns against exactly this and it was right to: the
 * version that took the longest name prefix shared with a SIBLING read "USA MK
 * IV Lead" as a Mark IIC+, because they share "USA MK". What makes this safe is
 * that the families are written down rather than derived — "USA MK IV" and "USA
 * MK IIC+" are two entries, the longest one wins, and no amount of shared
 * spelling can make one inherit the other's amp.
 *
 * Every line comes from Yek's Guide to the Fractal Audio Amplifier Models or
 * from Fractal's own Blocks Guide, except a handful the guides predate — those
 * were each confirmed against Fractal's forum before being written down. A
 * family nobody could source is not in here, and the models under it fall back
 * to their maker or to silence, which is what they did before.
 */
const FAMILIES = { amp: ampFamilies, ...effectFamilies }

/**
 * Words that name a voicing of an amp rather than a different amp.
 *
 * These are the difference between the bright and the normal input, the deep
 * switch in and out, the two jacks jumpered together — one amp, described two
 * ways. Which is why a model whose name is another model's name plus nothing
 * but these can safely inherit that model's lineage: "USA MK IIC+ Bright" is a
 * Mark IIC+.
 *
 * The rule is deliberately narrow, and the reason is worth keeping. The obvious
 * version — take the longest name prefix that some sibling shares — resolves
 * three times as many models and gets them wrong: it reads "USA MK IV Lead" as
 * a Mark IIC+ because they share "USA MK", and "Mr Z Highway 66" as a Dr. Z Maz
 * 38 because they share "Mr Z". Both are stated with total confidence and both
 * are false. Requiring an exact match on the rest of the name is what makes the
 * difference between describing a voicing and guessing at a model.
 */
const VOICINGS = new Set([
  'bright',
  'normal',
  'treble',
  'jumped',
  'vibrato',
  'deep',
  'fat',
  'hot',
  'mid',
  'low',
  'high',
  'brilliant',
  'shift',
  'bass',
  'boost',
  'custom',
  'ef86',
  '12ax7'
])

/** Model names are compared without case: the cab roster shouts, the amps don't. */
const key = (name) => String(name || '').trim().toLowerCase()

/**
 * One index per family, built once.
 *
 * Two passes, because the voicing rule reads the first pass's answers: an amp
 * can only inherit from a model that is itself in the data with a lineage of
 * its own, never from another inheritor.
 */
const indexes = new Map()

function indexFor(slug) {
  if (indexes.has(slug)) return indexes.get(slug)
  const catalog = CATALOGS[slug]
  const index = new Map()
  if (!catalog) {
    indexes.set(slug, index)
    return index
  }

  for (const model of catalog) {
    if (!model?.name) continue
    index.set(key(model.name), {
      manufacturer: model.manufacturer || null,
      basedOn: model.basedOn || null
    })
  }

  // Second pass: a voicing of a model we know is that model.
  for (const model of catalog) {
    if (!model?.name || model.basedOn) continue
    const words = model.name.split(/\s+/)
    for (let cut = words.length - 1; cut >= 1; cut--) {
      const tail = words.slice(cut).map((w) => w.toLowerCase())
      // Stop at the first word that names a different amp rather than a voicing
      // of this one — anything further left would be guessing.
      if (!tail.every((w) => VOICINGS.has(w))) break
      const base = index.get(key(words.slice(0, cut).join(' ')))
      if (base?.basedOn) {
        index.set(key(model.name), {
          manufacturer: base.manufacturer || model.manufacturer || null,
          basedOn: base.basedOn
        })
        break
      }
    }
  }

  indexes.set(slug, index)
  return index
}

/**
 * The maker and the lineage for one model, or null when we do not know.
 *
 * Null is a real answer and the common one outside amps and drives. Everything
 * that reads this has to render nothing for it rather than a gap where a fact
 * should be.
 */
export function lineageFor(slug, name) {
  const found = indexFor(slug).get(key(name))
  // A model named outright, with the specific amp behind it, is the best answer
  // there is. Only a maker and no amp is worse than what the family knows.
  if (found?.basedOn) return found
  const family = familyFor(slug, name)
  if (family) {
    return {
      manufacturer: found?.manufacturer || family.manufacturer || null,
      basedOn: family.basedOn
    }
  }
  if (!found || (!found.manufacturer && !found.basedOn)) return null
  return found
}

/**
 * The longest family whose name begins this model's name, or null.
 *
 * On whole words only: without that, "Recto1" would claim "Recto10" if such a
 * thing were ever added, and a family named "SV" would claim "SV Bass" and
 * "SVT" alike. Longest first, so "USA MK IIC++" is never answered by "USA MK
 * IIC+" and "Plexi Studio 20" is never answered by "Plexi".
 */
export function familyFor(slug, name) {
  const model = key(name)
  if (!model) return null
  let best = null
  for (const entry of FAMILIES[slug] || []) {
    const family = key(entry.family)
    if (!family || !entry.basedOn) continue
    if (model !== family && !model.startsWith(family + ' ')) continue
    if (!best || family.length > key(best.family).length) best = entry
  }
  return best
}

/**
 * The one line to put on screen, in a player's words.
 *
 * The lineage when there is one, and the maker on its own when there is not —
 * "Mesa/Boogie" is most of what somebody wanted to know from "USA MK IV Lead",
 * and it is true, which the specific model would not be.
 */
export function gearLine(slug, name) {
  const found = lineageFor(slug, name)
  if (!found) return null
  return found.basedOn || found.manufacturer
}

/**
 * Put the catalog onto a roster read off the unit.
 *
 * Anything the device supplied wins: an FM3 reading from its own device cache
 * does carry lineage, and the unit is the better authority on its own models.
 * This only fills in the nulls, which on an AM4 is all of them.
 */
export function withLineage(slug, models) {
  // Guarded on either source: wah and comp have families and no per-model
  // catalog, and guarding on the catalog alone would have skipped them whole.
  if (!Array.isArray(models) || (!CATALOGS[slug] && !FAMILIES[slug])) return models
  return models.map((model) => {
    if (model?.basedOn) return model
    const found = lineageFor(slug, model?.name)
    if (!found) return model
    return {
      ...model,
      manufacturer: model?.manufacturer || found.manufacturer,
      basedOn: found.basedOn
    }
  })
}
