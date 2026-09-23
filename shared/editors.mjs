/**
 * THE PROGRAMS THAT HOLD THE USB CONNECTION, BY NAME.
 *
 * "What kind of information do we have to let people know they need to close
 * any of the fractal software, like FM3 edit… maybe we should add it in more
 * places." And: "is there a way to name the device specifically by detecting
 * which device they're using? If not, what do you think the best way is to
 * describe the devices?"
 *
 * Only one program can have a unit's USB connection, and Fractal's own editor
 * for that unit is the usual one that already has it. Its updater, Fractal-Bot,
 * is the other. So wherever this app knows which unit it is — connected now,
 * or the one last seen — the advice names that unit's editor, and where it
 * does not, it names them all rather than "another editor", which somebody
 * who only knows it as "AM4-Edit" might not recognise as theirs.
 *
 * One file, because the sentence appears on the computer's setup, the phone's
 * connection page, the troubleshooting list and the connect-a-computer steps,
 * and four hand-typed copies drift.
 */

/** Each unit's editor, as Fractal names it. The Axe-Fx III before the II. */
const EDITORS = [
  { unit: /axe-?fx\s*(iii|3)\b/i, editor: 'Axe-Edit III' },
  { unit: /axe-?fx\s*(ii|2)\b/i, editor: 'Axe-Edit' },
  /* The XL and XL+ by their short names, "II XL" and "II XL+", which is what
     a connected one calls itself. */
  { unit: /^ii\s*xl\b/i, editor: 'Axe-Edit' },
  { unit: /\bfm3\b/i, editor: 'FM3-Edit' },
  { unit: /\bfm9\b/i, editor: 'FM9-Edit' },
  { unit: /\bam4\b/i, editor: 'AM4-Edit' },
  { unit: /\bvp4\b/i, editor: 'VP4-Edit' }
]

/** Fractal's firmware updater, which holds the port the same way. */
export const UPDATER = 'Fractal-Bot'

/** Every editor, for when the unit is not known. */
export const ALL_EDITORS = 'FM3-Edit, FM9-Edit, Axe-Edit III, Axe-Edit, AM4-Edit, VP4-Edit'

/** The editor for a unit named like "FM3" or "Axe-Fx III", or null. */
export function editorFor(unit) {
  if (typeof unit !== 'string' || !unit.trim()) return null
  return EDITORS.find((e) => e.unit.test(unit))?.editor || null
}

/**
 * The programs to close, as a list: "FM3-Edit or Fractal-Bot" for a known
 * unit, every editor and Fractal-Bot for an unknown one.
 */
export function holders(unit) {
  const one = editorFor(unit)
  return one ? `${one} or ${UPDATER}` : `${ALL_EDITORS} or ${UPDATER}`
}

/** The whole sentence, for a step or a help line. */
export function quitEditor(unit) {
  const one = editorFor(unit)
  return `Quit ${holders(unit)} if ${one ? 'either' : 'one'} is open. Only one program can use the USB connection at a time.`
}
