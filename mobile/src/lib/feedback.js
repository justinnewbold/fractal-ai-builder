/**
 * The tap you feel.
 *
 * On a dark stage the screen is the last thing you can rely on, so a control
 * that has registered a press says so through the case. Deliberately quiet —
 * light for anything you might press repeatedly, heavier only where a mistake
 * costs a song.
 *
 * Every call is swallowed: a device with no taptic engine, or a user who has
 * turned it off in system settings, must not be able to fail a preset change.
 */
import * as Haptics from 'expo-haptics'

const quietly = (run) => {
  try {
    const done = run()
    if (done?.catch) done.catch(() => {})
  } catch {
    // A phone that cannot buzz is not a phone that cannot play.
  }
}

/** A control moved. */
export const tick = () => quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))

/** Something changed that you would want to feel from a stand — a preset, a scene. */
export const thud = () => quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))

/** The unit refused. */
export const nope = () =>
  quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))
