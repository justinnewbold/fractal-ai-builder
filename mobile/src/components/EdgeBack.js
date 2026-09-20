import { useRef } from 'react'
import { PanResponder, View } from 'react-native'

/**
 * Swipe in from the left edge to go back one step.
 *
 * "I want to make some swipe gestures and make it easy for someone to exit the
 * menu they're in or go back to the previous menu, so under the settings menu
 * they could swipe on the left side of the screen to the right to go back to
 * the play screen, or in one of the submenus on the settings screen, it would
 * swipe and go back to the previous page they were on."
 *
 * ONE STEP, ALWAYS. This never decides where back IS — the screen wrapping it
 * does, and it is always the thing one level up: a submenu goes to the list,
 * the list goes to Play. That is the whole of the rule, and keeping the
 * decision at the call site is what stops it becoming a pile of special cases.
 * Done is the other gesture and it is not this one: Done leaves for Play from
 * any depth, in one tap.
 *
 * BUILT ON PanResponder, WHICH IS WHY IT REACHES A PHONE AT ALL. The usual
 * answer is react-native-gesture-handler, and installing it would move the
 * native fingerprint — which stops every installed handset receiving updates
 * until a new build is made and spends an iOS build slot to add a swipe.
 * PanResponder ships inside React Native, so this goes out over the air like
 * any other change. See mobile/fingerprint.json and CLAUDE.md.
 *
 * WHAT IT REFUSES TO CLAIM, because a gesture that fires when you did not mean
 * it is worse than no gesture:
 *
 *   - It must START at the left edge. A drag beginning anywhere else is
 *     somebody using the screen, and the screen keeps it.
 *   - It must be going sideways, by a clear margin over vertical. Otherwise
 *     every scroll that began near the left edge would exit the page.
 *   - A tap is never a swipe: it only ever claims the gesture on MOVE, so
 *     buttons under it keep working normally.
 *
 * And the release has its own threshold, so a short wobble that was claimed
 * still does nothing. A flick counts even when it is short, because a fast
 * thumb is a deliberate one.
 */

/** How far in from the left a gesture may start and still mean "back". */
export const EDGE = 28
/** How far it has to travel before the claim is made, in pixels. */
const CLAIM = 10
/** How far it has to end up, unless it was thrown. */
const TRAVEL = 60
/** A flick: fast enough that distance stops mattering. */
const FLICK = 0.35

export default function EdgeBack({ onBack, children, style }) {
  /*
   * The live handler, held in a ref so the responder itself is made once.
   *
   * Rebuilding PanResponder every render is the trap here: mid-gesture the
   * View would swap to a new set of handlers and the release would land on a
   * responder that never saw the start. So the responder closes over this ref
   * and reads the current callback out of it at the moment it fires.
   */
  const latest = useRef(onBack)
  latest.current = onBack

  const pan = useRef(
    PanResponder.create({
      /* Never on touch-down: that would eat taps meant for buttons. */
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.x0 <= EDGE && g.dx > CLAIM && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      /*
       * DELIBERATELY NOT THE CAPTURE VERSION. Capture asks from the outside
       * in and would take the gesture off whatever is under the finger —
       * including a knob or a slider that happens to sit against the left
       * edge, which on the Edit screen several do. A horizontal drag is
       * exactly what those exist for, and losing it to a page change would
       * be the gesture doing harm.
       *
       * Bubbling is enough: a vertically scrolling list does not claim a
       * sideways drag, so it reaches this View anyway. Anything that DOES
       * claim it wanted it.
       */
      onPanResponderRelease: (_e, g) => {
        if (g.dx > TRAVEL || (g.vx > FLICK && g.dx > CLAIM)) latest.current?.()
      }
    })
  ).current

  /* No handlers at all when there is nowhere to go: a View that claims
     gestures and then does nothing with them is a dead patch of screen. */
  return (
    <View style={[{ flex: 1 }, style]} {...(onBack ? pan.panHandlers : null)}>
      {children}
    </View>
  )
}
