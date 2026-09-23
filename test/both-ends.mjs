/**
 * The same app at both ends, or a written reason why not.
 *
 * There are four things you can install and two sets of screens. The Mac app
 * loads the browser's own build, so it cannot drift from the web by
 * construction, and one Expo project builds both phones, so those two cannot
 * drift from each other. What is left is the real seam: `src/` and `mobile/`,
 * two screens written by hand for the same rig.
 *
 * Nothing used to watch that seam. The chain editor was fixed on the phone in
 * 7.311.0 and did not reach the browser until 7.320.0 — nine versions of a
 * screen that existed on one end and not the other, with nothing failing, and
 * the only way anyone found out was by opening the app and not seeing it.
 *
 * So: every button either exists at both ends, or is written down here with the
 * reason it does not. A new button on one side fails this test until somebody
 * says which it is. That is the whole mechanism — it does not decide anything,
 * it refuses to let the decision go unmade.
 *
 * WHAT IT CANNOT SEE, deliberately. A label built out of a variable is skipped
 * rather than guessed at, and so is a busy caption ("Removing…"). An extractor
 * that cries wolf gets an allowlist that becomes a junk drawer, and then it is
 * worse than nothing. This one is quiet where it cannot read and loud where it
 * can, which covers the plain `Move` / `Add` / `Remove` that drift is made of.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/**
 * What counts as something a person taps: a short capitalised phrase.
 *
 * Three words at the outside. Anything longer is a sentence on a screen rather
 * than a button, and the app has plenty of those.
 */
const LOOKS_LIKE_A_BUTTON = /^[A-Z][A-Za-z’']*(?: [A-Za-z’'&]+){0,2}$/

const tidy = (s) => s.replace(/&rsquo;/g, '’').replace(/\s+/g, ' ').trim()

/** "Removing…" is the same button mid-press, not a second button. */
const isBusy = (s) => /…$/.test(s)

function wordsIn(text) {
  const out = new Set()
  const keep = (raw) => {
    const t = tidy(raw)
    if (!isBusy(t) && LOOKS_LIKE_A_BUTTON.test(t)) out.add(t)
  }
  for (const m of text.matchAll(/>([^<>{}]+)</g)) keep(m[1])
  for (const m of text.matchAll(/'([^']{1,24})'|"([^"]{1,24})"/g)) keep(m[1] ?? m[2])
  return out
}

/**
 * Where a `<button>`'s opening tag ends.
 *
 * Counted rather than searched for, because an attribute is full of the
 * character being looked for: `onClick={() => move(a, b)}` has three `>` in it
 * before the one that matters.
 */
function endOfOpeningTag(src, from) {
  let depth = 0
  let quote = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return -1
}

/**
 * What the browser's buttons say.
 *
 * Only what is between the tags. A `title` is a tooltip somebody has to hover
 * to read, which a phone has no way to show and no reason to match.
 */
export function webButtons(src) {
  const found = new Set()
  let i = 0
  while ((i = src.indexOf('<button', i)) !== -1) {
    const opened = endOfOpeningTag(src, i + 7)
    const closed = src.indexOf('</button>', i)
    if (opened === -1 || closed === -1) break
    for (const w of wordsIn(src.slice(opened, closed + 1))) found.add(w)
    i = closed + 9
  }
  return found
}

/**
 * The text of a `{...}` beginning at `open`, or null if it never closes.
 *
 * Quotes are tracked as well as depth, because a brace inside a string is not
 * a brace — and a label is one of the few places a `}` shows up in prose.
 */
function braced(src, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  return null
}

/**
 * What the phone's buttons say.
 *
 * `<Press label="Add" />` — the phone puts the word in an attribute because
 * the same string is read out by VoiceOver, so this reads the attribute.
 */
export function phoneButtons(src) {
  const found = new Set()
  /*
   * A caption is the small word ABOVE a button's label, and it is a word on
   * the button as surely as the label is — the Setlists button on the stage
   * screen is "Setlists" over the name of the list, and reading only the
   * label saw the name and missed what the button is for. Only literal
   * captions are read; the rest are a scene number or a block's name, which
   * are contents rather than words anybody wrote.
   */
  for (const m of src.matchAll(/\bcaption="([^"]{1,40})"/g)) {
    for (const w of wordsIn(`>${m[1]}<`)) found.add(w)
  }
  for (const m of src.matchAll(/\blabel=(?:"([^"]{1,40})"|\{)/g)) {
    if (m[1] !== undefined) {
      for (const w of wordsIn(`>${m[1]}<`)) found.add(w)
      continue
    }
    /*
     * The braces are counted rather than read up to the first `}`.
     *
     * A label built from a template — `` label={`${songs(l)} · tap to rename`} ``
     * — closes one brace early, and a scan that stops there carries on eating
     * the file. That is how "Empty", a word for a setlist with no songs in it
     * forty lines further down, arrived in the survey as a button the browser
     * was missing. Unbalanced is worse than unread: it invents findings.
     */
    const body = braced(src, m.index + m[0].length - 1)
    if (body !== null) for (const w of wordsIn(body)) found.add(w)
  }
  return found
}

export const buttonsIn = (side, files) => {
  const out = new Set()
  const pick = side === 'web' ? webButtons : phoneButtons
  for (const f of files) for (const w of pick(read(f))) out.add(w)
  return out
}

/**
 * Every button, what it does, and what each end calls it.
 *
 * A one-sided button is not a bug — the phone is a stage remote and the
 * browser is where you sit down and build a tone, and plenty of things
 * belong at one end only. What was missing is anybody writing that down. So
 * an entry with `phone: null` or `web: null` has to carry a `why`, and the
 * `why` is allowed to be "only in the browser" where that is the honest state
 * of it. The list is then a list of the open questions, which is worth having
 * on its own.
 *
 * `unreadable` marks an end where the word is built out of a variable, so it
 * is here for a reader and not checked against the file. `also` is the other
 * words the same control shows — a toggle's second face, a tab pair.
 *
 * `notButtons` names words that sit inside a button and are not its label —
 * `{entry.name || 'Untitled'}` is what an unnamed preset is CALLED in the row
 * you press. The obvious rule for those, a literal after `||`, was written
 * first and immediately ate `{copied || 'Share as file'}`, an ordinary
 * button's ordinary label. The two shapes are identical and nothing around
 * them tells them apart, so they are named instead: a list cannot quietly
 * swallow a button the way a clever rule can. For a check whose whole job is
 * noticing what went missing, a silent miss is the failure that matters.
 *
 * Per area rather than global, because the same word is a name in one place
 * and a button in another: "Empty" is what an empty preset slot is called in
 * the list, and it is the empty chain slot you press in the editor.
 */
export const AREAS = [
  {
    area: 'the chain and block editor',
    web: ['src/components/GridEditor.jsx', 'src/components/Modifiers.jsx'],
    phone: ['mobile/src/screens/Edit.js'],
    buttons: [
      { does: 'put a new block in an empty slot', web: 'Add', phone: 'Add', unreadable: ['web'] },
      {
        does: 'change which amp, cab or drive a block is',
        web: null,
        phone: 'Model',
        why: 'only on the phone — the browser edits a block\u2019s controls but has no model picker at all, so an amp on the browser is whatever the unit was already set to'
      },
      {
        does: 'swap the block in a full slot for a different one',
        web: 'Replace',
        phone: null,
        unreadable: ['web'],
        why: 'the phone has Add and Remove and no single Replace — two taps for what the browser does in one'
      },
      { does: 'take a block out of the chain', web: 'Remove', phone: 'Remove' },
      {
        does: 'the empty slot you press to put something in it',
        web: 'Empty — tap to add',
        phone: 'Empty'
      },
      {
        does: 'move a block to another slot from a button',
        web: 'Move',
        phone: null,
        why: 'both ends drag a block by holding its ≡ grip; only the browser also keeps a Move button, for a mouse'
      },
      {
        does: 'abandon a move already started',
        web: 'Cancel move',
        phone: null,
        why: 'the browser’s Move starts a move that then waits for a target slot; a drag on the phone ends when the finger lifts, so there is nothing to abandon'
      },
      { does: 'close the block sheet without changing anything', web: 'Cancel', phone: 'Close' },
      {
        does: 'ask the unit for its block list again after that read failed',
        web: 'Try again',
        phone: null,
        why: 'only in the browser — nobody has decided whether the phone should offer it'
      },
      {
        does: 'build a starting chain on an empty preset',
        web: 'Starter chain',
        phone: null,
        why: 'only in the browser — nobody has decided whether the phone should offer it'
      },
      { does: 'attach a modifier to a control', web: 'Attach', phone: 'Attach' },
      {
        does: 'read what each scene holds for a modifier',
        web: 'Read scenes',
        phone: null,
        why: 'only in the browser — nobody has decided whether the phone should offer it'
      },
      {
        does: 'open the chain editor',
        web: null,
        phone: 'Edit chain',
        why: 'in the browser the chain is a section of the page under its own heading, so there is nothing to open'
      },
      {
        does: 'open the modifiers panel',
        web: null,
        phone: 'Modifiers',
        why: 'as above — a section of the page in the browser, a sheet on the phone'
      },
      {
        does: 'show whether a block is bypassed, and switch it',
        web: null,
        phone: 'Bypassed',
        also: ['Engaged'],
        why: 'the browser says a block’s on or off on the play screen instead, beside the block'
      },
      {
        does: 'put a control back where it was',
        web: null,
        phone: 'Undo',
        why: 'only on the phone — nobody has decided whether the browser should have it'
      },
      {
        does: 'leave the block editor',
        web: null,
        phone: 'Done',
        why: 'the browser’s editor is part of the page, so there is nothing to leave'
      },
      {
        does: 'switch between a block’s main controls and the rest of them',
        web: null,
        phone: 'Main',
        also: ['More'],
        why: 'a handset cannot show every control at once, so the phone splits them over two tabs; the browser shows them together'
      }
    ]
  },
  {
    area: 'the play screen',
    web: ['src/components/Gig.jsx'],
    phone: ['mobile/src/screens/Stage.js'],
    buttons: [
      { does: 'open the block editor', web: 'Edit', phone: 'Edit' },
      { does: 'tap a tempo in', web: 'Tap Tempo', phone: 'Tap Tempo' },
      {
        does: 'turn the tuner on and off',
        web: 'Tuner',
        phone: 'Tuner',
        also: ['Stop tuner']
      },
      { does: 'ask the app for a tone', web: 'Ask', phone: '✦ Tone', unreadable: ['phone'] },
      {
        does: 'step to the preset before this one',
        /* The word is the same at both ends; only the arrow differs. The
           browser draws its chevron as a character in the label — "‹ Previous"
           — and the phone draws it as a picture beside the label, cut from
           Justin's own mockup of this screen. So the browser's copy never
           matches this scanner's idea of a button name and the phone's now
           does, which is the whole of the difference recorded here. */
        web: '‹ Previous',
        phone: 'Previous'
      },
      {
        does: 'step to the preset after this one',
        web: 'Next ›',
        phone: 'Next'
      },
      {
        does: 'choose what Previous and Next step through',
        /* Both ends name the button after the list it is stepping through, and
           both say "All" when that is every preset on the unit. */
        web: 'All',
        phone: 'All'
      },
      {
        does: 'the word "Setlists" above that button',
        web: 'Setlists',
        phone: 'Setlists'
      },
      {
        does: 'show whether a block is bypassed',
        web: 'On',
        also: ['Off'],
        phone: null,
        why: 'the phone’s block tile carries the block’s short name and its channel, with no on/off word'
      },
      {
        does: 'ask the unit for its block list again after that read failed',
        web: 'Try again',
        phone: null,
        why: 'only in the browser — nobody has decided whether the phone should offer it'
      }
    ]
  },
  {
    /*
     * The one place a survey of this went wrong, and worth saying why.
     *
     * The browser has a button that says "Star this preset"; the phone stars
     * from an icon whose label is built out of the preset's name, and an
     * earlier pass read that as a phone with no way to star anything. It has
     * had one all along. So every entry below was checked against the other
     * end's whole app rather than the one file that looked like its opposite
     * number — which is also why the file lists here are lists.
     */
    area: 'the setlists and the preset list',
    /* CloudPresets.jsx and Recent.jsx were here too. Both held the library of
       tones the AI had made, and went with it. */
    web: ['src/components/Setlists.jsx'],
    phone: ['mobile/src/screens/Setlists.js', 'mobile/src/screens/Presets.js'],
    notButtons: {
      Empty: 'what an empty slot is called in the list — the chain editor’s Empty IS a button, which is why this is per area'
    },
    buttons: [
      {
        does: 'make a preset one of the starred ones',
        web: 'Star this preset',
        also: ['Starred', 'Star', 'Unstar'],
        phone: 'Star',
        /* The phone's says "Star <name>" / "Unstar <name>" — the same button,
           named after what it is about to star, because on a list of forty
           rows a button that only says "Star" says nothing about which. */
        unreadable: ['web']
      },
      {
        does: 'take a preset out of the list it is in',
        /* The browser's used to be a bare "Remove", on the library of tones the
           AI had made. That list went with the AI; what is left is the setlist
           row, which names what it is about to remove exactly as the phone
           does — on a list of forty rows a button that only says "Remove" says
           nothing about which. */
        web: 'Remove <name> from <setlist>',
        phone: 'Remove <name>',
        unreadable: ['web', 'phone']
      },
      {
        does: 'move a song up or down the running order',
        web: 'Move <name> — hold and drag, or use the arrow keys',
        phone: 'Drag <name>',
        unreadable: ['web', 'phone'],
        why: 'the same grip and the same gesture at both ends; the browser also answers the arrow keys, because a grip that only takes a pointer takes the running order away from anybody driving it with a keyboard, which is not a thing a phone has'
      },
      {
        does: 'read the preset list off the unit again',
        web: null,
        phone: 'Refresh',
        why: 'the browser re-reads the list by itself, on opening it and after every change; the phone offers it by hand as well, for a list that went stale in a pocket'
      },
      {
        does: 'close the setlist sheet',
        web: null,
        phone: 'Done',
        also: ['Done adding'],
        why: 'setlists are a page in the browser, with nothing to close'
      }
    ]
  },
  {
    /*
     * These three words were two different sets of words until 7.325.0 — the
     * browser said Copy log and Clear, the phone said Copy the log and Clear
     * the log, and the account button said Create account in one place, Create
     * an account in another and Make an account on the phone. Nothing was
     * broken by it and nobody was confused, but the log is the thing you are
     * told to press when something has gone wrong, and being told to press a
     * button by a name it does not have is a bad moment to have on a stage.
     * They are one set of words now, and this is what keeps them one.
     */
    area: 'the log',
    web: ['src/components/DebugLog.jsx'],
    phone: ['mobile/src/screens/Log.js'],
    buttons: [
      { does: 'put the whole log on the clipboard', web: 'Copy Logs', phone: 'Copy Logs' },
      { does: 'throw the log away', web: 'Clear Logs', phone: 'Clear Logs' },
      {
        does: 'hand the log over as a file instead of a paste',
        web: 'Share as file',
        phone: null,
        why: 'only in the browser — the log is capped at 400 lines, which pastes into a chat whole, so the phone has never needed it'
      },
      {
        does: 'close the log',
        web: null,
        phone: 'Done',
        why: 'the browser’s log is a panel in the settings page, with nothing to close'
      }
    ]
  },
  {
    area: 'getting connected and signed in',
    web: ['src/components/ConnectScreen.jsx', 'src/components/SignIn.jsx', 'src/components/SignInSheet.jsx'],
    phone: ['mobile/src/screens/Connect.js', 'mobile/src/screens/SignIn.js'],
    buttons: [
      {
        does: 'make a new account',
        /*
         * At both ends now. It was the phone only — "do not allow an account
         * to be created on any of the desktop or the web app version" — until
         * the browser could sell the unlock: "somebody should be able to
         * create an account on the web and desktops, and make purchases as
         * well." The same two words at both ends.
         */
        web: 'Create Account',
        phone: 'Create Account'
      },
      { does: 'sign in to an account you have', web: 'Sign in', phone: 'Sign in' },
      {
        does: 'email yourself the computer download link',
        web: null,
        phone: 'Send link',
        /*
         * "A phone can't download desktop software, it also isn't suppose to
         * go to GitHub directly." So the phone's answer to "how do I connect
         * a computer" is the address to type there, or this — the link sent
         * somewhere the computer can open it. A browser running ON the
         * computer needs neither: it links straight to the downloads page.
         */
        why: 'the browser is already on a computer that can open the link'
      },
      {
        does: 'connect with the account this device already remembers',
        web: 'Connect',
        phone: null,
        /* The browser's connect screen remembers a signed-in account and
           offers to rejoin with it. The phone does that without asking: a
           session it already holds goes straight to the rig. */
        why: 'a phone with a session rejoins on its own rather than offering a button'
      },
      {
        does: 'join the computer with a pairing code',
        web: null,
        phone: null,
        /* "I want the QR code gone and the scanner gone. It has never worked
           once." Signing in on both ends is the pairing now. */
        why: 'there are no pairing codes at either end any more'
      },
      {
        does: 'send yourself a password reset',
        web: 'Forgot password?',
        phone: 'Forgot password',
        /* The browser's carries a question mark because it sits in a row of
           links; the phone's is a button and does not ask. */
        unreadable: ['web']
      },
      {
        does: 'find out how to get a computer on the other end',
        web: 'Set up phone remote',
        phone: 'Connect my computer',
        why: 'the browser says it from the computer being set up, the phone from the end that needs one — "Change how to connect computer to Connect my computer", which is the phone saying what pressing it gets you rather than asking a question on your behalf'
      },
      {
        does: 'look around without a rig',
        /* Both ends say it the same way now. "Change just looking to just Try
           the Demo - no text underneath" was carried out on the phone and not
           here, so the browser went on asking "Just looking?" with the offer
           tucked into the sentence as a chip. It is a button under the primary
           at both ends. */
        web: 'Try the Demo',
        also: ['Try now', 'Go'],
        phone: 'Try the Demo',
        why: 'the same offer at both ends, in the same three words; the browser also says Try now on the not-connected screen and Go beside the code box, neither of which the phone has a place for'
      },
      {
        does: 'choose which of the five Fractals the demo is',
        web: 'Demo Unit',
        phone: 'Demo Unit',
        unreadable: ['web', 'phone'],
        why: 'both ends now say "Demo Unit" — it was "Which unit the demo is" at both, which is a sentence rather than a label and read as one in a list of two-word rows. NEITHER end is readable from here: the browser says it as a Setup row in App.jsx and the phone as a sheet title in components/DemoUnit.js, and this area scans the connect and sign-in screens at both ends. The old wording was five words, so LOOKS_LIKE_A_BUTTON never matched it and the check skipped itself silently; the new one is two words and matches, which is how the gap showed up at all.'
      },
      {
        does: 'read the pairing code off the computer’s screen with the camera',
        web: null,
        phone: null,
        /* "I want the QR code gone and the scanner gone. It has never worked
           once. Every time I've ever tried it, you tell me something
           different." The camera, the QR code and the code box all went
           together; signing in on both ends is the pairing now. */
        why: 'there is no camera and no code to read at either end any more'
      },
      {
        does: 'close the sign-in sheet',
        web: null,
        phone: 'Done',
        why: 'signing in is a page in the browser, with nothing to close'
      }
    ]
  }
]

/** Every word an entry accounts for, whichever end it is at. */
const covered = (b) => [b.web, b.phone, ...(b.also || [])].filter((w) => typeof w === 'string')

export function run(test) {
  for (const area of AREAS) {
    const notButtons = area.notButtons || {}
    const drop = (words) => new Set([...words].filter((w) => !(w in notButtons)))
    const ends = {
      web: drop(buttonsIn('web', area.web)),
      phone: drop(buttonsIn('phone', area.phone))
    }

    /* A name that stopped appearing is an excuse nobody needs any more, and
       left alone it would go on excusing a button that arrived later under the
       same word. */
    test(`nothing on ${area.area} is excused that is not there`, () => {
      const raw = new Set([...buttonsIn('web', area.web), ...buttonsIn('phone', area.phone)])
      for (const word of Object.keys(notButtons)) {
        assert.ok(
          raw.has(word),
          `"${word}" is listed under notButtons for ${area.area} and no longer appears there. ` +
            'Take it out of AREAS in test/both-ends.mjs.'
        )
      }
    })

    test(`every button on ${area.area} is at both ends or written down`, () => {
      const named = new Set()
      for (const b of area.buttons) for (const w of covered(b)) named.add(w)
      for (const side of ['web', 'phone']) {
        for (const word of ends[side]) {
          assert.ok(
            named.has(word),
            `"${word}" is a button on ${area.area} in the ${side === 'web' ? 'browser' : 'phone'} app ` +
              'and is not in AREAS in test/both-ends.mjs. Add it there with what the other end calls it, ' +
              'or with the reason it is only at this one.'
          )
        }
      }
    })

    test(`a button ${area.area} lists at an end is still there`, () => {
      for (const b of area.buttons) {
        for (const side of ['web', 'phone']) {
          const word = b[side]
          if (typeof word !== 'string') continue
          if ((b.unreadable || []).includes(side)) continue
          if (!LOOKS_LIKE_A_BUTTON.test(word)) continue
          assert.ok(
            ends[side].has(word),
            `"${word}" — ${b.does} — is listed on ${area.area} in the ` +
              `${side === 'web' ? 'browser' : 'phone'} app and is not there any more. ` +
              'If it went on purpose, update AREAS in test/both-ends.mjs.'
          )
        }
      }
    })
  }

  test('a button at one end only says why', () => {
    for (const area of AREAS) {
      for (const b of area.buttons) {
        if (b.web !== null && b.phone !== null) continue
        assert.ok(
          b.why,
          `"${b.web || b.phone}" on ${area.area} is at one end only and no reason is written down. ` +
            'Put one in AREAS in test/both-ends.mjs — "only in the browser" is a fine answer, ' +
            'a blank is not.'
        )
      }
    }
  })
  /*
   * COLOUR MEANS THE SAME THING AT BOTH ENDS, or it means nothing.
   *
   * "The dot next to the unit name was changed to green a while back. Looks
   * like it didn't hit the web app. We need to be better at keeping all
   * versions of the app in sync with changes."
   *
   * The survey above walks both apps for the WORDS on their buttons, which is
   * why a rename cannot land at one end only. Colour had no such check, and
   * the lamp beside the unit name drifted for weeks: green on the phone, cyan
   * in the browser, for the same fact about the same rig. Cyan is not a
   * near-miss either — it is the colour that means "the computer is
   * answering", one link further back down the chain, so the browser was
   * quietly saying something different rather than something faded.
   *
   * Two checks, because there are two ways for this to go wrong. The palettes
   * can disagree about what a colour IS, and the lamps can disagree about
   * which colour a state GETS.
   */
  test('the two apps paint the same palette', () => {
    /*
     * mobile/src/lib/theme.js says in its own first paragraph that it is "the
     * same palette as the web app's :root, and for the same reason: nothing
     * is coloured for decoration". That was true when it was written and
     * nothing has ever held it true since.
     */
    const css = read('src/styles.css')
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    const cssVar = (name) => {
      const hit = root.match(new RegExp(`--${name}:\\s*([^;]+);`))
      return hit ? hit[1].trim().toLowerCase() : null
    }

    const theme = read('mobile/src/lib/theme.js')
    const dark = theme.slice(theme.indexOf('const DARK = {'), theme.indexOf('\n}', theme.indexOf('const DARK = {')))
    const phoneColour = (key) => {
      const hit = dark.match(new RegExp(`\\b${key}:\\s*'([^']+)'`))
      return hit ? hit[1].trim().toLowerCase() : null
    }

    /* The semantic four and the ink they sit on. Anything decorative is
       deliberately not here — the two apps are different shapes and are
       allowed to be. What has to match is what a colour MEANS. */
    for (const [phone, web] of [
      ['signal', 'signal'],
      ['live', 'live'],
      ['fault', 'fault'],
      ['ok', 'ok'],
      ['chassis', 'chassis'],
      ['panel', 'panel'],
      ['rule', 'rule'],
      ['silk', 'silk'],
      ['silkDim', 'silk-dim'],
      ['silkFaint', 'silk-faint']
    ]) {
      const a = phoneColour(phone)
      const b = cssVar(web)
      assert.ok(a, `the phone has no ${phone}`)
      assert.ok(b, `the browser has no --${web}`)
      assert.equal(a, b, `${phone} is ${a} on the phone and ${b} in the browser`)
    }
  })

  test('a lamp means the same thing at both ends', () => {
    /*
     * Three lamps in each app and two colours that are easy to confuse,
     * because they are next to each other in the chain: the COMPUTER
     * answering is cyan, the UNIT answering is green. A rig with a sleeping
     * computer and a rig with an unplugged FM3 are different evenings, and
     * the dot is the fastest way to tell which one you are having.
     */
    const lamp = read('mobile/src/components/Lamp.js')
    const css = read('src/styles.css')

    /* What the phone paints for each state — the FILL, not the halo. Read
       whole, the halo line's `color.okHalo` overwrites the fill's `color.ok`
       and the check then compares the wrong pair. */
    const fill = lamp.slice(lamp.indexOf('const fill ='), lamp.indexOf('const halo ='))
    assert.ok(fill.length > 40, 'the lamp was rewritten; this check reads its fill')
    const phone = Object.fromEntries(
      [...fill.matchAll(/state === '(\w+)' \? color\.(\w+)/g)].map((m) => [m[1], m[2]])
    )
    assert.equal(phone.good, 'ok', 'the phone no longer paints an answering unit green')
    assert.equal(phone.live, 'live', 'the phone no longer paints an answering computer cyan')
    assert.equal(phone.fault, 'fault', 'the phone no longer paints a fault red')

    /* And what the browser paints, per lamp. The unit's is scoped to the top
       bar; the link lamps take the unscoped rule. */
    const ruleFor = (selector) => {
      const at = css.indexOf(`${selector} {`)
      assert.notEqual(at, -1, `${selector} is gone, so a lamp lost its colour`)
      return css.slice(at, css.indexOf('}', at))
    }
    assert.match(ruleFor(".topbar .lamp[data-state='live']"), /background: var\(--ok\)/, 'the browser paints an answering unit something other than green')
    assert.match(ruleFor(".lamp[data-state='live']"), /background: var\(--live\)/, 'the browser paints an answering computer something other than cyan')
    assert.match(ruleFor(".lamp[data-state='fault']"), /background: var\(--fault\)/, 'the browser paints a fault something other than red')

    /*
     * And the browser's unit lamp really is the top bar's. If TopBar stopped
     * drawing it inside .topbar the scoped rule above would silently stop
     * applying and the dot would go back to cyan with every check still green.
     */
    const bar = read('src/components/TopBar.jsx')
    assert.match(bar, /<div className="topbar"/, 'the top bar is not .topbar any more, so the unit lamp loses its colour')
    assert.match(bar, /<span className="lamp" data-state=\{lampState\} \/>/, 'the unit lamp is not in the top bar')
  })

  test('a setlist is renamed in the row you chose, at both ends', () => {
    /*
     * "Typing should happen in the blue cell and the duplicate deleted."
     *
     * The phone got this right first: the chosen setlist's card IS the name
     * box, so the name you are reading is the name you change. The browser
     * kept the older shape — the row you tapped, and then a separate NAME
     * field under it holding the same word an inch away. Two boxes for one
     * name is a question about which one is real, and it is exactly the kind
     * of drift this file exists to catch.
     */
    const web = read('src/components/Setlists.jsx')
    const phone = read('mobile/src/screens/Setlists.js')

    for (const [where, src] of [['the browser', web], ['the phone', phone]]) {
      /* The box is inside the row, handed down the same way at both ends. */
      assert.match(src, /editing=\{[\s\S]{0,240}?value: draft \?\? l\.name/, `${where} does not put the name box in the chosen row`)
      assert.match(src, /tap the name to rename/, `${where} never says the row can be typed in`)
      /*
       * And storage hears about it ONCE, when the typing is done. Writing per
       * keystroke re-renders the sheet between letters, which is what made a
       * name impossible to clear and made new setlists arrive named twice.
       */
      assert.match(src, /const commitName = \(\) => \{/, `${where} has no single place a typed name is saved`)
      assert.ok(!/onChange(Text)?=\{[^}]*updateList/.test(src), `${where} writes the name on every keystroke again`)
    }

    /* And the second name box is gone from the browser, not merely hidden. */
    assert.ok(!/setlist-name/.test(web), 'the browser still carries a second box for the same name')
    assert.ok(!/setlist-name/.test(read('src/styles.css')), 'the second name box is styled, so something still draws it')
  })

  test('a model read off the unit can still be looked up, at both ends', async () => {
    /*
     * "I thought you were creating the descriptions...."
     *
     * They were created. 109 of the 119 amp families, 75 of the 86 drives and
     * all 45 cabs have one written, and the ten and eleven that do not are the
     * deliberate blanks — boutique amps nobody here has played and Fractal's
     * own designs with no real pedal behind them. Every one of the written
     * ones was INVISIBLE the moment a unit was plugged in.
     *
     * The gear sheet builds its rows two ways. `fromCatalog` is the printed
     * list, used when nothing is connected, and it carries `slug` — the block
     * the name came from. `fromRoster` is the list the unit itself hands over,
     * and it built `{ name, gear }` and stopped there.
     *
     * That draws the LIST correctly, which is why it survived: both columns
     * are there and the sheet looks finished. It is the model's PAGE that
     * breaks, because the description and the photograph are both looked up
     * per block kind, and a row that has forgotten which block it came from
     * cannot be asked for either. So "1987X Treble" on a real FM3 opened a
     * page reading "Nothing written down about this one yet", with the
     * sentence sitting in amp-lineage.json the whole time.
     *
     * Backwards, too: the descriptions were there until the app could reach a
     * unit, and then went away.
     */
    const ends = {
      browser: await import('../src/lib/gearCatalog.js'),
      phone: await import('../mobile/src/lib/gearCatalog.js')
    }
    const lines = {
      browser: await import('../src/lib/lineage.js'),
      phone: await import('../mobile/src/lib/lineage.js')
    }

    /* A roster shaped like the one a unit answers with: names and nothing
       else, which is exactly what an AM4 gives back. */
    const said = { amp: [{ name: '1987X Treble' }], drive: [{ name: 'T808 OD' }] }

    for (const [where, { groupsFor }] of Object.entries(ends)) {
      const { descriptionFor } = lines[where]
      const built = groupsFor(said).filter((g) => g.fromUnit)
      assert.ok(built.length >= 2, `${where} did not take the unit's own lists`)

      for (const group of built) {
        for (const row of group.entries) {
          assert.equal(row.slug, group.key, `${where} loses which block "${row.name}" came from`)
          assert.ok(
            descriptionFor(row.slug, row.name),
            `${where} cannot find the description for "${row.name}" once the unit has answered`
          )
        }
      }
    }

    /*
     * And the printed list and the unit's list agree about a row's shape, or
     * the page works on one path and not the other — which is the bug, one
     * layer up.
     */
    for (const [where, { groupsFor }] of Object.entries(ends)) {
      const printed = groupsFor({}).find((g) => g.key === 'amp')
      const asked = groupsFor(said).find((g) => g.key === 'amp')
      for (const field of ['slug', 'name', 'gear', 'basedOn', 'manufacturer']) {
        assert.ok(field in printed.entries[0], `${where}'s printed row has no ${field}`)
        assert.ok(field in asked.entries[0], `${where}'s row from the unit has no ${field}`)
      }
    }
  })

  test('a model page holds a spec line and as many paragraphs as were written', async () => {
    /*
     * "Your descriptions are not very captivating. I thought I described it
     * clearly how I wanted them previously when I uploaded the photo... I
     * didn't say I wanted a scrape of anything. I said I wanted it 'like'
     * this."
     *
     * The reference is a SHAPE: the model's name, what it really is, the
     * photograph, a line of numbers, then several paragraphs. This page could
     * hold one sentence. Anything longer written into the catalog came out as
     * a single block with the paragraph breaks eaten, which makes the writing
     * look worse the more of it there is — the opposite of what a person
     * filling these in deserves.
     *
     * So the plumbing goes in first and the words come after. Whoever writes
     * them types a blank line between paragraphs and gets paragraphs.
     */
    const lines = {
      browser: await import('../src/lib/lineage.js'),
      phone: await import('../mobile/src/lib/lineage.js')
    }

    for (const [where, lib] of Object.entries(lines)) {
      const { descriptionFor, specsFor, paragraphsOf } = lib

      /* Blank lines are paragraph breaks; a single newline inside one is just
         how the file was wrapped and is not a break. */
      assert.deepEqual(paragraphsOf('one\n\ntwo\n\nthree'), ['one', 'two', 'three'], `${where} loses paragraph breaks`)
      assert.deepEqual(paragraphsOf('wrapped\nover two lines'), ['wrapped over two lines'], `${where} breaks on a soft wrap`)

      /* Nothing written is an empty list, not a list holding an empty string —
         the "nothing written down yet" message hangs off exactly this. */
      for (const nothing of [null, undefined, '', '   ', '\n\n']) {
        assert.deepEqual(paragraphsOf(nothing), [], `${where} turns nothing into a paragraph`)
      }

      /* The one filled in as the worked example, in the shape the reference
         has: a spec line, and more than one paragraph. */
      const jvm = 'Brit JVM OD1 Orange'
      assert.match(specsFor('amp', jvm), /watt/, `${where} has no spec line for the JVM`)
      assert.ok(paragraphsOf(descriptionFor('amp', jvm)).length > 1, `${where} draws the JVM as one block`)

      /* And a model inherits its family's page whole — spec line and all
         the paragraphs — rather than only the first sentence of it. */
      assert.ok(paragraphsOf(descriptionFor('amp', '1987X Treble')).length > 1, `${where} gives a voicing only part of its family's page`)
      assert.match(specsFor('amp', '1987X Treble'), /50 watt/, `${where} loses the family's spec line on a voicing`)

      /* Nothing written is still nothing drawn: a block with no catalog at
         all must not acquire a spec line from somewhere. */
      assert.equal(specsFor('reverb', 'Ambient'), null, `${where} invents a spec line`)
    }

    /* Both pages read all three, or the fields exist and nothing draws them. */
    for (const [where, file] of [['browser', 'src/components/GearCard.jsx'], ['phone', 'mobile/src/components/GearCard.js']]) {
      const card = read(file)
      assert.match(card, /paragraphsOf\(descriptionFor\(/, `${where}'s model page still draws one block`)
      assert.match(card, /specsFor\(entry\.slug, entry\.name\)/, `${where}'s model page never asks for the spec line`)
      /* And the picture comes before the writing, which is the order asked
         for and the order the questions arrive in. */
      assert.ok(card.indexOf('photo.credit') < card.indexOf('about.map'), `${where} puts the writing above the photograph`)
    }
  })


  /*
   * THE SETUP LIST, WHICH NOTHING WAS WATCHING.
   *
   * "It looks like some of the menus aren't matching up, some of the changes
   * we made recently, like nesting some of the menus and things like that,
   * and some of the wording. I also thought we had checks in place to make
   * sure that they didn't drift apart??"
   *
   * There were, and they did not cover this. The AREAS above watch five
   * screens — the chain editor, the play screen, setlists, the log, and
   * getting connected — and Setup is not one of them. They also only see a
   * label a person could mistake for a button name: LOOKS_LIKE_A_BUTTON tops
   * out at three words, so "Amp & pedal names" and "Rename presets and
   * scenes" were invisible to the whole mechanism.
   *
   * And none of it watches SHAPE. Every check in this file asks whether a
   * word exists somewhere in a file. A row that moved one level down still
   * exists, so "Move walkthrough, updates and troubleshooting INSIDE of the
   * 'About' menu" could be carried out on the phone and skipped in the
   * browser with everything green.
   *
   * This reads the two lists as lists: which rows are on the front page, in
   * what order, and which are behind About. A row that exists at one end only
   * is fine and has to be written down with the reason, exactly as a button
   * does above.
   */
  test('Setup is the same list, in the same order, at both ends', () => {
    /* A row at one end only, and why. Same contract as AREAS: unexplained
       fails, explained passes, and the list is the open questions. */
    const ONE_END = {
      'Get it on your phone': 'browser only — a phone has no use for a way to get itself onto a phone, and it stays on the front page rather than inside About because "somebody who has a rig connected and wants the remote in their pocket is the likeliest buyer there is"'
      /* 'Unlock the full version' was here as phone-only — "the browser has
         nothing to sell". Web Billing changed that, and the row is at both
         ends now, in the same place. */
    }

    const rowsIn = (block, attr) =>
      [...block.matchAll(new RegExp(`<SetupRow\\b[\\s\\S]*?${attr}=(?:"([^"]+)"|\\{([A-Z_]+)\\})`, 'g'))].map(
        (m) => m[1] || m[2]
      )

    /* The browser: the front list is the first setup-rows block on the
       Settings sheet, and About's rows are the first one inside its page. */
    const web = read('src/App.jsx')
    const webSheet = web.slice(web.indexOf('title="Settings"'))
    const firstList = (block) => {
      const at = block.indexOf('<div className="setup-rows">')
      assert.notEqual(at, -1, 'the browser Setup list moved; this check reads it')
      return block.slice(at, block.indexOf('</div>', at))
    }
    const webFront = rowsIn(firstList(webSheet), 'title')
    const webAbout = rowsIn(firstList(webSheet.slice(webSheet.indexOf("setupPage === 'about'"))), 'title')

    /* The phone: the front page is `page === null`, About is `page === 'about'`. */
    const app = read('mobile/src/screens/Settings.js')
    const between = (from, to) => {
      const at = app.indexOf(from)
      assert.notEqual(at, -1, `the phone Setup screen moved; this check reads ${from}`)
      const end = to ? app.indexOf(to, at) : -1
      return app.slice(at, end === -1 ? undefined : end)
    }
    /* Up to the first page that is not the front one — 'unit', today. Named
       by the shape rather than by which page happens to come first, so adding
       a page does not silently widen the slice. */
    const phoneFront = rowsIn(between('{page === null ? (', "{page === '"), 'title')
    const phoneAbout = rowsIn(between("{page === 'about' ? (", '<Section>What stays at the computer</Section>'), 'title')

    for (const [where, rows] of [['browser front', webFront], ['phone front', phoneFront], ['browser About', webAbout], ['phone About', phoneAbout]]) {
      assert.ok(rows.length > 0, `${where} came back empty; this check no longer reads the list`)
    }

    /* Rows only one end has drop out, with a written reason. Everything left
       is a row both have, and those must be in the same order. */
    const shared = (rows, other) =>
      rows.filter((r) => {
        if (other.includes(r)) return true
        assert.ok(
          ONE_END[r],
          `"${r}" is on one end's Setup and not the other's, and no reason is written down. ` +
            'Put one in ONE_END in test/both-ends.mjs, or put the row on both ends.'
        )
        return false
      })

    /*
     * AN EXCUSE THAT NO LONGER APPLIES FAILS TOO. "Unlock the full version"
     * sat in ONE_END as phone-only after the browser had grown the same row,
     * and nothing complained — an entry that excuses a row present at both
     * ends is a reason that has stopped being true, and left there it would go
     * on excusing the next row to drift under that name.
     */
    for (const row of Object.keys(ONE_END)) {
      const web = webFront.includes(row) || webAbout.includes(row)
      const phone = phoneFront.includes(row) || phoneAbout.includes(row)
      assert.ok(web !== phone, `"${row}" is excused in ONE_END as one-end-only, and it is ${web && phone ? 'at both ends' : 'at neither'} now. Take it out.`)
    }

    const bothFront = [shared(webFront, phoneFront), shared(phoneFront, webFront)]
    assert.deepEqual(
      bothFront[0],
      bothFront[1],
      `the Setup front page is a different order at the two ends:\n  browser: ${webFront.join(', ')}\n  phone:   ${phoneFront.join(', ')}`
    )

    const bothAbout = [shared(webAbout, phoneAbout), shared(phoneAbout, webAbout)]
    assert.deepEqual(
      bothAbout[0],
      bothAbout[1],
      `the About page is a different order at the two ends:\n  browser: ${webAbout.join(', ')}\n  phone:   ${phoneAbout.join(', ')}`
    )

    /*
     * AND THE NESTING ITSELF, named rather than inferred. These three are the
     * instruction — "Move walkthrough, updates and troubleshooting INSIDE of
     * the 'About' menu" — so they are behind the door at both ends and on
     * neither front page.
     */
    for (const row of ['Updates', 'Troubleshooting']) {
      assert.ok(webAbout.includes(row), `${row} is not inside the browser's About`)
      assert.ok(phoneAbout.includes(row), `${row} is not inside the phone's About`)
      assert.ok(!webFront.includes(row), `${row} is back on the browser's front list`)
      assert.ok(!phoneFront.includes(row), `${row} is back on the phone's front list`)
    }
    /* The walkthrough is the third, and both ends name it from the same
       constant rather than typing the words, so it reads as REPLAY here. */
    assert.ok(webAbout.includes('REPLAY'), "the walkthrough is not inside the browser's About")
    assert.ok(phoneAbout.includes('REPLAY'), "the walkthrough is not inside the phone's About")
  })

  test('the web unlock page says what the phone paywall says, word for word', () => {
    /*
     * "I do not like the way that you write copy." So the browser's unlock
     * page has none of mine: every sentence on it is the phone paywall's.
     * This holds them together, so rewording one end without the other fails.
     */
    const web = read('src/App.jsx')
    const page = web.slice(web.indexOf("setupPage === 'unlock' ? ("), web.indexOf("setupPage === 'about' ? ("))
    const phone = read('mobile/src/screens/Paywall.js')
    const norm = (t) => t.replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
    for (const line of [
      'Phone Remote',
      'One-time payment unlocks the full version of this app, forever, including all future updates, on all supported Fractal devices:',
      'Sign in with the same account on another phone or tablet and it is unlocked there too.',
      'You’ll be able to control and switch presets, scenes, amp & effects blocks, tuner, tap tempo, setlists, and so much more.',
      'Unlock Full Version — ${'
    ]) {
      assert.ok(norm(phone).includes(line), `the phone paywall no longer says: ${line}`)
      assert.ok(norm(page).includes(line), `the web unlock page does not say what the phone says: ${line}`)
    }
    /* The Setup row is the phone's row, word for word. */
    const settings = read('mobile/src/screens/Settings.js')
    assert.match(settings, /title="Unlock the full version"/, 'the phone renamed its unlock row')
    assert.match(web, /title="Unlock the full version"/, 'the web unlock row is named differently from the phone’s')
    assert.ok(settings.includes('`Drive a real rig · ${purchase.price}`') && web.includes('`Drive a real rig · ${webPriceText}`'), 'the unlock row’s price line differs between the two ends')
  })

  test('a web purchase belongs to the account, and cannot take real money by accident', () => {
    const src = read('src/lib/webPurchase.js')
    /*
     * FILED UNDER THE ACCOUNT. appUserId is the signed-in account's id — the
     * same id the phone gives RevenueCat's logIn — which is the whole reason a
     * card taken in a browser unlocks the phone.
     */
    assert.match(src, /Purchases\.configure\(\{ apiKey: WEB_KEY, appUserId: accountId \}\)/, 'the web purchase is not filed under the account')
    const app = read('src/App.jsx')
    assert.match(app, /const accountId = link\.account\?\.id \|\| null/, 'the web unlock does not take the signed-in account’s id')
    assert.match(src, /if \(!accountId\) return \{ ok: false/, 'a purchase can be made with no account to belong to')

    /* The package by product id, as on the phone — first-wins could sell a
       subscription on a page that says "One-time payment". */
    assert.match(src, /p\?\.webBillingProduct\?\.identifier === PRODUCT_ID/, 'the web picks a package by position')
    assert.match(src, /export const PRODUCT_ID = 'cloud\.newbold\.fractalremote\.full'/, 'the web sells a different product id from the phones')

    /*
     * THE SANDBOX KEY, UNTIL HE SAYS OTHERWISE. A checkout nobody has walked
     * through must not be able to charge a real card. Going live is one line
     * in webPurchase.js — and this line here, on purpose, so it is a decision
     * somebody makes rather than a default that drifts.
     */
    assert.match(src, /export const WEB_KEY = SANDBOX_KEY/, 'the web checkout is taking real money; if that was meant, change this check with it')
    assert.match(src, /const SANDBOX_KEY = 'rcb_sb_/, 'the sandbox key is not a sandbox key')

    /* Loaded only when there is a price to show: nobody driving their own rig downloads Stripe. */
    assert.match(src, /await import\('@revenuecat\/purchases-js'\)/, 'the payment library is loaded for everybody')
    assert.ok(!/^import .*@revenuecat\/purchases-js/m.test(src), 'the payment library is in the main bundle')

    /* And the row is only offered to somebody who can use it. */
    /* To anybody who has not paid, signed in or not, as on the phone — the
       sign-in, or the new account, comes on the way to the unlock page. */
    assert.match(app, /\{paid\.checked && !paid\.unlocked \? \(\s*<SetupRow\s*key="unlock"[\s\S]{0,260}onClick=\{openUnlock\}/, 'the unlock row hides from somebody signed out, or skips the sign-in')
  })

  /**
   * THE DEMO'S BAR SAYS UNLOCK AND THE PRICE, IN THE BROWSER AS ON THE PHONE.
   *
   * "When someone's on the demo, it should always say unlock, and then the
   * price at the top? Otherwise, how's a user supposed to know how to go to
   * settings to sign in?"
   *
   * The phone has had it since the demo could be bought from; the browser
   * said DEMO and sent people to a page about the phone app, because at the
   * time a browser could not take a card. It can now, so the two bars say the
   * same thing: UNLOCK and the price for somebody who has not paid, DEMO and
   * Exit demo for somebody who has.
   */
  test('the demo bar says unlock and the price in the browser, as on the phone', () => {
    const bar = read('src/components/TopBar.jsx')
    const phone = read('mobile/src/components/TopBar.js')

    /* The same rule at both ends: the word is UNLOCK only while there is
       something to sell this person. */
    assert.match(phone, /const word = canBuy \? 'unlock' : demo \? 'demo'/, 'the phone bar stopped saying unlock in the demo')
    assert.match(bar, /const canBuy = demo && Boolean\(onUnlock\)/, 'the browser bar offers the unlock outside the demo')
    assert.match(bar, /\? canBuy\s*\? 'unlock'\s*: 'demo'/, 'the browser bar does not say unlock in the demo')

    /* The word and the pill both go to the unlock, and the pill is the price. */
    assert.match(bar, /onClick=\{onUnlock\}[\s\S]*?aria-label="Unlock the full version"/, 'UNLOCK does not open the unlock')
    assert.match(bar, /\{canBuy && unlockPrice \? \(/, 'the price pill is not drawn beside UNLOCK')
    assert.match(bar, /<span className="topbar-pill-face">\{unlockPrice\}<\/span>/, 'the pill says something other than the price')

    /* His words for the way out, and only for somebody who has paid. */
    assert.match(bar, /<span className="topbar-pill-face">Exit demo<\/span>/, 'Exit demo is missing from the browser bar')

    const app = read('src/App.jsx')
    assert.match(
      app,
      /onUnlock=\{isDemo\(\) && paid\.checked && !paid\.unlocked \? openUnlock : null\}/,
      'the browser bar offers the unlock to somebody who has paid, or outside the demo'
    )
    assert.match(app, /onExitDemo=\{isDemo\(\) && paid\.unlocked \?/, 'Exit demo is offered to somebody who has not paid')

    /*
     * Signed out, the unlock asks for the sign-in first and then lands on the
     * unlock page by itself — the whole point of the request is that nobody
     * has to find Settings. And not for somebody who turns out to have paid.
     */
    assert.match(app, /setUnlockAfterSignIn\(true\)\s*setSignIn\('account'\)/, 'signed out, UNLOCK does not ask for the sign-in')

    /*
     * And that sign-in is the plain one. On the website the demo takes the
     * computer's role, whose own sign-in turns the phone remote on through a
     * helper a website does not have — it failed every time. "There's
     * actually no place to even sign in anywhere on the web app."
     */
    assert.match(app, /if \(signIn === 'account'\) \{\s*await signInAccount\(/, 'the unlock’s sign-in sets up a phone remote instead of signing in')
    const link = read('src/lib/link.js')
    const plain = link.slice(link.indexOf('export async function signInAccount'), link.indexOf('export async function reconnectPhone'))
    assert.ok(plain.length > 0 && !/join\(|turnOnMac|autoConnect/.test(plain), 'the plain sign-in has an errand attached again')

    /* The phone's Setup has a way in from the demo; so does the browser's, in the phone's words. */
    assert.match(read('mobile/src/screens/Settings.js'), /label="Sign in with an email and password"/, 'the phone lost its sign-in button')
    assert.match(
      app,
      /\{isDemo\(\) && !link\.account \? \([\s\S]{0,200}note="Not signed in on this device\." defaultOpen>[\s\S]{0,300}setSignIn\('account'\)[\s\S]{0,120}Sign in with an email and password/,
      'the browser’s Setup has no way to sign in from the demo'
    )
    assert.match(app, /paid\.for !== accountId/, 'the unlock page can open on the signed-out answer, before the new account’s is in')
    assert.match(app, /if \(paid\.unlocked\) return\s*setSheet\('settings'\)\s*setSetupPage\('unlock'\)/, 'somebody who has paid is sent to the unlock page after signing in')

    /* The price reaches somebody not signed in; the purchase still does not. */
    const buy = read('src/lib/webPurchase.js')
    assert.match(buy, /purchasesFor\(accountId \|\| \(await visitorId\(\)\)\)/, 'the demo cannot show the price before a sign-in')
    assert.match(buy, /generateRevenueCatAnonymousAppUserId\(\)/, 'the visitor id is invented here rather than asked of RevenueCat')
    const buyer = buy.slice(buy.indexOf('export async function buyOnWeb'))
    assert.ok(!/visitorId/.test(buyer), 'a purchase can be filed under an anonymous visitor')

    /* And buying in the demo ends it, as on the phone. */
    assert.match(app, /if \(isDemo\(\)\) \{\s*setDemo\(false\)\s*window\.location\.reload\(\)/, 'buying in the browser leaves the person in the demo')
  })
}
