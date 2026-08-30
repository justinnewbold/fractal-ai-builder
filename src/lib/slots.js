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
