/**
 * The gestures, held apart from the taps.
 *
 * Three surfaces bind `touchstart` themselves rather than through React, for a
 * reason each of them documents: React registers touch listeners as passive, so
 * a `preventDefault` inside one is ignored and iOS takes the gesture as a page
 * scroll before the first move is answered.
 *
 * That `preventDefault` has a second effect, and it is the one that bites. It
 * also suppresses the click iOS would have synthesised from the press — so any
 * control *inside* a grab surface stops working, silently, on a phone only, in
 * a way no unit test and no desktop pass will show. The sheet's close button
 * spent a release doing nothing for exactly this reason while the swipe it
 * shares a header with worked perfectly.
 *
 * So: a grab surface either contains no controls, or it lets their touches
 * through before it takes the grab.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('../src/components/', import.meta.url)
const read = (file) => readFileSync(new URL(file, dir), 'utf8')

export function run(test) {
  test('only the known surfaces take a touch gesture themselves', () => {
    /*
     * Not a style rule — a review trigger. Binding a non-passive touchstart is
     * how you opt out of the click, and a fourth one should be a decision
     * somebody made on purpose rather than a paste of the other three.
     */
    const binds = readdirSync(dir)
      .filter((f) => f.endsWith('.jsx'))
      .filter((f) => /addEventListener\('touchstart'/.test(read(f)))
      .sort()
    assert.deepEqual(binds, ['Knob.jsx', 'Screens.jsx', 'Sheet.jsx'])
  })

  test('the screens take nothing on the press and yield to anything sideways', () => {
    /*
     * The fourth surface is the whole page. Every control on every screen is
     * inside it, so the two rules the others can bend are absolute here: the
     * touchstart is passive and never cancels the press, and a drag that begins
     * on something with its own sideways gesture — the chain strip, a grid, a
     * knob, a pad, a text field — is not a swipe.
     */
    const screens = read('Screens.jsx').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    assert.match(
      screens,
      /addEventListener\('touchstart', begin, \{ passive: true \}\)/,
      'the screens now grab the press — every tap on every screen goes with it'
    )
    const begin = screens.slice(screens.indexOf('const begin = ('))
    const body = begin.slice(0, begin.indexOf('\n    }'))
    assert.ok(!/preventDefault/.test(body), 'the screens cancel the press on touchstart')
    assert.ok(/closest\?\.\(YIELDS\)/.test(body), 'the screens no longer yield to surfaces that own a sideways drag')

    const yields = screens.match(/YIELDS =\s*'([^']+)'/)?.[1] || ''
    for (const owner of ['.chain-strip', '.grid-scroll', '.knob', 'input', '[data-no-swipe]']) {
      assert.ok(yields.split(',').map((s) => s.trim()).includes(owner), `${owner} is no longer left its own gesture`)
    }

    // Sideways only after the finger has plainly gone sideways; vertical scroll wins until then.
    assert.match(screens, /Math\.abs\(dx\) > INTENT && Math\.abs\(dx\) > SLACK \* Math\.abs\(dy\)/)
    assert.match(screens, /if \(!touch\.still\) page\.style\.transform/, 'reduced motion still drags the page under the finger')
  })

  test('all three screens sit inside the swipe surface', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const open = app.indexOf('<Screens ')
    const shut = app.indexOf('</Screens>')
    assert.ok(open !== -1 && shut > open, 'the screens are no longer wrapped')
    const inside = app.slice(open, shut)
    for (const v of ['play', 'shape', 'ask']) {
      assert.ok(inside.includes(`view === '${v}'`), `the ${v} screen is outside the swipe surface`)
    }
    assert.ok(!/<Sheet\b/.test(inside), 'a sheet is inside the swipe surface — it would travel with the page')
    assert.ok(!inside.includes('className="views"'), 'the tabs are inside the surface they switch')
    // onChange is a named handler rather than setView itself: a tab pressed by
    // hand also clears the report of what the last request in words did, which
    // is otherwise left on a screen the person has moved on from.
    // And `order` is what the surface may swipe between, which is not always
    // all three: a phone reaches the stage screen alone, and a swipe that
    // could still reach Ask would walk around that.
    assert.match(
      app,
      /<Screens view=\{view\} enabled=\{status === 'live'\} order=\{views\} onChange=\{changeView\}>/
    )
  })

  test('a grab surface holding a control lets the control have its tap', () => {
    /*
     * The sheet's header is the handle *and* the home of the close button, so
     * it is the one surface that has to make the distinction. Knob's element
     * hold only decoration, which is why they can take
     * every touch that reaches them.
     */
    // Comments out first: this very handler explains itself by naming
    // preventDefault, and a test that reads the explanation instead of the
    // code passes on a file that says the right thing and does the wrong one.
    const sheet = read('Sheet.jsx').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const begin = sheet.slice(sheet.indexOf('const begin = ('))
    const body = begin.slice(0, begin.indexOf('\n    }'))

    const bail = body.indexOf('closest')
    const stop = body.indexOf('preventDefault')
    assert.ok(bail !== -1, 'the sheet grabs every touch on its header, close button included')
    assert.ok(bail < stop, 'the sheet cancels the press before it checks what was pressed')
  })

  test('the swipe is still bound to the header, never the body', () => {
    // The block sheet is full of knobs, and a knob is a vertical drag. A
    // dismiss handler on the body would fight every one of them.
    const sheet = read('Sheet.jsx')
    assert.match(sheet, /const grip = handle\.current/)
    assert.match(sheet, /<header className="sheet-head" ref={handle}>/)
    assert.ok(
      !/ref={panel}[\s\S]{0,400}addEventListener\('touchstart'/.test(sheet),
      'drag-to-dismiss reached the sheet body'
    )
  })
}
