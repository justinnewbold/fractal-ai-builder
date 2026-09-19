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
      { does: 'make a new account', web: 'Create Account', phone: 'Create Account' },
      { does: 'sign in to an account you have', web: 'Sign in', phone: 'Sign in' },
      { does: 'join the computer with a pairing code', web: 'Connect', phone: 'Connect' },
      {
        does: 'send yourself a password reset',
        web: 'Forgot password?',
        phone: 'Forgot password',
        /* The browser's carries a question mark because it sits in a row of
           links; the phone's is a button and does not ask. */
        unreadable: ['web']
      },
      {
        does: 'look around without a rig',
        web: 'Try the demo',
        also: ['Try now', 'Go'],
        phone: 'Just looking? Try the demo',
        unreadable: ['phone'],
        why: 'the same offer at both ends; the browser also says Try now on the not-connected screen and Go beside the code box, neither of which the phone has a place for'
      },
      {
        does: 'read the pairing code off the computer’s screen with the camera',
        web: null,
        phone: 'Scan a code',
        why: 'the browser is the thing the QR POINTS AT — it carries the hosted app’s address with the code in the fragment, so opening the square’s link IS the browser pairing, and a camera there would be a laptop photographing its own screen'
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
}
