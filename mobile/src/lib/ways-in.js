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
 * FOUR ROUTES AND ALL FOUR EXIST NOW, which is new. The page was written when
 * only the Mac app was real, and each route carries a `status` for exactly
 * that reason — so nobody is sent looking for a download that was never built.
 * The Windows app and the two one-line helpers have since been built, so what
 * is left is the honest difference between them: the Mac app is signed by
 * Apple and opens without argument, the Windows app is not signed yet and
 * Windows says so in a blue box, and the terminal route builds the server from
 * source and asks real effort of you.
 *
 * NO COMMANDS ARE INVENTED HERE. The one-liners below are the two setup
 * scripts in `public/`, served from the app's own domain, and they are the
 * same two commands written at the top of those files. If one of them moves,
 * a test fails.
 *
 * AND BOTH TERMINAL ROUTES NEED A TOKEN, which is the part that has to be said
 * before somebody pastes a line and watches it stop. They fetch three private
 * repositories — the app and the two projects the device server is made of —
 * so there is no tokenless version of this route, and a page that did not say
 * so up front would be sending people at a wall.
 */

/*
 * The list, not `/releases/latest`.
 *
 * `/latest` means "the newest release of any kind", and this repository also
 * publishes an Android build on nearly every merge — so the download link
 * aimed at the Mac app landed on an .apk. The list page shows all of them with
 * their names, and the step below says which file to take.
 */
export const RELEASES = 'https://github.com/justinnewbold/fractal-ai-builder/releases'
export const FORGEFX = 'https://github.com/sKuhLight/ForgeFX'
export const CODEC = 'https://github.com/sKuhLight/forgefx-midi'

/*
 * Served from the app's own domain rather than from raw.githubusercontent.
 *
 * Both files live in `public/`, which Vite copies to the root of the deployed
 * site, so these are short enough to read down a phone to somebody and they do
 * not go stale when a branch is renamed.
 */
const SITE = 'https://fractal.newbold.cloud'
export const HELPER_SH = `curl -fsSL ${SITE}/mac.sh | bash`
export const HELPER_PS1 = `irm ${SITE}/windows.ps1 | iex`

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
      'On the Mac, open the download page below and take the newest file ending in .dmg.',
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
    status: 'ready',
    note: 'Ready now — Windows will warn about it, and that is expected',
    steps: [
      'On the PC, open the download page below and take the newest file ending in .exe.',
      'Open it. Windows shows a blue box that says "Windows protected your PC" — click More info, then Run anyway. It says that because the installer is not signed yet, not because anything is wrong with it.',
      'Plug your unit into the PC with its USB cable.',
      'Quit any Fractal editor if one is open. Only one program can hold the USB port, and whichever got there first keeps it.',
      'The first time it starts its server, Windows asks whether to allow it through the firewall. Say yes, or your phone cannot reach this computer over wifi.',
      'In the app, choose Set up phone remote, and type the code it shows into your phone. Same as the Mac — no account needed.'
    ],
    links: [{ label: 'Download Fractal Remote for Windows', url: RELEASES }]
  },
  {
    id: 'mac-terminal',
    os: 'mac',
    title: 'ForgeFX in a terminal, on a Mac',
    status: 'manual',
    note: 'Works today, and is properly technical',
    /*
     * The line to paste, named as well as listed.
     *
     * It appears in `steps` because that is where it belongs in the reading
     * order — after "open Terminal", before "it downloads". It appears here
     * too so both screens can tell that one step apart from the prose around
     * it and draw it as something you copy rather than something you read.
     * Matching on `steps.includes(way.command)` rather than on what the text
     * looks like: a guess about which lines are commands would eventually
     * dress a sentence up as one.
     */
    command: HELPER_SH,
    steps: [
      'Only worth doing if you do not want the Mac app. The app carries this same server inside it and sets it up for you. This is also the only route a Linux machine has.',
      'It needs git, Node 20, and a GitHub token that can read the project — the repositories are private, so ask Justin for one. Then open Terminal and paste both lines:',
      'export FORGEFX_TOKEN="the-token"',
      HELPER_SH,
      'It fetches the app and the two projects the device server is made of, builds them, and starts everything. The first run takes a few minutes; after that it is quick.',
      'It finishes by printing a QR code. Scan it with your phone on the same wifi — no account, nothing to sign into, same as the Mac app.',
      'macOS asks whether to let node accept incoming connections the first time. Say yes, or the phone cannot reach this machine.',
      'Everything lands in ~/src, and running the same line again updates it rather than starting over.'
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
    note: 'Works today, and skips the installer entirely',
    command: HELPER_PS1,
    steps: [
      'Only worth doing if you would rather not install the Windows app. The app carries this same server inside it and sets it up for you.',
      'It needs git, Node 20, and a GitHub token that can read the project — the repositories are private, so ask Justin for one. Then open PowerShell and paste both lines:',
      '$env:FORGEFX_TOKEN = "the-token"',
      HELPER_PS1,
      'It fetches the app and the two projects the device server is made of, builds them, and starts everything. The first run takes a few minutes; after that it is quick.',
      'It finishes by printing a QR code. Scan it with your phone on the same wifi — no account, nothing to sign into, same as the apps.',
      'Windows will ask whether to let node through the firewall. Say yes, or the phone cannot reach this PC over wifi.',
      'Everything lands in your user folder under src, and running the same lines again updates it rather than starting over.'
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
   * that opens by telling you it cannot help you. Both Windows routes work
   * now, so the sort no longer changes their order — it stays because the
   * next route to be written will start out `planned` too, and the page
   * should not open on it.
   */
  const works = (w) => (w.status === 'planned' ? 1 : 0)
  const mine = WAYS.filter((w) => w.os === os).sort((a, b) => works(a) - works(b))
  return [...mine, ...WAYS.filter((w) => w.os !== os)]
}
