/**
 * Which buttons the stage screen offers.
 *
 * THIS FILE USED TO BE PLAY MODE — a switch that took the ✦ Ask button off the
 * Play screen, so that nothing within reach of a thumb mid-song could start the
 * AI building a tone. The reasoning behind it was about accidents and it was
 * right about accidents; the AI it was protecting against is gone from all four
 * apps, and a switch that takes away something already absent is a switch that
 * reports success and changes nothing.
 *
 * So the switch went, along with the stored setting and the `toneWayIn` rule
 * the phone used to ask the same question. The one rule that was never about
 * the AI is re-exported from the file both ends share.
 */
export { editButtonShows } from '../../shared/play-mode.mjs'
