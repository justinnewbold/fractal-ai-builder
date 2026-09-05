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

/** What to print in front of a name. Numeric slots are padded so the column lines up. */
export function slotLabel(number, addressing) {
  if (!Number.isFinite(number) || number < 0) return '—'
  if (!isBanked(addressing)) return String(number).padStart(3, '0')
  const bank = Math.floor(number / PER_BANK)
  // Past Z there is no letter left, and inventing one is worse than a number.
  if (bank > LAST_BANK) return String(number).padStart(3, '0')
  return `${String.fromCharCode(65 + bank)}${String((number % PER_BANK) + 1).padStart(2, '0')}`
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
