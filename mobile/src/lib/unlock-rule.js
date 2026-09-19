/**
 * Who may drive a real unit, as two pure functions and nothing else.
 *
 * This is separated from purchases.js for one reason: that file imports React
 * Native, expo-constants and AsyncStorage, so node cannot load it and the rule
 * inside it could only ever be checked by reading the source as text. The rule
 * is the part that matters — get it backwards and either nobody can use what
 * they paid for, or everybody can use what they didn't — so it lives here,
 * where a test can call it with every combination and check the answer.
 *
 * Nothing in this file imports anything. That is the point of it.
 *
 * THE RULE, once, in one place: a person is stopped ONLY when the app is
 * certain they should be. Certainty means all of — purchasing works here, the
 * check has finished, and the answer was no. Anything less is not a "no", and
 * an app that treats "don't know" as "no" locks people out of something they
 * paid for on the day their signal is bad, which for this app is a stage.
 */

/**
 * May this person point the app at real hardware?
 *
 * Note what counts as yes, and why:
 *
 *   unlocked   — they paid
 *   !available — purchasing is impossible here: no native module, no API key,
 *                or the store could not be reached. A paywall that cannot take
 *                money must never be a paywall that blocks the app.
 */
export const mayDrive = ({ unlocked = false, available = false } = {}) =>
  Boolean(unlocked) || !available

/**
 * Should the app interrupt this person and ask them to pay?
 *
 * Every false below is a reason not to charge, and three of the four are
 * reasons not to be SURE:
 *
 *   demo      — free for ever; the demo is the whole free half of the app
 *   checking  — no answer from the store yet, and an unanswered question is
 *               not a no
 *   !available— see mayDrive
 *   unlocked  — they paid
 *
 * `inApp` is whether they are past the door at all; a paywall in front of the
 * sign-in screen would charge people before they know what they are buying,
 * and would meet Apple's reviewer before the demo does.
 */
export const shouldAskToPay = ({
  inApp = false,
  demo = false,
  checking = true,
  available = false,
  unlocked = false
} = {}) => Boolean(inApp) && !demo && !checking && Boolean(available) && !unlocked
