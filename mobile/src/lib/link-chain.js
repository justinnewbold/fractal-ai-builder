/* Generated from shared/link-chain.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * THE THREE CARDS AT THE TOP OF PHONE & COMPUTER, worded once for both ends.
 *
 * "I thought we updated this to a new format… Once again, always make sure
 * you're updating all the platforms when you do it." The page was two pages:
 * the phone's opened on a lamp and a sentence, the browser's on a block of
 * facts, and nothing held their words together. So the words live here, the
 * phone gets a generated copy (npm run sync:rules), and each end only draws
 * them: the unit, the computer and the phone as three cards joined by the
 * same two wires as How it works, each with a lamp that says whether that
 * piece is answering.
 *
 * `here` is which end is drawing: 'phone' for the phone app and a phone's
 * browser, 'computer' for the computer app and a desktop browser. The cards
 * are the same three either way; only which one is "this" changes.
 *
 * Tones are the browser's vocabulary, the same four link-word.mjs uses:
 * good, busy, bad, dim.
 */

/**
 * @param {object} p
 * @param {'phone'|'computer'} p.here
 * @param {boolean} [p.demo]
 * @param {{ name?: string|null, firmware?: string|null, state?: 'present'|'missing'|'silent'|'unknown' }} [p.unit]
 * @param {{ name?: string|null, version?: string|null, link?: string }} [p.computer]
 *   link, for a phone: connected, joining, no-answer or anything else for off.
 * @param {{ version?: string|null, email?: string|null, remote?: 'on'|'off'|'signed-out' }} [p.phone]
 *   remote, for a computer: whether its phone remote is on.
 */
export function linkChain({ here, demo = false, unit = {}, computer = {}, phone = {} }) {
  const atPhone = here === 'phone'
  const reached = atPhone ? computer.link === 'connected' : true
  const unitName = unit.name || 'Your unit'

  const unitCard = demo
    ? { body: `${unit.name || 'FM3'} · simulated`, tone: 'good' }
    : !reached
      ? { body: 'Reached through your computer', tone: 'dim' }
      : unit.state === 'present'
        ? { body: [unit.name || 'Connected', unit.firmware ? `firmware ${unit.firmware}` : null].filter(Boolean).join(' · '), tone: 'good' }
        : unit.state === 'missing'
          ? { body: 'No unit found. Check it is on and its USB cable is in.', tone: 'bad' }
          : unit.state === 'silent'
            ? { body: `${unitName} isn’t answering. Turn it off and on.`, tone: 'bad' }
            : { body: 'Looking for your unit…', tone: 'busy' }

  const computerName = computer.name || 'Your computer'
  const version = (v) => (v ? ` · v${v}` : '')
  const computerCard = !atPhone
    ? { body: `${computer.name || 'Fractal app'}${version(computer.version)}`, tone: 'good' }
    : demo
      ? { body: 'Not needed in the demo', tone: 'dim' }
      : computer.link === 'connected'
        ? { body: `${computerName}${version(computer.version)}`, tone: 'good' }
        : computer.link === 'joining'
          ? { body: `Finding ${computer.name || 'your computer'}…`, tone: 'busy' }
          : computer.link === 'no-answer'
            ? { body: `${computerName} isn’t answering`, tone: 'bad' }
            : { body: 'Not connected', tone: 'dim' }

  const phoneCard = atPhone
    ? { body: [phone.version ? `v${phone.version}` : null, phone.email || null].filter(Boolean).join(' · ') || 'This phone', tone: 'good' }
    : phone.remote === 'on'
      ? { body: `Phone remote on${phone.email ? ` for ${phone.email}` : ''}`, tone: 'good' }
      : phone.remote === 'signed-out'
        ? { body: 'Phone remote not set up', tone: 'dim' }
        : { body: 'Phone remote off', tone: 'dim' }

  return [
    { key: 'unit', label: 'YOUR UNIT', ...unitCard, wire: 'USB CABLE' },
    { key: 'computer', label: atPhone ? 'YOUR COMPUTER' : 'THIS COMPUTER', ...computerCard, wire: 'SECURE LINK' },
    { key: 'phone', label: atPhone ? 'THIS PHONE' : 'YOUR PHONE', ...phoneCard }
  ].map((card, i, all) => ({
    ...card,
    /* A wire is lit when both of its ends are answering. */
    lit: card.wire ? card.tone === 'good' && all[i + 1]?.tone === 'good' : undefined
  }))
}
