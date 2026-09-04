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
    const phone = code.slice(code.indexOf('@media (max-width: 620px) {\n  .gig-blocks {'))
    assert.match(phone.slice(0, 400), /button\.gig-block,\s*\n\s*button\.gig-scene \{\s*min-height: 66px/, 'on a phone the scenes and the blocks are sized apart again')
    assert.match(rule('.gig-block-name'), /font-size: var\(--f-4\)/, 'the block name is small again')
    assert.match(rule('button.gig-scene.named .gig-scene-name'), /font-size: var\(--f-4\)/, 'the scene name is small again')
    assert.match(rule('.gig-block-state'), /font-size: var\(--f-2\)/)
    assert.match(rule('.topbar-name'), /font-size: var\(--f-3\)/, 'the preset name in the bar is a headline again')
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
    const rule = code.slice(code.indexOf('.type-select {'), code.indexOf('}', code.indexOf('.type-select {')))
    assert.match(rule, /text-overflow: ellipsis/)
    assert.ok(!/;;/.test(rule), 'a stray double semicolon is back')
  })

}
