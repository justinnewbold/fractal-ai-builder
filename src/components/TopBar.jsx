import { isDemo, demoUnit } from '../lib/forgefx'
import { demoSentence } from '../lib/demoUnits'
import { describeUnit } from '../lib/link'
import { presetLabel } from '../lib/presetName'
import { FULL, VERSION } from '../lib/version'
import LinkChip from './LinkChip'

/**
 * One line, above everything, in every state.
 *
 * What it replaces: a wordmark, a sentence explaining the app to someone
 * already using it, a version badge, a collapsible device bar, a status line,
 * and a save cluster — six stacked elements, about 290px, before the first
 * thing anyone came here to do. On a phone that was 35-40% of the screen, and
 * the six of them between them said the unit's name four times, the preset
 * twice and the connection three times.
 *
 * So: one bar, 44px, and the single place any of those facts is written. The
 * unit and its lamp on the left, the loaded preset in the middle — a button,
 * because the preset is the thing you change most — unsaved and saving on the
 * right, and setup behind the gear.
 *
 * Sticky rather than fixed. A fixed bar is pinned to the layout viewport, which
 * on iOS means the keyboard slides underneath it and the page scrolls behind
 * it; sticky moves with the document and needs none of the compensation the
 * assistant already carries for its own input.
 *
 * It renders at every status, including none. The gear is how you reach the
 * host address and the sign-in when nothing is connected, which is exactly when
 * you need them and precisely when the old device bar was easiest to miss.
 */
export default function TopBar({
  status,
  device,
  /* Where the DEMO word goes when there is one. See below. */
  onGetPhoneApp,
  /* In the demo, for somebody who has not paid: the unlock, and what it
     costs. Null when there is nothing to sell them. */
  onUnlock = null,
  unlockPrice = null,
  /* In the demo, for somebody who HAS paid: the way back to their own rig. */
  onExitDemo = null,
  /* Which kind of fault this is, so the word beside the lamp is about the
     thing that is actually missing. See describeUnit. */
  faultReason = null,
  preset,
  dirty,
  onOpenPresets,
  onOpenSettings,
  /*
   * The unit's name, tapped. "Make it so that if you tap the top left button
   * where it shows the current device in the demo mode, that it'll bring up
   * that same list where you can change which one you're on."
   *
   * It goes two places, because the name means two different things. In the
   * demo it is a choice — which of the five this is pretending to be — and
   * the picker is the answer. On a real rig it is a fact, and the question
   * behind tapping it is "what IS this thing" — firmware, grid, scenes,
   * slots, and what it is connected through. App decides which; the bar only
   * knows the name is worth pressing.
   */
  onOpenUnit,
  /* Given only when there is an output level to move — see the speaker below. */
  onOpenVolume,
  link,
  onLinkAction,
  presetsOpen,
  menu,
  /*
   * Whether the bar carries the preset at all. On Play the preset is a tile
   * the width of the screen, right under this bar — "remove the preset name
   * from the header, it's already a button on the screen" — and the bar
   * gains the room it has been short of since the version and the link word
   * joined it. Edit and Create have no tile, so there it stays.
   */
  showPreset = true,
  children
}) {
  const demo = isDemo()
  // A phone driving the Mac from a distance. Handed in as state rather than
  // read from the connection module at render, which was only ever as fresh
  // as the last unrelated re-render.
  const remote = link?.role === 'remote'

  /*
   * The short name is the point: "FM3", not a sentence. A phone that has not
   * connected yet is not a fault, and one that has connected to a Mac with no
   * unit on it is — describeUnit holds both, in link.js where it can be tested,
   * because it got this wrong in a way a screenshot showed instantly and no
   * test could: "NOT CONNECTED" beside a chip reading "connected", over a
   * notice saying the Mac was connected and no unit was plugged in.
   */
  const { unit, lamp: lampState } = describeUnit({
    demo,
    role: link?.role,
    status,
    device,
    link: link?.link,
    reason: faultReason
  })

  /*
   * The word beside the lamp. On a phone the chip on the right already says
   * the state of the link — connected, no answer — so the bar does not say it
   * twice; here the word is about the unit.
   */
  /*
   * In the demo the word is UNLOCK for anybody who has not paid — the phone's
   * rule, and his: "when someone's on the demo, it should always say unlock,
   * and then the price at the top". Somebody who owns it still reads DEMO,
   * with Exit demo beside it, because offering an unlock to a person who has
   * paid sends them to a page with nothing on it for them.
   */
  const canBuy = demo && Boolean(onUnlock)
  const canLeave = demo && !canBuy && Boolean(onExitDemo)
  const how = demo
    ? canBuy
      ? 'unlock'
      : 'demo'
    : remote
      ? ''
      : status === 'live'
        ? 'connected'
        : status === 'fault'
          ? 'offline'
          : ''

  /*
   * Whether the preset is actually in this row, which is not the same question
   * as whether there is a preset.
   *
   * It decides the cap on the unit's name on a phone, and the cap was reading
   * the CONNECTION instead. "AXE-FX III cuts off" — ten characters against a
   * nine-character cap, on the Play screen, where the preset is the tile below
   * rather than anything in this bar. The cap was defending room nothing was
   * using.
   */
  const presetInBar = status === 'live' && showPreset

  return (
    <div className="topbar"
      data-status={lampState}
      data-preset={presetInBar ? 'yes' : 'no'}
      data-unlock={canBuy ? 'yes' : 'no'}
    >
      <div className="topbar-row">
        <span className="lamp" data-state={lampState} />
        {/*
          A button, because the name was the one thing in this bar that looked
          like a label and was the first thing anybody pressed. The preset
          beside it has been a button for the same reason since the bar was
          built: it is what you would change.
        */}
        <button
          className="topbar-unit silk-label"
          onClick={onOpenUnit}
          aria-label={demo ? 'Demo Unit' : 'About this unit'}
        >
          {unit}
        </button>
        {/* The word carries the state as well as saying it: green when the unit
            is answering, red when it isn't, so the bar reads at a glance. */}
        {/*
          IN THE DEMO THE WORD IS A BUTTON, and it goes somewhere this app can
          actually deliver.

          "Make it so demo can be clicked to bring up the unlock page." This
          end could not, once: the unlock was only ever an in-app purchase on
          a phone. It can now — the browser and the computer app take a card
          through Web Billing (lib/webPurchase.js) — so for somebody who has
          not paid the word reads UNLOCK and does exactly what the phone's
          does, with the price in a pill beside it.

          Where it still reads DEMO — the answer about paying not in yet, or
          nothing to sell — it hands somebody the phone app instead: what the
          remote does, what it costs, and a square to point a camera at.

          Outside the demo the same word reads CONNECTED or FINDING, means
          nothing of the sort, and stays a plain label rather than becoming a
          control that would surprise somebody mid-set.
        */}
        {canBuy ? (
          <button
            className="topbar-how is-button is-unlock" data-state={lampState}
            onClick={onUnlock}
            title={demoSentence(demoUnit())}
            aria-label="Unlock the full version"
          >
            {how}
          </button>
        ) : how && demo && onGetPhoneApp ? (
          <button
            className="topbar-how is-button" data-state={lampState}
            onClick={onGetPhoneApp}
            title={demoSentence(demoUnit())}
            aria-label="Get Fractal Remote on your phone"
          >
            {how}
          </button>
        ) : how ? (
          <span
            className="topbar-how" data-state={lampState}
            /* The demo's one-line explanation lives behind its word once the
               banner has been put away, so a hover still says what DEMO means. */
            title={
              demo
                ? demoSentence(demoUnit())
                : undefined
            }
          >
            {how}
          </span>
        ) : null}

        {/*
          The pill beside the word, the same one the phone draws in the same
          place. For somebody who has not paid it carries the price and
          nothing else — UNLOCK $9.99 reading across the two, rather than the
          same verb twice in half an inch. For somebody who has, it is the way
          out of the demo, in his words: "have it just clearly say exit demo
          if they're in the demo and they've already paid."
        */}
        {canBuy && unlockPrice ? (
          <button className="topbar-pill" onClick={onUnlock} aria-label="Unlock the full version">
            <span className="topbar-pill-face">{unlockPrice}</span>
          </button>
        ) : canLeave ? (
          <button className="topbar-pill" onClick={onExitDemo} aria-label="Exit demo">
            <span className="topbar-pill-face">Exit demo</span>
          </button>
        ) : null}

        {/* The preset is a button because it's the thing you change most, and
            because a slot number nobody can act on is trivia. */}
        {presetInBar ? (
          <button
            className={`topbar-preset ${presetsOpen ? 'open' : ''}`}
            onClick={onOpenPresets}
            aria-label="Choose a preset"
            aria-expanded={!!presetsOpen}
          >
            {/* One line inside the button, so the slot and the name share a
                baseline while the line itself sits in the middle of a button
                that the touch floor makes 44px tall. Baseline-aligned children
                of the button sat at its top edge — the name rode high beside
                Save and the gear on every phone. */}
            <span className="topbar-preset-line">
              <span className="topbar-slot mono">
                <span className="sr-only">Preset </span>
                {preset?.number ?? '--'}
              </span>
              <span className="topbar-name">{presetLabel(preset)}</span>
              <span className="topbar-caret" aria-hidden="true" />
            </span>
          </button>
        ) : (
          <span className="topbar-gap" />
        )}

        {/* The Save button says whether there is anything to save; there is
            no separate word for it any more. */}
        {children}

        {/*
          The version, where it can be read without opening anything.

          "The app version number is listed only in settings. I like to always
          know easily what version we are working on." Fair: it is the first
          thing either of us needs when something looks wrong, and it lived one
          sheet and one fold away from the screen it describes.

          Small, dim and last before the gear, so it sits with the other things
          about the app rather than the things about the tone. It carries the
          same title as Setup's line so a hover still gives the commit.
        */}
        <span className="topbar-version mono" title={FULL}>
          v{VERSION}
        </span>

        {/* Named while something is wrong: at the other end of this same bar
            the word is about the UNIT, and two states with nothing saying
            which is which read as one app disagreeing with itself. */}
        <LinkChip
          compact
          link={link}
          onAction={onLinkAction}
          sayMac={remote && status !== 'live'}
        />

        {/*
          The volume, behind a speaker rather than across the top of Play.

          "Can we set that to be a slide-up menu? Put a sound button that looks
          like a speaker in the header, and when it's tapped you can slide the
          volume left or right or do the plus minus thing."

          It was a permanent row above the preset tile — the control you reach
          for between songs, taking a strip of the one screen whose currency is
          scene buttons you can hit without looking. Behind the speaker it costs
          a tap when it is wanted and nothing when it is not.

          Absent, not disabled, on a preset whose output block the app cannot
          reach: a speaker that opens an empty sheet is worse than no speaker.
        */}
        {onOpenVolume ? (
          <button className="topbar-volume" onClick={onOpenVolume} aria-label="Volume">
            {/* Drawn rather than an emoji: this sits beside a 15px version
                number on a bar that is already tight, and a colour emoji at
                that size is a smudge. currentColor, so it takes the bar's ink
                in both themes. */}
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M15.5 9.2a4 4 0 0 1 0 5.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M18.2 6.6a7.7 7.7 0 0 1 0 10.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}

        {/* Setup is a sheet now, not a fold under the bar. It carries the
            host address, the sign-in, the ports and the diagnostics, so it was
            always too much to hang off a 44px bar — and a fold that pushes the
            whole page down is the opposite of what this bar is for. */}
        <button
          className="topbar-gear"
          onClick={onOpenSettings}
          aria-label="Connection and setup"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>

      {/*
        The preset menu hangs off the bar rather than off the button, for the
        same reason the save popover does: the button sits mid-row, and a menu
        anchored to it runs off the edge of a phone. The bar spans the screen.
      */}
      {menu}
    </div>
  )
}
