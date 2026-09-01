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
}
