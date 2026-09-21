/**
 * Every word of the walkthrough, on both ends, from one file.
 *
 * "Do not change any wording without asking me first."
 *
 * That instruction is the reason this file exists rather than the strings
 * living in the two components that draw them. Copy typed into a component
 * gets tidied: a hyphen becomes an em dash, "Wi-Fi" becomes "wifi", a
 * sentence gets shortened to fit a button, and none of it is a decision
 * anybody made. Held here, a change to the wording is a change to THIS file
 * and shows up as one line in a diff.
 *
 * It is quoted exactly as written, including the plain hyphens where a
 * typographer would use a dash, and the '·' separators.
 *
 * DYNAMIC WHERE IT CLAIMS SOMETHING. A few lines are functions rather than
 * strings, and each of those is a line that names a fact: which unit was
 * found, how many presets it holds, whether a phone arrived. Those cannot be
 * typed out, because the one moment this screen exists for is the moment
 * somebody is deciding whether the app actually works — and a walkthrough
 * that says "FM3 found" with nothing plugged in has answered that.
 *
 * mobile/src/lib/onboarding.js is generated from this by `npm run sync:rules`.
 */

/**
 * The price when the store has not said one.
 *
 * "Change that one so it does know the correct price per app, and then default
 * back if it doesn't know the price."
 *
 * The store is the only thing that knows what this costs to the person
 * holding the phone: App Store and Play price by country, so a buyer in
 * Sydney is quoted in Australian dollars and a buyer in Berlin in euros.
 * Printing $9.99 at all of them would be quoting a price they cannot pay.
 *
 * His wording is what shows when the store has not answered yet — which is
 * every launch for a moment, and every launch on a copy that cannot reach it.
 */
const FALLBACK_PRICE = '$9.99'

/** The three boxes, in order, on both welcome screens. */
export const CHAIN = [
  {
    key: 'unit',
    badge: 'U',
    n: '01',
    title: 'Your unit',
    body: 'FM3, FM9, Axe-Fx III, AM4, VP4',
    /* The phone's own wording for the same three boxes. */
    phoneTitle: 'YOUR UNIT',
    phoneBody: 'FM3, FM9, Axe-Fx III, AM4, VP4',
    wire: 'USB',
    phoneWire: 'USB CABLE'
  },
  {
    key: 'computer',
    badge: 'C',
    n: '02',
    note: 'YOU ARE HERE',
    title: 'This computer',
    body: 'USB host. Live control. Permanent saving.',
    phoneTitle: 'YOUR COMPUTER',
    phoneBody: 'USB host + permanent saving',
    wire: 'SECURE LINK',
    phoneWire: 'SECURE LINK'
  },
  {
    key: 'phone',
    badge: 'P',
    n: '03',
    note: 'OPTIONAL',
    title: 'Your phone',
    body: 'A remote that works nearby or away.',
    phoneTitle: 'THIS PHONE',
    phoneBody: 'Your remote - nearby or away'
  }
]

/** D1 — the computer's welcome. */
export const D1 = {
  eyebrow: 'SETUP OVERVIEW',
  head: 'Let’s get your whole rig connected.',
  sub: 'Three clear steps. About a minute.',
  foot: 'The computer talks to the Fractal unit. Your phone talks to the computer.',
  go: 'Start setup',
  skip: 'Skip walkthrough'
}

/** D2 — plug the unit in, and what the port actually answered. */
export const D2 = {
  step: 'STEP 1 OF 3',
  head: 'Plug your unit into this computer.',
  sub: 'Use a USB cable. No driver is required.',
  /** Named by the unit that answered, never typed out. */
  found: (name) => `${name} found`,
  /** USB · firmware 8.02 · 512 presets — whichever of those is known. */
  detail: ({ firmware, presets }) =>
    ['USB', firmware ? `firmware ${firmware}` : null, presets ? `${presets} presets` : null]
      .filter(Boolean)
      .join('  ·  '),
  helpTitle: 'Nothing found?',
  helpBody: 'Quit FM3-Edit or Axe-Edit. One app can hold USB at a time.',
  next: 'Next',
  later: 'I’ll plug in later'
}

/** D2B — the same step, when another program is holding the port. */
export const D2B = {
  step: 'STEP 1 OF 3 · NEEDS ATTENTION',
  head: 'Something else has the USB port.',
  sub: 'Your unit is visible, but another app is holding the connection.',
  title: 'Close the app holding USB',
  steps: [
    'Quit FM3-Edit, Axe-Edit, or another copy of Fractal Remote.',
    'On Windows, allow firewall access so the phone can reach this computer.'
  ],
  again: 'Look again',
  without: 'Continue without it'
}

/** D3 — the offer of a phone. */
export const D3 = {
  step: 'STEP 2 OF 3',
  head: 'Use your phone as the remote?',
  sub: 'No account required. Scan one code and you’re connected.',
  why: [
    { key: 'stage', badge: '↗', label: 'STAGE', body: 'Change scenes from across the room' },
    { key: 'rack', badge: 'T', label: 'RACK', body: 'Tune without walking back' },
    {
      key: 'anywhere',
      badge: '∞',
      label: 'ANYWHERE',
      body: 'Connect through this computer - even away from home Wi-Fi'
    }
  ],
  note: 'Secure connection through this computer - the phone never connects directly to the unit.',
  pair: 'Pair my phone',
  not: 'Not now',
  foot: 'You can add a phone later in Settings → Phone & computer.'
}

/** D4 — the square, the code, and the wait. */
export const D4 = {
  step: 'STEP 3 OF 3',
  head: 'Scan this code with your phone.',
  sub: 'The phone connects to this computer, which stays connected to your Fractal unit.',
  codeLabel: 'OR ENTER THIS CODE',
  waiting: 'Waiting for your phone…',
  note: 'No account required. Pairing creates a private connection between this phone and computer.',
  noApp: 'I don’t have the app',
  skip: 'Skip for now'
}

/** The three things worth knowing, said once at the end of each walkthrough. */
export const D5 = {
  head: 'You’re set.',
  /** FM3 on USB · iPhone connected — only what is actually true. */
  status: ({ unit, phone }) =>
    [unit ? `${unit} on USB` : null, phone ? 'iPhone connected' : null].filter(Boolean).join('  ·  '),
  tips: [
    { key: 'play', label: 'PLAY', body: 'Performance controls for the guitar in your hands.' },
    { key: 'edit', label: 'EDIT', body: 'The full signal chain when you need deeper changes.' },
    {
      key: 'save',
      label: 'SAVE',
      body: 'Changes are live immediately. Save permanently to a preset from this computer.'
    }
  ],
  go: 'Start playing',
  foot: 'Need this again? Settings → Show the walkthrough.'
}

/** P1 — the phone's welcome. */
export const P1 = {
  /* His, replacing "YOUR RIG, FROM ACROSS THE STAGE." — "Let's change that
     then. I don't like it." It is the line the store banner carries, so the
     first thing somebody reads in the app is the thing that brought them to
     it. Capitals and the full stop are this screen's house style, not a
     change to his words. */
  head: 'CONTROL YOUR FRACTAL FROM YOUR PHONE.',
  sub: 'Presets, scenes, blocks, tuner and tap tempo - on the phone in your pocket.',
  go: 'Get started',
  haveCode: 'I already have a pairing code'
}

/** P2 — the same three boxes, down a phone. */
export const P2 = {
  count: '1 OF 2',
  eyebrow: 'ONE SIMPLE PATH',
  head: 'Your phone talks to your computer.',
  foot: 'No computer yet? Try a simulated unit free, with no time limit.',
  go: 'Got it'
}

/** P3 — demo or real rig. */
export const P3 = {
  count: '2 OF 2',
  head: 'WHERE DO YOU WANT TO START?',
  demo: {
    tag: 'FREE',
    eyebrow: 'EXPLORE THE APP',
    title: 'Try the demo',
    body: 'Use a simulated Fractal unit. Every screen works. No computer needed.',
    go: 'Start free demo'
  },
  real: {
    eyebrow: 'CONTROL YOUR HARDWARE',
    title: 'Connect my real rig',
    body: 'We verify the computer connection before purchase.',
    go: (price) => `Set up  ·  ${price || FALLBACK_PRICE} once`
  },
  restore: 'Already bought it? Restore purchase',
  foot: 'The demo stays free forever.'
}

/** P4 — which unit the demo pretends to be. */
export const P4 = {
  tag: 'DEMO',
  eyebrow: 'PICK YOUR HARDWARE',
  head: 'Which unit should we simulate?',
  sub: 'Real models and parameter ranges. Change this any time.',
  /** Play with FM3 — named by whichever is chosen. */
  go: (unit) => `Play with ${unit}`
}

/** P5 — the coach mark, shown on Play where the gesture lives. */
export const P5 = {
  /* "Remove one of two quicktip. No need to replace with anything." — so the
     count goes and the label stays. There is one tip, and it does not
     advertise a second that was never written. */
  count: 'QUICK TIP',
  head: 'Hold a block to change its channel.',
  body: 'Tap toggles the block. Press and hold to choose channels A-D.',
  hold: 'Hold for channel',
  go: 'Try it',
  skip: 'Skip',
  foot: 'This tip appears here - exactly when the gesture becomes useful.'
}

/** P6 — is the computer app installed yet. */
export const P6 = {
  tag: 'CONNECT',
  eyebrow: 'CONNECT YOUR COMPUTER',
  head: 'Is Fractal Remote installed there?',
  yes: 'Yes - show me the scanner',
  notYet: 'NOT YET  ·  THE COMPUTER APP IS FREE',
  platforms: [
    { key: 'mac', badge: 'M', label: 'MAC', go: 'Send link' },
    { key: 'windows', badge: 'W', label: 'WINDOWS', go: 'Send link' },
    { key: 'linux', badge: 'L', label: 'LINUX', go: 'Send link' }
  ],
  foot: 'We’ll email or text the download link so you can open it on the computer.',
  back: 'Back to the free demo'
}

/** P7 — scanning the computer's square. */
export const P7 = {
  tag: 'CONNECT',
  eyebrow: 'PAIR WITH YOUR COMPUTER',
  head: 'Scan the square on your computer.',
  codeLabel: 'OR ENTER THE CODE UNDER IT',
  foot: 'The code appears in Set up phone remote on your computer.',
  go: 'Connect',
  noCode: 'I don’t have a code yet',
  /* NEW WORDING, not from the PDF. Somebody who has signed in on another
     device has no code to scan and nothing on this screen for them — the
     walkthrough sent them round in a circle. Justin can change this line. */
  account: 'Sign in with an email and password'
}

/** P8 — the one-time unlock, offered only once the computer is there. */
export const P8 = {
  tag: 'REAL RIG',
  /** Connection verified · FM3 — and it has been, before this is drawn. */
  verified: (unit) => `Connection verified  ·  ${unit}`,
  eyebrow: 'CONTROL MY REAL RIG',
  head: (price) => `${price || FALLBACK_PRICE} one-time`,
  sub: 'One payment. Every device you own. Every future update. Every supported unit.',
  gets: [
    { key: 'presets', label: 'PRESETS', body: 'Scenes and blocks' },
    { key: 'perform', label: 'PERFORM', body: 'Tuner, tap tempo and setlists' },
    { key: 'hardware', label: 'HARDWARE', body: 'FM3, FM9, Axe-Fx III, AM4, VP4' }
  ],
  go: (price) => `Unlock real-rig control  ·  ${price || FALLBACK_PRICE}`,
  restore: 'Restore purchase',
  keep: 'Keep using the free demo',
  foot: 'Changes are live. Permanent preset saving stays on the computer.'
}

/** P9 — connected, and the same three things the computer says. */
export const P9 = {
  /** FM3 · ONLINE */
  tag: (unit) => `${unit} · ONLINE`,
  head: 'You’re connected.',
  /** FM3 · 8 scenes · through your computer */
  status: ({ unit, scenes }) =>
    [unit, scenes ? `${scenes} scenes` : null, 'through your computer'].filter(Boolean).join('  ·  '),
  tips: [
    { key: 'play', label: 'PLAY', body: 'Fast controls for performing.' },
    { key: 'edit', label: 'EDIT', body: 'Your full signal chain.' },
    { key: 'save', label: 'SAVE', body: 'Changes are live now. Save permanently on the computer.' }
  ],
  go: 'Open Play',
  foot: 'Replay this anytime in Settings → Show the walkthrough.'
}

/** What Settings calls the way back in, on both ends. */
export const REPLAY = 'Show the walkthrough'

/*
 * The way out of a walkthrough somebody is only LOOKING at.
 *
 * "I'm signed in and went to settings to restart the tutorial to get the
 * screenshots. Now my only option is to start the demo again."
 *
 * Replaying it is not a first run. Every button on these screens is there to
 * get somebody set up, and somebody already set up needs none of them — they
 * need the door. New wording, mine, and he can change it.
 */
export const CLOSE = 'Close the walkthrough'
