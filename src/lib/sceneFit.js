/**
 * A tone made on one unit, landing on a unit with fewer scenes.
 *
 * "I am currently on the AM4, which only allows four scenes per preset. But
 * most of these presets were created on the FM3."
 *
 * Everything in the library is a spec, and a spec's scenes carry the index
 * they were written for — 0 to 7 on an FM3, because an FM3 has eight. Loaded
 * against an AM4 the validator read scenes 5 to 8 as out of range, dropped
 * them, and wrote a line about each into the "Rejected during checking" panel.
 * Nothing was broken and nothing was lost — but the half of the tone that
 * survived was the first half, chosen by nothing except numbering, and the
 * panel that said so is the most technical thing on the screen.
 *
 * Which four is a decision only the player can make: on a preset laid out
 * clean, verse, chorus, lead, solo, harmony, ambient, outro, the four that
 * matter are not the first four. So the app asks, once, before it loads —
 * and then renumbers what was picked into the scenes the unit does have,
 * because scene 7 kept as scene 7 is scene 7 nowhere on an AM4.
 *
 * The same arithmetic covers every pairing, in both directions: an Axe-Fx III
 * tone on a VP4, an AM4 tone on an FM9 (which always fits and is never asked
 * about). Nothing here names a unit. The count comes off the device.
 */

/** The unit's scene count, as a number that can be counted to. */
const ceiling = (sceneCount) => Math.max(1, Math.floor(Number(sceneCount) || 8))

/**
 * The scenes a saved tone holds, in the order they are numbered.
 *
 * Order matters because it is the order the picker offers them in, and a spec
 * is under no obligation to list scene 3 before scene 6.
 */
export function sceneRows(spec) {
  const list = Array.isArray(spec?.scenes) ? spec.scenes : []
  return list
    .map((scene) => ({ index: Number(scene?.index), name: String(scene?.name || '').trim(), scene }))
    .filter((row) => Number.isInteger(row.index) && row.index >= 0)
    .sort((a, b) => a.index - b.index)
}

/** What to call a scene on screen — its own name, or the number it was. */
export const sceneLabel = (row) => row.name || `Scene ${row.index + 1}`

/**
 * How many of this tone's scenes this unit has no room for.
 *
 * Zero is the answer for every tone made on the unit it is being loaded onto,
 * and for every tone with no scenes at all, which is most of them. Only a
 * non-zero answer is worth stopping a load for.
 */
export function scenesOverflowing(spec, sceneCount) {
  const top = ceiling(sceneCount)
  return sceneRows(spec).filter((row) => row.index >= top).length
}

/**
 * The picker's opening answer: the first however-many it will hold.
 *
 * Not a recommendation — a starting point that is already correct for the
 * common case of a tone whose scenes run 1, 2, 3, 4 and then stop mattering.
 */
export function defaultKeep(spec, sceneCount) {
  return sceneRows(spec)
    .slice(0, ceiling(sceneCount))
    .map((row) => row.index)
}

/**
 * The tone, with only the chosen scenes in it, renumbered to fit.
 *
 * The renumbering is the part that makes this a load rather than a refusal.
 * Pick scenes 1, 4, 6 and 8 off an FM3 tone and they arrive on the AM4 as
 * scenes 1, 2, 3 and 4 — in the order they were written, keeping their names,
 * so the footswitch under scene 2 plays what was scene 4 and is still called
 * whatever it was called.
 *
 * Everything else in the spec is untouched: blocks, values and the amp are the
 * same on both units and were never the thing that did not fit.
 */
export function fitScenes(spec, keep, sceneCount) {
  const wanted = new Set((Array.isArray(keep) ? keep : []).map(Number))
  const rows = sceneRows(spec)
  const kept = rows.filter((row) => wanted.has(row.index)).slice(0, ceiling(sceneCount))
  const moved = kept
    .map((row, i) => ({ from: row.index, to: i, name: sceneLabel(row) }))
    .filter((m) => m.from !== m.to)
  const dropped = rows.filter((row) => !kept.includes(row)).map(sceneLabel)
  return {
    spec: { ...spec, scenes: kept.map((row, i) => ({ ...row.scene, index: i })) },
    kept: kept.map(sceneLabel),
    moved,
    dropped
  }
}

/**
 * What happened to the scenes, in a sentence, for the conversation.
 *
 * Said in the log rather than only in the picker, because the picker is gone
 * by the time the tone is on screen and "why has this only got four sounds"
 * is a question somebody asks a week later.
 */
export function describeFit(fit, sceneCount) {
  if (!fit) return ''
  const parts = [`Kept ${fit.kept.length} of ${fit.kept.length + fit.dropped.length} scenes`]
  if (fit.dropped.length) parts.push(`left behind ${fit.dropped.join(', ')}`)
  if (fit.moved.length) {
    parts.push(
      `renumbered ${fit.moved.map((m) => `${m.name} to scene ${m.to + 1}`).join(', ')}`
    )
  }
  return `${parts.join(' — ')}. This unit has ${ceiling(sceneCount)}.`
}
