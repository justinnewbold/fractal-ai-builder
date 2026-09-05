/**
 * How a unit addresses its stored slots.
 *
 * The AM4 keeps 104 presets in lettered banks of four — A01 to Z04 — and says
 * so on its own display. Gen-3 units keep 512 and simply number them; there are
 * no banks in the firmware or on the front panel, and ForgeFX reports the
 * difference as `presets.addressing`.
 *
 * The preset list lettered both. That works for the first 104 slots and then
 * runs out of alphabet: an FM3's slot 200 was labelled "s1" and slot 460 "À1",
 * addresses that name nothing on a unit that has no banks to begin with.
 */
const PER_BANK = 4
const LAST_BANK = 25 // Z

export const isBanked = (addressing) => addressing === 'bankLetter'

/**
 * How many stored slots this unit actually has, or null when it has not said.
 *
 * The app used to answer this with `?? 512`, which is the gen-3 number and a
 * guess about somebody else's hardware. On a unit whose driver reports no
 * preset count at all, that guess became a fact: the picker offered 512 slots,
 * the background name scan walked toward 512, and a save could be aimed at a
 * slot the unit has never had. A phone parked one for slot 500, the Mac carried
 * it out, and the unit answered "Preset location index must be integer 0..103,
 * got 500" — every six seconds, because the parked request kept being retried.
 *
 * Null is the honest answer to a question the unit has not answered, and every
 * caller now has to decide what to do about it. Not scanning and not offering
 * slots is a smaller failure than inventing four hundred that do not exist.
 */
export function slotCount(capabilities) {
  const count = capabilities?.presets?.count
  return Number.isInteger(count) && count > 0 ? count : null
}

/**
 * Whether this slot is one the unit has said it does not have.
 *
 * Only ever true when the unit has stated a count. A unit that has not said is
 * given the benefit of the doubt, because the alternative is refusing every
 * save on hardware whose driver simply never reports the number — turning a
 * rare wrong slot into a feature that never works. The count learned from a
 * refusal (see countFromRefusal) is what closes that gap.
 */
export function slotOutside(number, capabilities) {
  const count = slotCount(capabilities)
  if (count === null) return false
  return !Number.isInteger(number) || number < 0 || number >= count
}

/**
 * The top of a range a unit has just refused, read out of its own complaint.
 *
 * Drivers say "must be integer 0..103" when asked for something outside what
 * they hold. That sentence is the only place some units ever state their size,
 * so rather than showing it to a guitarist verbatim it is read: the app learns
 * the real count from the refusal and stops offering what does not exist.
 *
 * Deliberately narrow. It matches a stated range and nothing else, so an
 * unrelated message with numbers in it teaches the app nothing.
 */
export function countFromRefusal(message) {
  const found = /\b0\s*\.\.\s*(\d{1,5})\b/.exec(String(message || ''))
  if (!found) return null
  const top = Number(found[1])
  return Number.isInteger(top) && top >= 0 ? top + 1 : null
}

/**
 * What to print in front of a name.
 *
 * Numeric slots are padded so the column lines up. A banked unit gets both:
 * the number the app uses and the address the unit shows on its own display.
 *
 * "Can we also add the slot number in front of the A to Z bank numbers in this
 * preset menu." Right, and it matters more than it looks: everything else in
 * this app talks in numbers — save to slot 5, the bar says SLOT 99 — while the
 * unit's front panel and this list talked in letters. Anyone reading one and
 * typing the other had to do the arithmetic themselves, and the arithmetic is
 * only obvious once you know a bank holds four.
 *
 * The number first, because it is the one you type.
 */
export function slotLabel(number, addressing) {
  if (!Number.isFinite(number) || number < 0) return '—'
  const padded = String(number).padStart(3, '0')
  if (!isBanked(addressing)) return padded
  const bank = Math.floor(number / PER_BANK)
  // Past Z there is no letter left, and inventing one is worse than a number.
  if (bank > LAST_BANK) return padded
  return `${padded} ${String.fromCharCode(65 + bank)}${String((number % PER_BANK) + 1).padStart(2, '0')}`
}

/** Whether this slot opens a bank — the only place the list draws a rule. */
export function startsBank(number, previous, addressing) {
  if (!isBanked(addressing)) return false
  if (previous === null || previous === undefined) return true
  return Math.floor(number / PER_BANK) !== Math.floor(previous / PER_BANK)
}

/**
 * How much longer a scan has to run, in words.
 *
 * A progress bar answers "how far", which is the wrong question when the
 * remaining work is four minutes of the unit dumping presets one at a time.
 */
export function timeLeft(remaining, msPerSlot) {
  if (!remaining || !msPerSlot || !Number.isFinite(msPerSlot)) return null
  const seconds = Math.round((remaining * msPerSlot) / 1000)
  if (seconds < 45) return 'under a minute left'
  const minutes = Math.round(seconds / 60)
  return `about ${minutes} minute${minutes === 1 ? '' : 's'} left`
}

/* --------------------------------------------------- the chain, not the bank -- */

/**
 * Whether this unit's chain is four slots in a line rather than a grid.
 *
 * A separate question from how it addresses its *presets*, which is what the
 * rest of this file is about — but the same word, so it lives here rather than
 * being asked with a raw string comparison in four places.
 */
export const isLinearChain = (capabilities) => capabilities?.slotModel === 'linear'

/**
 * Put a unit's reported chain into the one convention the app uses: from zero.
 *
 * The app's rule is stated in GridEditor: columns are zero-based inside, and
 * the wire's one-based numbering is added once, at the boundary. Gen-3 obeys
 * it. The AM4 does not, and reports its four slots as 1..4 — the driver's own
 * two methods disagree with each other, `grid()` answering `slot - 1` and
 * `placedBlocks()` answering `slot`.
 *
 * So every column arrived one too high, and everything downstream was wrong in
 * the same direction: a chain of four drew five slots, the phantom one labelled
 * 1, and putting a block in it wrote to wire slot 1 — on top of the block the
 * screen was calling 2. "It shows five blocks when there's only four... if you
 * add one, it actually saves it to the first block, but overwrites the one that
 * is listed as number two."
 *
 * Corrected on the way in rather than at each use, because there were four uses
 * and the next one would have been wrong too.
 */
export function zeroBasedChain(list, capabilities) {
  if (!Array.isArray(list) || !isLinearChain(capabilities)) return list
  /* Only when it really is one-based. A driver that is fixed upstream, or one
     that reports an empty chain, must not be shifted into negative slots. */
  const cols = list.map((b) => b?.col).filter((c) => Number.isInteger(c))
  if (!cols.length || Math.min(...cols) < 1) return list
  return list.map((b) => (Number.isInteger(b?.col) ? { ...b, col: b.col - 1 } : b))
}

/**
 * Whether an answer is about a different preset than the one that was asked for.
 *
 * "On the Cowboys From Hell rig it's still showing the Distortion Rigs scenes."
 * Slot 97 showed 96's scene names and kept showing them: the app asked for 97,
 * was answered about 96, believed it, and cached it under 97 — and on a phone
 * that cache is the only source there is, because an AM4 cannot be dumped over
 * the relay. One bad answer outlived the read that produced it.
 *
 * Deliberately one-sided: only a stated, disagreeing identity counts. A driver
 * that does not echo which slot it read says nothing either way, and treating
 * silence as a mismatch would throw away every name on every unit that does not
 * report one. `null` is not silence — an AM4 says null when it dumped the
 * active buffer rather than the stored slot, which is a real disagreement.
 */
export function wrongSlot(asked, got) {
  if (typeof asked !== 'number') return false
  if (got === undefined) return false
  return got !== asked
}
