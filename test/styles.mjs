/**
 * The dimensional system, held shut.
 *
 * The stylesheet reached 4,800 lines carrying nineteen font sizes, twenty-eight
 * padding lengths, five radii and no rule about any of them — nine of the font
 * sizes sat in the 9.5–13.5px band in half-pixel steps, which is a distinction
 * nothing renders differently and nobody chose deliberately twice.
 *
 * The scales exist now. What this stops is the next well-meant `13.5px` from
 * starting the drift again, which is exactly how the first nineteen arrived:
 * one reasonable-looking literal at a time.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

/** Declarations, minus comments — a commented-out example is not a rule. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

const declarations = (prop) => [
  ...code.matchAll(new RegExp(`(?:^|[;{\\s])${prop}: ([^;{}]+);`, 'g'))
].map((m) => m[1].trim())

/**
 * One whole block from `at`, braces matched.
 *
 * A media query holds rules that hold rules, so "up to the next `}`" reads a
 * fraction of one and quietly passes or fails on whichever rules happened to
 * land first.
 */
function balanced(text, at) {
  const open = text.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1)
  }
  return text.slice(at)
}

export function run(test) {
  test('every font size comes off the scale', () => {
    /*
     * Two exceptions, both deliberate and both named: the preset name on the
     * stage screen is a sign rather than text, and 16px on an input is a
     * platform floor — iOS zooms the page when a focused field is smaller, and
     * that zoom then has to be undone by hand.
     */
    const sign = new Set(['40px', '64px'])
    const bare = declarations('font-size').filter((v) => /^[0-9.]+px$/.test(v) && !sign.has(v))
    assert.deepEqual(bare, [], `font sizes off the scale: ${[...new Set(bare)].join(', ')}`)

    // And the scale itself is six steps, not six plus whatever crept in.
    const steps = [...code.matchAll(/--f-(\d): ([0-9]+)px/g)].map((m) => m[2])
    assert.equal(steps.length, 6, `the type scale has ${steps.length} steps`)
    assert.deepEqual(steps, ['11', '12', '13', '15', '20', '28'])
  })

  test('every padding and gap comes off the spacing scale', () => {
    // 0 is not a step, and 1px is a hairline rather than a space.
    const fine = new Set(['0', '1px'])
    const off = []
    for (const prop of [
      'padding',
      'padding-top',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'gap',
      'row-gap',
      'column-gap'
    ]) {
      for (const value of declarations(prop)) {
        for (const part of value.split(/\s+/)) {
          if (/^[0-9.]+px$/.test(part) && !fine.has(part)) off.push(`${prop}: ${part}`)
        }
      }
    }
    /*
     * One survivor, kept on purpose: the grid's left inset is measured from
     * the row labels beside it, not from the page. Rounding it to a step moves
     * the cells out from under the coordinates that name them.
     */
    const allowed = off.filter((x) => x === 'padding-left: 74px')
    assert.ok(allowed.length <= 1, 'more than one deliberate exception')
    const rest = off.filter((x) => x !== 'padding-left: 74px')
    assert.deepEqual(rest, [], `spacing off the scale: ${[...new Set(rest)].join(', ')}`)
  })

  test('radius says what a thing is, in three tiers', () => {
    /*
     * The rule that resolved "instrument or app": anything standing for the
     * hardware keeps the chassis radius; the app's own furniture — sheets,
     * scrims, pills — is rounder, so the two never read as the same surface.
     * A circle and a square corner are shapes, not steps.
     */
    const shapes = new Set(['0', '50%'])
    const bare = declarations('border-radius').filter(
      (v) => !shapes.has(v) && !v.includes('var(')
    )
    assert.deepEqual(bare, [], `radii off the three tiers: ${[...new Set(bare)].join(', ')}`)
  })

  test('elevation is three steps; a glow is not elevation', () => {
    const shadows = declarations('box-shadow')
    for (const v of shadows) {
      if (v === 'none' || v.includes('var(--e-')) continue
      // What is left must be a ring, a halo or an inset — light, not lift.
      assert.ok(
        /inset|^0 0 /.test(v),
        `box-shadow "${v}" reads as elevation but is not one of the three steps`
      )
    }
  })

  test('the token that was superseded is gone, not just unused', () => {
    // --gutter was declared, documented as superseded by --s-2, and used once
    // in 118 gap declarations. A token nobody uses is a token someone will.
    assert.ok(!code.includes('--gutter'), '--gutter is still declared')
  })

  test('nothing on a touch screen is under the 44px floor', () => {
    /*
     * A sweep of the app on a phone found the whole chrome row at 40px, the
     * on/off pill at 40, selects at 34, the theme toggle at 34 and the sign-in
     * fields at 21 — each set deliberately, each a little short, none of them
     * wrong enough to notice sitting at a desk.
     *
     * The trap is specificity. The touch floor is a blanket `button` rule at
     * (0,0,1); any component that names itself — `button.fx-power` at (0,1,1) —
     * outranks it and keeps whatever height it gave itself. So a small base
     * height is fine only if the same selector is raised again for touch. That
     * pairing is what this checks, and 40px survived one correction without it.
     */
    const coarseBodies = []
    for (const m of code.matchAll(/@media \(pointer: coarse\)\s*\{/g)) {
      let i = m.index + m[0].length
      let depth = 1
      const from = i
      while (i < code.length && depth) {
        if (code[i] === '{') depth++
        else if (code[i] === '}') depth--
        i++
      }
      coarseBodies.push(code.slice(from, i - 1))
    }
    const coarse = coarseBodies.join('\n')
    const rules = (text) => {
      const out = new Map()
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const h = m[2].match(/min-height: (\d+)px/)
        if (h) out.set(m[1].trim().replace(/\s+/g, ' '), Number(h[1]))
      }
      return out
    }

    // Inside a touch block, short is simply wrong.
    const inside = [...rules(coarse)].filter(([, h]) => h < 44)
    assert.deepEqual(inside.map(([s2, h]) => `${s2} → ${h}px`), [], 'short min-heights inside a touch block')

    // Outside one, short is only allowed if touch raises the same selector.
    const raised = rules(coarse)
    const unraised = []
    for (const [selector, h] of rules(code.split('@media (pointer: coarse)')[0])) {
      if (h >= 44) continue
      if (!/\b(button|input|select)\b|\.chip/.test(selector)) continue
      if ((raised.get(selector) ?? 0) < 44) unraised.push(`${selector} → ${h}px, never raised for touch`)
    }
    assert.deepEqual(unraised, [], `under the floor with no touch override:\n  ${unraised.join('\n  ')}`)
  })

  test('every field a phone user must type into clears the iOS zoom floor', () => {
    // Under 16px iOS zooms the page on focus. email and password were left out
    // of this list for a long time — the two fields the phone flow cannot avoid.
    // Specifically the rule that sets the floor — these types also appear in
    // the min-height rule nearby, and checking for them anywhere in the touch
    // block passes happily while the zoom bug is back.
    // Five rules apply the floor to different corners of the app, so the test
    // is whether a type is covered by ANY of them — not by whichever one comes
    // first in the file.
    const selectors = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /font-size: var\(--f-input\)/.test(m[2]))
      .map((m) => m[1])
      .join(' ')
    assert.ok(selectors, 'no rule applies the 16px input floor at all')
    for (const type of ['email', 'password', 'text']) {
      assert.match(
        selectors,
        new RegExp(`input\\[type='${type}'\\]`),
        `input[type='${type}'] never gets the 16px floor — iOS will zoom the page on focus`
      )
    }
  })

  test('no field sets its own font-size and escapes the zoom floor', () => {
    /*
     * "As soon as I click the chat box, it zooms in on it and then you can't
     * see the send button anymore."
     *
     * The floor above is written on bare element selectors, and a media query
     * adds no specificity — so `textarea.refine-input { font-size: var(--f-3) }`
     * at (0,1,1) beat it and the composer stayed at 13px. The test above passed
     * throughout, because `textarea` IS in the floor rule; it was the override
     * that won.
     *
     * So this is the general form: any field named with a class of its own that
     * sets a font-size must also be named in a rule applying the floor. It
     * catches the next one, which is the point — this is the third time a
     * class-qualified field has quietly outranked a blanket rule in this file.
     */
    /*
     * Position matters as much as presence, and getting that wrong is how the
     * first attempt at this fix shipped green and still zoomed: the floor was
     * added to the touch block near the top of the file, and
     * `textarea.refine-input` sets its size several hundred lines below at the
     * same specificity, so source order handed it back. A guard that only asked
     * "is the class named somewhere" passed throughout. So each field is
     * checked against where its floor sits, not merely whether one exists.
     */
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const floorAt = new Map()
    for (const m of rules) {
      if (!/font-size: var\(--f-input\)/.test(m[2])) continue
      for (const s of m[1].matchAll(/\.([\w-]+)/g)) {
        floorAt.set(s[1], Math.max(floorAt.get(s[1]) ?? -1, m.index))
      }
    }

    /*
     * Every rule that gives a class-named field a size that is NOT the floor.
     *
     * Deliberately not "rules outside the touch block": an earlier version of
     * this guard tried to express that as "before the first @media (pointer:
     * coarse)", and the composer's own rule lives several hundred lines AFTER
     * that block — so the one field the whole test exists for was skipped, and
     * the broken fix passed. Whether a rule sits inside a media query does not
     * matter here. What matters is that something sets a non-floor size and the
     * floor does not come after it.
     */
    const owned = new Map()
    for (const m of rules) {
      if (!/font-size:/.test(m[2])) continue
      if (/font-size: var\(--f-input\)/.test(m[2])) continue
      if (!/\b(?:input|textarea)\.[\w-]+/.test(m[1])) continue
      for (const s of m[1].matchAll(/\b(?:input|textarea)\.([\w-]+)/g)) {
        owned.set(s[1], Math.max(owned.get(s[1]) ?? -1, m.index))
      }
    }
    assert.ok(owned.size, 'no class-named field sets its own font-size — has the scan stopped matching?')

    for (const [cls, own] of owned) {
      const floor = floorAt.get(cls)
      assert.ok(
        floor !== undefined,
        `.${cls} sets its own font-size and is never named in the 16px floor — ` +
          'a bare element selector cannot reach it, so iOS zooms the page on focus'
      )
      assert.ok(
        floor > own,
        `.${cls} gets the 16px floor at character ${floor} but sets its own size at ${own} — ` +
          'same specificity, later wins, so the floor never applies and iOS zooms the page on focus'
      )
    }
  })

  test('the page reserves the room the floating Ask button takes up', () => {
    /*
     * `.ask-anywhere` is fixed over the bottom-right corner on Play and Edit.
     * Whatever it covers there can only be got at by scrolling it out from
     * under — so the shell's bottom padding has to be at least as deep as the
     * button's inset plus its height. It was not, and the eighth scene button
     * on a phone sat under it with nowhere to go.
     *
     * The padding that matters is the one in the `@supports (padding: max())`
     * block, not the `.shell` rule at the top of the file: same specificity,
     * later in the source, and supported everywhere. Raising the first one
     * alone changes nothing on any real browser, which is exactly the mistake
     * this test is here to catch.
     */
    const rule = code.match(/@supports \(padding: max\(0px\)\) \{\s*\.shell \{([^}]*)\}/)
    assert.ok(rule, 'the @supports block that sets the real shell padding is gone')
    const reserved = Number((rule[1].match(/padding-bottom: calc\((\d+)px \+/) || [])[1])
    assert.ok(reserved, `shell padding-bottom is no longer a plain reservation: ${rule[1].trim()}`)

    const button = code.match(/\.ask-anywhere \{([^}]*)\}/)
    assert.ok(button, '.ask-anywhere is gone')
    const inset = Number((button[1].match(/bottom: calc\(var\(--s-(\d)\)/) || [])[1])
    const height = Number((button[1].match(/min-height: (\d+)px/) || [])[1])
    assert.ok(inset && height, `cannot read the button's own geometry: ${button[1].trim()}`)
    const scale = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 }
    const needed = scale[inset] + height

    assert.ok(
      reserved >= needed,
      `the shell reserves ${reserved}px but the Ask button occupies ${needed}px ` +
        `(${scale[inset]}px inset + ${height}px tall) — the last row of controls cannot be scrolled clear of it`
    )
  })
  test('what sits above the bar clears the status bar too', () => {
    /*
     * The bar carries safe-area-inset-top of its own, which is why it has
     * always looked right on a notched phone. Nothing else did — and the
     * update notice is above it deliberately, since a stale tab makes
     * everything else on screen a possible lie about what the code does.
     *
     * Added to a home screen there is no browser chrome over the page, so that
     * notice came up underneath the clock and the signal bars. Reported as a
     * screenshot with "A newer version of this app is out" struck through by
     * 7:10 and a battery icon.
     *
     * On the shell rather than on the notice, so the next thing put above the
     * bar cannot inherit the bug. And it must come after the @supports block,
     * which is the rule that actually applies — same specificity, later in the
     * source; setting it earlier changes nothing on any real browser, the
     * mistake the padding test above exists to catch.
     */
    /*
     * Every rule that sets it, not the last one written. The phone-width block
     * tightens this padding — that is the rule that applies on the device the
     * notice was hiding on — so a guard reading one rule passes while the fix
     * is undone in the only place it was ever needed.
     */
    const tops = []
    for (const m of code.matchAll(/\.shell \{([^}]*)\}/g)) {
      const top = m[1].match(/padding-top:[^;]*/)
      if (top) tops.push(top[0].trim())
    }
    assert.ok(tops.length, 'nothing sets the top of the page at all')
    for (const top of tops) {
      assert.match(
        top,
        /env\(safe-area-inset-top, 0px\)/,
        `"${top}" leaves the top of the page under the status bar, so anything above the bar hides behind the clock`
      )
    }
    // The shorthand would reset it, so it must not carry one after these.
    assert.ok(
      !/\.shell \{[^}]*padding: /.test(code.slice(code.indexOf('@supports (padding: max(0px))'))),
      'a padding shorthand after the inset rules puts the top back where it was'
    )
  })

  test('inside a sheet the preset list is not a second scroller', () => {
    /*
     * A 300px window over a 23,000px list, inside a sheet body that scrolls
     * itself: two nested scrollers fighting for the same thumb, seven rows
     * visible at a time. The sheet is the one scroll surface; the top-bar
     * menu, which is not a sheet, keeps its cap.
     */
    const at = code.indexOf('.sheet-body .preset-scroll {')
    assert.notEqual(at, -1, 'the preset list inside a sheet has its own scroll window again')
    const rule = code.slice(at, code.indexOf('}', at))
    assert.match(rule, /max-height: none/)
    assert.match(code, /\.preset-menu \{[^}]*max-height: min\(72vh, 560px\)[^}]*overflow-y: auto/, 'the top-bar menu lost its cap')
    assert.match(code, /\.preset-menu \.preset-scroll \{\s*max-height: none/, 'the menu has a second scroller inside it again')
  })

  test('a sheet keeps its contents off the screen edge, and a scene tile is a tile', () => {
    /*
     * The sheet body had no inline padding, so every sheet's first column
     * started at x=1 — inside the iOS edge-swipe zone — and the scene tiles,
     * with no width rule, shrank to the width of a dash: 38px targets on a
     * touch screen.
     */
    const body = code.slice(code.indexOf('.sheet-body {'), code.indexOf('}', code.indexOf('.sheet-body {')))
    const pad = body.match(/padding: ([^;]+);/)?.[1] || ''
    assert.match(pad, /var\(--s-[3-9]\) var\(--s-4\)/, `the sheet body is flush to the edge: "${pad}"`)
    const tile = code.slice(code.indexOf('button.scene {'), code.indexOf('}', code.indexOf('button.scene {')))
    assert.match(tile, /width: 100%/, 'a scene tile shrinks to its content again')
    assert.match(tile, /min-height: 44px/, 'a scene tile is under the touch floor')
    // The tour card compensated for the missing padding on its own; with the body padded it would double up.
    const tour = code.slice(code.indexOf('.tour-card p {'), code.indexOf('}', code.indexOf('.tour-card p {')))
    assert.ok(!/padding: 0 var\(--s-4\)/.test(tour), 'the tour card still pads itself on top of the sheet body')
  })

  test('a row and its delete button share one line', () => {
    /*
     * The delete button shipped with no styling at all. `button.recent-row` is
     * a flex item at full width and a list item is not a flex container, so the
     * × wrapped underneath every row: 89px tall instead of 44, an orphaned ×
     * at the left edge, and the restore target no longer where it looked.
     *
     * Two rules make it a row, and both have to hold: the item has to lay out
     * as flex, and the button beside the × must not claim the whole width.
     */
    const item = code.slice(code.indexOf('.recent-list li {'), code.indexOf('}', code.indexOf('.recent-list li {')))
    assert.match(item, /display: flex/, 'the row and its delete button stack instead of sitting side by side')

    const row = code.slice(code.indexOf('button.recent-row {'), code.indexOf('}', code.indexOf('button.recent-row {')))
    assert.ok(
      !/width: 100%/.test(row),
      'the row claims the whole line again, which pushes the delete button onto its own'
    )
    assert.match(row, /flex: 1 1 auto/, 'the row no longer takes the room the delete button leaves')

    const del = code.slice(code.indexOf('button.recent-del {'), code.indexOf('}', code.indexOf('button.recent-del {')))
    assert.ok(del, 'the delete button has no styling at all')
    assert.match(del, /min-height: 44px/, 'the delete button is under the touch floor')
  })

  test('a phone says which unit it is driving', () => {
    /*
     * "Please show what device the unit is currently connected to in the top
     * left. AM4, FM3, Axe-Fx."
     *
     * It was there on a desktop and hidden on a phone, along with the word
     * "connected", to buy room for the preset name — which was being cut to
     * "D…". Dropping the word is still right: the chip on the right of this same
     * bar says exactly that, and the lamp says it again in colour.
     *
     * The unit's name is not a repeat of anything, and with two Macs and two
     * units on one account it is the one fact that says WHICH RIG this screen is
     * driving — on the device where you cannot look over and check.
     *
     * The room came from elsewhere in the end: the separate UNSAVED word is
     * gone, and Save now appears only when there is something to save.
     */
    // Every narrow block, not the first one that matches: there are three, and
    // the topbar rules are not in the first.
    let narrow = ''
    for (const m of code.matchAll(/@media \(max-width: 620px\)/g)) narrow += balanced(code, m.index)
    assert.ok(narrow.includes('.topbar-'), 'the narrow bar rules are gone')

    const hidden = [...narrow.matchAll(/([^{}]+)\{[^{}]*display: none[^{}]*\}/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim())
      .join(' | ')
    assert.ok(
      !/\.topbar-unit/.test(hidden),
      'the unit name is hidden on a phone again, which is the one fact saying which rig this is'
    )
    assert.ok(/\.topbar-how/.test(hidden), 'the connection word is back, saying what the chip beside it already says')

    /*
     * And a long one is capped, so "Axe-Fx III" cannot spend the eight
     * characters the preset name is guaranteed just below it.
     */
    const unit = narrow.slice(narrow.indexOf('.topbar-unit {'))
    assert.match(unit.slice(0, unit.indexOf('}')), /max-width/, 'a long unit name can eat the preset name')
  })

  test('the Macs to choose between both fit on the screen', () => {
    /*
     * A Mac is called whatever its owner called it, so the buttons here read
     * "Drive Justin's MacBook Pro" and "Drive Studio Mac" — two long labels that
     * do not share a line on a phone. Without the wrap the second one leaves the
     * screen, and the second one is the one not currently selected: precisely
     * what somebody opened this notice to press.
     *
     * Written after a delete button shipped with no styling at all and broke a
     * whole list. A class named in JSX and absent from here is not a small
     * mistake in this app.
     */
    const at = code.indexOf('.host-pick {')
    assert.ok(at !== -1, 'the row of Macs to choose between has no styling at all')
    const rule = code.slice(at, code.indexOf('}', at))
    assert.match(rule, /display: flex/, 'the buttons do not lay out as a row')
    assert.match(rule, /flex-wrap: wrap/, 'a long Mac name pushes the other choice off the screen')
  })

  test('the floating Ask never floats over a phone’s controls', () => {
    /*
     * This used to check a swap: a floating button on wide screens, a fourth
     * `button.ask-tab` on phones. That tab is gone — it opened the same
     * conversation the Ask screen already is — so what is left to hold is the
     * half that was always about the hardware in someone's hands.
     *
     * Fixed to the bottom-right corner, the floating button sat on scene tile
     * 6, the pad's Change and Edit's Modifiers, because that corner is where
     * the last control in every grid lands. On a phone the tab row is the way
     * to the conversation and this must stay hidden.
     */
    assert.ok(
      !/button\.ask-tab \{/.test(code),
      'the removed Ask tab still has styling, which will dress up whatever gets that class next'
    )
    const at = code.indexOf('.ask-anywhere {')
    assert.notEqual(at, -1, 'the floating Ask button is gone entirely — wide screens lost the sheet')
    assert.match(
      code,
      /@media \(max-width: 700px\) \{\s*\.ask-anywhere \{\s*display: none/,
      'the floating Ask is back over a phone’s controls'
    )
  })

  test('a docked sheet is clipped to its rail and arrives without overshoot', () => {
    /*
     * The tour is a sheet; on a desktop it docks as a rail that animates in
     * from translateX(100%) inside an unclipped fixed layer, with a spring
     * that overshoots — so its first frames painted past the right edge of
     * the screen, and so did its exit.
     */
    const at = code.indexOf('.sheet-layer.rail {')
    assert.notEqual(at, -1)
    const rail = code.slice(at, code.indexOf('}', at))
    assert.match(rail, /overflow: clip/, 'the rail layer does not clip the sheet sliding into it')
    const sheet = code.slice(code.indexOf('.sheet-layer.rail .sheet {'), code.indexOf('}', code.indexOf('.sheet-layer.rail .sheet {')))
    assert.match(sheet, /transition-timing-function: var\(--ease\)/, 'the rail still springs past its docked position')
  })

  test('the tab you pressed is underlined, on paper the small type is readable, and the rest', () => {
    // :active at (0,3,1) outranked .current at (0,2,1): the grey press underline stuck on iOS.
    const current = code.indexOf('button.view-tab.current:not(:disabled) {')
    const active = code.indexOf('button.view-tab:active:not(:disabled) {')
    assert.ok(current !== -1 && active !== -1 && current > active, 'the current tab’s underline loses to the press state')
    const tab = code.slice(code.indexOf('button.view-tab {'), code.indexOf('}', code.indexOf('button.view-tab {')))
    assert.match(tab, /min-height: 44px/, 'the tab bar is under the touch floor')
    const toggle = code.slice(code.indexOf('.theme-toggle button {'), code.indexOf('}', code.indexOf('.theme-toggle button {')))
    assert.ok(!/min-height: 0/.test(toggle), 'the theme toggle opts out of the touch floor')
    // Tour dots and hand edits have their styles.
    assert.match(code, /button\.tour-dot \{/, 'the tour dots are not styled as buttons')
    assert.match(code, /\.turn-hand \.turn-text \{/, 'hand edits lost their quiet style')
    const hand = code.slice(code.lastIndexOf('.turn-hand .turn-text {'), code.indexOf('}', code.lastIndexOf('.turn-hand .turn-text {')))
    assert.match(hand, /border-left: 2px solid var\(--silk-faint\)/, 'a hand edit has no mark of its own now that it has no word')
    assert.match(code, /\.chain-strip\[data-overflow='yes'\],\s*\.grid-scroll\[data-overflow='yes'\] \{[^}]*mask-image/, 'the chain strip has no edge fade when it scrolls')
  })

  test('the faint type reads, in both themes', () => {
    /*
     * The cream theme's --silk-faint was #8b9099 on #f2efe9: 2.8:1, under
     * even the large-text floor, on every "FM3", "500", "remote", "Off" and
     * inactive tab. WCAG AA for text is 4.5:1; at 4.9:1 it was still "a
     * little light" on a phone in daylight, so the cream theme's floor is
     * higher. The dark theme's --silk-faint had the same 2.9:1 fault.
     */
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    const themes = [
      ['dark', ':root {', 4.5],
      ['light', "[data-theme='light'] {", 6.5]
    ]
    for (const [name, open, floor] of themes) {
      const block = code.slice(code.indexOf(open), code.indexOf('}', code.indexOf(open)))
      const token = (t) => block.match(new RegExp(`--${t}: (#[0-9a-f]{6})`))?.[1]
      for (const ground of ['chassis', 'panel']) {
        for (const ink of ['silk', 'silk-dim', 'silk-faint']) {
          const r = ratio(token(ink), token(ground))
          assert.ok(r >= floor, `--${ink} on --${ground} is ${r.toFixed(2)}:1 in the ${name} theme (floor ${floor})`)
        }
      }
    }
  })

  test('a channel button is 44px both ways, not just across', () => {
    /*
     * It had min-width: 44px and no min-height, so it met the guideline in the
     * one direction a chip is naturally wide in and missed it in the direction
     * that actually needed the floor. Picking a channel is a primary control —
     * it is what a scene IS on this hardware.
     */
    const rule = code.slice(code.indexOf('.channel-buttons .chip {'), code.indexOf('}', code.indexOf('.channel-buttons .chip {')))
    assert.match(rule, /min-width: 44px/)
    assert.match(rule, /min-height: 44px/, 'a channel button is back to meeting the touch floor sideways only')
  })

  test('the amber reads too — on it and against it', () => {
    /*
     * The other half of the same fault, and the one on the control people press
     * hardest and in a hurry. `--on-signal` on `--signal` in the cream theme
     * measured 3.78:1 — that is the Save button's own text — and `--signal` as
     * ink on the cream ground came to 3.43:1, which is every amber word, rule
     * and border on that theme.
     *
     * Both directions, because amber is used both ways: as a ground with ink on
     * it, and as ink on the page. Fixing one alone leaves the other under the
     * floor and looking deliberate.
     */
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    for (const [name, open] of [['dark', ':root {'], ['light', "[data-theme='light'] {"]]) {
      const block = code.slice(code.indexOf(open), code.indexOf('}', code.indexOf(open)))
      const token = (t) => block.match(new RegExp(`--${t}: (#[0-9a-f]{6})`))?.[1]
      const signal = token('signal')
      assert.ok(signal, `the ${name} theme has no --signal`)
      const ink = ratio(token('on-signal'), signal)
      assert.ok(ink >= 4.5, `--on-signal on --signal is ${ink.toFixed(2)}:1 in the ${name} theme — that is the Save button`)
      for (const ground of ['chassis', 'panel']) {
        const r = ratio(signal, token(ground))
        assert.ok(r >= 4.5, `--signal as ink on --${ground} is ${r.toFixed(2)}:1 in the ${name} theme`)
      }
    }
  })

  test('the preset sits in the middle of the bar, and the chip’s word is not the smallest type in it', () => {
    const rule = (sel) => code.slice(code.indexOf(sel + ' {'), code.indexOf('}', code.indexOf(sel + ' {')))
    assert.match(rule('button.topbar-preset'), /align-items: center/, 'the preset button packs its line to the top of a 44px box again')
    assert.match(rule('.topbar-preset-line'), /align-items: baseline/, 'the slot and the name no longer share a baseline')
    assert.match(rule('button.phone-chip.compact'), /font-size: var\(--f-1\)/, 'the chip is off the scale')
  })

  test('on a phone the bar drops the unsaved word so the preset keeps its name', () => {
    const at = code.indexOf('@media (max-width: 620px) {\n  .save-cluster {')
    assert.notEqual(at, -1)
    const block = code.slice(at, at + 1200)
    assert.ok(!/topbar-dirty/.test(code), 'the separate UNSAVED word is back')
    assert.match(code, /\.save-cluster\[data-dirty='no'\] button\.save-now \{[^}]*background: none/, 'the Save button is amber with nothing to save')
    assert.match(block, /\.topbar-name \{\s*min-width: 8ch/, 'the preset name can shrink to one letter again')
  })

  test('on Play a scene is the size of a block, the words in both are readable, and the bar name is not a headline', () => {
    const rule = (sel) => code.slice(code.indexOf(sel + ' {'), code.indexOf('}', code.indexOf(sel + ' {')))
    const height = (text) => text.match(/min-height: (\d+)px/)?.[1]
    assert.equal(height(rule('button.gig-scene')), height(rule('button.gig-block')), 'scene tiles and effect blocks differ in height')
    /*
     * On a phone the two are still one rule, and both take their size from the
     * control rather than from a number written here.
     *
     * This used to pin the literal `min-height: 66px`, which pinned the bug:
     * that block hard-coded a 108px column floor and a 66px tile, so the − / +
     * buttons were overruled on the one screen they exist for and "Smallest"
     * was three blocks to a row whatever a player chose. What the test is
     * actually protecting is that a scene and a block never drift apart in
     * size — so it checks that, and that the figure comes from --gig-tile.
     */
    /* The 620px block that carries the two grids — there is more than one
       620px block in this file, and balanced() is here for exactly this. */
    const at = code.lastIndexOf(
      '@media (max-width: 620px) {',
      code.indexOf('.gig-scenes {\n    grid-template-columns')
    )
    const phone = balanced(code, at)
    assert.match(
      phone,
      /button\.gig-block,\s*\n\s*button\.gig-scene \{\s*min-height: var\(--gig-tile/,
      'on a phone the scenes and the blocks are sized apart again, or sized past the control'
    )
    /*
     * And the COLUMN COUNT comes from the control too.
     *
     * A pixel floor says "at least this wide" and lets the viewport pick how
     * many fit, which is why the default kept coming out three scenes across
     * when the layout he chose is two. minmax(0, 1fr) rather than 1fr because
     * a grid item's default min-width is its min-content — the trap that had
     * the effects stuck three to a row no matter what the floor said.
     */
    for (const [grid, v] of [['.gig-scenes', '--gig-scene-cols'], ['.gig-blocks', '--gig-fx-cols']]) {
      const rule = phone.slice(phone.indexOf(grid + ' {'), phone.indexOf('}', phone.indexOf(grid + ' {')))
      assert.match(
        rule,
        new RegExp(`grid-template-columns: repeat\\(var\\(${v}`),
        `${grid} on a phone no longer takes its column count from the size control`
      )
      assert.match(rule, /minmax\(0, 1fr\)/, `${grid} lets its content push a column wider than its share`)
    }
    assert.match(rule('.gig-block-name'), /font-size: var\(--f-4\)/, 'the block name is small again')
    assert.match(rule('button.gig-scene.named .gig-scene-name'), /font-size: var\(--f-4\)/, 'the scene name is small again')
    assert.match(rule('.gig-block-state'), /font-size: var\(--f-2\)/)
    assert.match(rule('.topbar-name'), /font-size: var\(--f-3\)/, 'the preset name in the bar is a headline again')
  })

  test('at Smallest a tile is a fixed box, so a long scene name cannot push the blocks off the screen', () => {
    /*
     * "This says it's the smallest. It's still too big. All buttons need to be
     * able to fit on screen at the smallest."
     *
     * Two things were letting the screen grow past what the control asked for.
     *
     * `min-height` is a floor, not a height, so a scene called WET CRUNCH FUNK
     * wrapped to three lines and stood three times as tall as one called LEAD.
     * The height of the Play screen therefore depended on how a player had
     * named their scenes — which is why Smallest fitted the demo, whose scenes
     * are RHYTHM / LEAD / CLEAN, and did not fit his rig.
     *
     * And a grid item's default `min-width: auto` is its min-content width, so
     * a track declared `minmax(92px, 1fr)` still came out 130px because the
     * longest block name said so. The column floor was overruled by the text
     * inside it.
     *
     * Both are properties of the CSS, not of a screenshot, so both are pinned
     * here. Measured alongside: 8 scenes and 14 blocks at 440x790 with no
     * scroll.
     */
    const rule = (sel) => code.slice(code.indexOf(sel + ' {'), code.indexOf('}', code.indexOf(sel + ' {')))

    for (const sel of ['.gig[data-compact] button.gig-scene', '.gig[data-compact] button.gig-block']) {
      const r = rule(sel)
      assert.match(r, /\n\s*height: \d+px/, `${sel} is a floor again rather than a height`)
      assert.match(r, /min-height: 0/, `${sel} keeps a floor that can beat its own height`)
      assert.match(r, /overflow: hidden/, `${sel} lets its contents out of the box again`)
    }

    // The names are clamped, so neither can spend a line it has not got.
    assert.match(
      rule('.gig[data-compact] .gig-scene-name'),
      /-webkit-line-clamp: 2/,
      'a scene name wraps as far as it likes again'
    )
    assert.match(
      rule('.gig[data-compact] .gig-block-name'),
      /text-overflow: ellipsis[\s\S]*white-space: nowrap/,
      'a block name wraps again, so a row of blocks is as tall as its longest name'
    )

    // And the tiles can be as narrow as they were asked to be.
    const narrow = code.slice(code.indexOf('.gig[data-compact] .gig-block-cell,'))
    assert.match(narrow.slice(0, 200), /min-width: 0/, 'the tiles can push their own columns wider again')

    // A phone has no floating Ask button, so it keeps none of its footprint —
    // that was 80px at the bottom of the screen with the least room.
    // Anchored on the rule that hides the button, not on the width — there is
    // an earlier 700px block in this file and it is about something else.
    const noFab = code.slice(code.indexOf('.ask-anywhere {\n    display: none;'))
    assert.match(
      noFab.slice(0, 1400),
      /\.shell \{\s*padding-bottom: max\(16px, env\(safe-area-inset-bottom/,
      'the phone keeps 80px clear under a button it does not have'
    )
  })

  test('the search row the arrows are on is visible', () => {
    const rule = code.slice(code.indexOf('.param-search-hit.active {'), code.indexOf('}', code.indexOf('.param-search-hit.active {')))
    assert.match(rule, /border-color: var\(--signal\)/, 'the active search row looks like every other row')
  })

  test('the small type is 11px, state words are opaque, pills are targets with a mouse, and the bar says what it means', () => {
    const rule = (sel) => code.slice(code.indexOf(sel + ' {'), code.indexOf('}', code.indexOf(sel + ' {')))
    assert.match(code, /--f-1: 11px/, 'the smallest step of the scale is under 11px again')
    assert.ok(!/--f-\d: 10px/.test(code), 'a 10px step is back on the scale')
    assert.ok(!/opacity/.test(rule('.fx-chan')), 'the channel letter is see-through')
    for (const sel of ['button.gig-block.on .gig-block-state', 'button.gig-block.off']) {
      const every = [...code.matchAll(new RegExp(sel.replace(/[.()]/g, '\\$&') + ' \\{[^}]*\\}', 'g'))].map((m) => m[0])
      assert.ok(every.length >= 1)
      for (const r of every) assert.ok(!/opacity/.test(r), `${sel} dims with transparency, which takes the state word with it`)
    }
    assert.match(rule('button.fx-power'), /min-height: 44px/, 'the power pill is under 44px with a mouse')
    assert.match(rule('.strip-btn'), /min-height: 44px/, 'the strip buttons are under 44px with a mouse')
    assert.match(rule('.channel-buttons .chip'), /min-width: 44px/, 'the channel chips are narrow targets')
    const how = rule('.topbar-how')
    assert.match(how, /font-family: var\(--display\)/, '"demo" is set in the mono face again, where it read as "deno"')
    assert.match(how, /text-transform: uppercase/)
    assert.match(code, /\.topbar-slot::before \{\s*content: 'slot '/, 'the slot number has no noun')
  })

  test('the edge fade is at every width and on the grid, scene names wrap, the menu is one scroller', () => {
    // Unindented, so at base scope: every rule inside a media block is indented two spaces.
    const base = code.indexOf("\n.chain-strip[data-overflow='yes'],\n.grid-scroll[data-overflow='yes'] {")
    assert.notEqual(base, -1, 'the overflow fade is not shared by the strip and the grid at base scope (or sits inside the phone block)')
    const name = code.slice(code.indexOf('.scene-name {'), code.indexOf('}', code.indexOf('.scene-name {')))
    assert.match(name, /white-space: normal/, 'a scene name is cut to "Rhyt…" again')
    assert.ok(!/text-overflow: ellipsis/.test(name))
    assert.match(code, /\.scene-row \{[^}]*minmax\(120px, 1fr\)/, 'the scene cell is too narrow for a name and a pencil')
    assert.ok(!/\.scenes \{\s*margin-top: 34px/.test(code), 'the dead air under the Scenes sheet head is back')
  })

  test('the model picker clips with an ellipsis, not mid-word', () => {
    // The control is a button now, not a select: an <option> is one run of text
    // and could not carry a name in one size beside an amp in another. The
    // truncation rule follows the element that shows the chosen name.
    const rule = code.slice(code.indexOf('.type-open-name {'), code.indexOf('}', code.indexOf('.type-open-name {')))
    assert.match(rule, /text-overflow: ellipsis/)
    assert.ok(!/;;/.test(rule), 'a stray double semicolon is back')
    assert.ok(!code.includes('.type-select'), 'the styling for the select the app no longer renders is still here')
  })

  /*
   * The conversation gets the screen it is on.
   *
   * "Right now it feels clunky." Half of that was the tone taking pages. The
   * other half was this: the transcript was a 340px window (260 on a phone) with
   * the page scrolling behind it, on the screen whose own comment says Create
   * "gives it the whole screen". Measured before the change: 19px of 900.
   */
  test('the transcript fills the Create screen rather than a letterbox', () => {
    const chat = css.slice(css.indexOf('.shell.shell-chat'))

    // A height, not a minimum: a column that grows has no reason to scroll, and
    // the transcript pushed the composer off the bottom instead.
    assert.match(chat.slice(0, 900), /height: 100dvh/, 'the chat column has no fixed height')
    assert.ok(!/min-height: 100vh|height: 100vh\b/.test(chat.slice(0, 900)),
      'vh rather than dvh — on iOS that is the tall viewport, so the column outgrows the screen')

    // The chain has to reach: the conversation is inside .screens > .screen,
    // both plain blocks, and a flex column only hands height to flex items.
    assert.match(css, /\.shell-chat \.screens,\s*\n\s*\.shell-chat \.screens > \.screen \{/,
      'the flex chain stops before the conversation, so it stays at content height')
    assert.match(css, /\.chat-screen \.assistant-log \{[^}]*max-height: none/,
      'the log keeps its letterbox cap on the screen that is meant to be its home')
  })

  /*
   * And the box you type into gets the width of the row it is in.
   *
   * `.refine-row` was referenced in two components and styled in none, so the
   * row was a plain block and the field kept a browser default: 230 pixels, on
   * a 1280-pixel window and on a 390-pixel phone alike. Measured after: 1046 of
   * 1113 on the desktop.
   */
  test('the box you type in is as wide as the row and as tall as what is in it', () => {
    const row = code.slice(code.indexOf('.refine-row {'), code.indexOf('}', code.indexOf('.refine-row {')))
    assert.match(row, /display: flex/, 'the composer row is a plain block again, so the box keeps its default width')
    /* At the bottom, so the button stays put as the box grows upward. */
    assert.match(row, /align-items: flex-end/, 'the button drifts down the screen as the box grows')

    const field = code.slice(
      code.indexOf('.refine-row .refine-input {'),
      code.indexOf('}', code.indexOf('.refine-row .refine-input {'))
    )
    /* A field carries an intrinsic width; without this a flex item will not go
       below it, which is how one 230px box survived every screen. */
    assert.match(field, /min-width: 0/, 'the box cannot shrink below its intrinsic width')
    assert.match(field, /flex: 1 1 auto/, 'the box does not take the space in the row')

    const area = code.slice(
      code.indexOf('textarea.refine-input {'),
      code.indexOf('}', code.indexOf('textarea.refine-input {'))
    )
    /* The height is computed from the content, so a ceiling is what stops a
       pasted page from eating the conversation above it. */
    assert.match(area, /max-height:/, 'a long request grows the box without limit')
    assert.match(area, /overflow-y: auto/, 'past the ceiling the box clips rather than scrolls')
    assert.match(area, /resize: none/, 'a drag handle fights the height being computed')
    /* It changed element, and the blanket textarea rule is written for the big
       description box — a different face, size, ground and pad. */
    assert.match(area, /font-family: var\(--mono\)/, 'the box quietly changed typeface')

    /*
     * And it is still a target under a thumb. The 44px floor names elements
     * individually because that is the only thing that beats the rules setting
     * their heights — and an element selector does not follow a class across
     * element types, so `input.refine-input` stopped covering this box the
     * moment it became a textarea.
     */
    assert.match(code, /textarea\.refine-input,/, 'the box you type in is under 44px on a phone again')
  })

  /*
   * The preset name gets the room; the chips beside it stop taking it.
   *
   * "Make the save and connect button a little bit smaller, it's overlapping
   * slightly into the preset name." On a 390px screen the name wanted 108px and
   * had 98, so it read "Puppet…" — and the chip on that phone says "connected",
   * which is three characters longer than the short case anyone measuring
   * casually would land on.
   *
   * What came off is horizontal padding and the tracking on a word that does
   * not need it. What did not come off is height: these are the controls
   * somebody presses standing up, mid-song.
   */
  test('the bar spends its width on the name, and its chips are still targets', () => {
    /* The phone block that carries all of it — found by the promise made in it
       rather than by counting media queries. */
    /* Anchored on the promise itself — `.topbar-name` appears twice, and the
       base rule is not the one that matters here. */
    const at = code.indexOf('min-width: 8ch')
    assert.ok(at > 0, 'the promise of eight characters of preset name is gone')
    const block = balanced(code, code.lastIndexOf('@media (max-width: 620px)', at))
    assert.ok(block.includes('min-width: 8ch'), 'the phone rules for the bar are not one block')

    for (const [what, rule] of [
      ['the row', /\.topbar-row \{[^}]*gap: var\(--s-1\)/],
      ['Save', /\.save-cluster button\.save-now \{[^}]*padding: var\(--s-2\) var\(--s-2\)/],
      ['the link chip', /button\.phone-chip\.compact \{[^}]*padding: var\(--s-1\) var\(--s-1\)/],
      ['the preset button', /button\.topbar-preset \{[^}]*padding: var\(--s-1\)/],
      ['the slot and the name', /\.topbar-preset-line \{[^}]*gap: var\(--s-1\)/]
    ]) {
      assert.match(block, rule, `${what} takes back the width it gave the preset name`)
    }

    /* The tracking on a nine-letter word cost five pixels of the name. */
    assert.match(block, /letter-spacing: normal/, 'the chip is tracked again, at the name’s expense')

    /*
     * And none of it came out of the height. Every height here is set outside
     * the phone block, so a padding change cannot quietly shrink a target —
     * this fails if somebody ever answers "a little bit smaller" with the one
     * dimension that must not move.
     */
    assert.ok(
      !/min-height|height:/.test(block.slice(block.indexOf('.topbar-row {'))),
      'something in the bar got shorter rather than narrower'
    )
    assert.match(code, /\.save-cluster button\.save-now \{[^}]*min-height: 46px/,
      'the Save button lost its floor')
  })

  /*
   * A four-slot chain runs across; a twelve-column grid never can.
   *
   * "Show them horizontally like it does on the device itself." The AM4 is four
   * switches in a row and signal runs along them. The reason this was a stacked
   * list to begin with is the other unit: the old horizontal grid was 940px
   * wide on a 390px phone, which is the bug that rebuild fixed.
   */
  test('the chain runs across only on the unit whose chain fits across', () => {
    const across = code.slice(code.indexOf('.chain-lane[data-linear] {'))
    assert.ok(across.length > 100, 'the linear chain no longer has a layout of its own')
    assert.match(across.slice(0, 200), /flex-direction: row/, 'the four slots are stacked again')

    /*
     * The plain lane stays a column. A bare `.chain-lane` going horizontal puts
     * twelve columns on a phone, which is the 940px grid back.
     */
    const plain = code.slice(code.indexOf('.chain-lane {'), code.indexOf('}', code.indexOf('.chain-lane {')))
    assert.match(plain, /flex-direction: column/, 'a grid unit lays its twelve columns across a phone again')

    /*
     * And the slot you tap gets the whole row back for its controls — a quarter
     * of a phone is 85px, and a model picker does not fit in it.
     */
    assert.match(code, /\.chain-lane\[data-linear\] \.chain-slot\.open \{[^}]*flex-basis: 100%/,
      'the open slot keeps its quarter of the row, so its controls are unreachable')
  })

  /*
   * An arrow at the end of the box, and a box you would type a sentence into.
   *
   * "Instead of a send button below the chat box, put a send arrow on the right
   * side of it. Also, let's make the chat box text entry a little more rounded
   * instead of square."
   */
  test('the composer ends in a round arrow and the box is not a rectangle', () => {
    const btn = code.slice(code.indexOf('button.send-btn {'), code.indexOf('}', code.indexOf('button.send-btn {')))
    assert.ok(btn.length > 40, 'the send arrow has no style of its own')
    assert.match(btn, /border-radius: 50%/, 'the arrow is square again')
    /* Round is not an excuse to be small: this is pressed with a thumb. */
    assert.match(btn, /width: 44px/, 'the arrow is under a thumb-sized target')
    assert.match(btn, /height: 44px/, 'the arrow is under a thumb-sized target')
    /* It must not stretch as the box grows — flex-end keeps it at the bottom,
       and a fixed basis keeps it a circle. */
    assert.match(btn, /flex: 0 0 auto/, 'the arrow stretches with the box')

    const box = code.slice(code.indexOf('textarea.refine-input {'), code.indexOf('}', code.indexOf('textarea.refine-input {')))
    const radius = box.match(/border-radius: var\(--r-(\d)\)/)
    assert.ok(radius, 'the box takes whatever radius it inherits')
    assert.ok(Number(radius[1]) >= 3, `the box is back to a ${radius[0]} corner, which is the panel edge`)
  })
}
