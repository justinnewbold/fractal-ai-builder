/**
 * Which buttons the stage screen offers.
 *
 * THIS FILE USED TO BE PLAY MODE. Play mode was a switch that took the ✦ Ask
 * button off the Play screen, so that nothing within reach of a thumb mid-song
 * could start the AI building a tone. The AI is gone from all four apps, and a
 * switch that takes away something already absent is a switch that reports
 * success and changes nothing — so the switch went with it, on the phone and
 * in the browser, along with toneWayIn and the stored setting.
 *
 * What is left is the one rule that was never about the AI.
 */

/**
 * Whether the Edit button shows on the stage screen.
 *
 * The chain editor is there whenever there is a unit to edit — it was never
 * gated on play mode, because rebuilding a chain is not asking anyone for
 * anything: "the edit button on the stage screen should just always be there
 * as long as we are connected, I don't want to have to spend ANOTHER expo
 * build slot."
 *
 * On a wide window Edit is also a screen of its own, and the button is the way
 * in from Play. There is nowhere else it needs to be absent from.
 */
export const editButtonShows = ({ status }) => status === 'live'
