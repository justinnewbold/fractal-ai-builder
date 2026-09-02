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

    // And the scale itself is seven steps, not seven plus whatever crept in.
    const steps = [...code.matchAll(/--f-(\d): ([0-9]+)px/g)].map((m) => m[2])
    assert.equal(steps.length, 7, `the type scale has ${steps.length} steps`)
    assert.deepEqual(steps, ['10', '11', '12', '13', '15', '20', '28'])
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
  test('the pad fits the screen instead of filling the column', () => {
    /*
     * A square pad with no cap was as wide as the column: 358px on a phone,
     * where it pushed the scene you were in off the screen, and 1148px on a
     * desktop, where it was the page. It is a control, not a screen.
     */
    const at = code.indexOf('.xy-pad {')
    assert.notEqual(at, -1)
    const rule = code.slice(at, code.indexOf('}', at))
    const width = rule.match(/width: ([^;]+);/)?.[1] || ''
    assert.match(width, /min\(/, 'the pad is as wide as whatever it is in')
    assert.match(width, /\d+px/, 'no pixel cap on the pad')
    assert.match(width, /\d+vh/, 'no cap against the screen height, so a phone in landscape gets a pad taller than the screen')
    assert.match(rule, /aspect-ratio: 1/, 'the pad is no longer square')
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
    assert.match(code, /\.preset-menu \.preset-scroll \{[^}]*max-height: min\(52vh, 420px\)/, 'the top-bar menu lost its cap')
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

  test('the floating Ask and the Ask tab swap at the phone breakpoint', () => {
    const at = code.indexOf('button.ask-tab {')
    assert.notEqual(at, -1, 'the phone/desktop swap for Ask is gone')
    const block = code.slice(at, at + 600)
    assert.match(block, /^button\.ask-tab \{\s*display: none/, 'the Ask tab shows on wide screens too')
    assert.match(block, /@media \(max-width: 700px\) \{[^@]*\.ask-anywhere \{\s*display: none/, 'the floating Ask still floats over a phone’s controls')
    assert.match(block, /@media \(max-width: 700px\) \{[^@]*button\.ask-tab \{\s*display: inline-flex/, 'the Ask tab is missing on a phone')
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
    assert.match(code, /\.chain-strip\[data-overflow='yes'\] \{[^}]*mask-image/, 'the chain strip has no edge fade when it scrolls')
  })

  test('on paper the faint type still reads', () => {
    /*
     * The cream theme's --silk-faint was #8b9099 on #f2efe9: 2.8:1, under
     * even the large-text floor, on every "FM3", "500", "set up", "Off" and
     * inactive tab. WCAG AA for text is 4.5:1.
     */
    const block = code.slice(code.indexOf("[data-theme='light'] {"), code.indexOf('}', code.indexOf("[data-theme='light'] {")))
    const token = (name) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))?.[1]
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    for (const ground of ['chassis', 'panel']) {
      for (const ink of ['silk', 'silk-dim', 'silk-faint']) {
        const r = ratio(token(ink), token(ground))
        assert.ok(r >= 4.5, `--${ink} on --${ground} is ${r.toFixed(2)}:1 in the light theme`)
      }
    }
  })

}
