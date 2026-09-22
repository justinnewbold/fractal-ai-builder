/**
 * What is left of pairing: telling a pairing account apart from a person's.
 *
 * THE CODES ARE GONE, AND THIS FILE IS THE HOLE THEY LEFT.
 *
 * "I want the QR code gone and the scanner gone. It has never worked once.
 * Every time I've ever tried it, you tell me something different. OK, I'm
 * sorry. I don't wanna do it anymore. OK, to use this app and connect it to
 * your computer, you have to sign up. That's the way we're doing it."
 *
 * There used to be a whole arrangement here. A computer minted an
 * eight-character code from an alphabet with no 0, 1, I or O in it; the code
 * was the password to a hidden account at pair.fractal.newbold.cloud that
 * nobody ever saw, so two devices could share an account without anybody
 * making one. The computer showed it as a QR code carrying a link to the
 * hosted app with the code in the fragment, and the phone read it with its
 * camera or had it typed in.
 *
 * It was a good idea and it did not work in his hands, across every attempt.
 * Joining a phone to a computer is a sign-in now, on both ends, and that is
 * the only way. The demo still needs no account and neither does the computer
 * app on its own.
 *
 * WHY THESE TWO SURVIVE:
 *
 *   isPairAccount — every phone and computer paired the old way still holds a
 *     perfectly good session on one of those hidden accounts. A screen that
 *     read them as signed-out would be wrong about somebody who is working,
 *     and a screen that printed the address as an email would be showing them
 *     something meaningless. So the shape is still recognised, even though
 *     nothing makes another one.
 *
 *   HOSTED_ORIGIN — where the app lives. It was here because the QR pointed
 *     at it; it stays because other things need the address.
 */

/** Where the hidden account's address lives. Nothing was ever mailed to it. */
export const PAIR_DOMAIN = 'pair.fractal.newbold.cloud'

/** Where the app is served from. */
export const HOSTED_ORIGIN = 'https://fractal.newbold.cloud'

/**
 * Is this one of the hidden accounts a pairing code stood for?
 *
 * Asked so that no screen shows somebody `X7K2MQ4B@pair.fractal.newbold.cloud`
 * as though it were their email address, and so a device paired before the
 * codes went away still reads as signed in.
 */
export const isPairAccount = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${PAIR_DOMAIN}`)
