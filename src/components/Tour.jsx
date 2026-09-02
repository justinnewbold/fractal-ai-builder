import { useEffect, useState } from 'react'
import Sheet from './Sheet'

/**
 * The four things nobody works out on their own.
 *
 * A tour is a tax on everyone who did not need it, so this one is short and
 * says only what the screen cannot. Where the tabs are is not in here: they
 * are labelled Play, Edit and Create and sit across the top. What is in here
 * is the two facts that make people nervous — where a change actually goes,
 * and how to undo it — plus the one concept this app leans on that a Fractal
 * unit itself explains badly.
 *
 * It is offered, not imposed. Skip keeps the same corner on every card that
 * has one, and it is a real button rather than a grey word: someone who has
 * used a Fractal for ten years should be able to get out in one tap without
 * reading anything. Closing it any other way — the X, the back gesture, a
 * swipe down — counts the same as skipping, because a tutorial that reappears
 * after you dismissed it is worse than one you never saw.
 *
 * It waits for a working connection. There is nothing to tour when the app
 * cannot reach a unit, and the screen at that point already says what to do
 * about it — a tutorial arriving on top of a real problem is noise over the
 * one message that mattered.
 */
const KEY = 'fab.tour.v1'

export const tourSeen = () => {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    // A browser that refuses storage would otherwise show this every load.
    // Assuming it has been seen is the kinder failure of the two.
    return true
  }
}

export const markTourSeen = () => {
  try {
    localStorage.setItem(KEY, 'done')
  } catch {
    // Nothing to be done, and nothing worth interrupting anyone over.
  }
}

const CARDS = [
  {
    title: 'Three screens',
    body: (
      <>
        <p>
          <strong>Play</strong> is the one to have open with a guitar in your hands: the preset
          you&rsquo;re on, its scenes, a tuner.
        </p>
        <p>
          <strong>Edit</strong> is the signal chain &mdash; tap any block to open it, or search for
          a control by name if you know what you want.
        </p>
        <p>
          <strong>Create</strong> is where you describe a sound and it gets built for you.
        </p>
      </>
    )
  },
  {
    title: 'Say what you want',
    body: (
      <>
        <p>
          On Create, write it the way you&rsquo;d say it to someone: <em>tight modern metal rhythm
          in drop A</em>, or <em>warm clean with a bit of shimmer</em>. Name a band, a record or a
          real amp and it will work out what made that sound.
        </p>
        <p>
          You always see the whole thing &mdash; every block, every value &mdash; before anything
          reaches the unit. Nothing is sent until you press the button that says so.
        </p>
      </>
    )
  },
  {
    title: 'Nothing sticks until you save',
    body: (
      <>
        <p>
          Changes land in the unit&rsquo;s edit buffer, which is the sound coming out of it right
          now. Play it, keep asking for changes, take as long as you like.
        </p>
        <p>
          It only becomes permanent when you press <strong>Save</strong>, and only in the slot you
          choose there. If you don&rsquo;t like where it went, <strong>Revert to saved</strong> in
          the same place puts the stored version back.
        </p>
      </>
    )
  },
  {
    /*
     * Not "eight states". Eight is the FM3's count and the app reads it from
     * the unit for a reason — the family does not agree on it — so a title
     * that asserts eight is wrong on whichever device has a different number,
     * and it is the sort of wrong a player notices immediately.
     */
    title: 'Scenes are one rig, several sounds',
    body: (
      <>
        <p>
          A scene is not another preset. One preset holds one set of blocks, and a scene is a saved
          pattern of which of them are switched on &mdash; so you get several usable sounds out of
          one rig, changed by footswitch with no gap in the audio.
        </p>
        <p>
          That&rsquo;s why a lead scene is the rhythm scene plus a boost and a delay, rather than a
          hotter amp: the gain lives on the block, and every scene shares it.
        </p>
      </>
    )
  }
]

export default function Tour({ open, onClose }) {
  const [card, setCard] = useState(0)

  // Back to the start when it is asked for again from Settings. Reopening on
  // the last card is a small thing that makes it feel broken.
  useEffect(() => {
    if (open) setCard(0)
  }, [open])

  const last = card === CARDS.length - 1
  const finish = () => {
    markTourSeen()
    onClose()
  }

  return (
    <Sheet
      open={open}
      /* Any way out is the same way out. The X, the back gesture and a swipe
         all arrive here, and all of them mean "not now" — so all of them have
         to stop it coming back, or dismissing it is a thing you do repeatedly
         rather than once. */
      onClose={finish}
      title={CARDS[card].title}
      note={`${card + 1} of ${CARDS.length}`}
      footer={
        /*
          The right-hand button is always the way forward — Next, Next, Next,
          Done. It was Done on the left and Back on the right, which meant the
          fourth tap in the place the last three had been went backwards. That
          is muscle memory being punished, and it is the exact reason people
          stop trusting a tour and hunt for the X.

          Skip has the far left for as long as it means something. On the last
          card it means what Done means, so it goes rather than sitting there
          as a second way to do the same thing.*/
        <div className="tour-foot">
          {last ? null : (
            <button className="chip" onClick={finish}>
              Skip
            </button>
          )}
          {/* Dots that do what they look like they do. Inert ones read as a
              paging control that ignores the finger. */}
          <div className="tour-dots">
            {CARDS.map((c, i) => (
              <button
                key={c.title}
                type="button"
                className={i === card ? 'tour-dot on' : 'tour-dot'}
                onClick={() => setCard(i)}
                aria-label={'Step ' + (i + 1) + ' of ' + CARDS.length}
                aria-current={i === card}
              />
            ))}
          </div>
          {card > 0 ? (
            <button className="chip" onClick={() => setCard(card - 1)}>
              Back
            </button>
          ) : null}
          <button className="primary" onClick={last ? finish : () => setCard(card + 1)}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      }
    >
      <div className="tour-card">{CARDS[card].body}</div>
    </Sheet>
  )
}
