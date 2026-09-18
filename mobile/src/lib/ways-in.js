/* Generated from shared/ways-in.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * How to get a computer on the other end of this, and what each route costs.
 *
 * "We also need to make instructions that teach people how to connect by
 * either downloading the Mac app, installing forgefx with a helper file for
 * terminal or a windows app (after we build those ones later)."
 *
 * WHAT THIS IS FOR is the person holding a phone that says NO COMPUTER, who
 * has no idea a computer was ever part of the arrangement. Nothing in the app
 * said so: the sign-in screen asked for a code "your computer shows" and there
 * was no way from there to find out which computer, or how to make one show
 * anything.
 *
 * FOUR ROUTES, AND ONE OF THEM EXISTS TODAY, which is the whole reason this is
 * written the way it is. The Mac app is real and downloadable now. Running
 * ForgeFX by hand is real and genuinely technical, and is the only thing a
 * Windows or Linux machine can do until the apps are built. The Windows app is
 * not written, and neither are the one-line helpers. A page that dressed all
 * four up as equals would send somebody looking for a download that does not
 * exist, so each one carries its own `status` and says plainly where it
 * stands.
 *
 * NO COMMANDS ARE INVENTED HERE. The terminal routes name the two repositories
 * and the Node version they need, because those are true. There is no
 * one-line installer yet, and saying so is better than printing a command that
 * does not work on the other end of somebody's evening.
 */

export const RELEASES = 'https://github.com/justinnewbold/fractal-ai-builder/releases/latest'
export const FORGEFX = 'https://github.com/sKuhLight/ForgeFX'
export const CODEC = 'https://github.com/sKuhLight/forgefx-midi'

/**
 * `ready` is a thing you can download and run today.
 * `manual` works today and asks real technical effort of you.
 * `planned` does not exist — say so, and say what to do instead.
 */
export const WAYS = [
  {
    id: 'mac-app',
    os: 'mac',
    title: 'The Mac app',
    status: 'ready',
    note: 'Ready now — this is the easy one',
    steps: [
      'On the Mac, open the download page below and get the latest Fractal Remote.',
      'Drag it to Applications and open it.',
      'Plug your unit into the Mac with its USB cable.',
      'Quit FM3-Edit or Axe-Edit if either is open. Only one program can hold the USB port, and whichever got there first keeps it.',
      'In the app, choose Set up phone remote. It shows a short code and a QR you can scan.',
      'On your phone, scan that QR with Scan a code — or type the code in. That is the whole of it — no account needed.'
    ],
    links: [{ label: 'Download Fractal Remote for Mac', url: RELEASES }]
  },
  {
    id: 'windows-app',
    os: 'windows',
    title: 'The Windows app',
    status: 'planned',
    note: 'Not built yet',
    steps: [
      'There is no Windows app to download at the moment.',
      'When there is, it will be the same handful of steps as the Mac one: install it, plug the unit in, and type the code it shows on your phone.',
      'Until then, a Windows machine can run ForgeFX itself — below.'
    ],
    links: []
  },
  {
    id: 'mac-terminal',
    os: 'mac',
    title: 'ForgeFX in a terminal, on a Mac',
    status: 'manual',
    note: 'Works today, and is properly technical',
    steps: [
      'Only worth doing if you do not want the Mac app. The app carries this same server inside it and sets it up for you.',
      'It needs Node 20 installed, and two repositories checked out next to each other: ForgeFX, and the codec it depends on.',
      'Build the codec first, then start the server inside ForgeFX. It listens on port 5056 on that machine.',
      'With it running and the unit plugged in, sign in on your phone with the same account and it will find it.',
      'There is no one-file installer for this yet. When there is, it will be here.'
    ],
    links: [
      { label: 'ForgeFX', url: FORGEFX },
      { label: 'forgefx-midi (the codec)', url: CODEC }
    ]
  },
  {
    id: 'windows-terminal',
    os: 'windows',
    title: 'ForgeFX in a terminal, on Windows',
    status: 'manual',
    note: 'The only thing a Windows machine can do today',
    steps: [
      'ForgeFX is the part that actually talks to the unit, and it runs anywhere Node does.',
      'It needs Node 20 installed, and two repositories checked out next to each other: ForgeFX, and the codec it depends on.',
      'Build the codec first, then start the server inside ForgeFX. It listens on port 5056 on that machine.',
      'Windows will ask whether to let it through the firewall the first time. Say yes, or the phone cannot reach it over wifi.',
      'With it running and the unit plugged in, sign in on your phone with the same account and it will find it.',
      'There is no one-file installer for this yet. When there is, it will be here.'
    ],
    links: [
      { label: 'ForgeFX', url: FORGEFX },
      { label: 'forgefx-midi (the codec)', url: CODEC }
    ]
  }
]

export const wayById = (id) => WAYS.find((w) => w.id === id) || null

/**
 * Which computer this browser is running on.
 *
 * TAKES THE USER AGENT RATHER THAN REACHING FOR ONE. This module is bundled by
 * the phone app, and a phone has no `navigator.userAgent` to read — a module
 * that names it bundles, installs, and throws the first time that line runs.
 * The browser passes its own; the phone never calls this at all, for the
 * reason in `waysFor`.
 *
 * `null` for anything it cannot place, which includes every phone — and that
 * is the important case, not an edge one.
 */
export function osGuess(ua = '') {
  const s = String(ua || '')
  if (/Windows NT|Win64|WOW64/i.test(s)) return 'windows'
  /* iPhone and iPad first: an iPad's user agent says Macintosh. */
  if (/iPhone|iPad|iPod|Android/i.test(s)) return null
  if (/Macintosh|Mac OS X/i.test(s)) return 'mac'
  return null
}

/**
 * The routes, with the ones for this computer first.
 *
 * AND ON A PHONE, NOTHING IS REORDERED, which is the part worth being careful
 * about. This page is about which COMPUTER somebody is going to plug their
 * unit into. In a browser that question is answered by the browser itself —
 * you are reading this on the machine in question. On a handset it is not:
 * knowing the app is running on an iPhone says nothing about whether there is
 * a Mac or a PC on the desk, and putting the Mac routes first because somebody
 * owns an iPhone would be a guess dressed as an answer.
 *
 * So `os` of null leaves the order alone, and the order it leaves alone opens
 * on the one route that exists today.
 */
export function waysFor(os = null) {
  if (!os) return WAYS.slice()
  /*
   * And within this computer's own routes, the ones that WORK come first.
   *
   * Sorting on the operating system alone put "The Windows app — not built
   * yet" at the top of the page for every Windows visitor, which is a page
   * that opens by telling you it cannot help you. The thing they can actually
   * do today goes first; the one that does not exist keeps its place in the
   * list, because "when will there be a Windows app" is a real question and
   * silence is a worse answer than "not yet".
   */
  const works = (w) => (w.status === 'planned' ? 1 : 0)
  const mine = WAYS.filter((w) => w.os === os).sort((a, b) => works(a) - works(b))
  return [...mine, ...WAYS.filter((w) => w.os !== os)]
}
