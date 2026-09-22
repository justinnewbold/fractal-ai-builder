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
  /* Was "No account required. Scan one code and you're connected." Both
     halves stopped being true on the same day: there is no code to scan, and
     an account is now what joins the two ends. MY WORDING. */
  sub: 'Sign in on this computer and on the phone, and they find each other.',
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

/** D4 — the QR code, the pairing code, and the wait. */
export const D4 = {
  step: 'STEP 3 OF 3',
  /* Was "Scan this code with your phone." and a note reading "No account
     required." The QR code and the pairing code are both gone, and an
     account is the only way the two ends find each other. MY WORDING. */
  head: 'Sign in on this computer.',
  sub: 'Then sign in on the phone with the same account, and it becomes the remote for the unit here.',
  waiting: 'Waiting for your phone…',
  note: 'An account is what joins the two. The demo and this computer app are both free without one.',
  noApp: 'I don’t have the app',
  skip: 'Skip for now',
  /*
   * NEW WORDING, MINE, from what he said this screen should say: "it's fine
   * if the Mac says, if you've purchased this, go ahead and scan the QR code."
   *
   * The computer cannot check — the purchase lives on the phone's App Store
   * account and nothing here can see it. So this states the condition and the
   * PHONE is what actually answers it, which is the other half of the same
   * sentence: "the phone needs to be able to tell, hey, you did not unlock
   * this, or yes, you did unlock it." It does, on the far side of the scan.
   *
   * Which is why this is worded as what to expect rather than as a warning.
   * Nothing here is being withheld, and somebody who has not bought it yet is
   * not doing anything wrong by scanning.
   */
  owned: 'If you’ve bought the phone app, sign in on it with this same account and it will connect. The phone checks — it will say so if it isn’t unlocked yet.'
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
  /* Was "I already have a pairing code". Codes are gone — "I want the QR
     code gone and the scanner gone" — so the person this is for is the one
     who has been here before and has an account. MY WORDING. */
  haveCode: 'I already have an account'
}

/** P2 — the same three boxes, down a phone. */
export const P2 = {
  count: '1 OF 2',
  eyebrow: 'ONE SIMPLE PATH',
  head: 'Your phone talks to your computer.',
  /* MINE, from his mockup. The three boxes underneath are the answer to "what
     are the pieces"; this says how many there are before somebody counts. */
  sub: 'Three pieces. One powerful connection.',
  foot: 'No computer yet? Try a simulated unit free, with no time limit.',
  go: 'Got it'
}

/** P3 — demo or real rig. */
/*
 * P3 — the two ways in, and nothing else.
 *
 * "How do we verify their computer connects before purchasing? Didn't know
 * we built that. If we don't actually do that then remove it. Also remove
 * the text to the bottom that says free forever. And the text at top that
 * says free. And remove the text that says where do you want to start."
 *
 * FOUR LINES GONE, and one of them was my fault.
 *
 *   'We verify the computer connection before purchase.' — we DID. The
 *   walkthrough paired with a code, said "Connection verified", and offered
 *   the unlock on the strength of it. When the codes went out, pairing left
 *   the walkthrough and that step became unreachable, so it was removed. This
 *   line was left behind describing a thing the app no longer does.
 *
 *   'WHERE DO YOU WANT TO START?' — the two cards under it say what they
 *   are. A heading that asks the question the screen already is, is a line
 *   spent on nothing.
 *
 *   'FREE' — the card says "Start free demo" and the eyebrow says EXPLORE
 *   THE APP. Three labels on one card, two of them saying the same thing.
 *
 *   'The demo stays free forever.' — said again at the bottom of a screen
 *   whose first card already says free twice.
 *
 * What is left is the two choices, the way back for somebody who has paid,
 * and the way in for somebody with an account.
 */
export const P3 = {
  count: '2 OF 2',
  demo: {
    eyebrow: 'EXPLORE THE APP',
    title: 'Try the demo',
    body: 'Use a simulated Fractal unit. Every screen works. No computer needed.',
    go: 'Start free demo'
  },
  real: {
    eyebrow: 'CONTROL YOUR HARDWARE',
    title: 'Connect my real rig',
    /*
     * "Have the button just say 'Unlock'."
     *
     * It read "Set up  ·  $9.99 once", which put a price on a button that
     * takes no money: pressing it opens the computer-app step, and the
     * charge happens later at the paywall where the store's own sheet
     * quotes the price. A price here reads as a till, two screens early.
     *
     * So this is the only card label in the walkthrough that is a plain
     * string rather than a function of the store's price. The price still
     * belongs on P8, which IS the paywall.
     */
    go: 'Unlock'
  },
  restore: 'Already bought it? Restore purchase'
}

/** P4 — which unit the demo pretends to be. */
export const P4 = {
  tag: 'DEMO',
  eyebrow: 'PICK YOUR HARDWARE',
  head: 'Which unit should we simulate?',
  sub: 'Real models and parameter ranges. Change this any time.',
  /** Play with FM3 — named by whichever is chosen. */
  go: (unit) => `Play with ${unit}`,
  /*
   * NEW WORDING, MINE. This screen was a one-way door: every button on it
   * chose a unit and the only way forward started the demo, so somebody who
   * got here and then decided they would rather connect their real rig had
   * to go INTO the demo and back out through Setup to do it. In a
   * walkthrough that is a trap. Justin can change this line.
   */
  back: 'Back'
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
  /*
   * WAS "Yes - show me the scanner", and there is no scanner.
   *
   * "I want the QR code gone and the scanner gone."
   *
   * The camera went with the QR code, and this button was left promising
   * one. It has opened the sign-in screen ever since, because an account is
   * the only way to join a phone to a computer now, so the label says that.
   * MY WORDING. The plain hyphen matches the rest of his lines.
   */
  yes: 'Yes - sign in to connect',
  notYet: 'NOT YET  ·  THE COMPUTER APP IS FREE',
  platforms: [
    { key: 'mac', badge: 'M', label: 'MAC', go: 'Send link' },
    { key: 'windows', badge: 'W', label: 'WINDOWS', go: 'Send link' },
    { key: 'linux', badge: 'L', label: 'LINUX', go: 'Send link' }
  ],
  foot: 'We’ll email or text the download link so you can open it on the computer.',
  back: 'Back to the free demo',
  /*
   * NEW WORDING, MINE.
   *
   * "This needs to be crystal clear that to download this, you have to be
   * from your computer. It does ask for an email, but it's not very clear. It
   * just says download when you click on it. And it tries downloading it on
   * the phone."
   *
   * The address was a BUTTON on the phone, so tapping it opened the downloads
   * page on the handset and started fetching a Mac installer onto a phone
   * that can do nothing with it. It is an address to type somewhere else, so
   * it is printed rather than pressed now, and this line says where.
   */
  address: 'TYPE THIS ON YOUR COMPUTER · NOT ON THIS PHONE',
  emailLabel: 'OR HAVE THE LINK SENT TO YOU'
}

/**
 * P7 — what is left of the pairing step.
 *
 * "I want the QR code gone and the scanner gone. It has never worked once.
 * Every time I've ever tried it, you tell me something different."
 *
 * The screen this named is gone: the camera, the QR code, the eight-character
 * box and the Connect button under it. Only the one line survives, because
 * three other screens point at the same action with it and one phrase for one
 * thing is how they stay from drifting apart.
 */
export const P7 = {
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
    /*
     * CHANGED FROM THE PDF, because what it said stopped being true.
     *
     * It read "Changes are live now. Save permanently on the computer." —
     * and it was right when it was written: the computer refused a slot
     * write from a handset, on purpose.
     *
     * "All changes made on the phone can be saved, and should be able to be
     * saved to the unit."
     *
     * They can, and they are. The phone asks the computer to write the slot,
     * the computer writes it, and the phone is told the moment it lands. So
     * the tip named a limit the app has not had for a while, on the screen a
     * new person reads first. MY WORDING for the replacement.
     */
    { key: 'save', label: 'SAVE', body: 'Changes are live. Save writes them into the slot on your unit.' }
  ],
  go: 'Open Play',
  foot: 'Replay this anytime in Settings → Show the walkthrough.',
  /*
   * THE SAME LAST SCREEN, FOR SOMEBODY WHO CHOSE THE DEMO.
   *
   * "When I did a fresh app install, not logged in, there's no tutorial,
   * nothing. So it just brings up the screen. This is a new user trying it
   * out. Not a very good experience."
   *
   * Right, and the screen that would have fixed it was already written — this
   * one. PLAY, EDIT and SAVE in three lines. It was only ever reached after a
   * real pairing, so the person most likely to need it, somebody who has
   * never seen the app at all, was the one person who never got it.
   *
   * The tips are his and are reused word for word. These two lines are mine,
   * because the ones above them say "You're connected" and name a computer,
   * and in the demo there is no computer and nothing is connected.
   */
  demo: {
    head: 'Here’s the app.',
    /** FM3 · simulated */
    status: (unit) => `${unit}  ·  simulated`
  }
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
