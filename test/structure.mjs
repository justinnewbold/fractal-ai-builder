/**
 * Structural checks on App.jsx.
 *
 * Three bugs this session were about where things were rather than what they
 * did, and all sixty logic tests passed through every one: panels rendering in
 * Edit while every announcement said Library, the error banner living inside
 * Design so failures anywhere else were silent, and four props dropped while
 * rewriting a view.
 *
 * These read the source rather than mount it. That is a deliberate trade —
 * App.jsx cannot be imported by node, because the mock device imports JSON —
 * and it is enough, because the failures were all visible in the structure. A
 * panel in the wrong block, a missing prop and a banner nested inside a
 * conditional are all things you can see without a browser.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
/* The grid rules both apps share, so the checks below can RUN them rather than
   read them out of whichever file happens to hold them this month. */
import { cableColumns, doubtfulWrite, toWireCell as wireCell } from '../shared/grid-plan.mjs'
import { linkTone, linkWord, toneOfRemote } from '../shared/link-word.mjs'
import { describeLink } from '../src/lib/link.js'
/* Used by the one check below that reads the TEST files rather than the app. */
import { parse } from '@babel/parser'
import babelTraverse from '@babel/traverse'

/* CommonJS interop: @babel/traverse's default export is on `.default` under
   some resolutions and is the module itself under others. */
const traverse = babelTraverse.default || babelTraverse

const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
/* The Ask button's rule lives in a module so it can be asserted as behaviour
   rather than as a line of App.jsx that a comment could impersonate. */
const play = await import('../src/lib/playMode.js')

/** Everything rendered inside one view's conditional block. */
function view(name) {
  const start = src.indexOf(`view === '${name}' ? (`)
  assert.notEqual(start, -1, `no ${name} view found`)

  /*
   * Ends at the next view, or at the sheets that follow the last one. It used
   * to end at a trailing `<section hidden=`, which Phase 4 deleted — without
   * this the final view's segment ran to the end of the file and every
   * placement assertion silently started reading components in no view at all.
   */
  const rest = src.slice(start + 20)
  const next = rest.search(/\{status === 'live' && view === '|\{status === 'live' \? \(|Sheets\. Things you open/)
  return rest.slice(0, next === -1 ? undefined : next)
}

/** Everything rendered inside one sheet, asserted against the sheet itself. */
function sheet(title) {
  const at = src.indexOf(`title="${title}"`)
  assert.notEqual(at, -1, `no sheet titled ${title}`)
  const open = src.lastIndexOf('<Sheet', at)
  const shut = src.indexOf('</Sheet>', at)
  assert.ok(open !== -1 && shut > open, `the ${title} sheet is not closed`)
  return src.slice(open, shut)
}

const components = (segment) => [...new Set([...segment.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))]

/**
 * The props of a component, as written.
 *
 * Not a regex to the first `>`: props hold arrow functions, and `(a, b) =>`
 * contains a `>` that ends the match early — which had this reporting a missing
 * onError on a component that plainly has one. So it walks the braces instead
 * and stops at the `>` that is actually outside them.
 */
function tag(segment, name) {
  const at = segment.search(new RegExp(`<${name}\\b`))
  if (at === -1) return null
  let depth = 0
  for (let i = at + name.length + 1; i < segment.length; i++) {
    const ch = segment[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return segment.slice(at, i)
  }
  return null
}

/**
 * The props a component actually declares, read from its own signature.
 *
 * Written after passing <Cost writes={...} /> — a prop that component has never
 * had. It rendered nothing, forever, silently. Comparing what a call site
 * passes against what the component destructures catches invented props and
 * renamed ones, which no amount of reading the call site will.
 */
function declaredProps(component) {
  // A component may be a named export of a differently-named file, so find the
  // file that declares it rather than assuming the two match.
  const dir = new URL('../src/components/', import.meta.url)
  let src = null
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsx')) continue
    const body = readFileSync(new URL(file, dir), 'utf8')
    if (new RegExp(`function ${component}\\s*\\(`).test(body)) {
      src = body
      break
    }
  }
  if (!src) return null
  const m = src.match(new RegExp(`function ${component}\\s*\\(\\s*\\{([^}]*)\\}`, 's'))
  if (!m) return null
  return m[1]
    .split(',')
    .map((x) => x.split(/[=:]/)[0].trim())
    .filter(Boolean)
}

export function run(test) {
  test('call sites only pass props the component has', () => {
    // Every component, every caller — including components calling components.
    // The six-name version of this check missed <Stages partial={...} /> when
    // Stages takes active: rendered fine, sat frozen forever.
    const dir = new URL('../src/components/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'))
    const bodies = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]))

    /*
     * Signatures per file, resolved local-first.
     *
     * Two files can declare components with the same name — Grid.jsx has a
     * private Chain that takes different props from Console.jsx's exported
     * Chain — and a flat name-to-signature map picks whichever file happened to
     * parse last. That false positive nearly caused a real bug: acting on it
     * removed a prop the local component genuinely declares.
     */
    const perFile = {}
    const everywhere = {}
    for (const [file, body] of Object.entries(bodies)) {
      perFile[file] = {}
      /*
       * Comments out before the signature is read.
       *
       * The parameter list is matched as everything up to the first `}`, then
       * split on commas — so a block comment explaining one prop puts its own
       * prose and its own commas into the list, and every name it touches is
       * dropped from the accepted set. The failure that follows is a call site
       * being told a prop "does not accept", which is the opposite of true and
       * sends you to fix the wrong file. This app comments almost everything;
       * a guard that breaks when a prop is explained is a guard that punishes
       * the house style.
       */
      const declarations = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      for (const m of declarations.matchAll(
        /(?:export default |export )?function ([A-Z]\w+)\s*\(\s*\{([^}]*)\}/gs
      )) {
        const props = m[2]
          .split(',')
          .map((x) => x.split(/[=:]/)[0].trim())
          .filter((x) => /^\w+$/.test(x))
        perFile[file][m[1]] = props
        everywhere[m[1]] = [...new Set([...(everywhere[m[1]] || []), ...props])]
      }
    }

    const callers = { 'App.jsx': src, ...bodies }
    for (const [caller, body] of Object.entries(callers)) {
      for (const name of Object.keys(everywhere)) {
        // The component defined in the caller's own file wins; otherwise the
        // union of every declaration, which cannot produce a false failure.
        const props = perFile[caller]?.[name] || everywhere[name]
        // Skip a component's own definition file matching its wrapper usage.
        let from = 0
        for (;;) {
          const at = body.indexOf('<' + name, from)
          if (at === -1) break
          const boundary = body[at + name.length + 1]
          if (boundary && /[\w-]/.test(boundary)) {
            from = at + 1
            continue
          }
          let i = at + name.length + 1
          let depth = 0
          while (i < body.length) {
            const ch = body[i]
            if (ch === '{') depth++
            else if (ch === '}') depth--
            else if (ch === '>' && depth === 0) break
            i++
          }
          /*
           * Only this tag's own props.
           *
           * A prop whose value is JSX — <TopBar menu={<div className=…/>} /> —
           * carries other components' props inside it, and a flat scan read
           * every one of them as belonging to the outer tag. So the braced
           * values are removed before the names are taken; what is left is the
           * attribute list this tag actually writes.
           */
          const bare = body.slice(at, i).replace(/=\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, '=')
          const passed = [...bare.matchAll(/(\w+)=/g)].map((m) => m[1])
          for (const prop of passed) {
            assert.ok(
              props.includes(prop) || prop === 'key' || prop === 'children',
              `${caller}: <${name}> is passed "${prop}", which it does not accept`
            )
          }
          from = i
        }
      }
    }
  })

  test('no hook watches something declared further down its own function', () => {
    /*
     * The blank page. "The app couldn't draw — Cannot access 'we' before
     * initialization", and nothing else on the screen, on every device at
     * once.
     *
     * A dependency array is evaluated DURING RENDER. An effect written near
     * the top of a component that lists a `const` defined further down reaches
     * into that const's temporal dead zone and throws before anything is
     * drawn — and it throws in the one place nothing catches usefully, so the
     * whole app is a sentence on an empty page. Minified, the name in that
     * sentence is two letters and says nothing about where to look.
     *
     * Console.jsx has carried a comment about this trap for months, learned
     * the same way, and it happened again anyway — in App.jsx, four hundred
     * lines apart, with 640 passing tests. Nothing here runs the app, so
     * nothing here could catch it. This can: the hazard is visible in the
     * order of the file, which is exactly what these tests read.
     *
     * Function declarations are hoisted and are not a hazard, so they are not
     * listed. Each top-level function is scanned as its own scope, because a
     * name declared in one component says nothing about a name used in
     * another.
     */
    const scopes = (text) => {
      const starts = [...text.matchAll(/\n(?:export default |export )?function [A-Za-z_$][\w$]*\s*\(/g)].map(
        (m) => m.index
      )
      if (!starts.length) return [{ at: 0, text }]
      return starts.map((at, i) => ({ at, text: text.slice(at, starts[i + 1] ?? text.length) }))
    }

    /* Where a name's dead zone ends, or null when nothing here declares it —
       a prop, an import, or something from an enclosing scope. */
    const declaredAt = (text, name) => {
      const n = name.replace(/\$/g, '\\$')
      const patterns = [
        `\\n\\s*const ${n}\\b\\s*=`,
        `\\n\\s*let ${n}\\b\\s*=`,
        `\\n\\s*const \\[\\s*${n}\\b`,
        `\\n\\s*const \\[[^\\]]*,\\s*${n}\\s*\\]`,
        `\\n\\s*const \\{[^}]*\\b${n}\\b[^}]*\\}\\s*=`
      ]
      let first = null
      for (const p of patterns) {
        const m = text.match(new RegExp(p))
        if (m && (first === null || m.index < first)) first = m.index
      }
      return first
    }

    const files = [
      ['App.jsx', src],
      ...readdirSync(new URL('../src/components/', import.meta.url))
        .filter((f) => f.endsWith('.jsx'))
        .map((f) => [
          `components/${f}`,
          readFileSync(new URL(`../src/components/${f}`, import.meta.url), 'utf8')
        ])
    ]

    const found = []
    for (const [name, text] of files) {
      for (const scope of scopes(text)) {
        for (const arr of scope.text.matchAll(/\},\s*\[([^\]]*)\]\)/g)) {
          const deps = arr[1]
            .split(',')
            .map((d) => d.trim().split(/[.?[(]/)[0].trim())
            .filter((d) => /^[A-Za-z_$][\w$]*$/.test(d))
          for (const dep of new Set(deps)) {
            const at = declaredAt(scope.text, dep)
            if (at === null || at < arr.index) continue
            const line = text.slice(0, scope.at + arr.index).split('\n').length
            found.push(`${name}:${line} watches \`${dep}\`, which is declared below it`)
          }
        }
      }
    }

    assert.deepEqual(found, [], `a hook reaches into a dead zone and the app will not draw:\n${found.join('\n')}`)
  })

  test('every component rendered is one this file can actually see', () => {
    /*
     * `<DeviceDetail>` moved from the top bar into a sheet in App and was not
     * imported there. The build was green — Vite bundles JSX without resolving
     * identifiers — and every one of these tests passed. The app threw
     * "DeviceDetail is not defined" on first paint, and only running it found
     * that out.
     *
     * A component tag is a plain identifier. Either the file imports it or the
     * file defines it; anything else is a reference error waiting for the
     * branch that renders it to be reached, which may be a screen nobody
     * opens in testing.
     */
    const dir = new URL('../src/', import.meta.url)
    const files = {}
    const walk = (at, prefix = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
        if (entry.isDirectory()) walk(next, prefix + entry.name + '/')
        else if (/\.jsx$/.test(entry.name)) files[prefix + entry.name] = readFileSync(next, 'utf8')
      }
    }
    walk(dir)

    // React's own, plus the fragment shorthand, which has no import.
    const builtin = new Set(['Fragment', 'StrictMode', 'Suspense', 'Profiler'])

    for (const [name, raw] of Object.entries(files)) {
      const body = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const known = new Set(builtin)
      for (const m of body.matchAll(/^import\s+([\s\S]*?)\s+from\s+/gm)) {
        for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
          const id = part.trim().split(/\s+as\s+/).pop().trim()
          if (/^[A-Za-z_$][\w$]*$/.test(id)) known.add(id)
        }
      }
      for (const m of body.matchAll(/(?:function|const|class)\s+([A-Z]\w*)/g)) known.add(m[1])

      for (const m of body.matchAll(/<([A-Z]\w*)[\s/>]/g)) {
        assert.ok(
          known.has(m[1]),
          `${name} renders <${m[1]}> but neither imports nor defines it`
        )
      }
    }
  })

  test('each screen holds what it is for, and nothing it is not', () => {
    /*
     * Two screens now, and the things you open are sheets. The original of
     * this test existed because five panels named in the UI as Library spent
     * three releases rendering in Edit; the same mistake is now possible in a
     * new direction — setup leaking onto a screen you look at on a stage.
     *
     * There were three. Create held the conversation and went with the AI,
     * taking BandBook out of the Setup sheet with it.
     */
    const play = components(view('play'))
    assert.deepEqual(play, ['Gig'], `Play should be the gig screen alone, not ${play.join(', ')}`)

    for (const name of ['Chain', 'ParamSearch', 'GridEditor', 'Modifiers']) {
      assert.ok(components(view('shape')).includes(name), `${name} should be on Shape`)
    }

    // Setup on the stage screen is how you change the host address by accident.
    for (const name of ['PhoneRemote', 'LinkDetails', 'ConnectScreen', 'SignInSheet', 'Ports', 'Diagnostics', 'LocalLibrary']) {
      assert.ok(!play.includes(name), `${name} is on Play`)
      assert.ok(!components(view('shape')).includes(name), `${name} is on Shape, not in a sheet`)
    }

    // And the sheets hold what was taken out of the views.
    for (const [title, names] of [
      ['Presets', ['PresetList', 'LocalLibrary', 'Backup', 'Versions', 'DeviceBackup']],
      ['Scenes', ['Scenes', 'SceneMatrix']],
      ['Settings', ['DeviceDetail', 'PhoneRemote', 'Ports', 'ChangeLog', 'DebugLog', 'Diagnostics', 'LinkDetails']]
    ]) {
      for (const name of names) {
        assert.ok(components(sheet(title)).includes(name), `${name} should be in the ${title} sheet`)
      }
    }
  })

  test('Play can fit the whole rig on one screen, and the bar sits clear of the glass', () => {
    /*
     * "It would be nice just to have everything static on the screen without
     * being able to scroll." Fit is a switch under Button size: Play wears
     * the trimmed layout, measures what the screen has left after its own
     * chrome, and hands that to fitTiles for the tile height and the block
     * columns. And "I'm on iOS 27 and the top of the screen is now blurry":
     * the bar lost its backdrop blur and sits ten pixels under the inset on
     * the home screen.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    assert.match(gig, /const compact = fit \|\| size === 0/, 'Fit does not wear the trimmed layout')
    assert.match(gig, /const chrome = el\.scrollHeight - grids/, 'the chrome is not measured as the screen less its grids')
    assert.match(gig, /fitTiles\(\{\s*\n\s*available: viewport - top - chrome/, 'the grids are not handed what the screen has left')
    assert.match(gig, /'--gig-fit-tile': `\$\{fitVars\.tile\}px`, '--gig-fx-cols': String\(fitVars\.fxCols\)/, 'the measured height does not reach the tiles')
    assert.match(gig, /\}, \[fit, hasScenes, sceneCount, blocks\.length\]\)/, 'the measure does not follow the rig')
    assert.match(src, /fit=\{fit\}/, 'Play is not told about Fit')
    assert.match(src, /Fit everything on one screen/, 'Setup has no Fit switch')
    assert.match(src, /disabled=\{fit \|\| size <= 0\}/, 'the size steps still move while Fit is on')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /\.gig\[data-compact\] button\.gig-scene \{[^}]*height: var\(--gig-fit-tile, 56px\)/, 'a scene tile ignores the fitted height')
    assert.match(css, /\.gig\[data-compact\] button\.gig-block \{[^}]*height: var\(--gig-fit-tile, 52px\)/, 'a block tile ignores the fitted height')
    assert.doesNotMatch(css, /\.topbar \{[^}]*backdrop-filter/, 'the bar is a blurred layer again')
    assert.match(css, /@media \(display-mode: standalone\) \{\s*\n\s*\.topbar \{\s*\n\s*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 10px\)/, 'the bar starts under the glass on the home screen')
  })

  
  
  
  
  
  
  
  test('the build says which build it is, not just which version', () => {
    /*
     * Seven merges shipped under v6.9.5, because the number is hand-written and
     * hand-written numbers get forgotten. The commit doesn't: it changes with
     * every build on its own. So the two travel together wherever the build
     * identifies itself, and "is my fix in the thing I'm looking at" stops
     * depending on anyone's memory.
     */
    const detail = readFileSync(new URL('../src/components/DeviceDetail.jsx', import.meta.url), 'utf8')
    assert.ok(detail.includes('{FULL}'), 'the setup fold shows a version with no commit beside it')
    assert.ok(!/\bVERSION\b/.test(detail), 'a bare version number is back on screen')
  })

  test('the chrome above the first control stays one bar deep', () => {
    /*
     * The number this restructure exists for. It was six stacked elements and
     * about 290px on a phone — 35-40% of the screen spent before anything you
     * came to do. A browser measures it properly (there's a harness for that);
     * what a text test can hold is the shape that produced it, so it can't be
     * rebuilt one well-meaning row at a time.
     *
     * The rule: between the update notice and the first view, the only things
     * rendered are the bar, the states that mean the app can't work yet, and
     * the assistant.
     */
    const from = src.indexOf('<TopBar')
    const to = src.indexOf("view === 'play' ? (")
    assert.ok(from !== -1 && to > from, 'the chrome no longer starts at the top bar')
    const chrome = src.slice(from, to)
    const allowed = new Set([
      'TopBar', // the bar itself
      'SaveBar', // rides in it
      // The preset menu, passed to the bar as a prop and absolutely positioned
      // under it. It is in the bar, not stacked above the view — the height it
      // adds to the page is zero, which the browser pass measures directly.
      'PresetList',
      // The phone's connect screen: the one thing to do when it is not
      // connected, on the screen where that is the case. Replaces the bare
      // sign-in form that used to sit under an error notice here.
      'ConnectScreen',
      // The swipe surface. It wraps the views rather than sitting above them
      // and adds no height of its own: the opening tag falls in this slice
      // only because the first view is inside it.
      'Screens',
      /*
       * The two update notices, which moved from ABOVE the bar to under it so
       * that the bar could be pinned — a page reserving a strip above the bar
       * is a bar that travels every time the screen is touched. They render
       * nothing at all unless there is an update, and when there is one, being
       * the first thing under the bar is the point of them.
       */
      'UpdateNotice',
      'UpdateReadyNotice'
    ])
    // The assistant used to be on this list — it sat above every screen at
    // once. It is the Ask tab now, which is what took the chrome down again.
    for (const name of components(chrome)) {
      assert.ok(allowed.has(name), `${name} is stacked above the first view — that is what took 290px`)
    }
  })

  
  test('the bar that carries the whole app renders in every state', () => {
    /*
     * It replaced six stacked elements, all of which were gated on being
     * connected — so the screen you get when nothing is connected had no way to
     * reach the host address or the sign-in that fixes it. The bar is outside
     * every status check, and the gear inside it is how setup is reached when
     * setup is the thing that's wrong.
     */
    const at = src.indexOf('<TopBar')
    assert.notEqual(at, -1, 'no top bar')
    const before = src.slice(0, at)
    const gate = before.lastIndexOf("status === 'live'")
    const opened = before.lastIndexOf('{')
    assert.ok(gate < opened, 'the top bar is behind a status check')
  })

  test('the unit name is pressed, and goes somewhere different in the demo', () => {
    /*
     * "Make it so that if you tap the top left button where it shows the
     * current device in the demo mode, that it'll bring up that same list
     * where you can change which one you're on. In other modes, if they tap
     * that button, just have it show the about where it shows more info about
     * the current device connected."
     *
     * It was a <span>, and it was the first thing anybody pressed — the name
     * of the thing you are driving, top left, looking exactly like the preset
     * beside it, which has been a button since the bar was built.
     *
     * WHAT MAKES IT TWO DESTINATIONS is that the name means two things. In the
     * demo it is a choice, so it opens the five. On a real rig it is a fact,
     * so it opens the page holding the facts — gen, grid, scenes, slots — and
     * the connections behind them. One press, and which page is the app's
     * decision rather than the bar's.
     */
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    assert.match(bar, /<button\s+className="topbar-unit/, 'the unit name is a label again, not a button')
    assert.match(bar, /onClick=\{onOpenUnit\}/, 'the unit name is a button that does nothing')

    const wired = src.replace(/\s+/g, ' ')
    assert.match(
      wired,
      /onOpenUnit=\{\(\) => \{.*setSetupPage\(isDemo\(\) \? 'demo' : 'link'\)/,
      'the unit name no longer opens the picker in the demo and the unit page outside it'
    )
    assert.match(wired, /onOpenUnit=\{\(\) => \{ .*setSheet\('settings'\)/, 'it picks a page without opening the sheet it lives in')

    /* And a button has to be styled as one, or it arrives with a browser's
       default chrome in the middle of the bar. A class named in JSX and absent
       from the stylesheet is not a small mistake in this app. */
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /button\.topbar-unit \{/, 'the unit button has no styling at all')

    /*
     * Both ends. The phone's bar is the browser's bar — "Make sure the iOS app
     * shows this exact header" — and a name that presses in one and not the
     * other is the seam this suite exists to hold. Setup is one screen there
     * rather than a stack, so it cannot open already standing on a page; it
     * lands at the top, where the demo block is the first thing drawn.
     */
    const phone = readFileSync(new URL('../mobile/src/components/TopBar.js', import.meta.url), 'utf8')
    assert.match(phone, /onPress=\{onOpenUnit \|\| onOpenSettings\}/, 'the phone still reads its unit name without pressing it')
  })

  test('the bar says whether it is carrying a preset, and says it once', () => {
    /*
     * "In the top left corner where it shows the device name all of them look
     * good except AXE FX III cuts off... most people will be using this from
     * phones, and so it needs to be able to kind of show that all the way, so
     * it looks clean."
     *
     * The cap on the name is a real rule — a long one must not spend the eight
     * characters the preset name is promised beside it — and it was asking the
     * wrong question. It read the CONNECTION, so it defended the preset's room
     * on every screen that has no preset in this bar at all. Play is one of
     * those, and on a phone Play is the only screen there is: the cap was
     * guarding space nothing could ever use, and cutting a ten-character name
     * to do it.
     *
     * So the bar says it outright, and the ONE condition that draws the preset
     * is the same one that writes it down. Two conditions here would drift,
     * and the way that drift shows up is a name cut short beside an empty half
     * of the bar — which is exactly where this started.
     */
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')

    assert.match(
      bar,
      /const presetInBar = status === 'live' && showPreset/,
      'nothing decides, in one place, whether the preset is in this row'
    )
    assert.match(
      bar,
      /data-preset=\{presetInBar \? 'yes' : 'no'\}/,
      'the bar no longer tells the stylesheet whether it is carrying a preset'
    )
    assert.match(bar, /\{presetInBar \? \(/, 'the preset is drawn off a second condition, which can disagree with the first')

    /* And only the one. A second copy of the test is a second thing to keep in
       step with the attribute. */
    assert.equal(
      (bar.match(/status === 'live' && showPreset/g) || []).length,
      1,
      'the condition that decides whether the preset is in the bar is written out more than once'
    )
  })

  test('the preset picker keeps its controls while the list runs past them', async () => {
    /*
     * "Can we lock the top portion of the part where it shows the numbers you
     * can choose between, like 100, 200, 300, 400, and 500, and then
     * underneath it where there's the filter. So those are always visible...
     * That way, if you're down on like 400, you don't have to scroll all the
     * way back to the top to find a new preset quickly."
     *
     * THE OBVIOUS FIX IS THE ONE ALREADY RULED OUT. Giving the list its own
     * scroll window and leaving the controls outside it is what the rule
     * beside `.sheet-body .preset-scroll` forbids: two scrollers in one sheet
     * fight the same thumb, seven rows at a time. Sticky keeps the single
     * scroller and pins the controls to the top of it.
     *
     * ONE WRAPPER, NOT TWO STICKY ELEMENTS. The head wraps to two rows on a
     * narrow phone, so a separately-pinned search box would need a top offset
     * equal to a height nothing in CSS can know. Pinning the pair as one block
     * needs no such number.
     */
    const con = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

    const pinned = con.indexOf('<div className="preset-pinned">')
    assert.notEqual(pinned, -1, 'the controls are not pinned any more')
    const head = con.indexOf('<div className="panel-head">')
    const box = con.indexOf('className="preset-filter"')
    const list = con.indexOf('<div className="preset-scroll"')
    assert.ok(pinned < head, 'the jumps are outside the pinned block')
    assert.ok(pinned < box && box < list, 'the search box is outside the pinned block, or below the list')

    const rule = css.slice(css.indexOf('.sheet-body .preset-pinned {'))
    assert.notEqual(rule.indexOf('.sheet-body .preset-pinned {'), -1, 'the pinned block has no styling at all')
    const decl = rule.slice(0, rule.indexOf('}'))
    assert.match(decl, /position: sticky/, 'the pinned block does not stick')
    assert.match(decl, /background:/, 'rows pass behind the pinned block with nothing to hide them')
    /*
     * And it reaches up into the sheet's own padding. At `top: 0` it pinned
     * twelve pixels down and the list went on moving through the strip above
     * it — half a preset row sliding along behind the word PRESETS, which
     * reads as a rendering fault rather than as a fixed header.
     */
    assert.match(decl, /top: calc\(var\(--s-3\) \* -1\)/, 'the list shows through the gap above the pinned block')
    assert.match(decl, /padding-top: var\(--s-3\)/, 'the controls sit twelve pixels high of where they were')

    /* Only in a sheet: on a wide screen the list has its own box and the
       controls never leave the screen, so there is nothing to stick to. */
    assert.ok(!/^\.preset-pinned \{/m.test(css), 'the pinned block sticks outside a sheet too, where nothing scrolls past it')

    /* "Lastly, change the word filter to search." */
    assert.match(con, /placeholder="Search"/, 'the box says Filter again')
    assert.match(con, /aria-label="Search presets"/, 'a screen reader is still told it is a filter')
    assert.ok(!/placeholder="Filter"/.test(con), 'the box says Filter again')
  })

  test('the demo opens on the first preset the unit really ships with', async () => {
    /*
     * "In demo mode, can we set it up so that it starts at preset one... and
     * that that is the one that loads first in the demo is whatever's on
     * preset one across all five demo units."
     *
     * It opened on 500, a slot outside the factory bank, invented in the mock
     * and named DEMO. Two things wrong with that: it is not a preset anybody's
     * unit has, which is the one promise this demo makes; and it put the
     * picker five hundred rows down a list of 512, so the first thing anybody
     * did on opening it was scroll back to the top — the same journey the
     * pinned controls above exist to save.
     *
     * Read off each unit's own bank rather than written as 0, so it stays the
     * first preset if a bank ever starts elsewhere.
     */
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const { UNIT_KEYS } = await import('../src/lib/demoUnits.js')
    const { presetsFor } = await import('../src/lib/factoryPresets.js')

    for (const key of UNIT_KEYS) {
      const first = presetsFor(key).find((p) => p.name)
      assert.ok(first, `${key} has no factory bank to open on`)
      const open = createMockDevice(key).preset()
      assert.equal(open.number, first.number, `the ${key} demo does not open on its first preset`)
      assert.ok(open.name, `the ${key} demo opens on a preset with no name`)
      assert.notEqual(open.number, 500, `the ${key} demo still opens on the invented slot 500`)
    }

    /* Each unit's own, which is the whole point of carrying five banks. */
    const names = UNIT_KEYS.map((k) => createMockDevice(k).preset().name)
    assert.ok(new Set(names).size > 1, 'all five demo units open on the same preset name')
  })

  test('a song is dragged up the running order, in the browser too', () => {
    /*
     * "I thought we updated this to where presets or setlist could be
     * rearranged by just dragging and dropping. I don't know if this is just
     * only in the demo version or on the web app."
     *
     * Half right, and the half that was missing is the browser. The phone has
     * dragged setlist songs since setlists arrived; the browser kept a pair of
     * arrows. Same seam as the demo unit picker, the other way round.
     *
     * AND THE ARROWS LOOKED BROKEN, which is how this surfaced. With one song
     * in a list they are both disabled, and a disabled arrow looks exactly
     * like an arrow that does not work — "the little arrows to go up and down
     * don't work" is the phone hearing the same complaint before it changed.
     * A single song now gets no grip at all rather than a control that cannot
     * do anything.
     */
    const web = readFileSync(new URL('../src/components/Setlists.jsx', import.meta.url), 'utf8')
    assert.ok(!/setlist-move/.test(web), 'the browser still moves songs with arrows')
    assert.match(web, /className="setlist-grip"/, 'the browser has no grip to drag a song with')
    assert.match(web, /chosen\.presets\.length > 1 \? \(/, 'a list of one song still draws a control that can do nothing')

    /*
     * The chain editor's maths, out of shared/, so a song lands where a block
     * would. A second landing rule in one app is a second feel to learn.
     */
    assert.match(web, /from '\.\.\/\.\.\/shared\/lane-order\.mjs'/, 'the browser rolled its own landing maths')
    for (const on of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      assert.ok(web.includes(on), `the grip does not handle ${on}, so a drag starts or ends somewhere it should not`)
    }
    assert.match(web, /setPointerCapture/, 'the drag dies the moment the pointer leaves the grip')

    /* And by keyboard, which the arrows did and a bare pointer grip would not. */
    assert.match(web, /const gripKey = /, 'the running order is now pointer-only')
    assert.match(web, /ArrowUp/, 'the grip does not answer the up arrow')

    /*
     * ONLY THE LISTS SOMEBODY MADE. "For starred items and when it shows all,
     * you can leave those in order where they can't be rearranged." True by
     * construction rather than by a flag: this editor is drawn for `chosen`,
     * which is looked up in the setlists, and All presets and Starred are
     * sources rather than setlists — there is nothing here to drag them with.
     */
    assert.match(
      web,
      /const chosen = lists\.find\(\(l\) => l\.id === source\) \|\| null/,
      'the song editor is no longer tied to a list somebody made, so slot order may be draggable'
    )

    /* The grip has to be styled, and has to take the gesture off the page:
       without touch-action the browser claims it as a scroll and the row
       never moves at all on the one device this was asked for. */
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('button.setlist-grip {'))
    assert.notEqual(rule.indexOf('button.setlist-grip {'), -1, 'the grip has no styling at all')
    assert.match(rule.slice(0, rule.indexOf('}')), /touch-action: none/, 'a drag on a phone scrolls the sheet instead of moving the song')

    /* The carried row is opaque. Translated out of the list it passes over the
       search box below, and a see-through row prints its name on top of
       "Find a preset" — two rows in one place rather than one being moved. */
    const lifted = css.slice(css.indexOf('.setlist-song.lifted {'))
    assert.match(lifted.slice(0, lifted.indexOf('}')), /background:/, 'the row being dragged is see-through')
  })


  test('the block editor arrives over the screen, not below it', () => {
    /*
     * It used to be the last row of the console grid. Tapping a block on a
     * phone therefore scrolled the thing you tapped off the top of the screen,
     * and the controls you asked for landed below the fold — which is the
     * whole reason the sheet exists. Nesting is the guarantee: a BlockPanel
     * rendered as a sibling of the chain again is the old bug returning.
     */
    const panel = src.indexOf('<BlockPanel')
    assert.notEqual(panel, -1, 'the block editor is gone')
    /*
     * The sheet it is in, not the first sheet in the file: there are several
     * now, and which one comes first in App is a layout detail. What is held
     * here is that the nearest <Sheet above BlockPanel has not been closed
     * before reaching it — which is exactly "BlockPanel is nested in a sheet",
     * and stays true however the sheets are reordered.
     */
    const open = src.lastIndexOf('<Sheet', panel)
    assert.notEqual(open, -1, 'nothing opens as a sheet')
    assert.ok(
      !src.slice(open, panel).includes('</Sheet>'),
      'the block editor is not inside a sheet'
    )
    assert.equal(
      (src.match(/<BlockPanel/g) || []).length,
      1,
      'the block editor is rendered more than once — one of them is not in a sheet'
    )
  })

  test('a sheet is dismissed by its handle, never by its body', () => {
    /*
     * The single most likely way this restructure destroys the best existing
     * work. The block editor is full of knobs and a knob turn is a vertical
     * drag; a dismiss handler on the sheet body would fight every one of them,
     * and the iOS touch handling underneath took three attempts to get right.
     *
     * So the touchstart goes on the grab handle's ref and on nothing else.
     */
    const sheet = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8')
    const binds = [...sheet.matchAll(/(\w+)\.addEventListener\('touchstart'/g)].map((m) => m[1])
    assert.deepEqual(binds, ['grip'], `touchstart is bound to ${binds.join(', ') || 'nothing'}`)
    assert.ok(
      /const grip = handle\.current/.test(sheet),
      'the drag no longer reads the handle ref'
    )
    assert.ok(
      !/panel\.current\.addEventListener\('touch/.test(sheet),
      'the sheet body has a touch handler on it'
    )
    // Passive listeners ignore preventDefault, and React registers every touch
    // handler as passive — which is why this one is native.
    assert.ok(
      /addEventListener\('touchstart', begin, \{ passive: false \}\)/.test(sheet),
      'the drag listener is passive again, so iOS will take the gesture as a scroll'
    )
  })

  test('the knobs stay put while a parameter is written', () => {
    /*
     * "When I change any parameter the screen basically shakes up and down" —
     * with two screenshots half a second apart, the same sheet at two quite
     * different heights.
     *
     * Every knob commit ends in a full re-read of the unit, which rebuilds the
     * chain and hands the block panel an identical block under a NEW object
     * identity. The panel's parameter read depended on that object, so it
     * threw away six knobs, drew one line of text while it asked the unit for
     * the values it already had, and put them back. A sheet is as tall as its
     * contents, so that is about 200px out of the middle of the screen and
     * back, once per knob.
     *
     * Two things hold it shut: what the read is keyed on, and what is on
     * screen while it runs.
     */
    const con = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const panel = con.slice(con.indexOf('export function BlockPanel('))
    assert.ok(panel, 'the block panel is gone')

    assert.ok(
      !/\}, \[block, onError\]\)/.test(panel),
      'the parameter read depends on the block object again, so every refresh of the chain re-reads it'
    )
    assert.match(panel, /\}, \[readKey, onError\]\)/, 'the parameter read is no longer keyed')
    /*
     * And keyed on all three things that change what a knob here means. The
     * scene is the one worth stating: a block's settings are per-scene, so a
     * footswitch on the floor changes every value on this panel without
     * touching anything in the app.
     */
    assert.match(panel, /const readKey = /)
    for (const part of ['block\\?\\.effectId', 'block\\?\\.channel', 'scene']) {
      assert.match(
        panel.slice(panel.indexOf('const readKey = '), panel.indexOf('const readKey = ') + 120),
        new RegExp(part),
        `the parameter read no longer notices a change of ${part}`
      )
    }
    assert.match(panel, /const scene = useDevice\(/, 'the panel is not watching the live scene')

    // A re-read that does happen keeps the knobs up: the line is for a panel
    // with nothing in it yet, which is the only time it costs no height.
    assert.match(
      panel,
      /\{loading && !shown\.length \? \(/,
      'a re-read empties the deck again, and the sheet jumps with it'
    )

    /*
     * And the thing that handed it a new block in the first place: a knob
     * commit asked the app to re-read the unit — the preset, the block list,
     * the scene, its names and the tempo — for a change to none of them, five
     * round trips down a relay per knob. The switches beside the knobs DO
     * change the chain and still ask.
     */
    assert.match(panel, /\{ chain: false \}/, 'a knob still asks for a full re-read of the unit')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(
      app,
      /onChanged=\{\(summary, change, \{ chain = true \} = \{\}\) => \{/,
      'the block editor cannot say that nothing about the chain moved'
    )
    assert.match(app, /if \(chain\) read\(\)/, 'every knob still re-reads the whole unit')
  })

  test('nothing is said about the unit once the computer has gone quiet', () => {
    /*
     * "This is lying saying that a Mac is connected. My Mac is turned off
     * completely" — under a notice reading THE MAC CAN'T SEE YOUR UNIT, which
     * is a sentence about a unit that only something at the Mac could have
     * said.
     *
     * It had been said, once, while the Mac was on. `device` kept that answer
     * and the notice kept reading it, because a read that fails afterwards
     * changes the reason but leaves the object the older branch is written
     * from. So the object goes when the Mac stops answering, and only the
     * reason is left to speak.
     */
    assert.match(src, /if \(macSilent\(err\)\) setDevice\(null\)/, 'a stale answer can still write the notice')
    assert.match(
      src,
      /err\?\.unitGone \? 'unit-gone' : macSilent\(err\) \? 'no-answer' : 'unreadable'/,
      'App keeps its own copy of what a silent computer looks like'
    )
    // One definition of that, in the module the reads live in, so the screen
    // and the asking cannot disagree about what a dead line is.
    const store = readFileSync(new URL('../src/lib/deviceState.js', import.meta.url), 'utf8')
    assert.match(store, /export const macSilent = /)
    assert.match(store, /if \(macSilent\(err\)\) break/, 'a dead line is asked five times again')
  })

  test('a failure inside a sheet is shown inside that sheet', () => {
    /*
     * "On the chain screen it always says on. When I tap one of the buttons it
     * will turn it off on the unit, but there's no way to turn it back on."
     *
     * The Mac had lost its port to the unit, so every write came back refused,
     * the store put each block back the way it found it, and the explanation
     * went into the app's one notice — which is drawn on the page, under the
     * sheet, on a page a sheet makes inert. A whole set of taps, each one
     * failing, and not one word on screen about any of it.
     *
     * Three things hold that shut, and each one was the bug on its own:
     * the sheet can show a failure; the app hands it the one raised since the
     * sheet opened; and a unit that has gone closes the sheet altogether,
     * because there is nothing to edit in a preset nothing can reach.
     */
    const sheet = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8')
    const body = sheet.indexOf('<div className="sheet-body">')
    assert.notEqual(body, -1, 'the sheet body is gone')
    const alert = sheet.indexOf('sheet-alert')
    assert.ok(alert > body, 'a failure is drawn outside the body, where the sheet does not scroll to it')
    assert.match(sheet, /role="alert"/, 'the message is not announced')

    assert.ok(
      (src.match(/alert=\{sheetAlert\}/g) || []).length >= 2,
      'the chain and the block editor are the two sheets that write to the unit'
    )
    assert.match(
      src,
      /const sheetAlert = sheet && error && errorSheet === sheet \? error : null/,
      'a sheet shows an error raised somewhere else, or before it was opened'
    )
    assert.match(src, /setErrorSheet\(text \? sheetNow\.current : null\)/, 'nothing records where a failure happened')

    // The error itself, not its sentence: only the object carries unitGone.
    const toggle = src.slice(src.indexOf('const toggleBlock'), src.indexOf('const toggleBlock') + 2200)
    assert.ok(!/setError\(err\.message\)/.test(toggle), 'the chain toggle flattens the error and loses why it failed')
    assert.match(toggle, /setError\(err\)/)
    assert.match(
      toggle,
      /if \(!err\?\.unitGone\) refreshBlocks\(\)/,
      'a refused toggle trusts its own roll-back instead of asking the unit'
    )

    const lost = src.slice(src.indexOf('if (!lostUnit) return'), src.indexOf('if (!lostUnit) return') + 300)
    /*
     * And it is a READ that decides, not one failed write. A single call can
     * come back with the port shut while the next is answered perfectly — the
     * Mac's own screen is asking that same port several times a second — and
     * "my Mac is connected just fine, the phone says it has lost the unit" is
     * what tearing the app down over one of those looks like.
     */
    assert.match(lost, /read\(\)\.then/, 'one failed write still tears the whole screen down')
    assert.match(lost, /if \(live && !fresh\) setSheet\(null\)/, 'a read that worked still closes what was open')
    assert.ok(
      !/setStatus\('fault'\)/.test(lost),
      'the fault is declared without asking the unit, so a read that would have answered is never made'
    )

    /*
     * And when the notice does come up, it carries what the far end actually
     * said. The sentence on screen is this app's translation; "port not open"
     * is the server's own four words, and the difference between a screenshot
     * that raises a question and one that answers it.
     */
    assert.match(src, /setErrorDetail\(value && typeof value !== 'string' \? value\.detail \|\| null : null\)/)
    assert.match(
      src,
      /errorDetail \|\| \(faultReason === null \|\| faultReason === 'unreadable' \? error : null\)/,
      'the fault notice drops the one line that says what came back'
    )
  })

  
  test('the error banner is outside every view', () => {
    // It lived inside Design, so a failure in Library or Edit set the message
    // and rendered nothing. Silence reads as a dead button.
    const banner = src.indexOf('data-kind="fault" role="alert"')
    assert.notEqual(banner, -1, 'no error banner found')
    const firstView = src.indexOf("view === 'play' ? (")
    assert.ok(banner < firstView, 'the banner must render before any view block')
  })

  test('panels that need a preset are given one', () => {
    // Scenes read preset?.number without being passed a preset: silently
    // undefined, so its cache invalidation quietly did nothing. Three of these
    // live in sheets now, which is the same seam wearing a different shape.
    for (const [name, prop] of [
      ['Scenes', 'preset'],
      ['LocalLibrary', 'preset'],
      ['Backup', 'preset'],
      ['Versions', 'preset']
    ]) {
      const seg = src.slice(src.indexOf("view === 'play' ? ("))
      const props = tag(seg, name)
      assert.ok(props, `${name} is not rendered anywhere`)
      assert.ok(new RegExp(`\\b${prop}=`).test(props), `${name} is missing ${prop}`)
    }
  })

  test('panels that can fail can report it', () => {
    // A panel with no onError swallows its failures.
    for (const name of ['GridEditor', 'Scenes', 'Modifiers', 'PhoneRemote', 'BlockPanel', 'CabPicker']) {
      const props = tag(src, name)
      assert.ok(props, `${name} is not rendered`)
      assert.ok(/onError=/.test(props), `${name} cannot report errors`)
    }
  })

  test('every collapsible panel has a distinct key', () => {
    // The saved layout order is keyed on these; duplicates would render a panel
    // twice and hand React two children with the same key.
    // No floor on the count any more: seventeen folds becoming a handful is
    // the point of the restructure, so a test that demanded eleven of them
    // would be defending exactly what it was written to help remove.
    const keys = [...src.matchAll(/<Section key="([^"]+)"/g)].map((m) => m[1])
    assert.ok(keys.length, 'expected the sections to be keyed')
    assert.equal(keys.length, new Set(keys).size, 'duplicate Section keys')
  })

  test('the gear sheet is a thing to read, not a menu to pick from', () => {
    /*
     * "Add an info page like this to settings listing the real life
     * equivalents of each amp and effects pedals."
     *
     * Its own sheet rather than a fold inside Setup: four hundred rows with a
     * search over them, and a list that long inside a panel inside a sheet is
     * two scrolls fighting over one thumb.
     */
    const gear = sheet('Amp and pedal names')
    assert.ok(components(gear).includes('GearNames'), 'the gear sheet holds nothing')
    assert.match(gear, /tall/, 'a four-hundred-row list is in a sheet sized to its contents')
    // Mounted only while open — that much DOM should not sit behind a closed sheet.
    assert.match(gear, /\{sheet === 'gear' \? <GearNames \/> : null\}/, 'the list is built whether or not anyone opened it')

    const panel = readFileSync(new URL('../src/components/GearNames.jsx', import.meta.url), 'utf8')
    const code = panel.slice(panel.indexOf('export default')).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')

    /*
     * THE ROWS ARE BUTTONS, and they were not. "There is nothing to choose
     * here, and a row that depresses under a thumb promises an action it does
     * not have" — half right. Nothing to choose, but something to READ: the
     * photographs and the descriptions existed the whole time and were
     * reachable only from the block editor's panel, for the model already
     * chosen, which is the one model nobody is wondering about.
     *
     * "Still not seeing any amp cab and pedal photos or descriptions. Should
     * be able to tap on the card and open a detailed page like this." So a row
     * opens the model's own page; picking a model is still the editor's job.
     */
    const rows = code.slice(code.indexOf('gear-list'))
    assert.match(rows, /<button type="button" className="gear-row" onClick=\{\(\) => setOpen\(e\)\}>/, 'the rows cannot be opened')
    assert.match(code, /if \(open\) return <GearCard entry=\{open\} onBack=\{\(\) => setOpen\(null\)\} \/>/, 'there is nothing behind a row')

    /*
     * And the page is the three things that were missing, in the order the
     * questions come in: what it really is, what it is like, what it looks
     * like. The credit cannot be separated from the photograph — every one of
     * these is Creative Commons and naming the photographer is the condition
     * of showing it at all.
     */
    const card = readFileSync(new URL('../src/components/GearCard.jsx', import.meta.url), 'utf8')
    assert.match(card, /descriptionFor\(entry\.slug, entry\.name\)/, 'the page never asks what the model is like')
    assert.match(card, /photoFor\(entry\.name\)/, 'the page never asks what the model looks like')
    assert.ok(
      card.indexOf('<img src={photo.src}') < card.indexOf('{photo.credit}'),
      'the photograph is drawn somewhere the credit is not'
    )
    assert.ok(
      card.indexOf('{about}') < card.indexOf('<img src={photo.src}'),
      'the picture comes before the words that say what it is'
    )
    /* A row with the slug dropped cannot be looked up at all, which is the
       whole reason the catalog carries it. */
    const catalog = readFileSync(new URL('../src/lib/gearCatalog.js', import.meta.url), 'utf8')
    assert.match(catalog, /out\.push\(\{\s*slug,/, 'a catalog row no longer knows which block it came from')

    // The search field clears the iOS zoom floor like every other one.
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.gear-search {'), css.indexOf('}', css.indexOf('.gear-search {')))
    assert.match(rule, /font-size: var\(--f-input\)/, 'tapping the search box will zoom the page on iOS')

    // And Setup's row opens it rather than unfolding four hundred rows in place.
    const setup = sheet('Settings')
    assert.match(setup, /key="gear-names"/, 'Setup has no way into the gear sheet')
    assert.match(setup, /onClick=\{\(\) => setSheet\('gear'\)\}/, 'the way in does not open the sheet')
  })

  
  test('the chain shows its two ends, and the stage screen still does not', () => {
    /*
     * "Does it just ignore the input and output so they're actually there but
     * just not showing on the chain? We obviously don't need those on the
     * pedalboard at all, but when we're actually viewing the chain, it might
     * be helpful to see that those are there and which input and output
     * they're coming from."
     *
     * Both halves of that, and the distinction is the point. The stage screen
     * draws its own tiles and filters these out by EXCLUDED_BLOCKS, because
     * nobody kicks an input block between two bars. The strip is the chain
     * being LOOKED at, and one that silently drops two of its blocks is a
     * diagram that disagrees with the unit.
     */
    const con = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const chain = con.slice(con.indexOf('export function Chain('), con.indexOf('export function PresetList('))
    assert.match(chain, /ends\('input'\)/, 'the chain no longer looks for the input block')
    assert.match(chain, /ends\('output'\)/, 'the chain no longer looks for the output block')
    /* Which one, not just that there is one — that is the half being asked
       about, and it is the block's own name from the unit. */
    assert.match(chain, /className="io-name mono"/, 'the chain draws the ends without saying which they are')
    assert.match(chain, /\{block\.name \|\| block\.slug\}/)
    /* No on/off under them: a preset with its output bypassed is one nobody
       can hear, and it is not a switch anybody wants under a thumb. */
    const io = chain.slice(chain.indexOf('const io = (block, side)'), chain.indexOf('const tap = (block)'))
    assert.ok(io, 'nothing draws the ends of the chain')
    assert.ok(!/fx-power/.test(io), 'the input and output grew an on/off pill')
    /* And the arrow still stands in where there is no block, which on an empty
       preset is the honest drawing. */
    assert.match(io, /if \(!block\)/, 'a preset with no input block draws nothing at all')

    /* A face that is no longer painted needs lettering that is not white. The
       light theme restates the tile rule at equal weight and wins on order, so
       the io tiles have to be restated with it or they are white on off-white. */
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /\[data-theme='light'\] button\.fx-tile\.io-tile \{/, 'the io tiles are white on off-white in the light theme')

    /* The stage screen is untouched: those blocks are still filtered out of it. */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    assert.match(
      gig,
      /STAGE_HIDDEN\.includes\(b\.slug\)/,
      'the stage screen now carries input and output tiles nobody can use there'
    )
  })

  
  test('the preset list opens on the one you are standing on, and keeps trying', () => {
    /*
     * "When opening the preset menu, have it scrolled to where the current
     * preset is in the middle so that you can see which ones are before and
     * after it."
     *
     * The centring was already written and did not always take. It looked
     * exactly once, on the render that mounted the list, and returned for good
     * if it found no row or nothing to scroll — and there are two perfectly
     * ordinary reasons for that instant to be the wrong one: the sheet takes
     * about a third of a second to arrive, and on iOS a scrollTop written to a
     * box inside a transform that is still animating is quietly dropped. Both
     * look identical to success from inside a single look, and both leave a
     * list of 512 at 000 with the loaded preset four hundred rows below.
     *
     * So it retries across frames, holds the position while the sheet lands,
     * and stands down the moment something else moves the list — because being
     * dragged back to the middle while you are already reading is worse than
     * opening at the top.
     */
    const list = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const at = list.indexOf('Open where you already are')
    assert.notEqual(at, -1, 'nothing opens the preset list where the player already is')
    const centring = list.slice(at, list.indexOf('return (', at))

    assert.match(centring, /requestAnimationFrame\(place\)/, 'the centring still takes a single look')
    assert.match(centring, /frames < LOOKS/, 'the centring gives up after one try again')
    assert.match(
      centring,
      /if \(!row \|\| !box \|\| !box\.clientHeight\)/,
      'a scrollbox that has no height yet is treated as no scrollbox at all'
    )
    /* The row goes to the middle, not the top: the whole point is seeing what
       is on either side of it. */
    assert.match(
      centring,
      /\(box\.clientHeight - row\.offsetHeight\) \/ 2/,
      'the current preset is put at the top of the list rather than the middle'
    )
    /*
     * A thumb wins, and it is recognised by a gesture rather than by reading
     * scrollTop back. Comparing the value written against the value read
     * cannot tell a thumb from the engine on iOS, where they routinely differ
     * — and a guard that fires on its own is worse than none, because it stops
     * the retry that exists for that exact platform.
     */
    assert.match(
      centring,
      /addEventListener\('pointerdown', theirs, \{ passive: true \}\)/,
      'the list fights whoever scrolls it while the sheet is still arriving'
    )
    assert.ok(
      !/box\.scrollTop - mine/.test(centring),
      'a thumb is inferred from scrollTop again, which on iOS is not a thumb'
    )
    /* And the target is clamped to the scroll that exists, so a preset near
       either end is not judged against a position the box cannot reach. */
    assert.match(centring, /Math\.min\(box\.scrollHeight - box\.clientHeight, want\)/)
    /* One line in the log the player already knows how to send, because this
       has now been reported twice with nothing to read but a screenshot. */
    assert.match(centring, /logDebug\('presets'/, 'a list that fails to open in the right place says nothing')
    assert.match(list, /const LOOKS = 40/, 'the retry window is gone or unbounded')

    /* A filter is the one time the top of the list is the right place: the
       matches are what was asked for. */
    assert.match(centring, /if \(needle \|\|/, 'a filtered list is yanked away from its matches')
  })

  test('a stale app finds out quickly, and Reload actually fetches the page', () => {
    /*
     * "Doesn't look like the push went through somehow, the PWA has not
     * updated yet, still on version 7.160.0" — about a deploy that was live
     * and correct. Two faults, both of which make a working deploy look like a
     * missing one.
     *
     * The check ran every ten minutes, and only on visibilitychange. An app
     * reopened from the home screen on iOS may come back through pageshow
     * instead, and a window brought forward on a Mac through focus — so the
     * one moment this exists for could pass unnoticed.
     *
     * And Reload called location.reload(), which on an installed app is
     * entitled to hand back the copy in the HTTP cache: a button that looks
     * like it worked and changes nothing. Fetching with cache: 'reload' goes
     * to the network and replaces that copy first.
     */
    const notice = readFileSync(new URL('../src/components/UpdateNotice.jsx', import.meta.url), 'utf8')
    assert.match(notice, /const CHECK_EVERY = 60 \* 1000/, 'a stale app waits ten minutes to be told again')
    for (const moment of ['visibilitychange', 'pageshow', 'focus']) {
      assert.ok(notice.includes(`'${moment}'`), `an app coming back through ${moment} is never checked`)
    }
    assert.match(
      notice,
      /fetch\(window\.location\.pathname, \{ cache: 'reload' \}\)/,
      'Reload can hand back the same stale page it was pressed to replace'
    )
    /*
     * And then it leaves for an address no cache has an answer for. Seen on
     * v7.196 with v7.198 live: Reload, and still v7.196 until the address was
     * typed by hand — location.reload() asks for the same URL, which is
     * exactly what an installed app's document cache and an edge cache both
     * hold. A query nobody has requested before has to come from the deploy.
     */
    assert.ok(
      !/window\.location\.reload\(\)/.test(notice),
      'Reload asks for the same address again, which is the one every cache has an answer for'
    )
    assert.ok(
      notice.indexOf("cache: 'reload'") < notice.indexOf('window.location.replace(freshAddress('),
      'the page is left before the cached copy is replaced'
    )
    assert.match(notice, /url\.searchParams\.set\(FRESH_PARAM, String\(now\)\)/, 'the address Reload leaves for is one a cache may already hold')
    assert.match(notice, /url\.searchParams\.delete\(FRESH_PARAM\)/, 'the cache-buster stays in the address bar and in every copied link')
    assert.match(notice, /history\.replaceState\(/, 'stripping the cache-buster adds a history entry, which the back gesture then lands on')
    /*
     * The button cannot see the page it produces, so the page that comes up
     * checks for it: Reload remembers the script the deploy named, and the
     * next page compares it with the one it loaded and says which happened.
     */
    assert.match(notice, /sessionStorage\.setItem\(EXPECT_KEY, script\)/, 'Reload does not remember what it was reaching for, so nothing can say whether it got there')
    assert.match(notice, /wanted === mine \? 'landed' : 'missed'/, 'the page that comes up never checks it is the one Reload asked for')
    assert.match(notice, /data-kind="missed"/, 'a Reload that changed nothing is not said out loud')
    assert.match(notice, /data-kind="landed"/, 'a Reload that worked is not confirmed with the version now running')
    assert.match(notice, /Up to date — v\{VERSION\}/, 'the confirmation does not name the version on screen')
    /* The check itself must not read the cache it exists to defeat. */
    assert.match(notice, /cache: 'no-store'/, 'the staleness check is served from the cache')
  })

  
  
  
  test('a phone can reach the chain, from the bar rather than by a swipe', () => {
    /*
     * "On the PWA we need to be able to see what chain was written or what
     * chain is currently on a setting … a button to view the studio or edit
     * screen where parameters can be viewed and changed."
     *
     * The Edit screen stays off a phone's swipe — BENCH in Screens.jsx, and
     * the rule the phone apps have always had: a bench screen within reach of
     * a stage tap is a hazard. That rule is about what a thumb lands on in the
     * dark, not about what the app may show, so the way in is a button on the
     * bar that already carries Ask, under the same play-mode rule.
     */
    /* Found by what opens it, not by its title: the Edit screen has a panel
       called Chain too, and it is the same editor — which is the point. */
    const at = src.indexOf("open={sheet === 'chain'}")
    assert.notEqual(at, -1, 'nothing opens the chain as a sheet')
    const chain = src.slice(src.lastIndexOf('<Sheet', at), src.indexOf('</Sheet>', at))
    for (const part of ['<Chain', '<ParamSearch', '<GridEditor', '<Modifiers']) {
      assert.ok(chain.includes(part), `the chain sheet is missing ${part}`)
    }
    assert.match(chain, /openBlockFrom\(id, 'chain'\)/, 'a block opened from the chain sheet has no way back')

    /* Closing the block editor returns to whatever opened it. One sheet is
       open at a time, so without this a block tapped in the chain sheet drops
       you on the stage screen when you close it. */
    assert.match(src, /setSheet\(sheetBack\)/, 'the block editor forgets where it was opened from')
    assert.match(src, /onChain=\{\s*\n?\s*chainShows/, 'the chain is reachable with play mode on')
    assert.match(src, /const chainShows = editButtonShows\(\{ status, view \}\)/, 'the chain button still comes and goes with Ask')
    assert.match(
      src,
      /views\.includes\('shape'\) \? changeView\('shape'\) : setSheet\('chain'\)/,
      'a wide screen opens a second copy of the editor beside the one it already has'
    )

    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    assert.match(gig, /\{onChain \?/, 'the stage screen has no way to the chain')
    /* "We removed that a long time ago and there shouldn't be any user
       facing ASK buttons." The switched-off one went too, so a tester reading
       the code finds none either. */
    assert.ok(!/onAsk|gig-ask|>\s*Ask\s*</.test(gig), 'the stage bar has an Ask button again')
    assert.ok(!/Ask Create/.test(gig), 'the stage screen tells somebody to ask the AI for scenes again')
  })

  test('the Connection panel has one fold rather than two', () => {
    /*
     * "On the Phone and computer drop-down where it says Connection, there's a
     * redundant Connection button that then takes you to the connection — let's
     * get rid of that extra step."
     *
     * Two presses to reach one list, and the second button carried the same
     * word as the section above it.
     *
     * WHAT THE CHIP ACTUALLY DID, and why it is replaced rather than deleted:
     * nothing asks the computer what is plugged into it until somebody wants
     * to know. That answer is a scan of every port on the machine, and from a
     * phone it is a question relayed across the internet — so it waits to be
     * asked for. The panel takes that cue from the fold it already lives in
     * now.
     *
     * And it has to keep waiting. `<details>` keeps its contents mounted while
     * it is shut, so a panel that read on mount would scan the ports of every
     * computer that so much as opened Setup.
     */
    const ports = readFileSync(new URL('../src/components/Ports.jsx', import.meta.url), 'utf8')

    assert.ok(
      !/Hide connection/.test(ports),
      'the Connection panel has a second fold of its own again, inside the one titled Connection'
    )

    assert.match(ports, /closest\('details'\)/, 'the panel no longer takes its cue from the fold it lives in')
    assert.match(ports, /addEventListener\('toggle'/, 'the panel never hears the fold open, so it reads once and never again')
    assert.match(
      ports,
      /if \(open && !ports\) load\(\)/,
      'the ports are scanned whether or not anybody asked — on every computer that opens Setup'
    )

    /* All of which needs a fold above it to listen to. */
    const setup = sheet('Settings')
    const at = setup.indexOf('<Ports')
    assert.notEqual(at, -1, 'the Connection panel is gone from Setup')
    const opened = setup.lastIndexOf('<Section', at)
    assert.ok(
      opened !== -1 && setup.slice(opened, at).includes('title="Connection"'),
      'the Connection panel is no longer inside the Connection section, so it has no fold to read'
    )
  })

  test('the phone leads Setup with the gear too, and says its facts in green', () => {
    /*
     * Both ends. "On the set-up screen, let's change the text underneath the
     * button labels to green. Also let's move the amp and pedals button to the
     * top of the list" — said once, about one screen, which exists twice.
     *
     * The line under each row is not small print: it is the live answer to the
     * question the row is named after, and the whole point of the list is that
     * most of it needs no tap. Grey said the opposite.
     *
     * `ok` rather than a green of its own. It is already what both apps use
     * for a thing said in words they are sure of, and it is already tuned per
     * theme — a second near-match would drift the moment one of them is.
     */
    const phone = readFileSync(new URL('../mobile/src/screens/Settings.js', import.meta.url), 'utf8')

    const titles = [...phone.matchAll(/<SetupRow\s+title="([^"]+)"/g)].map((m) => m[1])
    assert.equal(titles[0], 'Amp & pedal names', `the phone's Setup opens on ${titles.join(', ')}`)

    /* The row's own component, not a colour pasted per row: one place to be
       wrong, and the same one the browser has. */
    const row = phone.slice(phone.indexOf('function SetupRow({ title, status, onPress })'))
    assert.match(
      row.slice(0, row.indexOf('\n}')),
      /color: color\.ok,\s*fontSize: font\.small/,
      'the phone still says its live facts in grey'
    )
  })

  test('Setup is a list of rows with live status, each opening a page', () => {
    /*
     * "I wanna overhaul this whole settings set-up screen." Four doors under
     * a pile of unrelated buttons became: the version line at the top (kept
     * on purpose — "I like that there"), rows each carrying one live fact,
     * each opening its own page. The theme switch went in with the Play
     * screen, and the real amp names — "I do like that as well" — got a row of
     * their own.
     *
     * There were seven. "AI & cost" held the two switches, the token ledger
     * and the history of every tone designed, and went with the AI.
     *
     * Then "Unit" split in two. It held the unit's state AND the way in to
     * renaming, and those are not one thing: the state is the far end of the
     * chain Phone & computer is about, and renaming is an errand. So the
     * state moved there and the row took the errand's name. "Help & fixes"
     * became "Troubleshooting" in the same pass.
     */
    const setup = sheet('Settings')
    assert.match(setup, /<div className="device-meta mono setup-version">\{FULL\}<\/div>/, 'the version line is not at the top')
    /*
     * THE FRONT LIST ONLY, and that is the whole point of this check now.
     *
     * It used to scan the entire Settings sheet, every page inside it
     * included, so a row could move one level down and still satisfy it. That
     * is exactly how Troubleshooting and the walkthrough went on reading as
     * front-list rows here for weeks after the phone had moved them into
     * About — "some of the menus aren't matching up". A rows list that counts
     * rows wherever they happen to be cannot catch a nesting change.
     *
     * Multi-line SetupRows count too, for the same reason: the old pattern
     * required key, title and status on one line, so a row wrapped over four
     * lines was invisible to it.
     */
    const frontList = (page) => {
      const at = page.indexOf('<div className="setup-rows">')
      assert.notEqual(at, -1, 'the Setup list moved; this check reads it')
      return page.slice(at, page.indexOf('</div>', at))
    }
    const rowsIn = (block) =>
      [...block.matchAll(/<SetupRow\b[\s\S]*?title=(?:"([^"]+)"|\{([A-Z_]+)\})/g)].map((m) => m[1] || m[2])
    const rows = rowsIn(frontList(setup))
    assert.deepEqual(
      rows,
      [
        /*
         * First, and asked for: "move the amp and pedals button to the top of
         * the list". Every other row here is plumbing — what is connected,
         * what the screen looks like, what went wrong — and each is opened
         * when something needs sorting out. This one answers "what IS a Das
         * Metall, really", which is a question somebody has mid-song, and it
         * was fifth.
         */
        'Amp & pedal names',
        'Phone & computer',
        'Rename presets and scenes',
        /*
         * The same row the phone has, in the same place. It used to be the
         * one the browser could not have, because a browser has no App Store;
         * Web Billing takes the card through Stripe instead. Drawn only for
         * somebody signed in who has not paid, and this reads the file as
         * text, so it is always in this list.
         */
        'Unlock the full version',
        /*
         * The one row here the phone has not got, and the reason it is not
         * inside About with the other once-ever errands: "Somebody who has a
         * rig connected and wants the remote in their pocket is the likeliest
         * buyer there is." A phone needs no way to get itself onto a phone.
         */
        'Get it on your phone',
        /* No 'Play screen'. Stage tiles and Appearance are not doors any more;
           they are open at the bottom of this list. Asserted below.
           No 'Demo Unit' either — it is inside Phone & computer, where the
           phone keeps it. No 'Troubleshooting' and no walkthrough — inside
           About, where Justin put the phone's. */
        'About',
        /* Last, and drawn only on his own account: "only when logged into the
           justinnewbold@icloud.com account". See shared/admin.mjs. */
        'Give someone access',
        'Sales at a glance'
      ],
      `Settings opens on ${rows.length} rows: ${rows.join(', ')}`
    )

    /*
     * AND WHAT IS BEHIND THE ONE DOOR, in the phone's order.
     *
     * "Move walkthrough, updates and troubleshooting INSIDE of the 'About'
     * menu." Carried out on the phone; this is the browser holding the same
     * shape, so the next change to either list has to be made to both.
     */
    const about = setup.slice(setup.indexOf("setupPage === 'about'"))
    assert.deepEqual(
      rowsIn(frontList(about)),
      ['Updates', 'Troubleshooting', 'REPLAY'],
      'the About page is not the three rows the phone has, in that order'
    )
    assert.ok(!setup.includes('<Group'), 'the doors are back')

    /*
     * AND THE TWO THAT ARE NOT DOORS ARE OPEN, below the ones that are.
     *
     * "Move this to the settings screen at the bottom below all the other
     * drop-down menus — we want it quickly available just by clicking
     * settings. Don't have it via a drop-down, have it always visible."
     *
     * The trap this guards is precise, and it is one I walked into while
     * making the change: moving a <Section> from the Play screen page onto
     * this list would look done and would not BE done, because <Section> is a
     * <details> that starts closed. That is the same drop-down, one page to
     * the left. So the check is not "are these on the list" but "are these on
     * the list WITHOUT a fold around them".
     */
    const at = setup.indexOf('className="setup-loose"')
    const loose = setup.slice(at, setup.indexOf('setupPage ===', at))
    assert.ok(loose.length > 200, 'the open panels moved; this check reads them')
    /*
     * Comments stripped first, and that is not a detail. The block carries a
     * comment SAYING not to use <Section> here, and the first version of this
     * check read that comment and failed the file for explaining itself. That
     * is the third time this shape has bitten in this repo; a guard that names
     * what it forbids has to ignore prose.
     */
    const noProse = loose.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    assert.ok(!/<Section/.test(noProse), 'Stage tiles and Appearance are folded away again')
    assert.match(loose, />Stage tiles</, 'the tile size control is not on the Settings list')
    assert.match(loose, /<Theme \/>/, 'the light and dark buttons are not on the Settings list')
    /* Below the rows, not above them: the rows are what somebody opens
       Settings for, these are the thing they want in one click once there. */
    assert.ok(
      setup.indexOf('className="setup-rows"') < setup.indexOf('className="setup-loose"'),
      'the always-open settings sit above the list of rows'
    )

    const behind = (key) => {
      const at = setup.indexOf(`setupPage === '${key}' ? (`)
      assert.notEqual(at, -1, `the ${key} page is gone`)
      const next = setup.indexOf("setupPage === '", at + 1)
      return [...setup.slice(at, next === -1 ? undefined : next).matchAll(/<Section\s+key="([^"]+)"/g)].map((m) => m[1])
    }
    for (const [page, panels] of [
      /* Renaming is the page, with nothing in front of it. It is one button
         and the sentence saying why it is worth pressing, so it needs no
         folds at all. */
      ['rename', []],
      /* Which unit and which port lead, because they are the far end of the
         chain this page is about. The guide to getting a computer on the
         other end sits above the details about the line to it: it is the
         question somebody has when there is nothing on the other end at all.
         Account follows the phone remote, only in the demo and signed out:
         "there's actually no place to even sign in anywhere on the web app." */
      ['link', ['connection', 'phone-remote', 'account', 'ways-in', 'link-details']],
      /* Fixes first: it is the one somebody is looking for when they open
         this page at all, and the log is what they send if it did not help. */
      ['help', ['fixes', 'preset-check', 'debug-log', 'feedback', 'what-s-changed-this-session']],
      /* The small print joins About because that is where somebody looks for
         it, and because a store requires the privacy policy to be reachable
         from the app rather than only from a form.
         And so does the introduction — "move the tutorial to replay it later
         into the about section instead of under troubleshooting". Nothing
         about it is a fault being fixed: it is what the app is and how it
         works, and somebody hunting for it under Troubleshooting has first
         had to decide they have a problem. */
      /* Updates is a page of its own now rather than a panel on About, for
         the same reason the walkthrough is a row rather than a chip: they are
         rows inside About, which is where Justin put the phone's. The rows
         themselves are asserted above; what is left folded on About is the
         small print. */
      ['updates', []],
      ['about', ['small-print']]
    ]) {
      assert.deepEqual(behind(page), panels, `the ${page} page holds ${behind(page).join(', ')}`)
    }
    /* Ends at the help page: 'play' used to be the next one and is gone. */
    const linkPage = setup.slice(setup.indexOf("setupPage === 'link'"), setup.indexOf("setupPage === 'help'"))
    assert.ok(linkPage.includes('<DeviceDetail'), 'the unit header is not on the Phone & computer page')
    const renamePage = setup.slice(setup.indexOf("setupPage === 'rename'"), setup.indexOf("setupPage === 'link'"))
    assert.ok(!renamePage.includes('<DeviceDetail'), 'the unit header is back in front of the rename button')
    assert.match(renamePage, /setSheet\('scenes'\)/, 'the rename page does not open the names sheet')
    assert.match(renamePage, /setSheetBack\('settings'\)/, 'closing the names sheet would drop out of Setup')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /button\.setup-row \{[^}]*min-height: 60px/, 'a Setup row is under thumb height')
    const row = readFileSync(new URL('../src/components/SetupRow.jsx', import.meta.url), 'utf8')
    assert.match(row, /setup-row-status/, 'a row has nowhere to say its state')

    /*
     * "When you go deeper into the settings menu have swiping down or
     * clicking the X take you back to the settings menu instead of the home
     * screen." One handler answers all three (X, swipe, Escape) and the
     * browser's Back: on a page it goes up to the list and says 'stay'; the
     * sheet then keeps a history entry so the next Back is caught too. The
     * two sheets only Setup opens close back onto Setup.
     */
    assert.match(setup, /if \(setupPage\) \{\s*\n\s*setSetupPage\(null\)\s*\n\s*return 'stay'/, 'closing a page leaves Setup')
    const sheetSrc = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8')
    assert.match(sheetSrc, /if \(close\(\) === 'stay'\) mark\(\)/, 'a sheet that stayed open on Back has no entry for the next Back')
    assert.match(sheet('Amp and pedal names'), /onClose=\{\(\) => setSheet\('settings'\)\}/, 'closing the gear sheet leaves Setup')
  })

  
  test('a chain that is placed is also wired, or the preset makes no sound', () => {
    /*
     * "None of the tones created make any sound."
     *
     * They were all built into empty slots, and an empty slot has no cabling
     * in it. Placing a block fills a cell; it does not join that cell to
     * anything. So five blocks went in, sixty-three values landed, the unit
     * read every one of them back, the preset saved — and none of it was in
     * the signal path. Nothing in the app looked, so nothing said so.
     *
     * It used to start one column BEFORE the first block, on the belief that
     * the input needed joining to the chain like anything else. The unit never
     * once accepted it — "srcCol out of range (1..13): 0" on every build, and
     * every log line reading "6 of 7 cables — refused at columns -1". There is
     * no such cable: the FM3 stores one set of links between each pair of its
     * fourteen columns, the input feeds the first column by itself, and the
     * thirteenth is the last that has a next one to reach.
     *
     * THIS USED TO WATCH TWO CHAIN BUILDERS. The other was the AI's, in
     * actions.js, and went with it. The Starter chain button is the one that
     * is left, and every rule above is still its rule — the planner they
     * shared is still shared/grid-plan and lib/actions' chainPlan.
     */
    const fx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    const wire = fx.slice(fx.indexOf('export async function wireRow'))
    assert.ok(wire, 'nothing wires a row of the grid')
    assert.match(wire, /for \(const col of cableColumns\(lastCol\)\)/, 'the wire picks its own columns again')
    assert.deepEqual(cableColumns(3), [0, 1, 2, 3], 'the wire skips the first block')
    assert.equal(
      cableColumns(20).at(-1),
      12,
      'the wire runs past the last column that can start a cable, which the unit throws out'
    )
    assert.ok(
      !cableColumns(5).includes(-1),
      'the wire still asks the unit for a cable out of the input, which it has always refused'
    )

    const grid = readFileSync(new URL('../src/components/GridEditor.jsx', import.meta.url), 'utf8')
    const build = grid.slice(grid.indexOf('const buildStarter'), grid.indexOf('const picker ='))
    assert.ok(build.length > 200, 'the starter chain moved; retarget this test')
    assert.ok(build.includes('placeBlock'), 'the starter chain no longer places anything')
    assert.match(build, /wireRow\(1,/, 'the starter chain places blocks and never joins them up — the preset will be silent')
    assert.ok(
      build.indexOf('placeBlock') < build.indexOf('wireRow'),
      'the row is wired before the blocks are in it'
    )
    assert.ok(/linear \? null : await wireRow/.test(build), 'a unit with no grid is sent cable writes it has no cells for')

    /*
     * And the chain is built into the free cells rather than from column 0.
     *
     * "The volume slider disappeared and no presets have sound." The slider
     * moves the output block's level, and the output block had been built
     * over: a slot this app calls empty is a slot with nothing EDITABLE in it,
     * and the input and output are not editable.
     */
    assert.match(build, /chainPlan\(\{/, 'the starter chain no longer asks the planner where the free cells are')
    assert.match(build, /plan\.cols\[i\]/, 'the chain is placed from column 0 again, over whatever is there')
    assert.ok(
      !/placeBlock\(1, (?:i|col) \+ 1/.test(build),
      'the builder is 1-basing columns again'
    )
  })

  test('every panel and every sheet is closed', () => {
    // SectionStack is gone with the drag-to-reorder it existed for; what is
    // left is the pairing, which a bad splice still breaks.
    /* Any whitespace after the name, not just a space: a Section whose props
       run onto their own lines was invisible to this, which is exactly the
       shape a bad splice leaves behind. */
    assert.equal((src.match(/<Section\s/g) || []).length, (src.match(/<\/Section>/g) || []).length)
    assert.equal((src.match(/<Sheet\b/g) || []).length, (src.match(/<\/Sheet>/g) || []).length)
  })

  test('one device, one copy of its state, one subscription', () => {
    /*
     * Gig was not a view over App's state — it was a second client to the same
     * unit, with its own blocks, its own scene, its own tuner and its own
     * subscription to the event stream. Two listeners meant a footswitch press
     * arrived twice and each answered it by re-reading the block list down a
     * port that serialises every request. Scenes read the scene once at mount
     * and was then confidently wrong for the rest of its life.
     *
     * The store owns it. Anything that opens its own subscription, or keeps its
     * own copy of a device fact, is that bug growing back.
     */
    const dir = new URL('../src/', import.meta.url)
    const files = {}
    const walk = (at, prefix = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
        if (entry.isDirectory()) walk(next, prefix + entry.name + '/')
        else if (/\.jsx?$/.test(entry.name)) files[prefix + entry.name] = readFileSync(next, 'utf8')
      }
    }
    walk(dir)

    // Where the subscription may be named at all: the client that defines it,
    // the store that owns it, and the one line in App that hands it over.
    const subscribers = Object.entries(files)
      .filter(([name]) => name !== 'lib/forgefx.js' && name !== 'lib/deviceState.js')
      .filter(([, body]) => /subscribeEvents\s*\(/.test(body))
      .map(([name]) => name)
    assert.deepEqual(subscribers, [], `${subscribers.join(', ')} subscribes to device events directly`)

    const store = files['lib/deviceState.js']
    assert.ok(store, 'the device store is gone')
    assert.equal(
      (store.match(/driver\.subscribeEvents\(/g) || []).length,
      1,
      'the store subscribes to the event stream more than once'
    )

    // The store must stay loadable by node: it is the only place the write
    // path — optimistic set, confirm, roll back — is actually tested, and one
    // import of the device client would pull in JSON that node cannot load.
    assert.ok(
      !/from '\.\/forgefx/.test(store),
      'the device store imports the device client, so it can no longer be tested'
    )

    // Nobody keeps a private second copy of a fact the store owns.
    const owned = [
      ['sceneNames', /useState\(\s*\[\s*\]\s*\)[^\n]*\/\/\s*scene names/i],
      ['tunerOn', /const \[\s*tunerOn\s*,/],
      ['tuning', /const \[\s*tuning\s*,/]
    ]
    for (const [fact, pattern] of owned) {
      for (const [name, body] of Object.entries(files)) {
        if (name === 'lib/deviceState.js') continue
        assert.ok(!pattern.test(body), `${name} keeps its own ${fact}; the store owns it`)
      }
    }
  })

  test('the app reads the fields the device actually sends', () => {
    /*
     * The most expensive class of bug this codebase has, because it is
     * invisible in demo and total on hardware: the mock invents a shape, the
     * UI is written against the invention, and the panel is broken for every
     * real user while looking perfect to everyone who tests it.
     *
     * It has now happened four times. The ports picker read a serial/midiIn
     * split that ForgeFX has never served, and told everyone their unit wasn't
     * plugged in. The cab panel read `slot.bank` — an object on a real unit —
     * and handed React an object as a child, taking the Controls view down
     * with it. The meters read `level`, which does not exist, so every bar sat
     * at zero under a blank label. And the model picker matched
     * `block.typeName`, a field /preset/blocks has never returned, so it never
     * once named the model it was on.
     *
     * So: the names below are the device's, verified against the ForgeFX
     * driver source, and nothing may read the invented ones.
     */
    // Code only. Half the value of a rule like this is the comment beside the
    // fix explaining what the wrong field was, and a scan that reads prose
    // fails on its own documentation.
    const code = (body) => body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

    const dir = new URL('../src/', import.meta.url)
    const files = {}
    const walk = (at, prefix = '') => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
        if (entry.isDirectory()) walk(next, prefix + entry.name + '/')
        else if (/\.jsx?$/.test(entry.name)) files[prefix + entry.name] = code(readFileSync(next, 'utf8'))
      }
    }
    walk(dir)

    const mock = files['lib/mockDevice.js']
    assert.ok(mock, 'the mock device is gone')

    // What the routes really answer with. Drift here is the bug.
    for (const [field, route] of [
      ['irName', 'GET /preset/blocks/:eid/cab — slots carry irName/irIndex'],
      ['irIndex', 'GET /preset/blocks/:eid/cab'],
      ['effectId', 'GET /preset/monitors/live — rows are keyed by effectId'],
      ['paramName', 'GET /preset/monitors/live — one row per monitored param'],
      ['norm', 'GET /preset/monitors/live — the level is norm'],
      ['type', 'GET /preset/blocks/:eid/params — carries the current model'],
      ['slotCount', 'GET /mod/model — slotCount, not slots'],
      ['ordinal', 'GET /mod/model — sources are keyed by ordinal'],
      ['bindingSupported', 'GET /mod/model — how a unit says it cannot bind']
    ]) {
      assert.ok(mock.includes(field), `the mock no longer serves ${field} (${route})`)
    }

    // And the shapes nothing serves. Each cost a release.
    /*
     * Pinned positively, one assertion per bug, rather than by banning the
     * wrong field names: "slot", "block" and "type" each name two unrelated
     * things in this codebase — a preset slot and a cab slot, a device block
     * and a streamed spec block — so a name-ban flags honest code and gets
     * deleted the first time it cries wolf.
     */
    const hw = files['components/Hardware.jsx']
    const gig = files['components/Gig.jsx']
    assert.ok(hw && gig, 'Hardware.jsx or Gig.jsx is gone')


    // The cab panel: names and the enum labels, never the enum objects.
    assert.ok(/slot\.irName/.test(hw), 'the cab panel no longer reads irName')
    assert.ok(/slot\.irIndex/.test(hw), 'the cab panel no longer reads irIndex')
    assert.ok(
      /label\(slot\.bank\)/.test(hw) && /label\(state\.mode\)/.test(hw),
      'the cab panel renders a {value,label} enum straight into JSX again — that throws'
    )

    /*
     * The monitor readings. The standalone meters panel is gone — its whole
     * content was a bar per block, which is what Play already draws — so the
     * one surviving reader is the signal bar, and `norm` is still the field.
     */
    assert.ok(/m\.norm/.test(gig), "the gig screen's signal bar no longer reads norm")
    assert.ok(!/\.level\b/.test(gig), 'the signal bar reads .level again — monitors have none')

    /*
     * And it asks for ONE block.
     *
     * Reported as "when the app is open it keeps cutting out and if I close
     * the app, then it doesn't" — the audio, on a unit that serialises every
     * request while it is also making sound.
     *
     * `liveMeters()` with no block asks the host for every block's monitors,
     * which it can only answer by fetching the whole grid first. ForgeFX's own
     * note in gen3.ts liveMonitors() says what that costs: grid()'s cache
     * lasted 500ms, so an all-blocks call on a 500ms tick fired "a full ~24KB
     * preset dump on every tick". Its author called the all-blocks form
     * "(rare)". This screen was polling it twice a second, and on a phone this
     * screen is the whole app.
     *
     * The bar draws one number. One block is all it ever needed.
     */
    const meterCall = gig.match(/await liveMeters\(([^)]*)\)/)
    assert.ok(meterCall, 'the signal bar no longer polls meters at all')
    assert.notEqual(
      meterCall[1].trim(),
      '',
      'the signal bar asks for every block again — that fetches the whole preset on every tick'
    )
    assert.match(
      gig,
      /size === 0/,
      'the signal bar polls at the smallest size, where it is not even drawn'
    )

    /*
     * And the HOST is told, which is the expensive half.
     *
     * Stopping this screen's own poll stops one request every 500ms. ForgeFX's
     * telemetry supervisor does not watch this screen: it starts on its first
     * event listener and runs four output-meter round trips every 100ms for as
     * long as anything is subscribed — about forty SysEx transactions a second
     * at a unit that is also making sound. A phone connecting supplies that
     * listener through the relay, and closing the app removes it, which is the
     * shape of what was reported in both directions.
     */
    assert.match(
      gig,
      /setMetersWanted\(/,
      'nothing tells the host whether a meter is being drawn, so it polls four of them regardless'
    )

    // And the block reaches the host as ?eid=, which is what makes it one read
    // rather than a grid fetch.
    const fx = files['lib/forgefx.js']
    assert.match(
      fx.slice(fx.indexOf('export const liveMeters'), fx.indexOf('export const liveMeters') + 400),
      /\?eid=\$\{effectId\}/,
      'liveMeters drops the block on the floor, so the host reads every one of them'
    )

    // Modifiers: the source ordinal is what gets written to the device, so a
    // wrong field name here is not a blank label, it is a bad write.
    const mods = files['components/Modifiers.jsx']
    assert.ok(mods, 'Modifiers.jsx is gone')
    assert.ok(/s\.ordinal/.test(mods), 'the source picker no longer reads the ordinal it must send')
    assert.ok(!/s\.value/.test(mods), 'a modifier source is being read as .value again — it has none')
    assert.ok(
      /model\.bindingSupported === false/.test(mods),
      'the guard that hides Attach on a unit that cannot bind is reading the wrong field'
    )
    assert.ok(/model\.slotCount/.test(mods), 'the slot count is being read as .slots again')

    const console_ = files['components/Console.jsx']
    assert.ok(console_, 'Console.jsx is gone')
    assert.ok(
      /setTypeState\(\w+\?\.type/.test(console_),
      'the model picker no longer reads the type off the params response'
    )
  })

  test('nothing user-facing talks about the plumbing', () => {
    /*
     * Terms that mean something to whoever built this and nothing to a
     * guitarist. Every component is checked, not just App.jsx: the worst
     * offenders — "run npm run serve", "relaying through your Supabase
     * project", an AXIS_CLOUD block — were in panels this test never read,
     * and they were the first thing a person saw on their phone.
     *
     * Comments are stripped first; a comment may say anything. Two files are
     * exempt because they are the diagnostics, written for exactly these
     * words: LinkDetails and Diagnostics live under Technical details.
     */
    const dir = new URL('../src/components/', import.meta.url)
    /*
     * Technical details is exempt in App.jsx too: it carries the attribution
     * to the device server by name, with a link, which is credit rather than
     * plumbing — and it is behind the fold that says "for working out why
     * something went wrong".
     */
    const techStart = src.indexOf('key="debug-log"')
    const techEnd = src.indexOf('</Section>', techStart)
    const appProse = techStart === -1 ? src : src.slice(0, techStart) + src.slice(techEnd)
    const files = { 'App.jsx': appProse }
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsx') || f === 'LinkDetails.jsx' || f === 'Diagnostics.jsx') continue
      files[f] = readFileSync(new URL(f, dir), 'utf8')
    }
    const terms = [
      /npm run/,
      /localhost:5056/,
      /SysEx/,
      /Supabase/,
      /\brelay(ing|ed)?\b/i,
      /helper app/i,
      /AXIS_CLOUD/,
      /anon key/i,
      /the channel/i,
      /remote session/i,
      /ForgeFX/
    ]
    const hits = []
    for (const [name, body] of Object.entries(files)) {
      const prose = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // Only what a person can read: text between tags, and string literals.
      const seen = [
        ...[...prose.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]),
        ...[...prose.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2])
      ]
      for (const text of seen) {
        for (const term of terms) {
          if (term.test(text)) hits.push(`${name}: ${text.trim().slice(0, 70)}`)
        }
      }
    }
    assert.deepEqual(hits, [], `plumbing on screen:\n  ${hits.join('\n  ')}`)
  })

  test('the phone remote is honest about whether the computer answered', () => {
    const remote = readFileSync(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
    const linkSrc = readFileSync(new URL('../src/lib/link.js', import.meta.url), 'utf8')

    /*
     * Restored at mount, for every role, before anything is judged. It used
     * to happen inside a panel that only mounted after the app had already
     * failed — so a phone always saw an error screen first.
     */
    assert.match(
      src,
      /useEffect\(\(\) => \{\s*\n\s*const stop = subscribeLink\(setLink\)\s*\n\s*bootLink\(\)/,
      'the link is no longer booted at app mount — the phone will land on an error screen first again'
    )

    /*
     * A dead presence check used to reset hostSeen on every sync, so the chip
     * went red over a working link. The binding stays; the conclusion is gone.
     */
    assert.ok(
      !/hostSeen\s*=[^=].*presenceState/s.test(remote) && !/seen\([^)]*presenceState/.test(remote),
      'presence is deciding whether the computer is there again — it never tracks presence, so this is always "no"'
    )

    // Every write to the fact goes through the setter that announces it.
    const raw = remote.match(/^\s*hostSeen = (?!now\b)/gm) || []
    assert.equal(raw.length, 0, `hostSeen is written directly ${raw.length}× — nothing watching it will hear`)

    /*
     * Auto-connect is only ever turned off by a deliberate Disconnect. A
     * failed rejoin used to do it too, so a Mac that was merely asleep
     * disarmed the phone for good.
     */
    const files = readdirSync(new URL('../src/components/', import.meta.url))
      .filter((f) => f.endsWith('.jsx'))
      .map((f) => readFileSync(new URL('../src/components/' + f, import.meta.url), 'utf8'))
    const everywhere = [src, linkSrc, remote, ...files].join('\n')
    const offs = everywhere.match(/setAutoConnect\(false\)/g) || []
    assert.equal(offs.length, 1, `setAutoConnect(false) appears ${offs.length}× — it belongs in disconnectPhone alone`)
    assert.match(linkSrc, /export async function disconnectPhone\(\) \{[^}]*setAutoConnect\(false\)/s)
    assert.match(remote, /autoConnect !== false/, 'a sign-in no longer means "stay connected" by default')

    // The six-second bound before a dead relay is allowed to hang read().
    assert.match(
      src,
      /if \(remoteActive\(\) && !remoteHostSeen\(\) && !\(await hostResponds\(\)\)\) \{\s*\n\s*setFaultReason\('no-answer'\)\s*\n\s*setStatus\('fault'\)/,
      'read() no longer bounds a dead relay — every call waits out 20–45 s before admitting the fault'
    )

    // The phone gets a connect screen, not an error; the Mac keeps the notice.
    assert.match(src, /const showConnect =\s*\n\s*link\.role === 'remote' &&/, 'the connect screen is no longer keyed to the phone role')
    assert.match(src, /(\{| : )showConnect \? \(\s*\n\s*<ConnectScreen/, 'the connect screen is no longer the phone’s screen when not connected')
    /* Ahead of it, only the phone's own rule: signed in, not paid, the unlock first. */
    assert.match(src, /\{mustPay \? \([\s\S]{0,2000}\) : showConnect \? \(/, 'something other than the unlock stands in front of the connect screen')
    assert.match(
      src,
      /if \(showConnect && status === 'live'\) \{\s*\n[^}]*setStatus\('fault'\)/,
      'Play is rendered under the connect screen again'
    )
    assert.ok(!/onAnotherDevice/.test(src), 'the user-agent guess is back; the role decides now')

    /*
     * A fault that nothing asks about again is a fault that stays on screen.
     *
     * "This keeps saying I'm not connected, but yet the Mac app says I am
     * connected to the remote." The link was up, so the effect that reads on
     * connect never fired twice, and the only thing left asking was a thumb on
     * Try again.
     */
    const retry = src.indexOf("if (isDemo() || status !== 'fault' || showConnect) return undefined")
    assert.ok(retry !== -1, 'a phone stuck on a fault waits to be tapped again — nothing asks on its own')
    const loop = src.slice(retry, retry + 900)
    assert.ok(loop.includes('nextDelay(delay)'), 'the retry no longer backs off — a busy port gets hammered')
    assert.ok(loop.includes('await read()'), 'the retry asks nothing')

    /*
     * Which kind of fault it was, recorded where it happens. Worked out from
     * `device` instead, a Mac that went quiet was described as a Mac that
     * answered — see faultCopy.
     */
    for (const reason of ["setFaultReason('no-answer')", "setFaultReason('no-unit')", "setFaultReason(null)"]) {
      assert.ok(src.includes(reason), `read() never records ${reason}`)
    }
    assert.match(src, /reason: faultReason/, 'the notice is back to guessing the reason from the device object')

    // The bar draws the link from state, never from the module at render.
    const topbar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    const chip = readFileSync(new URL('../src/components/LinkChip.jsx', import.meta.url), 'utf8')
    assert.ok(!/remoteActive|remoteHostSeen/.test(topbar + chip), 'the bar reads the connection module at render again — it is only as fresh as the last unrelated re-render')
    assert.match(src, /note=\{describeLink\(link\)\.note\}/, 'the Setup note no longer says what the link is')
  })

  test('the phone is never shown the computer’s error while the app works out which end it is', () => {
    /*
     * Every first-time phone visitor saw a red "Can't find your Fractal —
     * open the app on this Mac — try Chrome" before the connect screen: the
     * first read went to localhost before the role was known, and the words
     * were the Mac's, written in App where the role could not be checked.
     */
    assert.ok(
      !/useEffect\(\(\) => \{\s*\n\s*read\(\)\s*\n\s*\}, \[read\]\)/.test(src),
      'the unit is read at mount before anyone knows which end this is'
    )
    assert.match(src, /if \(isDemo\(\) \|\| servedLocally\(\)\) \{\s*\n\s*read\(\)/, 'the computer and the demo no longer read at once')
    assert.match(src, /if \(s\.role !== 'remote'\) read\(\)/, 'the phone reads the unit over localhost')

    // The words are chosen by role, in one tested place.
    assert.match(src, /faultCopy\(\{/, 'the fault notice writes its own copy again')
    assert.match(src, /status === 'fault' && fault \? \(/, 'a notice renders before the role is known')
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    assert.ok(!/Try Chrome/.test(code), 'the Safari sentence is back in App, shown to everyone')
    assert.ok(!/this computer/.test(code), '"this computer" is written in App, where the role cannot be checked')

    // Leaving or entering the demo is a reload: the role was decided at load.
    const dir = new URL('../src/components/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(new URL(f, dir), 'utf8'))
    for (const body of [src, ...files]) {
      for (const m of body.matchAll(/setDemo\((true|false|!demo)\)/g)) {
        const after = body.slice(m.index, m.index + 120)
        assert.match(after, /window\.location\.reload\(\)/, `setDemo without a reload — the tab keeps the role it had: ${after.split('\n')[0]}`)
      }
    }
    const libDir = new URL('../src/lib/', import.meta.url)
    const libs = readdirSync(libDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, libDir), 'utf8'))
    const removals = [src, ...files, ...libs].join('\n').match(/removeItem\('forgefx\.demo'\)/g) || []
    assert.equal(removals.length, 1, 'something other than setDemo drops the demo flag')
  })

  
  test('the preset list shows names it has, not 512 dashes', () => {
    /*
     * The demo's Presets sheet was 512 rows of "000: —", the loaded "500 DEMO"
     * among them as "—", and the empty-state copy could never render because
     * the list was always 512 long. On a real gen-3 unit reading the names
     * takes minutes, so this is most of the list most of the time.
     */
    const at = src.indexOf('const allSlots = useMemo')
    const memo = src.slice(at, at + 900)
    assert.match(memo, /byNumber\.set\(preset\.number, \{ number: preset\.number, name: preset\.name \}\)/, 'the loaded preset’s own name is not in the list')
    for (const site of [...src.matchAll(/<PresetList\b/g)]) {
      const props = tag(src.slice(site.index), 'PresetList') || ''
      assert.match(props, /slowNames=/, 'a PresetList is not told whether names cost a dump')
    }
    const console_ = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const list = console_.slice(console_.indexOf('export function PresetList'), console_.indexOf('export function BlockPanel'))
    assert.match(list, /const known = slots\.filter\(\(s\) => s\.name !== undefined\)/, 'the list no longer knows which slots have a name')
    assert.match(list, /const named = known\.filter/, 'the list shows slots read and found empty by default')
    /*
     * "Opened the list at 491 — the loaded preset is not a row in this list."
     * The slot had been read as empty before a tone was saved into it, so the
     * cached blank hid the row and the list opened at 000. The loaded
     * preset's own name now wins over a cached name for its slot, the loaded
     * slot is always a row, and a miss is not marked as settled.
     */
    assert.match(memo, /\(!byNumber\.has\(preset\.number\) \|\| preset\.name\.trim\(\)\)/, 'a slot read as empty before a save still hides the loaded preset')
    assert.match(list, /const named = known\.filter\(\(s\) => \(s\.name \|\| ''\)\.trim\(\) \|\| s\.number === current\)/, 'the loaded slot can be hidden behind Show all')
    assert.match(list, /done\('the loaded preset is not a row in this list'\)[\s\S]{0,600}?centredOn\.current = null/, 'a miss on opening is the only try the list ever makes')
    assert.match(list, /named\.length === 0/, 'the empty state is gated on the list length again, which is always the unit’s slot count')
    assert.ok(!/slots\.length === 0 \?/.test(list), 'the dead empty-state condition is back')
    assert.match(list, /Show all \$\{slots\.length\}/, 'the unnamed slots are shown by default again — or cannot be shown at all')
    assert.match(list, /No names read yet/, 'the empty state does not say what to do')
    assert.match(list, /scanning \? \(\s*'Reading the names off the unit/, 'a list being read still tells you to press ⟳')
  })

  test('a scene tile does one thing, and naming is one button', () => {
    /*
     * Three designs, each fixing the last. "Double-click a scene to name it"
     * never fired at all — the first click jumped, the jump re-read the unit,
     * the re-read disabled the button. Tap-the-one-you-are-in worked but was a
     * hidden gesture, so it grew a pencil beside every tile: eight extra
     * targets for something you do once a preset.
     *
     * Now the tile is one action — go there — and naming is a button that says
     * "Edit name", about the scene you are in. Which is what was asked for.
     */
    const scenes = readFileSync(new URL('../src/components/Scenes.jsx', import.meta.url), 'utf8')
    assert.ok(!/Double-click a scene/.test(scenes), 'the hint still promises a double-click')
    assert.ok(!/onDoubleClick/.test(scenes), 'the double-click path is back — it races the re-read and never fires')
    assert.ok(!/scene-pencil/.test(scenes), 'the pencil beside every scene is back')
    assert.match(scenes, /onClick=\{\(\) => jump\(i\)\}/, 'a scene tile does something other than go to that scene')
    assert.match(scenes, /scene-edit-name/, 'there is no single button for naming a scene')
    assert.match(scenes, /startRename\(current\)/, 'the name button does not name the scene you are in')

    // And the name is said once. It was in the sheet's subtitle, on the tile
    // and in the field, all at the same time.
    const sheet = src.slice(src.indexOf('title="Scenes"'), src.indexOf('title="Scenes"') + 200)
    assert.ok(!/note=\{sceneNames\[scene\]/.test(sheet), 'the Scenes sheet still repeats the live scene name in its subtitle')
  })

  test('the tabs run Play, Edit — and a swipe agrees', () => {
    /*
     * "Move the edit button to the right of create." The swipe order is a
     * separate list and has to move with the tabs, or a swipe left goes
     * somewhere the eye did not.
     *
     * There were three. Create — the conversation — sat between these two and
     * went with the AI, so the rule is now about two screens rather than
     * three. The rule itself did not change.
     */
    const tabs = src.slice(src.indexOf("['play', 'Play']"), src.indexOf("].map(([id, label])"))
    const at = (id) => tabs.indexOf(`'${id}'`)
    assert.ok(at('play') < at('shape'), `the tabs are not Play, Edit — ${tabs}`)
    assert.equal(at('ask'), -1, 'the Ask tab is back')
    const screens = readFileSync(new URL('../src/components/Screens.jsx', import.meta.url), 'utf8')
    assert.match(
      screens,
      /export const ORDER = \['play', 'shape'\]/,
      'a swipe still moves between the screens in the old order'
    )
  })

  
  
  test('Back moves between screens, through the one history ledger the sheets use', () => {
    /*
     * With no history for the screens, Back on a phone left the app from any
     * of them. The sheets already owned popstate with a ledger of their own
     * pops; a second writer that did not share it would bring back the
     * introduction that closed itself a third of a second after opening.
     */
    const sheet = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8')
    assert.match(sheet, /import \{ pushEntry, listen, swallowedPop, popSelf \} from '\.\.\/lib\/nav'/, 'Sheet keeps a private history ledger')
    const sheetCode = sheet.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    assert.ok(!/let selfPops|let listening|history\.pushState|history\.back\(\)/.test(sheetCode), 'Sheet still touches history directly')
    assert.match(src, /import \{ pushEntry, replaceEntry \} from '\.\/lib\/nav'/, 'App writes history without the ledger')
    assert.match(src, /window\.addEventListener\('popstate', onPop\)/, 'App does not hear Back')
    assert.match(src, /if \(!st \|\| st\.sheet \|\| typeof st\.view !== 'string'\) return/, 'a sheet’s own pop is taken for a screen change')
    assert.match(src, /pushEntry\(\{ view \}\)/, 'a screen change leaves no entry for Back to return to')
    assert.match(src, /replaceEntry\(\{ view(: viewRef\.current)? \}\)/, 'the entry the app opened on carries no screen')
  })

  test('on a phone the preset picker is a sheet, and the bar leaves the name its room', () => {
    /*
     * The popover under the bar filled a phone's screen with the slot list:
     * no room outside it to tap, no X, no swipe. A sheet has all three and
     * Back closes it. And the loaded preset's name was down to one letter
     * beside UNSAVED, a dot, Save, the phone chip and the gear.
     */
    assert.match(src, /const narrow = useAsks\('\(max-width: 620px\)'\)/, 'the bar no longer knows it is on a phone')
    assert.match(src, /menu=\{\s*\n\s*presetMenu && !narrow \? \(/, 'the popover still opens on a phone')
    const at = src.indexOf('title="Choose a preset"')
    assert.notEqual(at, -1, 'the phone has no preset sheet')
    const picker = src.slice(src.lastIndexOf('<Sheet', at), src.indexOf('</Sheet>', at))
    assert.match(picker, /open=\{presetMenu && narrow\}/)
    assert.match(picker, /\{presetPicker\}/, 'the sheet does not carry the same picker as the popover')
    assert.equal((src.match(/<PresetList\b/g) || []).length, 2, 'the picker is written more than once')
    assert.match(src, /useDismiss\(presetMenuRef, \(\) => setPresetMenu\(false\), \{ open: presetMenu && !narrow, ignore: '\.topbar-preset' \}\)/, 'the popover’s outside-tap listener runs under the sheet, or the menu no longer dismisses through the shared hook')
  })

  test('the bar’s preset line is one span inside the button', () => {
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    // "500" with no noun, "demo" in mono: the number is announced as a preset, the word is a label.
    assert.match(bar, /<span className="sr-only">Preset <\/span>/, 'the slot number has no accessible noun')
    assert.match(bar, /className="topbar-how" data-state/, 'the connection word is back in the mono face')
    const at = bar.indexOf('<span className="topbar-preset-line">')
    assert.notEqual(at, -1, 'the slot and the name are direct children of the button, which packs them to its top edge')
    const line = bar.slice(at, bar.indexOf('</span>\n            </span>', at))
    assert.match(line, /topbar-slot/)
    assert.match(line, /topbar-name/)
    assert.match(line, /topbar-caret/)
  })

  test('the demo keeps its names and its tuner is the mock’s, not a dice roll', () => {
    const forgefx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    const events = forgefx.slice(forgefx.indexOf('export function subscribeEvents'), forgefx.indexOf('export function subscribeEvents') + 400)
    assert.match(events, /mock\.tunerStream\(\)/, 'the mock event stream rolls its own tuner again')
    assert.ok(!/Math\.random/.test(events), 'the tuner reading is random per tick')
    const mock = readFileSync(new URL('../src/lib/mockDevice.js', import.meta.url), 'utf8')
    /* Both keyed by the preset the names belong to — see demoMemory.js. */
    assert.match(mock, /keepSceneNames\(state\.presetNumber, state\.sceneNames\)/, 'a demo rename is not kept against its preset')
    assert.match(mock, /storedSceneNames\(number\) \|\|/, 'the demo does not read its kept names on load')
    assert.match(mock, /tunerStream: \(\) => createTunerStream\(\)/, 'the mock has no tuner of its own')
    const tuner = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    assert.match(tuner, /left: reading\?\.note \? `calc\(50% \+ \$\{offset\}%\)` : '50%'/, 'the needle keeps its last position when nothing is playing')
  })

  test('Escape leaves any popover, and the row it left gets its focus back', () => {
    /*
     * The link chip's popover closed on a tap outside and nothing else; the
     * scene-rename row closed on Enter and nothing else. One hook now owns
     * "tap outside or Escape, then focus goes back", and the two popovers
     * use it; the rename row, an inline thing and not an overlay, just
     * learned Escape. The save popover it would also have covered no longer
     * exists — its rules were orphans and are gone.
     */
    const read = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
    const hook = read('lib/dismiss.js')
    assert.match(hook, /e\.key !== 'Escape'/, 'the hook does not listen for Escape')
    assert.match(hook, /addEventListener\('pointerdown', away\)/, 'the hook does not listen for a tap outside')
    assert.match(hook, /cameFrom\.focus\?\.\(\{ preventScroll: true \}\)/, 'focus does not return to where it was')
    const chip = read('components/LinkChip.jsx')
    assert.match(chip, /useDismiss\(wrap, \(\) => setOpen\(false\), \{ open, ignore: '\.phone-chip' \}\)/, 'the link chip does not dismiss through the shared hook')

    /*
     * "Make the connected button just a round green checkmark when it is
     * connected and a red X when it's not, the same size as the settings
     * gear." In the bar the chip is a mark; the sentence stays on the button
     * for a screen reader and in the popover for everyone.
     */
    /*
     * And then: "Change the circle connected button to just the word
     * connected (green), disconnected (red)." The word follows the same
     * three states the mark did, in the state's colour, and the button keeps
     * the gear's height so it is still something a thumb can hit.
     */
    /*
     * The four words moved out to shared/link-word.mjs when the phone was asked
     * for "this exact header" — one set of words, decided once, because a phone
     * saying DISCONNECTED beside a Mac saying CONNECTED about the same link is
     * a difference nobody can debug from a photograph. So the chip is checked
     * for using them, and the words themselves are checked where they live.
     */
    assert.match(chip, /import \{ linkTone, linkWord \} from '\.\.\/\.\.\/shared\/link-word\.mjs'/, 'the chip has its own copy of the words again')
    assert.match(chip, /const mark = linkTone\(said\.tone\)/, 'the chip decides the mark for itself')
    assert.match(chip, /const state = linkWord\(said\.tone, link\.role\)/, 'the chip decides the word for itself')
    assert.equal(linkTone('good'), 'ok')
    assert.equal(linkTone('busy'), 'wait')
    assert.equal(linkTone('bad'), 'no')
    assert.equal(linkTone('dim'), 'off')
    assert.equal(linkWord('bad', 'remote'), 'disconnected', 'the chip does not say disconnected')
    assert.equal(linkWord('good', 'remote'), 'connected', 'the chip does not say connected')
    assert.equal(linkWord('busy', 'remote'), 'connecting', 'a link on its way is called something else')
    /*
     * Quiet is not broken. A remote that is off, or never set up, was a red
     * DISCONNECTED beside the version number — in the demo, for good — and
     * read as the app having lost something. Grey, and it says what it is.
     */
    assert.equal(linkWord('dim', 'remote'), 'no computer', 'a remote nobody turned on is called disconnected')
    assert.equal(linkWord('dim', 'mac'), 'no phone', 'a computer with no phone on it is called disconnected')
    /*
     * And the phone reads the same four states off its own link module, which
     * has no describeLink in it at all. This is the join between the two: if
     * the browser ever re-tones one of these states, the phone's bar is drawn
     * from the stale half and nothing else would notice.
     */
    for (const link of ['connected', 'joining', 'no-answer', 'signed-out']) {
      assert.equal(
        toneOfRemote(link),
        describeLink({ role: 'remote', link }).tone,
        `the phone and the browser disagree about a remote that is ${link}`
      )
    }
    const quiet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(quiet, /\.phone-word\.off \{\s*color: var\(--silk-faint\)/, 'the quiet word is not grey')
    /*
     * And it names what it is about while something is wrong. "The phone app
     * says it has lost the unit, but also says it's connected in the right
     * hand corner." The left of that bar is the unit and this is the Mac;
     * neither said so, and two states at opposite ends of one bar read as the
     * app disagreeing with itself.
     */
    assert.match(chip, /const word = sayMac && mark !== 'off' \? `computer \$\{state\}` : state/, 'the word never says which thing it is about')
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    assert.match(
      bar,
      /sayMac=\{remote && status !== 'live'\}/,
      'the computer is named when the unit is answering too, where there is no confusion and no room'
    )
    assert.match(chip, /compact \? \(\s*<span className=\{`phone-word \$\{mark\}`\} aria-hidden="true">\s*\{word\}/, 'the bar chip is a mark again, not the word')
    assert.match(chip, /aria-label=\{`\$\{said\.sentence\} — phone remote options`\}/, 'the chip has no sentence for a screen reader')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const wordCss = css.slice(css.lastIndexOf('And then a word again'))
    assert.match(wordCss, /button\.phone-chip\.compact \{[^}]*min-height: 44px/, 'the word is under the touch floor')
    assert.match(wordCss, /\.phone-word\.ok \{\s*color: var\(--ok\)/, 'connected is not green')
    assert.match(wordCss, /\.phone-word\.no \{\s*color: var\(--fault\)/, 'disconnected is not red')
    assert.ok(!/\.phone-mark \{/.test(css), 'the round mark still has styling, which will dress up whatever gets that class next')
    assert.ok(!/addEventListener\('pointerdown'/.test(chip), 'the link chip keeps a private outside-tap listener')
    const scenes = read('components/Scenes.jsx')
    assert.match(scenes, /e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\)\s*setRenaming\(null\)/, 'Escape does not leave the rename row, or leaves the sheet with it')
    assert.ok(!/\.save-pop/.test(read('styles.css')), 'the orphaned save popover rules are back')
  })

  test('Save carries its state, and both grids know when they overflow', () => {
    const read = (f) => readFileSync(new URL('../src/components/' + f, import.meta.url), 'utf8')
    const save = read('SaveBar.jsx')
    assert.match(save, /data-dirty=\{dirty \? 'yes' : 'no'\}/, 'the save cluster does not say whether anything is unsaved')
    /*
     * "Saved" is claimed only once something actually was saved. `dirty`
     * answers "is anything unsaved", which is a different question — on a
     * preset freshly loaded, or generated and written to the unit but never
     * put in a slot, there is nothing pending and nothing saved either, and
     * the button used to claim the second. Both halves are required: without
     * the save itself it lies, without !dirty it hides pending changes.
     */
    assert.match(
      save,
      /: !dirty && justSaved\s*\n?\s*\? '✓ Saved'/,
      'the button says "Saved" about a preset that has never been saved'
    )
    /*
     * And a save in flight says SAVING, with something that moves.
     *
     * "It goes back to the gig screen and says Waiting — change that to say
     * Saving with a visual indicator it's working, then have it say saved
     * after it's completed." Waiting is what the app is doing; saving is what
     * is happening to the preset, and whether the Mac has picked the request
     * up yet is this app's problem rather than the player's.
     */
    /* Comments out: the word this replaced is quoted in the comment that says
       why it went, and a comment that can fail a test is unwritable. */
    assert.ok(
      !/Waiting/.test(save.replace(/\/\*[\s\S]*?\*\//g, ' ')),
      'the button is telling a player the app is waiting again'
    )
    assert.match(save, /const working = !!queued \|\| !!saving/, 'a queued save and a live one are two states again')
    assert.match(save, /className="save-spin"/, 'a save in flight shows nothing moving')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /\.save-spin \{[^}]*animation: pulse/, 'the working dot does not move')
    assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.save-spin \{\s*animation: none/, 'the working dot ignores a player who asked for less motion')
    /*
     * And then it said "Save" instead, on a preset nobody had touched — the
     * same fault wearing the other word, a button offering to do a thing there
     * is no thing to do. So it is a presence now, not a label.
     */
    assert.match(
      save,
      /if \(!queued && !saving && !dirty && !justSaved\) return null/,
      'the Save button is back on a bar with nothing to save'
    )
    /*
     * "Saved" is the one state with no work behind it, so it is the one that
     * has to expire — and from a clock rather than a flag, or a component that
     * mounts an hour later starts its own timer and says it again.
     */
    assert.match(save, /Date\.now\(\) - savedAt < SAVED_FOR_MS/, '"Saved" never stops being said')
    /*
     * Hiding it took away the only door to the save sheet, which is also how a
     * preset is put in a DIFFERENT slot with nothing edited. That door moved
     * rather than closing.
     */
    assert.match(
      read('../App.jsx'),
      /setSheet\('save'\)[\s\S]{0,120}Save to a slot/,
      'a preset with no edits can no longer be saved to another slot at all'
    )
    assert.ok(!/className="lamp"/.test(save), 'the cyan dot is back beside Save')
    assert.ok(!/topbar-dirty/.test(read('TopBar.jsx')), 'the separate UNSAVED word is back in the bar')
    /*
     * The chain editor's two sideways scrollers are gone with the 940px grid
     * they belonged to — it is a list down the page now, so there is nothing
     * to fade. The strip on the Console still scrolls and still says so.
     */
    const grid = read('GridEditor.jsx')
    assert.ok(!/useOverflow\(/.test(grid), 'the chain editor is scrolling sideways again')
    assert.ok(
      !/grid-scroll|className="grid(?:"| editable)|gridTemplateColumns/.test(grid),
      'the fixed-width grid canvas is back in the chain editor'
    )
    /* The two ends count too: a preset that gains an output block is a strip
       one tile wider, and the fade that says there is more to the right has to
       be told. */
    assert.match(
      read('Console.jsx'),
      /useOverflow\(strip, \[chain\.length, !!input, !!output\]\)/,
      'the chain strip keeps a private observer'
    )
  })

  test('the model picker says its name, and Modifiers says what it needs', () => {
    const read = (f) => readFileSync(new URL('../src/components/' + f, import.meta.url), 'utf8')
    const console_ = read('Console.jsx')
    assert.ok(!/\{m\.basedOn \? ` — \$\{m\.basedOn\}` : ''\}/.test(console_), 'the model option carries the whole "based on" sentence again')
    assert.match(console_, /className="hint pad based-on">\{gear\}/, 'what a model is based on is not shown under the picker')
    const mods = read('Modifiers.jsx')
    assert.match(mods, /id="mod-why" role="status"/, 'the disabled Attach button gives no reason')
    assert.match(mods, /aria-describedby=\{why \? 'mod-why' : undefined\}/)
    assert.ok(!/<span className="hint">\{model\.sourcesNote\}<\/span>\n\s*\) : null\}\n\s*<\/label>/.test(mods), 'the sources note is inside the Source label again, naming the select with a sentence')
    assert.match(mods, /id="mod-sources-note"/)
    /*
     * "The modifiers drop down also doesn't show anything." A unit that cannot
     * bind returned null, so the fold drew its header over blank space — which
     * reads as broken even though the panel was right to offer nothing.
     */
    assert.ok(
      !/bindingSupported === false\) return null/.test(mods),
      'a unit that cannot bind gets an empty fold again, with nothing to explain it'
    )
    assert.match(mods, /doesn.{1,8}t let an app attach a modifier/, 'nothing says why the panel is empty')
  })


  test('a sheet that opens as another closes is not closed by its pop', () => {
    /*
     * Closing a sheet pops the history entry it pushed, and that pop lands a
     * beat later — by which time a sheet opened in the same action has its own
     * popstate listener up and catches it. The symptom is a sheet that opens
     * and then closes on its own about a third of a second later, with nothing
     * in the code that says to close it. "Show the introduction" from inside
     * Settings did exactly that.
     *
     * The books live in lib/nav.js now, shared with the screens' own history
     * entries; the invariants are the same.
     */
    const nav = readFileSync(new URL('../src/lib/nav.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    assert.match(nav, /let selfPops = 0/, 'nothing tracks the pops a sheet causes itself')
    assert.match(nav, /let listening = 0/, 'nothing tracks whether a pop will reach anyone')
    assert.match(
      nav,
      /if \(listening > 0\) selfPops\+\+\s*\n\s*win\(\)\.history\.back\(\)/,
      'the debt is owed unconditionally again — with no sheet left to pay it the next real back gesture is swallowed, and after three open-and-close cycles back stops closing sheets at all'
    )
    // Deferred a task: at teardown a handoff is indistinguishable from a plain close.
    assert.match(nav, /export function popSelf\(defer = \(fn\) => setTimeout\(fn, 0\)\) \{\s*\n\s*defer\(\(\) => \{/, 'the pop is no longer deferred')
    assert.match(nav, /if \(selfPops > 0\) \{\s*\n\s*selfPops--/, 'a pop another sheet caused is no longer told apart from a back gesture')
    // And the sheet puts its entry back when it swallows one.
    const sheet = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8')
    const swallow = sheet.slice(sheet.indexOf('if (swallowedPop())'))
    assert.match(swallow.slice(0, swallow.indexOf('return')), /mark\(\)/, 'a swallowed pop is not paid back with a fresh entry — the sheet survives with no history and the next back press leaves the app')
  })

  
  
  
  
  test('the demo is not a one-way door on a phone', () => {
    /*
     * Reported from a real phone: a sheet headed "Set up phone remote — once,
     * on this Mac", a Turn on button, and under it "Can't reach the Fractal app
     * on your Mac. Check that it is open." The Mac was open. The phone was in
     * the demo, which takes the Mac role on whatever device it runs on, and the
     * button's first act is a call to a helper on localhost that a phone can
     * never have. Tapping "Try the demo" once had made the door one-way, and
     * the way back was three taps deep in Setup.
     *
     * Three things hold it open, and each was a separate way to be stuck.
     */
    const link = readFileSync(new URL('../src/lib/link.js', import.meta.url), 'utf8')
    const chip = readFileSync(new URL('../src/components/LinkChip.jsx', import.meta.url), 'utf8')

    // The app has to be able to tell a Mac pretending from a phone pretending.
    assert.match(
      link,
      /canReachHelper\(\)[\s\S]{0,120}set\(\{ canHost/,
      'nothing asks whether this browser could host, so the demo cannot tell a computer from a phone'
    )

    /*
     * The bar's chip is the live path — Setup's panel already refuses in the
     * demo (`cloud?.demo`), and the reported screenshot came from tapping the
     * chip. It must not offer a setup that calls a helper this end cannot have.
     */
    assert.match(
      chip,
      /link\.canHost/,
      "the bar offers the computer's setup without asking whether this end could ever be one"
    )
    assert.match(
      chip,
      /'leave-demo'/,
      'the bar has no way out of the demo, which is how a phone got stuck wearing the computer’s screen'
    )

    /*
     * And leaving it is the whole job. A reload is what re-decides which end
     * this is; without it the phone keeps the Mac's role until something else
     * happens to reload the page, which is the shape of the original bug.
     */
    const act = src.slice(src.indexOf("kind === 'leave-demo'"))
    assert.match(
      act.slice(0, 600),
      /setDemo\(false\)[\s\S]{0,200}location\.reload\(\)/,
      'leaving the demo does not reload, so the phone goes on believing it is the computer'
    )
  })

  
  
  
  
  
  
  /*
   * A stated count outranks a refusal.
   *
   * Learning a unit's size from its own complaint is how the app stops
   * offering slots that do not exist. Applied to a unit that HAS stated its
   * size, it becomes the more expensive mistake: one refusal quoting a
   * smaller unit's range would hide four hundred real slots from the person
   * who owns them. The unit's own answer wins, and this is the guard that
   * keeps it that way.
   */
  test('what the unit says about its own size beats what a refusal implies', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(
      app,
      /slotCount\(device\?\.capabilities\) \? null : countFromRefusal\(err\.message\)/,
      'a refusal can now shrink a unit that already said how many presets it holds'
    )
    // And nothing anywhere invents the gen-3 count for a unit that never said.
    assert.ok(
      !/presets\?\.count \?\? 512|presets\.count \?\? 512/.test(app),
      'the invented 512 is back'
    )
  })

  /*
   * A button does not offer to fix what is not broken.
   *
   * "Says connected to Mac. But has a reconnect button. That shouldn't say
   * reconnect if already connected." The label was unconditional, so a live,
   * connected unit was offered a Reconnect — which reads as though the app
   * knows something the player does not.
   */
  test('Reconnect is only offered when something is disconnected', () => {
    const detail = readFileSync(
      new URL('../src/components/DeviceDetail.jsx', import.meta.url),
      'utf8'
    )
    assert.match(
      detail,
      /status === 'live' \? 'Read the unit again' : 'Reconnect'/,
      'the button says Reconnect at a unit that is connected'
    )
  })

  /*
   * Answering a question makes it go away.
   *
   * "This notification doesn't disappear after clicking one of the options."
   * Both buttons cleared the notice and then cleared the parked request, in
   * that order, with awaits between — and clearing the notice re-runs the
   * effect that watches for parked saves, which looks again immediately, finds
   * the request still there, and raises it a second time.
   *
   * And the copy said "the unit has moved since it asked" whatever the reason
   * was, so a request held up purely by its age announced itself as "it was on
   * 99 and is on 99 now" — a sentence that disproves itself as you read it.
   */
  test('a save request that has been answered cannot ask again', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

    // The decision is recorded before anything is awaited, and consulted.
    assert.match(app, /markHandled\(req\?\.id\)/, 'nothing records that a request was dealt with')
    assert.match(
      app,
      /handledSaves\.current\.includes\(req\.id\)/,
      'the watcher can raise a request that has already been answered'
    )
    /*
     * It is the FIRST thing carryOutSave does — after an await it is too late.
     * Measured with the comments stripped: the comment explaining this says
     * "before anything is awaited", and a guard that finds the word there
     * reads its own explanation as the defect.
     */
    const carry = app
      .slice(app.indexOf('const carryOutSave'), app.indexOf('const carryOutSave') + 2500)
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const marked = carry.indexOf('markHandled')
    const firstAwait = carry.indexOf('await ')
    assert.ok(
      marked >= 0 && (firstAwait === -1 || marked < firstAwait),
      'the request is marked after the first await, which is the race this fixes'
    )

    /*
     * And the Mac is never the one asked.
     *
     * "Every time I open the Mac app it shows me 'the phone asked to save'. I
     * have dismissed this notification multiple times and it shows up every
     * time." Dismissing recorded the id in a ref, which a restart empties, so
     * the only durable record was a DELETE whose failure `deleteHostDoc`
     * swallows — one failed delete and the question returned at every launch
     * for ever.
     *
     * It was also the wrong question. Once the unit has moved on, the buffer
     * the phone edited is gone: there is nothing correct left to save, so the
     * only sound answer is no, and a notice whose only answer is no is a notice
     * that should not exist. The phone is told instead, where the person who
     * asked is standing.
     */
    assert.ok(
      !/The phone asked to save/.test(app),
      'the computer is being asked again — a question whose only right answer is no'
    )
    assert.ok(
      !/setAskedSave/.test(app),
      'the state behind that notice is back'
    )
    // Both dead ends report to the phone, and say which one it was.
    const watcher = app.slice(app.indexOf('const req = await takeParkedSave()'))
    assert.match(watcher, /reportSave\(\{/, 'a request the computer cannot carry out leaves the phone waiting for ever')
    assert.match(
      watcher,
      /error: sameBuffer\s*\n?\s*\?/,
      'both dead ends give the phone the same reason, and one of them is a lie'
    )
    /*
     * Marked before the delete rather than after: the delete is the part that
     * can fail silently, and a decision recorded only by a failed delete is no
     * decision at all.
     */
    const drop = watcher.slice(0, watcher.indexOf('reportSave'))
    assert.ok(
      drop.indexOf('handledSaves.current = [') < drop.indexOf('await clearParkedSave()'),
      'the request is recorded as handled only after the delete, so a failed delete raises it again'
    )
  })

  /*
   * "The app version number is listed only in settings. I like to always know
   * easily what version we are working on."
   *
   * On the bar, where it can be read without opening anything. It was kept
   * off a phone's bar to give the preset name the room, and then asked for
   * there too: "Add the app version number to the header." So it shows at
   * every width now.
   */
  test('the version is on the main screen, on a phone as well', () => {
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    assert.match(bar, /className="topbar-version mono"/, 'the version is only in Setup again')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const hidden = [...css.matchAll(/\.topbar-version \{[^}]*display: none/g)]
    assert.equal(hidden.length, 0, 'the version is hidden somewhere again — a phone is where it was asked for')
  })

  
  
  
  test('scene names are checked against the preset they were asked for', () => {
    /*
     * "On the Cowboys From Hell rig it's still showing the Distortion Rigs
     * scenes. Weirdly it's only happening on these two."
     *
     * Only these two because it sticks: the wrong answer was cached under the
     * slot it was not about, and on a phone the cache is the only source —
     * an AM4 cannot be dumped over the relay. So the check has to happen
     * before the write to the cache, on both routes that can answer.
     */
    const fx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    const read = fx.slice(fx.indexOf('export async function readSceneNames'))
    const body = read.slice(0, read.indexOf('\nexport '))

    const summary = body.indexOf('wrongSlot(number, summary?.number)')
    const dump = body.indexOf('wrongSlot(number, dump?.location)')
    assert.ok(summary > 0, 'the summary route believes an answer about another preset')
    assert.ok(dump > 0, 'the dump route believes an answer about another preset — the one that bit')

    /* Before the cache, not after: a wrong answer that is rejected but kept is
       the same bug with an extra step. */
    for (const [what, at] of [['summary', summary], ['dump', dump]]) {
      const remembered = body.indexOf('rememberSceneNames', at)
      assert.ok(remembered > at, `the ${what} route caches before it checks`)
    }
  })

  test('the chain is corrected where it arrives, and Move is gone where it would lose the block', () => {
    /*
     * "It shows five blocks when there's only four... if you add one, it
     * actually saves it to the first block, but overwrites the one that is
     * listed as number two." And: "the move function doesn't work... let's just
     * remove the move button."
     */
    const fx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')

    /*
     * One place, not four. The columns were used by the editor's slot list, its
     * gap list, its labels and its writes, and correcting them at each use
     * leaves the next use wrong. This is the boundary the file already says it
     * converts at.
     */
    const blocks = fx.slice(fx.indexOf('export const presetBlocks'), fx.indexOf('export const blockParams'))
    assert.match(blocks, /zeroBasedChain\(/, 'a one-based chain reaches the app uncorrected')
    assert.match(fx, /lastCaps = res\?\.capabilities/, 'nothing remembers whether this unit counts from one')

    /*
     * And the correction happens on the way in rather than on the way out — the
     * write side already adds the wire's one, and doing it in both places is
     * how the chain ended up off by one to begin with.
     */
    /*
     * The boundary moved to shared/grid-plan, because the phone places blocks
     * now too and a second copy of "which end counts from one" is how this went
     * wrong the first time. Run rather than read, so a rewrite that still types
     * correctly but counts differently fails here.
     */
    assert.match(fx, /toWireCell/, 'nothing converts to the wire\'s column numbering any more')
    assert.match(
      fx,
      /from '\.\.\/\.\.\/shared\/grid-plan\.mjs'/,
      'the browser has its own wire boundary again, so the two apps can drift'
    )
    /* Rows shift with columns: the dump counts both from zero and the wire
       counts both from one. A row written unshifted went to the top row. */
    assert.deepEqual(
      wireCell(1, 0),
      { row: 2, col: 1 },
      'the wire boundary changed; the chain may now be corrected twice or not at all'
    )

    /*
     * Move, only where a move keeps the block. On a grid unit a block carries
     * its own settings; on the AM4 they live in the slot, so "move" is clear
     * one and create a fresh one — same name, every knob at its default.
     */
    const grid = readFileSync(new URL('../src/components/GridEditor.jsx', import.meta.url), 'utf8')
    const bare = grid.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const move = bare.slice(bare.indexOf('{linear ? null : ('), bare.indexOf('Replace', bare.indexOf('{linear ? null : (')))
    assert.ok(move.length > 20, 'Move is offered on every unit again')
    assert.match(move, /Move/, 'the guarded control is no longer Move')
    /* Remove and Replace stay — they are honest about creating a new block. */
    assert.match(bare, /'Replace'/, 'Replace went with it')
  })

  test('a block is held for its channels, and the hold does not also switch it off', () => {
    /*
     * "If you can hold one of the effects for a few seconds, it would be cool
     * to have a pop-up where you can quickly switch channels from ABCD... On
     * the Mac version, maybe we can do a right click."
     *
     * The channels were reachable already — on Edit, three taps into a sheet.
     * That is the right place to study a block and the wrong one to change it
     * between two bars, which is what the stage screen is for.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const bare = gig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    assert.match(bare, /useLongPress\(/, 'the stage tiles cannot be held')
    assert.match(bare, /gig-chan-btn/, 'there is nothing to pick once one is held')

    /*
     * "It's tiny right now. Maybe pull up a slide-up menu when you hold the
     * button down?" The pick is a sheet — the app's own, portalled out of the
     * swipe surface — with one big button per channel, not four pills inside
     * the tile. One sheet for the grid, owned by Gig, fed the block held.
     */
    assert.match(bare, /import Sheet from '\.\/Sheet'/, 'the channel pick is not the app\u2019s sheet')
    const chanSheet = bare.slice(bare.indexOf('function ChannelSheet('))
    assert.match(chanSheet, /<Sheet open=\{!!block\} onClose=\{onClose\} title=\{name\} note="Channel">/, 'the channel sheet does not slide up under the block\u2019s name')
    assert.match(chanSheet, /await setChannel\(block\.effectId, ch\)\s*\n\s*onClose\(\)/, 'the sheet does not go down once the channel is written')
    assert.match(bare, /onHold=\{\(\) => setChanEid\(block\.effectId\)\}/, 'a held tile no longer opens the sheet')
    assert.equal((bare.match(/<Sheet\b/g) || []).length, 1, 'more than one channel sheet — one per tile again')
    const chanCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const pill = chanCss.match(/button\.gig-chan-btn \{([^}]*)\}/)?.[1] || ''
    assert.match(pill, /min-height: 88px/, 'a channel button is thin again')
    assert.ok(!/\.gig-chan \{[^}]*position: absolute/.test(chanCss), 'the channels are back inside the tile')

    /*
     * The failure that matters, and it is not a cosmetic one.
     *
     * A press produces a click afterwards. Without swallowing it, the tile
     * somebody held to change a channel also toggles the block — silence, mid
     * song, from a gesture meant to be safe. It is held in the hook so that
     * every future caller gets it rather than remembering to.
     */
    const press = readFileSync(new URL('../src/lib/longPress.js', import.meta.url), 'utf8')
    const bareP = press.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    assert.match(bareP, /onClickCapture/, 'the click after a hold still reaches the button under it')
    const click = bareP.slice(bareP.indexOf('onClickCapture'))
    assert.match(click, /preventDefault\(\)/, 'a held block is also switched off')
    assert.match(click, /stopPropagation\(\)/, 'a held block is also switched off')

    /*
     * And the menu only opens where there is a choice. A block with one channel
     * — or none — opens an empty menu, which is worse than a gesture that does
     * nothing at all.
     */
    assert.match(bare, /channels\?\.length \|\| 0\) > 1/, 'a block with no channels opens an empty menu')

    /*
     * iOS answers a long press with its own callout over the top of the page,
     * and sends no contextmenu event, so CSS is the only place it can be
     * stopped. Android's own menu is cancelled in the handler, where the event
     * exists.
     */
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const tile = css.slice(css.indexOf('button.gig-block {'), css.indexOf('}', css.indexOf('button.gig-block {')))
    assert.match(tile, /-webkit-touch-callout: none/, 'iOS puts its own menu over the channels')
    assert.match(bareP, /onContextMenu/, 'right-click does nothing, and Android shows its own menu instead')

    /*
     * Pointer events, not a fourth touchstart. The three surfaces that bind one
     * each carry a paragraph explaining why, and touch.mjs makes a fourth a
     * decision rather than a paste — a hold never needs to cancel the gesture,
     * so it has no business in that list.
     */
    assert.ok(!/addEventListener\('touchstart'/.test(press), 'the hold went around React and into the passive-listener trap')
  })

  test('the tuner says the true reason it is not moving, and names a route that works', () => {
    /*
     * "On the AM4, hitting the tuner doesn't turn the tuner on the device...
     * but previously it was still reading the tuning back to the phone. On the
     * FM3 it works fine."
     *
     * Two different things, and only one of them was a fault.
     *
     * The unit's screen not changing is correct: the device server sends a
     * gen-3 unit a tuner-page open, which is why an FM3 lights up, and the
     * AM4's tuner block is always live so it is polled without ever switching
     * the unit into tuner mode. Nothing was there to say so, and from the
     * outside it looks like a button that missed.
     *
     * The readings were the fault, and this sentence has now been wrong twice,
     * in opposite directions. First "only the app at the Mac. Tune there." —
     * false, a phone on the same wifi always worked. Then "readings don't cross
     * the phone-remote link" — true when written, and no longer: the host
     * bridges them now, throttled to one every 80 ms.
     *
     * So what this holds is that the message never again names a cause it
     * cannot see. It may say what to try; it may not diagnose the link or the
     * unit as though it had looked.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const bare = gig.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

    /* The unit's own screen, explained only where it is true. */
    assert.match(bare, /device\.gen !== 3/, 'every unit is told its screen will not change, including the ones where it does')
    assert.match(bare, /switching the unit into tuner mode/, 'nothing explains a unit whose screen stays put')

    // Whitespace-flattened: JSX wraps a sentence wherever the line ran out, so
    // matching raw source tests the formatter rather than the words.
    const stall = bare
      .slice(bare.indexOf('remoteActive() ? ('), bare.indexOf('gig-scenes'))
      .replace(/\s+/g, ' ')
    assert.ok(stall.length > 40, 'the remote explanation is gone')

    /* Neither of the two sentences that turned out to be false. */
    assert.ok(
      !/Tune there|only the app at the computer/.test(bare),
      'the tuner still says a phone cannot do this, which is only true of one of its two routes'
    )
    assert.ok(
      !/don.{1,8}t cross the phone-remote link|carries changes, not/.test(bare),
      'the tuner still says readings cannot cross the link, which the host now bridges'
    )

    /* What is left is the two things still worth trying, and no diagnosis. */
    assert.match(stall, /this version of the app/, 'nothing names the computer being on an older version')
    assert.match(stall, /same wifi/, 'the route that works whatever the computer is running is not mentioned')
    assert.match(
      stall,
      /footswitch/,
      'nothing suggests engaging the tuner on the unit, which is how an AM4 is put into it'
    )
  })

  
  
  /*
   * An update you can see, and ask for.
   *
   * "I quit the app and restarted, I'm on 7.50.0, no update notification. In
   * addition to a notification that pops up can we add a check for update
   * button in settings?"
   *
   * There was nothing to see and no way to ask. The window loads the web app
   * over http with context isolation on and no preload at all, so the page and
   * the updater had never had a channel between them — everything the updater
   * knew went to the menu-bar menu and nowhere else.
   */
  test('the page can be told about an update, and ask for one', () => {
    const main = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
    const preload = readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8')

    assert.match(main, /preload: join\(__dirname, 'preload\.js'\)/, 'the window has no bridge again')
    // Context isolation stays on and node stays out: the bridge is the whole
    // surface, and it carries one subject.
    assert.match(main, /contextIsolation: true/, 'context isolation was turned off to do this')
    assert.match(main, /nodeIntegration: false/, 'node was let into the page to do this')
    assert.match(main, /ipcMain\.handle\('updates:check'/, 'nothing can ask for a check')
    assert.match(main, /win\.webContents\.send\('updates:state'/, 'the window is never told anything')

    /*
     * The wording is built once, in the main process. Two copies of it drift,
     * and a menu and a window disagreeing about the same download is worse
     * than either one alone.
     */
    assert.match(main, /line: updateLine\(state\)/, 'the window builds its own wording')
    assert.ok(
      !/updateLine|Downloading an update/.test(
        readFileSync(new URL('../src/lib/desktop.js', import.meta.url), 'utf8')
      ),
      'the page has its own copy of the update wording'
    )

    /*
     * And the bridge exposes updates and nothing else — read with the prose
     * stripped, because the comment above it says "the Mac app." and a guard
     * that finds its own explanation is a guard that can never pass. Third
     * time that has caught me in this file.
     */
    const bridge = preload.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(
      !/require\('node:|shell\.|dialog\.|\bapp\.(quit|relaunch|exit)/.test(bridge),
      'the preload reaches past updates into the rest of the app'
    )
    assert.match(bridge, /exposeInMainWorld\('fractalDesktop'/, 'the bridge is not exposed')
  })

  test('a channel is written where the scene that plays it can keep it', () => {
    const forgefx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')

    // The scene pass: standing in the scene, because that is what remembers it.
    const scenes = forgefx.slice(
      forgefx.indexOf('export async function applyScenes'),
      forgefx.indexOf('export const selectPreset')
    )
    assert.match(
      scenes,
      /await setChannel\(block\.eid, block\.channel\)/,
      'the scene pass writes the bypass and drops the channel, so half of every scene is thrown away'
    )

    /*
     * The block pass: the channel first. A value belongs to a channel, so
     * writing values before selecting one puts the lead settings on top of the
     * rhythm ones — and a channel is free to be on a different model, so the
     * ranges have to be re-read after the move exactly as they are after a
     * model swap.
     */
    const changes = forgefx.slice(
      forgefx.indexOf('export async function applyChanges'),
      forgefx.indexOf('export async function applyScenes')
    )
    const at = (re) => changes.search(re)
    assert.ok(at(/await setChannel\(change\.eid/) !== -1, 'a change carrying a channel never selects it')
    assert.ok(
      at(/await setChannel\(change\.eid/) < at(/await setType\(change\.eid/),
      'the model is written before the channel it belongs to'
    )
    assert.ok(
      at(/await setType\(change\.eid/) < at(/await blockParams\(change\.eid/),
      'the ranges are re-read before the writes that move them'
    )
    assert.ok(
      at(/await blockParams\(change\.eid/) < at(/setParamConfirmed/),
      'values are written against ranges read before the channel and model moved'
    )
  })

  
  
  
  
  
  /*
   * "The edit chain doesn't seem to be functioning correctly at all, delete
   * block works, but the rest you can't really add anything or change
   * anything."
   *
   * Delete was the one that worked because delete was the one that did not
   * check `ok:false`. This repo documents twice that this unit family answers
   * `ok:false` to writes that landed — so a move was written, reported refused,
   * and then actively rolled back, and a placement threw over a block that was
   * sitting there. Nothing in the chain editor may treat that answer as a
   * failure again.
   */
  test('the chain editor does not undo writes the unit said it refused', () => {
    const grid = readFileSync(new URL('../src/components/GridEditor.jsx', import.meta.url), 'utf8')
    assert.ok(
      !/res\?\.ok === false\) throw|if \(res\?\.ok === false\) \{\s*\n\s*await placeBlock/.test(grid),
      'a write is thrown away again because the unit answered ok:false'
    )
    // The rollback that remains is for a throw — a real transport failure —
    // and only for the move, whose block would otherwise exist nowhere.
    const move = grid.slice(grid.indexOf('const move = async'), grid.indexOf('const remove = async'))
    assert.match(move, /catch \(err\) \{\s*\n\s*await placeBlock\(from\.row, from\.col/, 'a move that throws mid-way loses the block')
    /* The rule moved to shared/grid-plan, because the phone needs the same one:
       treating ok:false as a failure is the bug this panel was reported for. */
    assert.match(grid, /const doubtful = doubtfulWrite/, 'nothing says what ok:false actually means here')
    assert.ok(doubtfulWrite({ ok: false }), 'a doubtful write now passes silently')
    assert.equal(doubtfulWrite({ ok: true }), null, 'a write that worked is being questioned')
    assert.match(doubtfulWrite({ ok: false }), /re-read/, 'the answer to a doubtful write is not to re-read the chain')
  })

  test('the chain editor counts columns the way the rest of the app does', () => {
    /*
     * Reads report columns 0-indexed and toWireCell adds the wire's 1 at the
     * boundary; actions.js has always worked that way. This panel added one of
     * its own for a linear unit and then the wire added another, so slot 1 on
     * an AM4 was written to column 2 — and the cells it drew could never match
     * the blocks the device reported.
     */
    const grid = readFileSync(new URL('../src/components/GridEditor.jsx', import.meta.url), 'utf8')
    assert.ok(!/linear \? \(i % cols\) \+ 1/.test(grid), 'a linear unit gets a second column increment again')
    /*
     * The rule moved to shared/grid-plan so the phone is handed the same copy —
     * a placement write changes a preset's structure rather than a value, and
     * two apps counting columns differently would not disagree out loud, they
     * would each put things one column along. So the check follows it there,
     * and runs it rather than reading it.
     */
    assert.ok(
      !/=> col \+ 1/.test(grid),
      'the panel is counting columns for itself again instead of using the shared rule'
    )
    assert.match(grid, /const label = colLabel/, 'the only place that counts from one should be the label')
    /*
     * The starter chain places into the columns chainPlan hands back, and a
     * linear unit — which has no grid and no input or output block to step
     * around — into its own slots, counted from zero. Neither adds one.
     */
    assert.match(
      grid,
      /placeBlock\(1, linear \? i : plan\.cols\[i\], block\.page\)/,
      'the starter chain starts one column late'
    )
  })

  test('the chain fits a phone, and answers where it was tapped', () => {
    const grid = readFileSync(new URL('../src/components/GridEditor.jsx', import.meta.url), 'utf8')
    assert.match(grid, /className="chain-lanes"/, 'the chain is not drawn as lanes down the page')
    // Drag-and-drop was the only way to move a block and does nothing at all
    // on a touch screen.
    assert.ok(!/draggable|onDragStart|onDrop/.test(grid), 'the chain editor is back on drag-and-drop, which iOS ignores')
    assert.match(grid, /className="chain-issue"/, 'a failure is reported somewhere other than beside the control that caused it')
    // A palette that failed to load used to be an empty catch, leaving Place
    // disabled with nothing to explain it.
    assert.match(grid, /paletteFailed/, 'a failed block list is silent again')
    assert.match(grid, /Couldn&rsquo;t read the block list/, 'a failed block list does not say so')
    /*
     * The cursor probe is gone, and stays gone.
     *
     * It moved the unit's edit cursor without writing anything, so you could
     * check that the app and the hardware agreed about which cell was which —
     * a thing worth doing once, while a numbering bug was being chased, by the
     * person chasing it. It shipped, folded behind "Technical details" and a
     * sentence about indexing conventions: "why is this here. makes no sense."
     * Correct. A diagnostic left in a player's chain editor is not a feature,
     * and the fold it hid in was broken anyway — opening it switched the probe
     * on, and the switch to turn it off vanished with it.
     */
    assert.ok(!/Point at it|chain-technical|pointAtCell/.test(grid), 'the cursor probe is back')
    const forgefx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    assert.ok(!/pointAtCell/.test(forgefx), 'the device call behind it is dead code again')
  })

  test('forgetting names nobody cached does not create a key to hold nothing', () => {
    /*
     * `forgetSceneNames` read the cache as `|| '{}'`, deleted from the empty
     * object and wrote it straight back — so renaming a scene where nothing had
     * ever been cached CREATED the key as `{}`. In the demo that is every
     * rename, because the demo keeps its names in its own store: reported as
     * `fractal.demo.sceneNames` populated beside a `fractal.sceneNames` that is
     * permanently an empty object, which reads like two stores disagreeing when
     * it is one store and a stray.
     */
    const forgefx2 = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    const at = forgefx2.indexOf('export function forgetSceneNames(')
    assert.notEqual(at, -1, 'forgetSceneNames is gone')
    const body = forgefx2.slice(at, forgefx2.indexOf('\n}', at))
    assert.match(body, /if \(!raw\) return/, 'an empty cache is written back rather than left alone')
    assert.match(
      body,
      /else localStorage\.removeItem\(SCENE_NAME_CACHE\)/,
      'a cache emptied by the last delete is left behind as {}'
    )
  })

  /*
   * "On the comparing scenes, A and B… channel and channel B is confusing.
   * Also saying that it cost twice as much isn't super user-friendly. The
   * generation also isn't working — it says building for about two minutes and
   * then just stops."
   *
   * The panel promised it "points scenes 1 and 2 at them" and never touched a
   * scene. Since choosing a channel is one of the two things a scene
   * remembers, both takes' choices landed in whichever scene was live and the
   * second overwrote the first — so only one take was ever audible. It also
   * threw away every write failure and every rejected setting, and rendered
   * its progress on a screen the person was not looking at.
   */
  test('signing in is the only way in the website offers', () => {
    /*
     * "Yes, number three sounds good."
     *
     * Three choices were on the table for what the website does about the
     * $9.99, which it cannot charge: gate the site behind a paid unlock, let
     * it be free and sell the app on convenience, or free for signed-in
     * accounts with the same-wifi box dropped. He took the third.
     *
     * WHAT THAT BOX WAS. The computer's address, typed, sending the browser
     * to the copy the computer serves on the LAN. Nothing signed into,
     * nothing paid, and a phone with full control of a rig — offered at the
     * bottom of the one screen whose entire job is to say that an account is
     * how you connect a phone. It was asked for once ("there should be two
     * options, one just to sign in and control the device and use local
     * browser storage"), and the account-only rule that came later is the one
     * that wins.
     *
     * WHAT IS NOT CLAIMED HERE. The route still exists — the computer serves
     * the app on the LAN and a typed address still reaches it, which is what
     * works at a venue with no signal. This holds only that the website stops
     * offering it as an alternative to signing in.
     */
    const connect = readFileSync(new URL('../src/components/ConnectScreen.jsx', import.meta.url), 'utf8')
    /* Comments quote what they replaced, so only what the screen draws counts.
       Fourth time this file has failed on its own explanation. */
    const drawn = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    const shown = drawn(connect)

    /* The box, its field, and the jump it made are all gone. */
    for (const [pattern, what] of [
      [/className="connect-local"/, 'the same-wifi box is back on the hosted screen'],
      [/placeholder="fractal\.local"/, 'the address field is back'],
      [/window\.location\.href = `http:\/\//, 'the screen sends the browser to a plain-http address again'],
      [/:5056/, 'the screen still knows the port the computer serves on'],
      [/no account, no code/, 'the same-wifi route advertises needing no account again']
    ]) {
      assert.ok(!pattern.test(shown), what)
    }
    /* And no wording of the promise, in any form. */
    assert.ok(
      !/no account|without an account|needs no account/i.test(shown),
      'the connect screen advertises a way in that needs no account again'
    )

    /* What is left is one route, and it says what it buys. */
    assert.match(shown, /Sign in with the same account as the computer/, 'the screen stopped asking for an account')
    assert.match(
      connect,
      /setlists and the presets you starred follow you to\s+any device/i,
      'nothing says what signing in buys'
    )
    /*
     * AND ONE SIGN IN BUTTON, not two. The screen drew its own twice — the top
     * branch on `remembered` being null and a second block on `!remembered`,
     * which is the same condition — so a signed-out phone got two buttons with
     * one label running different calls. "What is the button on the bottom".
     */
    assert.equal((shown.match(/>\s*Sign in\s*</g) || []).length, 1, 'the screen offers Sign in twice again')
    assert.ok(!/className="connect-account"/.test(shown), 'the duplicate sign-in block is back')

    /* No AI, which this screen advertised until he read it. */
    assert.ok(!/\bAI\b/.test(shown), 'the browser advertises an AI the app does not have')
  })

  test('watching a pull request does not need asking about', () => {
    /*
     * "Can you always approve PR subscribe/unsubscribe without my input?
     * That's the one I always have to confirm and it's tedious."
     *
     * Watching a pull request reads its comments and CI — it writes nothing
     * and sends nothing anywhere — so it is exactly the kind of step that
     * should not interrupt someone. The container this work runs in is thrown
     * away between sessions, so a setting written there dies with it; this
     * file travels with the repository, which is the only place the answer
     * stays answered.
     */
    const settings = JSON.parse(
      readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8')
    )
    const allowed = settings.permissions?.allow || []
    for (const tool of ['subscribe_pr_activity', 'unsubscribe_pr_activity']) {
      assert.ok(
        allowed.some((entry) => entry.endsWith(tool)),
        `${tool} still asks before it runs`
      )
    }
    /*
     * And the rest of the same class. Reading a pull request, its checks and
     * its comments is the bulk of what gets asked about here, and none of it
     * changes anything — so the whole of both servers is allowed, rather than
     * naming tools one at a time as each new one interrupts someone.
     */
    for (const server of ['mcp__github', 'mcp__Claude_Code_Remote']) {
      assert.ok(allowed.includes(server), `${server} still asks tool by tool`)
    }
  })

  test('the computer app can actually install what it downloads', () => {
    /*
     * Three things have to agree or the app checks for updates forever and can
     * never take one, which looks identical to working.
     *
     * electron-updater cannot update from a disk image — it downloads in the
     * background and swaps the app in, and mounting a .dmg is not something it
     * can do unattended. So a zip is built alongside, and latest-mac.yml points
     * at that. And the publish block is read twice over: electron-builder
     * writes the feed from it, and the packaged app reads it back to know where
     * to look. If they could disagree the app would check somewhere nothing is
     * ever released.
     */
    const yml = readFileSync(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8')
    assert.match(yml, /target:\s*zip/, 'there is nothing electron-updater can install')
    assert.match(yml, /publish:\s*\n\s*provider:\s*github/, 'the app has nowhere to check')

    const pkg = JSON.parse(
      readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')
    )
    assert.ok(
      pkg.dependencies?.['electron-updater'],
      'electron-updater is not shipped inside the app'
    )

    /*
     * One name, in all four places that show it.
     *
     * The app is named separately for the Mac bundle, the packager, the browser
     * tab and the home-screen icon, and nothing made them agree — so a rename
     * lands in three of the four and the fourth goes on saying the old thing
     * for months, on whichever surface nobody happened to open. That is not
     * hypothetical for a rename done by hand across a repository: it is the
     * ordinary outcome.
     *
     * The bundle name is the one with consequences. It decides what the .app in
     * Applications is called and what electron-builder names every release
     * asset, so productName in the two files that carry it must never drift.
     */
    const NAME = 'Fractal Remote'
    assert.equal(pkg.productName, NAME, 'the computer app is named something else')
    assert.match(yml, new RegExp(`productName: ${NAME}\\s*$`, 'm'), 'the packager builds a differently named app')

    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    assert.match(html, new RegExp(`<title>${NAME}</title>`), 'the browser tab says something else')

    const manifest = JSON.parse(
      readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')
    )
    assert.equal(manifest.name, NAME, 'an icon added to a home screen is named something else')

    /*
     * And published rather than drafted. electron-builder's default is a
     * draft, which is invisible to the updater — so the app would check, find
     * nothing, and be right, while the release sat waiting for a click.
     */
    assert.match(yml, /releaseType:\s*release/, 'the release would be a draft nobody can install')

    // Published from a release tag and from nothing else.
    const flow = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8')
    assert.match(flow, /refs\/tags\/desktop-v/, 'every build would publish, or none would')

    /*
     * And a release can be asked for without pushing a tag, because pushing
     * one is not always available: a credential scoped to a branch is refused
     * with a 403 and there is nothing to retry. It was never required either —
     * electron-builder creates the release through GitHub's API and GitHub
     * makes the tag, so the tag is a result of releasing, not the trigger.
     *
     * Only from the default branch, though. `createRelease` does not say which
     * commit to tag, so GitHub tags the default branch's head; published from
     * anywhere else, a release would carry that name and someone else's code.
     */
    assert.match(flow, /inputs\.publish/, 'a release can only be cut by pushing a tag')

    /*
     * And the job is allowed to create one. A workflow that says nothing about
     * permissions gets the repository default, which here is read only — so
     * the build signed, notarised and verified perfectly and then failed on
     * the last step, handing the finished thing to GitHub. Asked for by name
     * so it cannot quietly change underneath the release again.
     */
    assert.match(
      flow,
      /permissions:\s*\n\s*contents:\s*write/,
      'the release build cannot publish what it built'
    )
    /*
     * Held as the rule rather than as the line it was written on. This used to
     * match `inputs.publish && github.ref == 'refs/heads/main'` exactly, and
     * the expression grew a second way in — a merge to main now publishes,
     * so the Mac app follows the browser and the phone instead of sitting on
     * whatever release was last cut by hand.
     *
     * What must not change is the half after the `&&`: whatever asks for a
     * publish, it only ever happens from the default branch.
     */
    const ways = [...flow.matchAll(/\(\(?inputs\.publish[^)]*\)?[^)]*\)/g)].map((m) =>
      m[0].replace(/\s+/g, ' ')
    )
    assert.ok(ways.length > 0, 'a release can no longer be asked for without pushing a tag')
    for (const way of ways) {
      assert.ok(
        way.includes("github.ref == 'refs/heads/main'"),
        `a build off the default branch could publish a release tagged against main: ${way}`
      )
    }
  })

  
  test('the two-take comparison is gone, not half removed', () => {
    /*
     * "Comparing 2 tones still doesn't work well, just hangs on this screen.
     * Let's scratch that 2 scene generation for now. Get rid of it."
     *
     * Removed rather than hidden: a fold that is still built and still wired
     * is a thing that breaks in the dark.
     */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    for (const gone of ['buildComparison', 'setCompare', 'revealCompare', 'try-two-versions']) {
      assert.ok(!app.includes(gone), `${gone} is still wired into the app`)
    }
    assert.ok(!existsSync(new URL('../src/components/Refine.jsx', import.meta.url)), 'Refine.jsx is still there')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.ok(!/^\.compare\b/m.test(css), 'the compare styles are still shipped')
  })

  
  test('a window you can see is a window you can force quit', () => {
    /*
     * "The Fractal AI Builder isn't showing up in the active programs running,
     * so no option to force close if it's having issues."
     *
     * Hiding the dock icon is what makes this a menu-bar service, and that is
     * right. What it also does, less obviously, is take the app out of Force
     * Quit Applications — macOS leaves accessory apps out of that list. Which
     * bites exactly when it matters: a window that has stopped responding, and
     * no way to reach the one tool everybody knows.
     *
     * So the icon follows the window rather than being hidden for good.
     */
    const main = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
    assert.match(main, /function showInDock\(/, 'the dock icon is set in more than one place')
    assert.match(
      main,
      /function openWindow\(\) \{\s*\n\s*showInDock\(true\)/,
      'opening a window does not put the app in the dock, so it stays out of Force Quit'
    )
    assert.match(
      main,
      /win\.on\('closed', \(\) => \{[^}]*showInDock\(false\)/s,
      'the app stays in the dock after its window closes'
    )
    assert.ok(
      !/app\.dock\.hide\(\)/.test(main.slice(main.indexOf('app.whenReady'))),
      'startup hides the dock directly instead of through the one helper'
    )
  })

  
  test('the XY pad is gone, not half removed', () => {
    /*
     * "Let's just remove the XY pad. It's kind of weird."
     *
     * Removed rather than hidden, like the two-take comparison before it: a
     * panel that is still built and still wired is a thing that breaks in the
     * dark, and this one held a drag handler, a set of touch listeners and a
     * live write path per pointer move.
     */
    assert.ok(
      !existsSync(new URL('../src/components/XYPad.jsx', import.meta.url)),
      'XYPad.jsx is still there'
    )
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    for (const gone of ['XYPad', 'xyOn', 'gig-pad']) {
      assert.ok(!gig.includes(gone), `${gone} is still wired into the Play screen`)
    }
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.ok(!/\.xy[-\s{,]/.test(css), 'the pad styles are still shipped')
    const screens = readFileSync(new URL('../src/components/Screens.jsx', import.meta.url), 'utf8')
    assert.ok(!/\.xy/.test(screens), 'the swipe guard still exempts a surface that no longer exists')
  })

  test('the release runs on a machine that can sign', () => {
    /*
     * GitHub rolled macos-latest from image 20260728.0273.1 to 20260831.0337.3
     * between two builds three hours apart. The first signed and published
     * 7.31.0; the next two failed identically inside electron-builder's
     * keychain step — "SecKeychainUnlock: the user name or passphrase you
     * entered is not correct" — with no secret changed and nothing in the
     * signing path touched.
     *
     * So the runner is pinned rather than floating. This guard exists to make
     * the pin deliberate and to make its removal deliberate too: it goes when
     * electron-builder can sign on the newer image, not before.
     */
    const flow = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8')
    assert.ok(
      !/runs-on: macos-latest/.test(flow),
      'the release build floats onto whatever image GitHub ships next'
    )
    assert.match(flow, /runs-on: macos-\d+/, 'the runner is not pinned to a numbered image')
  })

  test('a phone reaches the stage screen and nothing else', () => {
    /*
     * Edit is bench work: a 4x12 grid to drag blocks around on. It was one
     * sideways swipe from the stage screen, which is how a grid editor came to
     * be within reach of a thumb mid-song. The phone apps in `mobile/` have
     * never carried it and say why in Stage.js; this is the same rule applied
     * to the web app, which was missing it.
     *
     * Hidden by viewport, not deleted: a desktop browser is where it belongs.
     *
     * Ask was the other bench screen, and went with the AI. The rule did not
     * change with it.
     *
     * Every route in is checked, because closing two of three is the same as
     * closing none — the tab row, the swipe order, and Back restoring an entry
     * pushed while the window was wide.
     */
    const screens = readFileSync(new URL('../src/components/Screens.jsx', import.meta.url), 'utf8')
    assert.match(screens, /export const viewsFor/, 'Screens no longer decides which views a viewport reaches')
    assert.match(
      screens,
      /export const BENCH = \['shape'\]/,
      'the bench screens are no longer named, so nothing can be held back from a phone'
    )
    assert.match(
      screens,
      /order\.length < 2/,
      'the swipe listener still engages with one screen, so a drag on the stage screen is measured against nothing'
    )
    assert.ok(
      !/const at = ORDER\.indexOf\(view\)/.test(screens),
      'the swipe still navigates the full order rather than the reachable one'
    )

    assert.match(
      src,
      /\.filter\(\(\[id\]\) => views\.includes\(id\)\)/,
      'the tab row still offers every screen, including the ones a phone cannot reach'
    )
    assert.match(
      src,
      /<Screens[^>]*order=\{views\}/,
      'the swipe surface is not told which screens this viewport reaches'
    )
    /* The Ask button and the sheet behind it went with the AI. Nothing on the
       stage screen starts a conversation, so there is nothing left to gate. */
    assert.ok(!/onAsk=/.test(src), 'the Ask button is back on the stage screen')
    assert.match(
      src,
      /if \(!viewsRef\.current\.includes\(st\.view\)\) return/,
      'Back can still restore a screen this viewport has no tab for'
    )
    assert.match(
      src,
      /if \(!views\.includes\(view\)\) setView\('play'\)/,
      'a window narrowed while Ask was open leaves the app on a screen with no body and no way out'
    )
  })

  test('the preset list opens where you already are', () => {
    /*
     * "If I'm already on preset like 160 and I clicked the preset button, it
     * should show 160 with the closest ones around it, not go back to the
     * first preset." Measured in a browser before the fix: with 165 loaded,
     * the row for it sat 3891px down a 790px screen. After: 468px, on screen.
     *
     * Two things have to hold, and the second is the one that bites.
     */
    const con = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    /*
     * PresetList alone, not the rest of the file. The model picker further
     * down uses scrollIntoView quite correctly — it is a popover with its own
     * scrollbox and no sheet under it — so a slice running to the end of the
     * file fails on somebody else's right answer.
     */
    const from = con.indexOf('export function PresetList')
    assert.notEqual(from, -1, 'PresetList is gone')
    const next = con.indexOf('\nexport ', from + 1)
    /*
     * Comments out first, the same move the Sheet handle test makes. The code
     * below explains why it must not use scrollIntoView, and a test reading
     * the explanation instead of the code fails on a file that says the right
     * thing and does the right thing. That is not hypothetical: this test
     * failed on its own warning before the strip was added.
     */
    const list = con
      .slice(from, next === -1 ? undefined : next)
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')

    assert.match(
      list,
      /querySelector\('\.preset-row\.current'\)/,
      'the list no longer looks for the loaded preset when it opens'
    )

    /*
     * scrollIntoView is the fallback, never the first move — and never without
     * putting the page's scroll back.
     *
     * It moves every scrollable ancestor including the page, which is the bug
     * the conversation log already had and wrote down in Assistant.jsx, and
     * which ancestor actually scrolls is not fixed either: the desktop panel
     * scrolls itself, and inside a sheet that max-height is deliberately
     * removed so the sheet body is what moves. So the box is still found and
     * moved directly.
     *
     * What changed is what happens when that does not work. A scrollTop
     * written to a box that owns its own compositor layer is dropped on iOS
     * often enough that the write cannot be assumed to have landed — the
     * assignment succeeds and the list does not move — and the list opening at
     * 000 was reported twice against code that did the right thing everywhere
     * it could be driven here. So the engine gets asked, and the page is put
     * back where it was.
     */
    assert.match(list, /function scrollerOf|scrollerOf\(/, 'nothing works out which ancestor scrolls')
    assert.match(
      list,
      /box\.scrollTop = target/,
      'the box is no longer moved directly, so the page is dragged around for every opening'
    )
    for (const call of [...list.matchAll(/scrollIntoView/g)]) {
      const after = list.slice(call.index, call.index + 400)
      assert.match(
        after,
        /window\.scrollTo\(px, py\)/,
        'scrollIntoView is used without putting the page back where it was'
      )
    }
    /*
     * And it is genuinely a fallback: the first scrollIntoView in the file is
     * the one reached only after the retries are spent without ever finding a
     * scrollbox, and it sits inside that branch rather than in front of it.
     */
    const firstAsk = list.indexOf('scrollIntoView')
    const spent = list.lastIndexOf('frames < LOOKS', firstAsk)
    assert.ok(
      spent !== -1 && firstAsk - spent < 500,
      'the browser is asked before the box this component went to the trouble of finding'
    )

    // And it stands down while a filter is being typed: then the matches are
    // the point, and they are at the top.
    assert.match(list, /if \(needle[^)]*\) return/, 'centring fights the filter being typed')
  })

  test('Previous and Next on Play follow a setlist, and the button between them says which', () => {
    /*
     * "Hitting next or previous cycles through songs on the favorites or
     * setlists." The two buttons stepped the slot number by one, in this
     * component, with nothing between them. Now the target comes from
     * lib/setlists — the slots, the stars, or a setlist — and the button in
     * the middle of the same row says which and opens the sheet that
     * changes it. Same row, because a row of its own costs the smallest
     * size step the 44px it exists to save.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const bare = (t) => t.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/\{\s*\}/g, '')
    const g = bare(gig)

    const stepFn = g.slice(g.indexOf('const step = async'), g.indexOf('setWorking(true)', g.indexOf('const step = async')))
    assert.ok(!/\(preset\?\.number \?\? 0\) \+ delta/.test(stepFn), 'Next is back to adding one to the slot number')
    assert.match(g, /stepTarget\(\{ source, current: preset\?\.number, delta, favourites, lists \}\)/, 'the target does not come from lib/setlists')

    const nav = g.slice(g.indexOf('className="gig-nav"'), g.indexOf('className="gig-bar"'))
    assert.match(nav, /‹ Previous/, 'Previous left the row')
    assert.match(nav, /Next ›/, 'Next left the row')
    assert.match(nav, /className=\{`gig-nav-source/, 'there is no button saying what the two step through')
    assert.ok(
      nav.indexOf('‹ Previous') < nav.indexOf('gig-nav-source') && nav.indexOf('gig-nav-source') < nav.indexOf('Next ›'),
      'the setlist button is not between Previous and Next'
    )
    assert.match(nav, /disabled=\{working \|\| landing\(-1\) === null\}/, 'Previous no longer goes dead where the list ends')
    assert.match(nav, /disabled=\{working \|\| landing\(1\) === null\}/, 'Next no longer goes dead on an empty list')
    assert.match(g, /<Setlists\b/, 'the sheet that builds a setlist is not on Play')

    // Three across, in the one row.
    const navCss = css.slice(css.indexOf('.gig-nav {'), css.indexOf('}', css.indexOf('.gig-nav {')))
    assert.match(navCss, /grid-template-columns: 1fr minmax\(\d+px, [\d.]+fr\) 1fr/, 'the nav row is not three across')

    // Both files are read back when either changes: the star is pressed in
    // the picker, over this screen.
    assert.match(g, /addEventListener\(MARKS_CHANGED/, 'a star pressed in the picker never reaches the count on the button')
    assert.match(g, /addEventListener\(SETLISTS_CHANGED/, 'a setlist edited on the sheet never reaches the buttons')

    // Per unit, with names: App hands Play the same key and list the picker gets.
    const play = app.slice(app.indexOf('<Gig'), app.indexOf('/>', app.indexOf('<Gig')))
    assert.match(play, /deviceKey=\{currentDeviceSlug\(\)\}/, 'Play does not know which unit the setlists are for')
    assert.match(play, /slots=\{allSlots\}/, 'the setlist sheet has no preset names to show')
  })

  
  
  test('the stage screen is the layout he picked, not the one it grew into', () => {
    /*
     * From a screenshot, with "like this": scenes two across in colour, the
     * effects four across in three letters, tuner and tap in a bar along the
     * bottom, and the size control beside the preset name.
     *
     * Each of those replaces something that had drifted. The tuner had a
     * full-width row in the MIDDLE of the screen — prime thumb space for
     * something you press between songs. Tap tempo had no button at all, while
     * forgefx.js carried tapTempo() with nothing calling it. And the size
     * control sat in the tab row, a different strip of the app from the screen
     * it sizes.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const bare = (t) => t.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const g = bare(gig)

    // The bar, and both things in it.
    const bar = g.slice(g.indexOf('className="gig-bar"'), g.indexOf('className="gig-bar"') + 900)
    assert.ok(bar.length > 0, 'the tuner and tap bar is gone')
    assert.match(bar, /Tuner/, 'the tuner left the bar')
    assert.match(bar, /Tap/, 'tap tempo left the bar')
    assert.ok(!/className="gig-modes"/.test(g), 'the tuner is back in a row of its own mid-screen')
    /*
     * The button sends a NUMBER, not a tap. Forwarding the presses let the
     * network decide the rhythm — see shared/tempo.mjs — so what goes over
     * is the tempo this end worked out.
     */
    assert.match(g, /sender\.current\.push\(guess\)/, 'nothing taps, so the button does nothing')
    assert.ok(!/tapBeat\(\)/.test(g), 'the taps are being forwarded again, so the wifi decides the tempo')

    /*
     * And the tempo is ON the button that sets it.
     *
     * A tap button with no readout is a control you have to trust: you tap
     * four times and find out whether it took by listening to the delay.
     *
     * The read-back is separate from the tap on purpose — deviceState.tapBeat
     * records why the two must not be folded together, and the same reasoning
     * runs the other way: a read taken mid-burst returns the tempo of the taps
     * BEFORE this one, so it waits for the burst to end. If that timer ever
     * collapses into the tap itself, the number on the button starts lying.
     */
    assert.match(bar, /gig-tap-bpm/, 'the tap button lost its tempo readout')
    /* The HANDLER only. Sliced to `const step` it ran on past the unmount
       cleanup, which clears the same timer — so deleting the debounce from the
       handler still found a clearTimeout and the test passed. It does not now. */
    const tapFn = g.slice(g.indexOf('const tap = async'), g.indexOf('useEffect(() => () => clearTimeout'))
    assert.match(tapFn, /clearTimeout\(reread\.current\)/, 'a second tap no longer cancels the pending read')
    assert.match(tapFn, /refreshTempo\(\)/, 'the tempo is never re-read, so the number goes stale')
    assert.ok(
      tapFn.indexOf('await tapBeat()') < tapFn.indexOf('setTimeout'),
      'the read is scheduled before the tap is sent'
    )

    /*
     * AND THE NUMBER MOVES ON THE TAP, not on the read that follows it.
     *
     * "It should change the tempo based on the tap and change the number
     * immediately and then read the device … right now it takes a few seconds
     * after doing the tap, so you can't even tell the tempo you're tapping
     * at." The readout used to come only from the unit, and the unit cannot be
     * asked until the burst ends — which is the paragraph above — so the
     * figure lagged the last press by nearly a second. Tapping is how you find
     * a tempo; one you cannot see while tapping is one you cannot aim.
     *
     * Both halves are held: the arithmetic happens before anything crosses
     * the network, and it is cleared when the unit answers so the two never
     * disagree on screen.
     *
     * The arithmetic is also now the ONLY thing that decides the tempo. What
     * goes over is the number it produced, so "read the device" can only ever
     * hand back what was sent.
     */
    assert.match(tapFn, /tappedBpm\(/, 'the taps are no longer turned into a tempo on this end')
    assert.ok(
      tapFn.indexOf('setTapped(guess)') < tapFn.indexOf('sender.current.push(guess)'),
      'the number waits for the request, so it still lags the tap'
    )
    assert.ok(
      !/await (setTempo|tapBeat|selectPreset)\(/.test(tapFn),
      'a tap waits on the network before it returns, which makes the next tap late and the rhythm wrong'
    )
    assert.match(tapFn, /setTapped\(null\)/, 'our own figure is never cleared, so the unit can never correct it')

    /*
     * The size control lives in Setup now, and Play carries none of it.
     *
     * "Let's move the sizing to the Settings menu so this one just shows
     * the preset." It had moved once already — from the tab row to beside
     * the preset name — and the preset name is the one row on Play that
     * was already fighting for width.
     */
    const preset = g.slice(g.indexOf('className="gig-preset"'), g.indexOf('className="gig-signal"'))
    assert.ok(!/gig-size|onSize/.test(g), 'the size control is back on the Play screen')
    const setup = sheet('Settings')
    /* "Stage tiles" now, the same words the phone uses for the same control,
       and it is not behind a fold — see the Settings list test for why. */
    assert.match(setup, />Stage tiles</, 'Settings has no Stage tiles section')
    assert.match(setup, /className="size-steps"/, 'the size steps are not in Settings')
    assert.match(setup, /aria-label="Smaller buttons"[\s\S]*?aria-label="Bigger buttons"/, 'Settings has lost a size step')
    assert.ok(!/onSize=/.test(bare(app)), 'App still hands Play a size control')

    /*
     * And the preset is a tile the height of a scene, with the number and
     * the name on one line. "Add the preset number to it as well as the
     * name", then "put the number inline with the name and make the font the
     * same size as the scenes."
     */
    assert.match(preset, /className="gig-name-num mono">\{preset\?\.number \?\? '--'\}/, 'the preset tile has no slot number')
    assert.match(preset, /className="gig-name-word">\{presetLabel\(preset\)\}/, 'the preset tile has no name')
    assert.ok(preset.indexOf('gig-name-num') < preset.indexOf('gig-name-word'), 'the number is not before the name')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const tileCss = css.match(/button\.gig-name \{([^}]*)\}/)?.[1] || ''
    /*
     * And it is the touch floor, not a scene tile's height.
     *
     * "Make the preset button a little smaller, so that an extra row of
     * effects can fit on the screen — right now they're being cut off." It was
     * sized to a scene because it used to be shaped like one, a number stacked
     * over a name; the number moved onto the name's line and the second line
     * went with it, leaving one line of text in a 62px box. 44px is what every
     * pressable thing gets, and the eighteen pixels went to the effects.
     */
    assert.match(tileCss, /min-height: 44px/, 'the preset tile is back to a scene tile\'s height')
    /*
     * The rest of the stack gave up a step each for the same reason. Held as
     * tokens rather than numbers: a literal here is how 10px, 12px and 18px
     * ended up in three rules that were meant to be the same gap.
     */
    const rule = (sel) => css.match(new RegExp(sel.replace('.', '\\.') + ' \\{([^}]*)\\}'))?.[1] || ''
    assert.match(rule('.gig-signal'), /margin-top: var\(--s-2\)/, 'the meter has its old 10px back')
    assert.match(rule('.gig-scenes'), /margin-top: var\(--s-2\)/, 'the scenes have their old 12px back')
    assert.match(rule('.gig-blocks'), /margin-top: var\(--s-3\)/, 'the effects have their old 18px back')
    assert.match(rule('.gig-foot'), /margin-top: var\(--s-2\)/, 'the foot has its old gap back')
    assert.match(tileCss, /flex-direction: row/, 'the number is stacked over the name again')
    const numCss = css.match(/\.gig-name-num \{([^}]*)\}/)?.[1] || ''
    const nameCss = css.match(/\.gig-name-word \{([^}]*)\}/)?.[1] || ''
    const sceneCss = css.match(/button\.gig-scene\.named \.gig-scene-name \{([^}]*)\}/)?.[1] || ''
    const size = (r) => r.match(/font-size: (var\(--f-\d\))/)?.[1]
    assert.ok(size(sceneCss), 'a named scene no longer sets its size')
    assert.equal(size(nameCss), size(sceneCss), 'the preset name is not the size of a scene name')
    assert.equal(size(numCss), size(sceneCss), 'the slot number is not the size of the name beside it')
    assert.ok(!/clamp\(30px, 9vw, 52px\)/.test(css), 'the preset name is a headline again')

    /*
     * And no tab row when there is one screen.
     *
     * A phone reaches Play and nothing else — Ask and Edit are bench work and
     * were taken off it on purpose. What was left was a row containing the word
     * "Play", underlined, which cannot be pressed to any effect and cannot be
     * left: "an entire row with no buttons that can even be changed". It earned
     * its keep while it also held the size control; that moved to the preset
     * row, and this had nothing.
     */
    const a = bare(app)
    assert.match(
      a,
      /const tabsWorthShowing = status === 'live' && views\.length > 1/,
      'the tab row is drawn whenever the app is live, so a phone gets a row holding one unpressable word'
    )
    assert.match(a, /\{tabsWorthShowing \? \(\s*<nav className="views"/, 'the tab row no longer reads that condition')

    // A scene carries its own colour; an effect carries both its names.
    assert.match(g, /--scene-fill/, 'scenes are back to eight identical panels')
    assert.match(g, /shortBlock\(block\)/, 'the effect tiles lost their three-letter name')
    assert.match(g, /gig-block-full/, 'the full effect name is gone, so nothing reads it aloud')
  })

  test('the range jumps carry you there without loading anything', () => {
    /*
     * 512 rows is about forty screens, and opening at the one you are on does
     * nothing for going somewhere else — which on a unit this size is most of
     * what the list is for.
     *
     * The property worth guarding is not that they exist. It is that they
     * SCROLL: tapping 300 mid-set must not change what is coming out of the
     * amp. Loading stays where it was, on the row you choose deliberately.
     */
    const con = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const from = con.indexOf('export function PresetList')
    const next = con.indexOf('\nexport ', from + 1)
    // Comments out, for the reason the test above this one records.
    const list = con
      .slice(from, next === -1 ? undefined : next)
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')

    const jump = list.slice(list.indexOf('const jumpTo'), list.indexOf('useEffect'))
    assert.ok(jump.length > 0, 'the range jumps are gone')
    assert.ok(
      !/onSelect/.test(jump),
      'a range jump loads a preset — tapping 300 must not change the sound mid-set'
    )
    assert.match(jump, /scrollTop/, 'the range jump no longer scrolls')

    // Offered against the unit's own size, so a smaller Fractal is not given
    // buttons for slots it does not have — and an AM4's 104 presets get
    // twenties rather than one lonely hundred. The step lives in presetJumps.
    assert.match(
      list,
      /const jumps = jumpsFor\(total\)/,
      'the jumps are a fixed list rather than what this unit actually holds'
    )

    // They sit in the heading beside the word Presets, which is where he asked
    // for them and a row closer to the thumb than under the filter box.
    const head = list.slice(list.indexOf('panel-head'), list.indexOf('preset-filter'))
    assert.match(head, /preset-jumps/, 'the jumps left the heading')

    // And the row knows its own number, so a jump never parses a label to
    // work out where it is going.
    assert.match(list, /data-slot=\{slot\.number\}/, 'rows no longer carry their slot number')
  })

  test('a chain read on the Play screen does not take the first no', () => {
    /*
     * "Now I'm switching seems I keep getting this error message. Couldn't
     * read the chain from the phone, so there's nothing to switch here yet.
     * Hitting the try again button always fixes it, but it really shouldn't
     * happen."
     *
     * The read runs straight after a preset change, which is exactly when the
     * unit is still loading that preset and its port is busy. One empty answer
     * became an error and a button whose only job was to ask again. The
     * presence check has been hardened against this for months; this read had
     * never been.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const g = gig.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    /* From the read's own position: there are useEffects above it, and
       indexOf from zero would have sliced backwards to nothing. */
    const at = g.indexOf('const refreshBlocks = async')
    assert.ok(at > 0, 'the chain read is gone from the Play screen')
    const fn = g.slice(at, g.indexOf('useEffect(() => {', at))
    assert.match(fn, /confirmedChain\(/, 'one empty chain read is a verdict again — the Try again bug is back')
    assert.ok(
      !/setChain\(\(await reReadChain\(\)\)/.test(fn),
      'the chain read still decides on a single ask'
    )
    /* And the phone gets the longer allowance, for the same reason the
       presence check does: the read travels a relay to a busy Mac. */
    assert.match(fn, /remote: remoteActive\(\)/, 'the phone reads the chain on the computer\u2019s shorter allowance')
  })

  

  test('an account is the only way to join a phone to a computer', () => {
    /*
     * "I want the QR code gone and the scanner gone. It has never worked
     * once. Every time I've ever tried it, you tell me something different…
     * to use this app and connect it to your computer, you have to sign up.
     * That's the way we're doing it."
     *
     * This test used to hold the opposite. There were two routes: a pairing
     * code — made at the computer, shown as a QR code, scanned or typed at
     * the phone, needing no account — and signing in, offered third for what
     * it bought. The code route is gone entirely: the code, the QR code, the
     * camera, and every box for typing one.
     *
     * WHAT STILL NEEDS NO ACCOUNT, because it would be easy to over-correct:
     * the demo, and a phone on the same wifi reaching the computer directly.
     * Only joining a phone to a computer from anywhere needs one.
     */
    const gone = [
      ['../src/components/PhoneQr.jsx', 'the computer’s QR code component'],
      ['../mobile/src/components/ScanCode.js', 'the phone’s camera scanner']
    ]
    for (const [rel, what] of gone) {
      assert.ok(!existsSync(new URL(rel, import.meta.url)), `${what} is back`)
    }

    /* No code anywhere: not made, not read, not typed. */
    const link = readFileSync(new URL('../src/lib/link.js', import.meta.url), 'utf8')
    for (const [pattern, what] of [
      [/export async function pairMac\(/, 'the computer can make a pairing code again'],
      [/export async function pairPhone\(/, 'the phone can be paired with a code again'],
      [/pairCodeFromUrl\(/, 'a #pair= link is read out of the address again'],
      [/makePairCode/, 'a pairing code can be minted again']
    ]) {
      assert.ok(!pattern.test(link), what)
    }
    /* Except the one that tells an ALREADY paired account apart, because
       those sessions are still perfectly good and still signed in. */
    assert.match(link, /import \{ isPairAccount \}/, 'a computer paired the old way now reads as signed out')

    const connect = readFileSync(new URL('../src/components/ConnectScreen.jsx', import.meta.url), 'utf8')
    assert.ok(!/connect-code-row/.test(connect), 'the phone has a code box again')
    assert.ok(!/one-time-code/.test(connect), 'the phone still offers a code to the keyboard')
    assert.match(connect, /onClick=\{onSwitchAccount\}[\s\S]{0,120}Sign in/, 'the phone’s way in is not signing in')
    /*
     * AND THE SAME-WIFI ROUTE NO LONGER ADVERTISES ITSELF AS NEEDING NO
     * ACCOUNT. It used to, and this test used to require it. He sent the
     * screen back: "it says no account no code need to remove that
     * terminology". It is a shortcut to the page the computer already serves,
     * not a second way to pair, and the heading says that now.
     */
    /*
     * COMMENTS QUOTE THE SENTENCE THEY REPLACED, which is the trap this file
     * falls into about once a quarter: the note above the new heading says
     * what the old one was, so a raw search for the old wording finds it and
     * the test fails on its own explanation. Only what the screen draws is
     * read.
     */
    const drawn = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    assert.ok(!/no account, no code/.test(drawn(connect)), 'the same-wifi route advertises needing no account again')

    const panel = readFileSync(new URL('../src/components/PhoneRemote.jsx', import.meta.url), 'utf8')
    assert.ok(!/PairCard|AccountCard|PhoneQr/.test(panel), 'the computer draws a QR code again')
    assert.match(panel, /onAction\('mac-setup'\)[\s\S]{0,140}Sign in to set up the phone remote/, 'the computer’s one button is not signing in')
    assert.ok(!/onAction\('mac-pair'\)/.test(panel), 'the computer can pair without an account again')

    assert.ok(!/kind === 'mac-pair'/.test(src), 'the computer’s pair action is back')
    assert.ok(!/pairFromCode|await pairPhone\(/.test(src), 'a typed code is wired up again')

    /*
     * AN ACCOUNT CAN BE MADE WHERE THE UNLOCK CAN BE BOUGHT.
     *
     * It was the phone only, after the unlock: "do not allow an account to be
     * created on any of the desktop or the web app version, only sign-ins."
     * Then the browser and the computer app started selling the unlock, and a
     * purchase has to belong to an account: "That was old info before we
     * decided to do purchases on the web, so yes, somebody should be able to
     * create an account on the web and desktops, and make purchases as well."
     *
     * The form offers it only to a caller that hands it `onCreate`, and every
     * sign-in hands it now. It was on the unlock's sign-in only, and the
     * website's first screen had no way to make one: "Where is the sign-up
     * button?" So the connect screen has a Create Account of its own, beside
     * Sign in, and it opens the form already on making one.
     */
    const webForm = readFileSync(new URL('../src/components/SignIn.jsx', import.meta.url), 'utf8')
    assert.ok(!/remoteSignUp/.test(webForm), 'the form makes accounts itself rather than through its caller')
    assert.match(webForm, /mode === 'in' && onCreate \? \(/, 'the browser offers to make an account to a caller with nothing to sell')
    assert.match(webForm, /Forgot password\?/, 'the browser lost the reset it still needs')
    const sheet = readFileSync(new URL('../src/components/SignInSheet.jsx', import.meta.url), 'utf8')
    assert.equal((sheet.match(/onCreate=\{onCreate\}/g) || []).length, 2, 'one of the sign-ins cannot make an account')
    const connectScreen = readFileSync(new URL('../src/components/ConnectScreen.jsx', import.meta.url), 'utf8')
    assert.match(connectScreen, /onClick=\{onCreateAccount\}[^>]*>\s*Create Account\s*</, 'the website’s first screen has no sign-up button')
    assert.match(src, /onCreateAccount=\{\(\) => \{\s*setSignInStart\('up'\)/, 'Create Account opens the form on signing in instead')
    assert.match(webForm, /useState\(onCreate && startIn === 'up' \? 'up' : 'in'\)/, 'the form ignores which button opened it')
    /*
     * A first-timer's way in is the big one. "When it says create account,
     * it's in a very tiny font underneath where it says sign in. Most people
     * coming here for the first time are going to be creating an account."
     * And making one is answered on a screen of its own: "it didn't give me
     * any confirmation that I need to check my email or that account was
     * created."
     */
    assert.match(connectScreen, /<button className="primary" onClick=\{onCreateAccount\}/, 'Create Account is not the big button on the first screen')
    assert.match(webForm, /className="chip signin-wide" onClick=\{\(\) => setMode\('up'\)\}/, 'the form’s Create Account is link-sized again')
    assert.match(webForm, /if \(needsConfirmation\) setMode\('sent'\)/, 'a new account is told to check its email in a line under the buttons again')
    assert.match(webForm, /if \(mode === 'sent'\) \{[\s\S]{0,400}Account made\.[\s\S]{0,200}Confirm it from the email we just sent, then sign in\./, 'the check-your-email screen lost the phone’s words')
    assert.match(sheet, /title=\{making \? 'Create Account' : 'Sign in'\}/, 'the sheet says Sign in over a form making an account')
    /* Create Account pressed by somebody who already has one signs them in —
       never "Account made, check your email" for an email that will not come. */
    const remoteLib = readFileSync(new URL('../src/lib/remote.js', import.meta.url), 'utf8')
    const linkLib = readFileSync(new URL('../src/lib/link.js', import.meta.url), 'utf8')
    assert.match(remoteLib, /const existing = Array\.isArray\(data\?\.user\?\.identities\) && data\.user\.identities\.length === 0/, 'an address that already has an account reads as a new one')
    assert.match(linkLib, /if \(existing\) \{\s*try \{\s*await signInAccount\(\{ email, password \}\)/, 'Create Account with an existing account’s details does not sign them in')
    assert.match(src, /onCreate=\{async \(details\) => \{\s*const out = await createAccount\(details\)/, 'the browser cannot make an account on the way to the unlock')

    const native = readFileSync(new URL('../mobile/src/screens/SignIn.js', import.meta.url), 'utf8')
    assert.ok(!/useState\('code'\)/.test(native), 'the phone leads with a code box again')
    assert.ok(!/pairCredentials/.test(native), 'the phone signs in with a code again')
    assert.match(native, /const canMakeAccount = mayDrive\(purchase\)/, 'the phone does not check the unlock before offering an account')
    assert.match(native, /\{canMakeAccount \? \(\s*\n?\s*<Press/, 'Create Account is offered before the app is unlocked')
    /* mayDrive rather than purchase.unlocked: somebody the store cannot be
       asked about is treated as unlocked, so a bad minute on a hotel network
       does not hide the form from somebody who paid. */
    assert.match(native, /import \{ mayDrive \} from '\.\.\/lib\/unlock-rule'/, 'the phone invents its own unlock rule for this')
  })

  test('nothing promises that joining a phone needs no account', () => {
    /*
     * "Go through all code, change anything that says no account needed. You
     * can use the demo for free without an account. You can use the computer
     * app for free without an account, but to connect your phone, you must
     * create an account, even if the app is unlocked."
     *
     * So the claim is not banned outright — it is still true of two things,
     * and saying so is the reason anybody tries them. What it may no longer
     * be attached to is PAIRING.
     */
    const shown = (text) =>
      text
        /* Comments quote the sentences they replaced — the fifth time that
           trap has come up — so only the strings and the JSX text are read. */
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')

    const files = [
      'src/components/ConnectScreen.jsx',
      'src/components/PhoneRemote.jsx',
      'src/components/PhoneApp.jsx',
      'src/components/SignIn.jsx',
      'src/components/SignInSheet.jsx',
      'shared/onboarding.mjs',
      'shared/ways-in.mjs',
      'mobile/src/screens/SignIn.js',
      'mobile/src/screens/Onboarding.js'
    ]

    /* And the screen that used to make the promise does not make it anywhere,
       in any wording: not in the heading, not in the paragraph under it. */
    const wifi = shown(readFileSync(new URL('../src/components/ConnectScreen.jsx', import.meta.url), 'utf8'))
    assert.ok(!/no account|without an account|needs no account/i.test(wifi),
      'the connect screen advertises a way in that needs no account again')

    /* And nowhere is it made about pairing. Every sentence carrying the claim
       has to be about the demo or about the same-wifi route. */
    const allowed = /demo|same wifi|on this phone|stays on this phone|no account details/i
    const offenders = []
    for (const rel of files) {
      const text = shown(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'))
      for (const m of text.matchAll(/[^.!?\n]*\b(no account|No account|without an account|needs no account)\b[^.!?\n]*/g)) {
        const sentence = m[0].replace(/\s+/g, ' ').trim()
        if (!allowed.test(sentence)) offenders.push(`${rel}: ${sentence}`)
      }
    }
    assert.deepEqual(offenders, [], `pairing is still advertised as needing no account:\n${offenders.join('\n')}`)
  })

  test('the save button is under your thumb, not above five hundred rows', () => {
    /*
     * "Clicking on a preset does absolutely nothing and nothing saves." It
     * did something — it chose the slot — but the button that saves was at the
     * top of the sheet, and picking a slot means scrolling into a list of 512,
     * so by the time a row was tapped the button was two screens up. The
     * sheet's footer does not scroll; that is where the button lives now.
     */
    const sheet = readFileSync(new URL('../src/components/SaveSheet.jsx', import.meta.url), 'utf8')
    const body = sheet.slice(sheet.indexOf('export default function SaveSheet'))
    assert.ok(!/save-confirm/.test(body), 'the save button is back in the scrolling body of the sheet')
    assert.match(sheet, /export function SaveFooter/, 'there is no footer to hold the save button')
    const foot = sheet.slice(sheet.indexOf('export function SaveFooter'), sheet.indexOf('export default function SaveSheet'))
    assert.match(foot, /className="primary save-confirm"/, 'the footer has no save button')
    assert.match(foot, /Replaces <strong>/, 'the footer does not say what the picked slot holds')
    assert.match(src, /title="Save"[\s\S]*?footer=\{\s*<SaveFooter/, 'the Save sheet is not given the footer')
    assert.match(src, /<SaveFooter[\s\S]*?slots=\{allSlots\}/, 'the footer cannot name what the slot holds')
  })

  
  test('the version check compares against the commit the pull request was based on', () => {
    /*
     * "I keep getting a failed notification from GitHub every time you push."
     * The job fetched the base branch as it stood when the job RAN. Pull
     * requests here merge within seconds of the push, so the base already had
     * the new version and the job called the change "still the same". The
     * base SHA is fixed at the push and cannot be overtaken.
     */
    const web = readFileSync(new URL('../.github/workflows/web.yml', import.meta.url), 'utf8')
    const job = web.slice(web.indexOf('  version:'))
    assert.match(job, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/, 'the job has no fixed point to compare against')
    assert.match(job, /git fetch --no-tags --depth=1 origin "\$BASE_SHA"/, 'the job still fetches the moving base branch')
    assert.match(job, /git show "\$BASE_SHA":package\.json/, 'the comparison still reads the base branch tip')
    assert.ok(!/git show FETCH_HEAD:package\.json/.test(job), 'the comparison against the moving tip is back')
  })

  test('the volume is behind the speaker in the bar, and moves the Output level the way the port can take', () => {
    /*
     * "Can we set that to be a slide-up menu? Put a sound button that looks
     * like a speaker in the header, and when it's tapped you can slide the
     * volume left or right or do the plus minus thing that's already set up,
     * but it's not there on the main screen."
     *
     * It was a permanent row across the top of Play — a strip of the one
     * screen whose currency is scene buttons you can hit without looking, held
     * open all night for a control wanted twice. So: a speaker in the bar, the
     * same control on a sheet behind it, and nothing on the stage screen.
     *
     * The other half is unchanged and still holds: Volume writes through the
     * coalescing writer rather than straight to setParam on every pixel — the
     * port takes one request at a time, and a drag that queued sixty writes a
     * second would land long after the thumb stopped and block the next scene
     * behind it.
     */
    const bare = (x) => x.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const gig = bare(readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8'))
    assert.ok(!/<Volume /.test(gig), 'the volume row is back across the top of the stage screen')
    assert.ok(!/import Volume/.test(gig), 'Play still pulls in the slider it no longer draws')

    const bareApp = bare(src)
    assert.match(bareApp, /import Volume from '\.\/components\/Volume'/, 'nothing renders the slider any more')
    assert.match(
      bareApp,
      /<Volume eid=\{outputEid\} preset=\{preset\} onError=\{setError\} \/>/,
      'the slider is not bound to the Output block'
    )
    assert.match(bareApp, /open=\{sheet === 'volume'\}/, 'the volume has no sheet to open into')
    assert.match(
      bareApp,
      /onOpenVolume=\{status === 'live' && outputEid !== null \? \(\) => setSheet\('volume'\) : null\}/,
      'the speaker is offered on a preset with no output level to move'
    )
    const barSrc = bare(readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8'))
    assert.match(barSrc, /className="topbar-volume"/, 'there is no speaker in the bar')
    assert.match(barSrc, /aria-label="Volume"/, 'the speaker says nothing to a screen reader')
    assert.match(barSrc, /<svg viewBox="0 0 24 24"/, 'the speaker is not drawn')
    const barCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(barCss, /button\.topbar-volume \{[^}]*min-height: 44px/, 'the speaker is under the touch floor')

    const nav = gig.indexOf('className="gig-nav"')
    /* "Move Previous / Next directly above the bottom tap bar." The nav sits
       in the sticky foot with the bar, after the block grid — never back
       between the preset tile and the scenes. */
    const foot = gig.indexOf('className="gig-foot"')
    const barAt = gig.indexOf('className="gig-bar"')
    const grid = gig.indexOf('className="gig-blocks"')
    assert.ok(foot !== -1 && grid < foot && foot < nav && nav < barAt, 'Previous / Next is not directly above the bar in the sticky foot')
    const footCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(footCss, /\.gig-foot \{[^}]*position: sticky;\s*bottom: 0/, 'the foot no longer sticks to the bottom')
    assert.ok(!/\.gig-bar \{[^}]*position: sticky/.test(footCss), 'the bar sticks on its own, leaving Previous / Next to scroll away')

    const vol = bare(readFileSync(new URL('../src/components/Volume.jsx', import.meta.url), 'utf8'))
    assert.match(vol, /latestWriter\(\(v\) => setParam\(eid, param\.id, v, param\)\)/, 'the slider writes without coalescing')
    assert.ok(!/setParamConfirmed/.test(vol), 'every drag value is a confirmed write — three round trips per pixel')
    assert.match(vol, /writer\.send\(v\)/, 'the drag does not go through the writer')
    assert.match(vol, /await writer\.settled\(\)[\s\S]*?clearDeviceCache\(\)[\s\S]*?blockParams\(eid\)/, 'the release does not read back what the unit holds')
    assert.match(vol, /outputLevelParam\(res\?\.named\)/, 'the slider does not pick the Level by the shared rule')
    assert.match(vol, /if \(!param\) return null/, 'a unit with no reachable level still gets a slider')
    assert.match(vol, /type="range"/, 'the control is not a slider')
    assert.match(vol, /aria-labelledby="gig-volume-word"/, 'the slider has no accessible name')
    // "Add the word volume somewhere on the volume slider bar." Over the
    // figure at the right, and never hidden on a phone.
    assert.match(vol, /className="gig-volume-read">\s*<span className="silk-label gig-volume-word"/, 'the word Volume is not over the figure')
    const volCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.ok(!/\.gig-volume-word \{\s*display: none/.test(volCss), 'the word Volume is hidden on a phone again')
    assert.match(vol, /aria-valuetext=\{label\}/, 'read aloud the slider is a bare number with no unit')
    assert.match(vol, /if \(stop \|\| dragging\.current\) return/, 'a read landing mid-drag yanks the thumb back')

    /*
     * "Do a plus minus on the sides of the volume slider that does 1 dB at a
     * time." One button before the track and one after it, each a whole dB,
     * through the same writer and the same read-back as the drag.
     */
    const track = vol.indexOf('type="range"')
    const minus = vol.indexOf('onClick={() => nudge(-by)}')
    const plus = vol.indexOf('onClick={() => nudge(by)}')
    assert.ok(minus !== -1 && plus !== -1, 'the − and + beside the slider are gone')
    assert.ok(minus < track && track < plus, 'the − and + are not either side of the track')
    assert.match(vol, /const by = volumeNudge\(param\)/, 'the buttons do not step by the shared rule')
    assert.match(vol, /const next = nudged\(value \?\? param\.value, param, delta\)/, 'a press is not clamped to the range')
    assert.match(vol, /writer\.send\(next\)\s*\n\s*release\(\)/, 'a press does not go through the writer and the read-back')
    assert.match(vol, /disabled=\{typeof now === 'number' && now <= param\.min\}/, 'the − does not stop at the bottom')
    assert.match(vol, /disabled=\{typeof now === 'number' && now >= param\.max\}/, 'the + does not stop at the top')
    assert.match(vol, /aria-label=\{`Volume down \$\{by\}\$\{unit\}`\}/, 'the − does not say what it does')

    // Every prop the call site passes is one the component declares.
    const sig = vol.match(/export default function Volume\(\{([^}]*)\}/)?.[1] || ''
    for (const prop of ['eid', 'preset', 'onError']) {
      assert.ok(sig.includes(prop), `Volume does not declare ${prop}`)
    }

    // And the slider is a touch target, drawn from the app's own tokens.
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const rule = css.match(/input\.gig-volume-slider \{([^}]*)\}/)?.[1] || ''
    assert.match(rule, /min-height: 44px/, 'the slider is under the touch floor')
    assert.match(rule, /touch-action: pan-y/, 'a finger on the slider cannot scroll the page, or scrolls it instead of sliding')
    const step = css.match(/button\.gig-volume-step \{([^}]*)\}/)?.[1] || ''
    assert.match(step, /min-height: 44px/, 'the − and + are under the touch floor')

    // "Make the bottom tab bar buttons smaller." The bar is the touch floor
    // and no more, and Tap is one line: the tempo beside the word.
    const bar = css.match(/button\.gig-bar-btn \{([^}]*)\}/)?.[1] || ''
    assert.match(bar, /min-height: 44px/, 'the bar buttons are taller than the touch floor again')
    const tap = css.match(/button\.gig-tap \{([^}]*)\}/)?.[1] || ''
    assert.match(tap, /flex-direction: row/, 'the tempo is stacked under Tap again, which is what made the bar tall')

    // "Let's make all these buttons rounded like iOS." Every pressable thing
    // on Play takes the furniture radius; the rest of the app keeps its edge.
    const round = css.slice(css.lastIndexOf('rounded like iOS'))
    const corner = round.match(/\.gig \.gig-preset,[\s\S]*?\{([^}]*)\}/)
    assert.ok(corner, 'the Play screen has lost its rounded corners')
    assert.match(corner[1], /border-radius: var\(--r-2\)/, 'the Play controls are back on the hardware corner')
    const selectors = round.slice(0, round.indexOf('{'))
    for (const s of ['button.gig-scene', 'button.gig-block', 'button.gig-bar-btn', '.gig-nav button', 'button.gig-volume-step', 'button.gig-name']) {
      assert.ok(selectors.includes(s), `${s} is square again`)
    }
    const screens = readFileSync(new URL('../src/components/Screens.jsx', import.meta.url), 'utf8')
    const yields = screens.match(/YIELDS =\s*'([^']+)'/)?.[1] || ''
    assert.ok(yields.split(',').map((s) => s.trim()).includes('input'), 'a drag along the slider turns the page')
  })

  
  test('Setup can ask the unit why a preset makes no sound', () => {
    /*
     * "Can we set up a way to read the parameters of the current scene to
     * investigate why there is no sound on any of the scenes in this preset?"
     *
     * Above the debug log, not inside it: the log is what the app did, this is
     * what the unit holds. It reads on a tap because it is a dozen round trips
     * down the port that is carrying the audio, and it copies the same three
     * ways the log does, because a phone's clipboard can say no.
     */
    const setup = sheet('Settings')
    assert.match(setup, /<PresetReport device=\{device\} link=\{link\} \/>/, 'Setup cannot read the preset')
    /* Above the debug log, which is the thing it must not be buried under.
       This used to measure against a "Developer" section holding the AI's
       trace; that went with the AI, and the log is the honest anchor — it is
       what this panel has always had to come before. */
    assert.ok(
      setup.indexOf('<PresetReport') < setup.indexOf('title="Debug log"'),
      'the preset read is buried at the bottom of the sheet again'
    )

    const panel = readFileSync(new URL('../src/components/PresetReport.jsx', import.meta.url), 'utf8')
    for (const call of ['presetBlocks()', 'readGrid()', 'blockParams(', 'getScene()']) {
      assert.ok(panel.includes(call), `the report never asks the unit for ${call}`)
    }
    assert.match(panel, /onClick=\{read\}/, 'the report reads on a timer rather than on a tap')
    assert.match(panel, /navigator\.share/, 'the copy has no fallback for a phone that refuses the clipboard')
    assert.match(panel, /silenceFaults\(/, 'the report is a dump with no answer in it')
  })

  test('a phone is not told three times which computer it is talking to', () => {
    /*
     * "Remove where it says 'through your Mac'."
     *
     * On a phone that line was the third thing in the Setup sheet saying one
     * fact: the header says CONNECTED, and Phone remote underneath names the
     * Mac. The address stays where it means something — on the machine with
     * the cable, where it is the thing you change — and the demo still says
     * out loud that it is a simulation.
     */
    const detail = readFileSync(new URL('../src/components/DeviceDetail.jsx', import.meta.url), 'utf8')
    /* Comments out first: the line this removed is quoted in the comment that
       explains why it went, and a comment that can fail a test is a comment
       nobody can write. */
    const code = detail.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const markup = code.slice(code.indexOf('return ('))
    assert.ok(!markup.includes("'through your computer'"), 'the phone is told what it is connected through again')
    assert.match(markup, /\{demo \|\| !remote \?/, 'the address line no longer decides whether it has anything to say')
    assert.match(markup, /demo \? 'simulated' : getHost\(\)/, 'the demo no longer says it is a simulation, or the computer has lost its address')
  })

  test('setlists and stars follow the account when there is one', () => {
    /*
     * "This says that setlists stay in this browser. Can we set that up to
     * save to the database across the cloud if user is signed in?"
     *
     * One row per person, like chats, holding every unit's lists, stars,
     * chosen source and the deletes still worth remembering. Pulled once when
     * the account arrives and pushed two seconds after any change here — both
     * local stores already announce their own writes, which is what the stage
     * screen listens to.
     */
    assert.match(src, /import \{ syncSetlists, setlistCloudReady \} from '\.\/lib\/cloudSetlists'/, 'nothing syncs the setlists')
    const wiring = src.slice(src.indexOf('const syncedLists = useRef'), src.indexOf('const linkAction'))
    assert.ok(wiring, 'the setlist sync is gone from App')
    assert.match(wiring, /if \(!link\.account \|\| !setlistCloudReady\(\)\) return undefined/, 'a signed-out browser is asked to sync anyway')
    assert.match(wiring, /addEventListener\(SETLISTS_CHANGED, later\)/, 'a setlist built here is never pushed up')
    assert.match(wiring, /addEventListener\(MARKS_CHANGED, later\)/, 'a star tapped here is never pushed up')
    assert.match(wiring, /setTimeout\(pull, 2000\)/, 'every drag through a running order is its own round trip')
    assert.match(wiring, /Picked up \$\{parts\.join\(' and '\)\} from/, 'what arrived from the other device is not said')

    /* Recent stays local on purpose: which presets this phone played tonight
       is about the phone. */
    const cloud = readFileSync(new URL('../src/lib/cloudSetlists.js', import.meta.url), 'utf8')
    assert.ok(!/\brecent\b\s*[:,]/.test(cloud), 'the recent list is being synced between devices')

    /* And the sheet says which of the two is true, rather than the old
       promise that it stays on the phone. */
    const sheet = readFileSync(new URL('../src/components/Setlists.jsx', import.meta.url), 'utf8')
    assert.match(sheet, /synced\s*\?\s*\n?\s*'Setlists and stars are kept with your account/, 'the sheet still says setlists stay in this browser when they do not')
    assert.match(sheet, /Sign in and they follow your account/, 'a signed-out phone is not told what signing in would do')

    /* The table it writes to is in the repo, not only in somebody's dashboard. */
    const sql = readFileSync(
      new URL('../supabase/migrations/20260910_stage_lists.sql', import.meta.url),
      'utf8'
    )
    assert.match(sql, /create table if not exists public\.stage_lists/)
    assert.match(sql, /enable row level security/, 'the table is readable by anyone with a key')
    assert.equal((sql.match(/auth\.uid\(\)/g) || []).length >= 4, true, 'a policy is not keyed to the account')
  })

  
  
  
  test('the backup panel declares the prop it reads', () => {
    /*
     * `deviceSlots` was read in DeviceBackup's markup and never declared or
     * passed, so the panel threw on render and the Backups section of the
     * Presets sheet was an error boundary's apology. Found one panel below the
     * reload button that started all this.
     */
    const versions = readFileSync(new URL('../src/components/Versions.jsx', import.meta.url), 'utf8')
    const sig = versions.match(/export function DeviceBackup\(\{([^}]*)\}/)?.[1] || ''
    assert.ok(sig.includes('deviceSlots'), 'DeviceBackup reads deviceSlots without declaring it')
    const call = src.slice(src.indexOf('<DeviceBackup'), src.indexOf('/>', src.indexOf('<DeviceBackup')))
    assert.match(call, /deviceSlots=\{/, 'DeviceBackup is rendered without the prop it reads')
  })

  test('a missing output block is said out loud, not shown as a missing slider', () => {
    /*
     * "The volume slider disappeared and no presets have sound."
     *
     * One fact, not two: the slider moves the output block's level, and a
     * preset built over its own output block has neither a level to move nor
     * anything reaching the jack. The slider going quiet was the only symptom
     * on screen, and a control that vanishes without a word reads as a bug in
     * the app rather than as the preset being broken.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const at = gig.indexOf("meterEid === null && chain === 'ok'")
    assert.notEqual(at, -1, 'a preset with no output block says nothing about it')
    const after = gig.slice(at, at + 700)
    assert.match(after, /no Output block/, 'the reason is missing or written in jargon')
    assert.match(after, /speaker is missing from the bar/, 'nothing connects it to the control that is not there')
    assert.match(after, /slotModel !== 'linear'/, 'a unit whose outputs are not a grid block is accused of missing one')
  })

  test('a read that could not clear the cache is not called a failed write', () => {
    /*
     * From a phone, clearing the unit's cache is refused — it only works at
     * the Mac — and the read that follows comes back one write behind. A log
     * from an iPhone has five parameters in a row reported as not landing,
     * each one reading back the PREVIOUS write's value scaled into its own
     * range: Tone read back the drive's 7, Level read back the tone's 4, Mix
     * read back the level's 6 as 60 out of 100. Every one of them had landed.
     *
     * So the app reports what it knows: unchecked, not failed.
     */
    const fx = readFileSync(new URL('../src/lib/forgefx.js', import.meta.url), 'utf8')
    const check = fx.slice(fx.indexOf('async function landed('), fx.indexOf('const wireLog'))
    assert.match(check, /clearDeviceCache\(\)\.catch\(\(\) => \{\s*stale = true/, 'a refused cache clear is swallowed again')
    assert.match(check, /return \{ ok: [^}]*stale \}/, 'the check does not report whether it could be believed')
    assert.match(fx, /NOT CHECKED/, 'the debug log still calls an unverifiable read a write that did not land')
    assert.match(fx, /unverified: checkA\.stale && checkB\.stale/, 'a write nobody could check is reported as one the device ignored')
    assert.match(fx, /couldn't be checked from your phone/, 'the failure line still blames the device for a read it could not take')

    const diag = readFileSync(new URL('../src/components/Diagnostics.jsx', import.meta.url), 'utf8')
    assert.equal(
      (diag.match(/c\.stale \? 'not checked'/g) || []).length,
      2,
      'the verification table and the copied report disagree about unchecked reads'
    )
  })

  
  
  
  
  test('the way to Edit on a phone is called Edit', () => {
    /*
     * "PLAY/ASK/EDIT tabs drop on phone; EDIT is easy to miss." The bar button
     * that opens the chain was called Chain, which is the thing it shows and
     * not the tab it stands in for.
     */
    const gig = readFileSync(new URL('../src/components/Gig.jsx', import.meta.url), 'utf8')
    const chain = gig.slice(gig.indexOf('{onChain ? ('), gig.indexOf('{onChain ? (') + 400)
    assert.match(chain, /className="gig-bar-btn gig-edit"/, 'the chain button lost its name')
    assert.match(chain, /<span>Edit<\/span>/, 'the way to the chain does not say Edit')
    assert.match(chain, /aria-label="Edit — see the chain and its controls"/, 'read aloud, the button no longer says Edit')
  })

  
  test('the Setup line about the unit is two lines that break between facts', () => {
    /*
     * "8 scenes · 512 slots wraps awkwardly" — one line broke wherever the
     * rail cut it. Now the app is one line and the unit is another, and each
     * fact is one unbreakable piece.
     */
    const detail = readFileSync(new URL('../src/components/DeviceDetail.jsx', import.meta.url), 'utf8')
    assert.equal((detail.match(/className="device-meta-line"/g) || []).length, 2, 'the meta is not two lines')
    for (const fact of ['{FULL}', 'gen {device.gen}', '{device.capabilities?.sceneCount} scenes', '{device.capabilities?.presets?.count} slots']) {
      assert.ok(detail.includes(`<span className="device-meta-fact">${fact}</span>`), `${fact} is not one unbreakable fact`)
    }
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.match(css, /\.device-meta-fact \{\s*white-space: nowrap;/, 'a fact can break in the middle')
    assert.match(css, /\.device-meta-fact \+ \.device-meta-fact::before \{\s*content: ' · ';/, 'the facts on a line are not joined by dots')
  })

  
  test('no test is registered from inside another test', () => {
    /*
     * A `})` went missing once and two `test(...)` calls ended up INSIDE
     * another test's body. They still ran and still passed, so nothing looked
     * wrong — but they registered while the queue was draining rather than
     * while this file was being read, which put one of them past the point
     * where run.mjs counts the score.
     *
     * Two things came of that. The tally printed "808 passed" on a run whose
     * 809th test had FAILED, with the failure below the line a person reads —
     * exactly what the summary was rewritten to prevent. And the count moved
     * with the Node version, because whether the straggler beat the summary
     * depended on how the runtime drains its microtasks: 809 on Node 22, 808
     * on Node 20 and 24. An upgrade looked like it had eaten a test.
     *
     * settle() re-awaits until the chain stops growing, so a stray brace can
     * no longer hide a result. This says it should not happen in the first
     * place, and says WHERE, which a count never did.
     *
     * A `test(` inside a plain block or a loop is fine and is not what this
     * looks for — those still register while the file is being read. Only a
     * registration inside another test's own callback is the fault.
     */
    const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs'))
    assert.ok(files.length >= 6, 'the test directory reads as empty; this check would pass on nothing')

    const strays = []
    for (const file of files) {
      const code = readFileSync(new URL(file, import.meta.url), 'utf8')
      const ast = parse(code, { sourceType: 'module', plugins: ['jsx'], allowAwaitOutsideFunction: true })

      traverse(ast, {
        CallExpression(path) {
          if (path.node.callee?.name !== 'test') return
          /* Is any enclosing function the callback of another `test(...)`? */
          const outer = path.findParent(
            (p) =>
              p.isFunction() &&
              p.parentPath?.isCallExpression() &&
              p.parentPath.node.callee?.name === 'test'
          )
          if (outer) {
            const name = path.node.arguments?.[0]?.value ?? '(unnamed)'
            strays.push(`${file}:${path.node.loc?.start.line} — ${name}`)
          }
        }
      })
    }

    assert.deepEqual(
      strays,
      [],
      `these tests register from inside another test, so the runner counts them late:\n  ${strays.join('\n  ')}`
    )
  })

  test('nothing in the app reaches for a name that does not exist', () => {
    /*
     * "The new mac app. Broke it" — a white window reading
     *
     *   The app couldn't draw — loadPlayMode is not defined.
     *
     * THE WEB APP HAD BEEN BROKEN SINCE 7.336.0 AND NOTHING SAID SO. That
     * version removed the AI tone builder and play mode, and three call sites
     * survived their definitions: `loadPlayMode` in a useState, and
     * `worthKeeping` and `newChatId` inside an effect that shelved a
     * conversation. Every one of them is a free variable — perfectly valid
     * JavaScript that throws the first time it is evaluated.
     *
     * Nothing in this repository could see it. The bundler does not resolve free
     * variables, because a browser global is also a free variable and it has no
     * way to tell them apart. The test suite reads App.jsx as TEXT — this file
     * says so in its own opening paragraph, "these read the source rather than
     * mount it", and gives the honest reason: App.jsx cannot be imported by
     * node. And it went unnoticed for three weeks because the testing happened
     * on the phone, which is a different codebase, and on a Mac app built before
     * the break.
     *
     * So: parse it and ask the scope. Babel resolves every reference against the
     * bindings actually in scope and hands back the ones that resolve to
     * nothing. That is the same question a browser asks at runtime, answered
     * without a browser — which is the gap the paragraph at the top of this file
     * admits to and could not previously close.
     */
    const KNOWN = new Set([
      /* The language. */
      'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'Float32Array',
      'Float64Array', 'Infinity', 'Int8Array', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number',
      'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'Uint16Array',
      'Uint32Array', 'Uint8Array', 'WeakMap', 'WeakSet', 'globalThis', 'undefined',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
      /* The browser. Only the ones this app actually uses — a permissive list
         would let the next `loadPlayMode` through as easily as the bundler did. */
      'AbortController', 'AbortSignal', 'Blob', 'DecompressionStream', 'DOMParser', 'Event',
      'EventSource', 'EventTarget', 'File', 'FileReader', 'FormData', 'Headers', 'Image',
      'IntersectionObserver', 'MutationObserver', 'Request', 'Response', 'ResizeObserver',
      'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams', 'WebSocket', 'XMLHttpRequest',
      'atob', 'btoa', 'cancelAnimationFrame', 'clearInterval', 'clearTimeout', 'console',
      'crypto', 'document', 'fetch', 'getComputedStyle', 'history', 'indexedDB', 'localStorage',
      'location', 'matchMedia', 'navigator', 'performance', 'queueMicrotask',
      'requestAnimationFrame', 'screen', 'sessionStorage', 'setInterval', 'setTimeout',
      'structuredClone', 'window',
      /* Replaced by Vite at build time — see `define` in vite.config.js. Free
         variables on purpose, and the only ones that are. */
      '__APP_VERSION__', '__COMMIT__', '__BUILT_AT__',
      /* React Native, for the phone's own files. */
      'process', 'global', '__DEV__', 'requestIdleCallback', 'cancelIdleCallback', 'alert'
    ])

    /*
     * Walked as URLs and normalised to forward slashes, which this repository
     * has now learned twice. `new URL(...).pathname` on Windows is
     * `/D:/a/...` — a leading slash in front of the drive letter, which
     * readdirSync refuses outright. And a short name built by slicing on the
     * repository's own folder name finds the wrong occurrence on a runner,
     * where the checkout is `D:/a/fractal-remote/fractal-remote`.
     * Both of those failed here before this comment existed.
     */
    const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/')
    const files = []
    const walk = (dir) => {
      for (const entry of readdirSync(fileURLToPath(dir))) {
        const full = fileURLToPath(new URL(entry, dir))
        if (statSync(full).isDirectory()) walk(new URL(`${entry}/`, dir))
        else if (/\.(jsx?|mjs)$/.test(entry)) files.push(full.replaceAll('\\', '/'))
      }
    }
    for (const dir of ['src/', 'shared/', 'mobile/src/']) walk(new URL(`../${dir}`, import.meta.url))
    assert.ok(files.length > 50, `only found ${files.length} source files to check`)

    const broken = []
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
      let ast
      try {
        ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
      } catch (err) {
        broken.push(`${file}: will not parse — ${err.message}`)
        continue
      }
      let globals = []
      traverse(ast, {
        Program(path) {
          globals = Object.keys(path.scope.globals)
        }
      })
      const unknown = globals.filter((name) => !KNOWN.has(name)).sort()
      if (unknown.length) {
        const short = file.startsWith(root) ? file.slice(root.length) : file
        broken.push(`${short} uses ${unknown.join(', ')} — defined nowhere, so it throws when that line runs`)
      }
    }

    assert.deepEqual(broken, [], `\n${broken.join('\n')}\n`)
  })
  test('one repository name, everywhere it decides where something goes', async () => {
    /*
     * "Rename the repo fractal-remote instead of fractal-AI-builder and update
     * anything that requires knowing that repo name."
     *
     * Most of what knew the old name was prose. THREE places are not, and each
     * one sends somebody or something to a URL:
     *
     *   - electron-builder's publish block, which is BOTH where a release
     *     build uploads and where an installed Mac app looks for the next
     *     version. Those two cannot be allowed to disagree.
     *   - the Releases link the phone and the browser offer for downloading
     *     the computer app.
     *   - the same link in the Mac app's own menu.
     *
     * THE NAME THEY CARRY IS THE ONE THAT EXISTS TODAY, and this check learned
     * that the expensive way. All three were pointed at `fractal-remote`
     * before the rename had actually happened on GitHub, on the reasoning that
     * GitHub redirects the old name. It does — the OLD one. A name that has
     * never existed does not redirect, it 404s. So every desktop build failed
     * at the publish step, on all four platforms, and the Download link the
     * apps offered went nowhere.
     *
     * Hence one constant and a check that the other two match it, rather than
     * three strings and a hope. On the day of the rename: change REPO, change
     * `repo:` in electron-builder.yml, run the sync, and this passes again.
     */
    const { REPO, RELEASES } = await import('../shared/ways-in.mjs')
    assert.match(REPO, /^[\w.-]+\/[\w.-]+$/, `REPO is not owner/name: ${REPO}`)
    const [owner, name] = REPO.split('/')

    const yml = readFileSync(new URL('../desktop/electron-builder.yml', import.meta.url), 'utf8')
    assert.match(yml, new RegExp(`^\\s*owner: ${owner}$`, 'm'), 'the publish block names another owner')
    assert.match(yml, new RegExp(`^\\s*repo: ${name}$`, 'm'), `the Mac app publishes to, and updates from, a repository that is not ${REPO}`)

    assert.equal(RELEASES, `https://github.com/${REPO}/releases`, 'the download link is not this repository')

    const main = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
    assert.match(main, new RegExp(`github\\.com/${REPO}/releases`), 'the Mac app menu points at another repository')

    /* And the phone's generated copy carries the same link, or a phone sends
       somebody somewhere the browser does not. */
    const phone = readFileSync(new URL('../mobile/src/lib/ways-in.js', import.meta.url), 'utf8')
    assert.ok(phone.includes(REPO), 'the phone offers a download from a different repository')
  })

  test('no screen shows anybody the account service\u2019s settings', () => {
    /*
     * "There is only 3 ways to connect. Mac, Windows or Linux. We removed the
     * terminal. There is no reason a user should be seeing supabase developer
     * jargon."
     *
     * Link details used to print three environment variables — the account
     * service's URL and its publishable key — to paste into a server's .env.
     * The first attempt at this only MOVED them: hidden from phones, folded
     * away at the computer, on the reasoning that running ForgeFX by hand was
     * one of the ways in and needed them.
     *
     * That route was taken out in 7.352.0: "I think that we should just drop
     * the helpers completely, nobody wants to deal with that kind of stuff in
     * order for it to work." All three that remain are applications that start
     * the device server themselves and set those values without being asked.
     * So the block had no audience at all, at either end.
     *
     * Nothing was leaked — the key is the publishable one and a signed-in user
     * can only reach their own channel — but a person who cannot act on
     * something should not be shown it, least of all on the screen they open
     * when the link is broken.
     */
    const files = [
      '../src/components/LinkDetails.jsx',
      '../src/App.jsx',
      '../src/components/PhoneRemote.jsx',
      '../mobile/src/screens/Settings.js',
      '../mobile/src/screens/Connect.js'
    ]
    /*
     * Comments stripped first. This file has been here before: an assertion
     * that reads a source for a word finds the word in the paragraph
     * EXPLAINING why the word is not there any more, and fails on its own
     * documentation. What is on a screen is what is outside a comment.
     */
    const bare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const file of files) {
      const text = bare(readFileSync(new URL(file, import.meta.url), 'utf8'))
      for (const jargon of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AXIS_CLOUD', '.env']) {
        assert.ok(!text.includes(jargon), `${file} puts "${jargon}" on a screen`)
      }
    }

    /* What is left is the one thing here anybody can act on: a step-by-step
       test of THIS device's own connection, stopping at the first fault. */
    const src = readFileSync(new URL('../src/components/LinkDetails.jsx', import.meta.url), 'utf8')
    assert.match(src, /Test the link/, 'the link test went with the jargon')
    assert.ok(!/DEFAULT_PROJECT/.test(src), 'the panel still reaches for the project settings')

    /*
     * And the count is counted, not typed. Both apps said "Four ways" for
     * weeks after the fourth was removed, because a number written into prose
     * cannot notice that the list under it changed.
     */
    const ways = readFileSync(new URL('../shared/ways-in.mjs', import.meta.url), 'utf8')
    const ids = [...ways.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1])
    assert.deepEqual(ids, ['mac-app', 'windows-app', 'linux-app'], `the ways in are now ${ids.join(', ')}`)
    /*
     * The browser only. The phone's version of this screen no longer lists
     * the routes at all — "a phone can't download desktop software, it also
     * isn't suppose to go to GitHub directly" — so there is no count on it to
     * get wrong. See mobile/src/screens/Connect.js.
     */
    for (const file of ['../src/App.jsx']) {
      const text = bare(readFileSync(new URL(file, import.meta.url), 'utf8'))
      assert.match(text, /waysWord\(\)/, `${file} types the number of ways rather than counting them`)
      assert.ok(!/Four ways/.test(text), `${file} still says there are four ways in`)
    }
  })

  test('the ways to connect a computer start level with each other', () => {
    /*
     * "When opening the connect a computer menu the Mac app is expanded by
     * default. Have it collapsed like the windows and Linux apps."
     *
     * The first route used to open itself, on the reasoning that waysFor puts
     * the one for YOUR computer first. What that produced was a page where
     * one route is a wall of steps and the rest are a line each, which reads
     * as one answer with footnotes rather than a choice. The summaries say
     * what each one costs; the steps are for after somebody has picked.
     */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const ways = app.slice(app.indexOf('<div className="ways">'), app.indexOf('</div>', app.indexOf('<div className="ways">')))
    assert.ok(ways.length > 100, 'the ways list moved; this check reads it')
    assert.match(ways, /<details key=\{way\.id\} className="way" data-status=\{way\.status\}>/, 'the routes are no longer folds')
    assert.ok(!/open=/.test(ways), 'one of the routes opens itself again')
  })

  test('the demo holds the factory bank the unit really ships with', async () => {
    /*
     * "Here are all the preset names and scene names for all of the current
     * fractal units for you to put in the demos."
     *
     * The demo was twelve hand-built presets and 500 blank slots. Good
     * presets — real amps, real cabs, scenes that differ — but not what
     * anybody's unit says when they switch it on, and somebody trying the
     * demo is holding it against the rig on their desk.
     */
    const { UNITS, presetsFor, nameFor, scenesFor, namedCount } = await import('../src/lib/factoryPresets.js')
    const { SLOTS, SCENES, build, splitRow } = await import('../scripts/factory-presets.mjs')

    assert.deepEqual([...UNITS].sort(), ['am4', 'axefx3', 'fm3', 'fm9', 'vp4'], `the catalog covers ${UNITS.join(', ')}`)

    for (const unit of UNITS) {
      const list = presetsFor(unit)
      assert.equal(list.length, SLOTS[unit], `${unit} has ${list.length} slots, not ${SLOTS[unit]}`)
      /* Slot numbers are the index, or a preset list would draw the right
         names against the wrong numbers — which is how somebody ends up on
         the wrong song. */
      list.forEach((p, i) => assert.equal(p.number, i, `${unit} slot ${i} says it is ${p.number}`))
    }

    /* The counts the source itself states: 384 on the big three, and the AM4
       and VP4 ship part-full on purpose. */
    assert.equal(namedCount('axefx3'), 384)
    assert.equal(namedCount('fm9'), 384)
    assert.equal(namedCount('fm3'), 384)
    assert.equal(namedCount('am4'), 88, 'the AM4 ships 88 presets in 104 slots; W1-Z4 are yours')
    assert.equal(namedCount('vp4'), 80, 'the VP4 ships 80')

    /*
     * AN EMPTY SLOT IS EMPTY, and has no scenes. "Generic names likely scene
     * 1, scene 2 or empty are accurate and should reflect that way." A demo
     * that fills those teaches that they come full.
     */
    assert.equal(nameFor('am4', 103), '', 'the AM4\u2019s last user slot was given something')
    assert.equal(scenesFor('am4', 103), null, 'an empty slot is offering scenes')

    /*
     * AN UNNAMED SCENE IS CALLED "Scene 5", because that is what the unit
     * shows. Not a blank tile, and not something invented to fill it.
     */
    for (const unit of UNITS) {
      for (const preset of presetsFor(unit)) {
        if (!preset.name) continue
        assert.equal(preset.scenes.length, SCENES[unit], `${unit} "${preset.name}" has ${preset.scenes.length} scenes`)
        preset.scenes.forEach((name, i) => {
          assert.ok(name, `${unit} "${preset.name}" scene ${i + 1} is blank`)
        })
      }
    }
    assert.equal(scenesFor('fm3', 2)[6], 'Scene 7', 'an unnamed scene is not called what the unit calls it')

    /* The units really do differ where the documentation says they differ:
       the FM3 rewrites the Rotary scene on 59 Bassguy because it has not the
       CPU for it. That the two are not copies of each other is the point of
       holding five lists rather than one. */
    assert.equal(nameFor('fm3', 0), nameFor('axefx3', 0), 'slot 0 is a different preset on the two units')
    assert.notEqual(
      scenesFor('fm3', 0)[4],
      scenesFor('axefx3', 0)[4],
      'the FM3 and the Axe-Fx III are being given identical scenes, so one of them is wrong'
    )

    /* Generated, not hand-edited: regenerate from the CSV and it must match. */
    const csv = readFileSync(new URL('../data/factory-presets.csv', import.meta.url), 'utf8')
    const fresh = build(csv)
    const onDisk = JSON.parse(readFileSync(new URL('../src/data/factory-presets.json', import.meta.url), 'utf8'))
    assert.deepEqual(onDisk, fresh, 'src/data/factory-presets.json is stale — run scripts/factory-presets.mjs')

    /* A preset name with a comma in it must not shift every scene along one. */
    assert.deepEqual(splitRow('fm3,7,"Sunday, Morning",A,B'), ['fm3', '7', 'Sunday, Morning', 'A', 'B'])

    /* And the demo actually serves them, at both ends. */
    for (const file of ['../src/lib/mockDevice.js', '../mobile/src/lib/mockDevice.js']) {
      const mock = readFileSync(new URL(file, import.meta.url), 'utf8')
      assert.match(mock, /presetsFor\(UNIT\)/, `${file} still shows twelve presets and 500 blanks`)
      assert.match(mock, /scenesFor\(UNIT, number\)/, `${file} does not use the factory scene names`)
    }
  })

  test('the demo can be any of the five units, and each is itself', async () => {
    /*
     * "Demo for all Fractal units with real default presets and scenes."
     *
     * It was an FM3 and only an FM3, which is the wrong shape of answer for
     * somebody deciding whether to buy this. An AM4 owner opening it saw
     * eight scene tiles their unit has not got, five hundred slots it has
     * not got, and a preset list sharing no names with theirs.
     */
    const { UNITS, unitByKey, DEFAULT_UNIT } = await import('../src/lib/demoUnits.js')
    const { createMockDevice } = await import('../src/lib/mockDevice.js')
    const { namedCount } = await import('../src/lib/factoryPresets.js')

    assert.deepEqual(UNITS.map((u) => u.key), ['fm3', 'fm9', 'axefx3', 'am4', 'vp4'])

    for (const unit of UNITS) {
      const mock = createMockDevice(unit.key)
      const caps = mock.detect().capabilities

      /* The counts are the unit's own. Eight scene tiles on a four-scene unit
         is the demo teaching something untrue about hardware. */
      assert.equal(caps.sceneCount, unit.scenes, `${unit.key} offers ${caps.sceneCount} scenes`)
      assert.equal(caps.presets.count, unit.slots, `${unit.key} offers ${caps.presets.count} slots`)
      assert.equal(mock.detect().short, unit.name)

      /*
       * An AM4 and a VP4 are a chain of four blocks and report NO GRID, which
       * is what a real one does — the app draws "grid ×" otherwise, and that
       * is not a fact about the unit.
       */
      if (unit.grid) assert.deepEqual(caps.grid, unit.grid, `${unit.key} lost its layout`)
      else assert.ok(!('grid' in caps), `${unit.key} claims a grid it has not got`)
      /*
       * 'linear' is the word, and it is not a free choice: gridShape, both
       * copies of isLinearChain and the play screen's meter all test for it.
       * The mock said 'chain', which matches none of them, so every one of
       * them answered "grid" and a VP4 drew as a 4x12 with ROW 2, COLUMN 1
       * under it. A bare assert.equal is how that survived — it asserted the
       * mock against itself and never said what the word is for.
       */
      assert.equal(
        caps.slotModel,
        unit.grid ? 'grid' : 'linear',
        `${unit.key} reports a slotModel the app does not read`
      )

      /* No cab block on a VP4, so no impulse responses to offer. */
      assert.equal(caps.cabIrs, unit.amps, `${unit.key} offers the wrong cab support`)

      /* And it is holding ITS OWN factory bank. */
      const first = mock.presetSummary(0).name
      assert.ok(first, `${unit.key} slot 0 is empty`)
      assert.ok(namedCount(unit.key) > 0, `${unit.key} has no factory bank behind it`)
    }

    /*
     * THE TWELVE HAND-BUILT PRESETS ARE FM3 PRESETS and appear only there.
     * They are an FM3 chain with FM3 amp numbers in it, and "Drop D Chug" is
     * not a name any AM4 has ever shown.
     *
     * AND THEY NO LONGER SIT ON THE FACTORY BANK. They used to hold slots
     * 0-11, which is where the FM3 keeps 59 Bassguy, 65 Bassguy, Vibrato Lux
     * and nine more — so the one unit with hand-built content was the one
     * unit whose bank you could not check against the thing on your desk.
     *
     * "With the FM3, they are not the actual default presets. One of them
     * says Papa's Roach, which definitely is not a preset that should be in
     * the demo. It should have the real factory presets like all the others
     * do."
     *
     * They start after the bank now, where a player's own presets live.
     */
    const { presetsFor, nameFor } = await import('../src/lib/factoryPresets.js')
    const fm3 = createMockDevice('fm3')

    /* Every factory slot reads the way the unit does — checked across the
       whole bank rather than at slot 0, which is where this last slipped. */
    for (const p of presetsFor('fm3').filter((x) => x.name)) {
      assert.equal(
        fm3.presetSummary(p.number).name,
        p.name,
        `fm3 slot ${p.number} reads "${fm3.presetSummary(p.number).name}" where the unit ships "${p.name}"`
      )
    }
    assert.equal(fm3.presetSummary(0).name, nameFor('fm3', 0), 'the FM3 demo does not open on its own first preset')

    /* The hand-built rigs are still there, past the bank. */
    assert.equal(fm3.presetSummary(386).name, "Papa's Roach", 'the hand-built rigs are gone entirely')
    assert.ok(
      presetsFor('fm3').every((x) => x.number < 384),
      'the FM3 factory bank now reaches past 384, so the hand-built rigs are back on top of it'
    )

    for (const key of ['fm9', 'axefx3', 'am4', 'vp4']) {
      assert.notEqual(
        createMockDevice(key).presetSummary(386).name,
        "Papa's Roach",
        `the FM3's hand-built presets leaked onto the ${key}`
      )
    }
    /* The AM4 and the VP4 really are different banks from each other. */
    assert.notEqual(createMockDevice('am4').presetSummary(0).name, createMockDevice('vp4').presetSummary(0).name)

    /* An unreadable saved choice is the FM3, not a crash: a demo that refuses
       to start is worse than one that starts as the wrong unit. */
    assert.equal(unitByKey('nonsense').key, DEFAULT_UNIT)
    assert.equal(unitByKey(undefined).key, DEFAULT_UNIT)

    /* And both ends offer the choice, only while the demo is on. */
    const detail = readFileSync(new URL('../src/components/DeviceDetail.jsx', import.meta.url), 'utf8')
    assert.match(detail, /\{demo \? \(\s*<div className="demo-units"/, 'the browser offers no unit picker')
    assert.match(detail, /setDemoUnit\(key\)/, 'the browser picker changes nothing')
    const settings = readFileSync(new URL('../mobile/src/screens/Settings.js', import.meta.url), 'utf8')
    assert.match(settings, /onPress=\{\(\) => setDemoUnit\(u\.key\)\}/, 'the phone offers no unit picker')
  })



  test('a failed pairing says so where the button is, and the way back in is on the Settings list', () => {
    /*
     * "Setup phone button does nothing on mac. Also no way to replay tutorial
     * set up??"
     *
     * Neither was true, and both were as good as true.
     *
     * THE BUTTON worked. It asked the account service for the hidden account
     * behind a pairing code, got back "email rate limit exceeded", and put
     * that in the error bar in the far top-left of the window — while the
     * button that failed is in a panel down the right-hand side. On a wide
     * screen they are a foot apart, and the words were the service's own:
     * a limit nobody set, with nothing to do about it.
     *
     * THE WALKTHROUGH was there too, as a Section on the About page, under
     * the version number and the build date. The last screen of it promises
     * "Settings → Show the walkthrough", which reads as a row on that list,
     * and that list is where somebody goes after reading the sentence.
     */
    const panel = readFileSync(new URL('../src/components/PhoneRemote.jsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

    /* The same sentence a second time, where the press happened. */
    assert.match(app, /<PhoneRemote link=\{link\} onAction=\{linkAction\} onError=\{setError\} error=\{error\} busy=\{busy\} \/>/, 'the panel is not told what went wrong, so only the far corner of the window says it')
    assert.match(panel, /function MacSide\(\{ link, email, onAction, busy, error \}\)/, 'the computer half of the panel cannot show a fault')
    assert.match(panel, /\{error \? <p className="hint tone-bad">\{String\(error\)\}<\/p> : null\}/, 'a failed pairing still only speaks from the top-left corner')
    /* Under the two buttons, not above them: it is about the press that just
       happened, and a message above a button is read before the press. */
    assert.ok(
      panel.indexOf("onAction('mac-setup')") < panel.indexOf('tone-bad'),
      'the fault is printed above the button it is about'
    )

    /*
     * The rate-limited-pairing message that used to be checked here is gone
     * with `pairMac`: nothing makes a pairing account any more, so nothing
     * can be refused for making too many.
     */
    /*
     * THE WALKTHROUGH IS A ROW INSIDE ABOUT, which reverses what this check
     * used to require.
     *
     * It was lifted onto the front list because the last screen of the tour
     * promises "Settings → Show the walkthrough" and it had been two doors in.
     * Then: "Move walkthrough, updates and troubleshooting INSIDE of the
     * 'About' menu." That is one door, not two, and it is where the phone's
     * has been since — the browser's stayed on the front list, which is the
     * drift this pass is closing.
     *
     * The promise still holds, because what it names is the Settings screen
     * and this is on it. What the check holds instead is the shape: a ROW,
     * not a chip inside a fold, because everything else at that level is a row
     * and the one thing that is not is the one thing nobody finds.
     */
    const aboutPage = app.slice(app.indexOf("setupPage === 'about' ? ("))
    assert.match(aboutPage, /<SetupRow\s*\n?\s*key="walkthrough"\s*\n?\s*title=\{REPLAY\}/, 'the walkthrough is not a row on the About page')
    assert.match(aboutPage, /setWalkthrough\(true\)/, 'the row on the About page does not open the walkthrough')
    const frontRows = app.slice(app.indexOf('<SetupRow key="link"'), app.indexOf('<SetupRow key="about"'))
    assert.ok(!frontRows.includes('key="walkthrough"'), 'the walkthrough is back on the front list, where the phone does not have it')
  })

  test('the computer states the condition, and the phone is what answers it', () => {
    /*
     * "It's fine if the Mac says, if you've purchased this, go ahead and scan
     * the QR code, and if they scan it, the phone needs to be able to tell,
     * hey, you did not unlock this, or yes, you did unlock it."
     *
     * Two halves, in the only two places that can carry them. The COMPUTER
     * cannot check anything: the purchase lives on the phone's App Store
     * account and there is nothing here that can see it, so its job is to say
     * what to expect. The PHONE is what actually answers, and it does that on
     * the far side of the scan — see the walkthrough's connect, which now
     * sends somebody who already paid past the unlock step instead of asking
     * them to buy the app a second time.
     */
    const tour = readFileSync(new URL('../src/components/Onboarding.jsx', import.meta.url), 'utf8')
    assert.match(tour, /<p className="onb-note">\{D4\.owned\}<\/p>/, 'the pairing step does not say who this is for')
    /* It is the whole of that step now — the QR code it used to sit above is
       gone, and signing in on both ends is the pairing. */
    assert.ok(!/PhoneQr/.test(tour), 'the tour draws a QR code again')
    assert.match(tour, /\{D4\.waiting\}/, 'the tour no longer says it is waiting for the phone')
  })



  /*
   * THE WALKTHROUGH SAYS WHAT THE PDF SAYS, WORD FOR WORD.
   *
   * "Do not change any wording without asking me first."
   *
   * Copy typed into a component gets tidied without anybody deciding to: a
   * plain hyphen becomes an em dash, "Wi-Fi" becomes "wifi", a sentence gets
   * shortened to fit a button. None of those is a change somebody approved, and
   * every one of them is invisible in review.
   *
   * So the strings live in one file and this holds a sample of them to the
   * source PDF, character for character — including the hyphens where a
   * typographer would use a dash, which is the exact thing most likely to be
   * "fixed" by accident.
   */
  /*
   * THE WALKTHROUGH REPORTS; IT DOES NOT PRETEND.
   *
   * Every screen in the PDF that names a fact — which unit answered, its
   * firmware, how many presets, whether a phone arrived — is wired to the
   * thing it names. That is the whole difference between this and a mockup,
   * and it is the one property worth a test: the single moment these screens
   * exist for is somebody deciding whether this app actually works, and a
   * walkthrough that prints "FM3 found" with nothing plugged in has answered
   * that question for them, wrongly.
   */
  test('the walkthrough says what the port answered, not what the mockup said', () => {
    const onb = readFileSync(new URL('../src/components/Onboarding.jsx', import.meta.url), 'utf8')

    /* Not one word typed into the component. */
    assert.match(onb, /from '\.\.\/\.\.\/shared\/onboarding\.mjs'/, 'the copy is not coming from the one file that holds it')
    const bare = onb.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    for (const typed of ['FM3 found', 'firmware 8.02', '512 presets', 'K7QM-4T9R', 'iPhone connected']) {
      assert.ok(!bare.includes(typed), `"${typed}" is typed into the screen, so it is true whether or not it is`)
    }

    /* The unit is whatever answered, and the numbers are read off it. */
    assert.match(onb, /const found = status === 'live' && !!device/, 'the found state is not the real one')
    assert.match(onb, /D2\.found\(unitName\)/, 'the unit name is not the one that answered')
    assert.match(onb, /firmware: firmwareOf\(device\)/, 'the firmware is not read off the unit')
    assert.match(onb, /presets: slotCount\(device\?\.capabilities\)/, 'the preset count is not the unit own')

    /* There is no QR code on that step any more — signing in on both ends
       is the pairing. What it still reads off the link is whether the phone
       has arrived, which is what the waiting line is about. */
    assert.match(onb, /\{D4\.waiting\}/, 'the pairing step no longer waits for the phone')

    /*
     * AND "THE PORT IS BUSY" IS TOLD APART FROM "NOTHING IS PLUGGED IN".
     * They are different screens in the PDF because they are different
     * problems: one is a thing to go and fix, the other is "plug it in".
     */
    assert.match(
      onb,
      /const stuck = !found && \(faultReason === 'no-answer' \|\| faultReason === 'unreadable'\)/,
      'the busy-port screen is guessed at rather than read from why the read failed'
    )

    /* It finishes itself once a phone actually arrives: nobody should press
       Next after the thing they are holding has already connected. */
    assert.match(onb, /if \(open && at === 'pair' && paired\) setAt\('done'\)/, 'the pairing step waits for a press it does not need')

    /* Seen once. Marked on open rather than on finish — closing the tab is
       not an accident to be corrected next launch. */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(app, /useState\(\(\) => !onboarded\(\)\)/, 'the walkthrough does not open itself on a first run')
    assert.match(app, /if \(walkthrough\) markOnboarded\(\)/, 'the walkthrough is not remembered, so it returns every load')
  })

  test('the walkthrough is worded the way he wrote it', async () => {
    const c = await import('../shared/onboarding.mjs')

    /* One from every screen, chosen for the bits most likely to drift. */
    assert.equal(c.D1.head, 'Let\u2019s get your whole rig connected.')
    assert.equal(c.D1.sub, 'Three clear steps. About a minute.')
    assert.equal(c.D1.skip, 'Skip walkthrough')
    assert.equal(c.D2.head, 'Plug your unit into this computer.')
    assert.equal(
      c.D2.helpBody,
      'Quit FM3-Edit, FM9-Edit, Axe-Edit III, AM4-Edit, VP4-Edit or Fractal-Bot if one is open. Only one program can use the USB connection at a time.'
    )
    assert.equal(c.D2B.head, 'Something else has the USB port.')
    assert.equal(c.D2B.without, 'Continue without it')
    assert.equal(c.D3.head, 'Use your phone as the remote?')
    assert.equal(c.D4.waiting, 'Waiting for your phone\u2026')
    assert.equal(c.D5.head, 'You\u2019re set.')
    assert.equal(c.P1.head, 'CONTROL YOUR FRACTAL FROM YOUR PHONE.')
    assert.equal(c.P3.demo.go, 'Start free demo')
    /*
     * THE PRICE IS THE STORE'S, AND HIS WORDS ARE THE FALLBACK.
     *
     * "Change that one so it does know the correct price per app, and then
     * default back if it doesn't know the price."
     *
     * The store is the only thing that knows what this costs the person
     * holding the phone — App Store and Play price by country — so printing
     * $9.99 everywhere quotes a price most buyers cannot pay.
     */
    /*
     * EXCEPT THE ONE THAT TAKES NO MONEY. "Have the button just say
     * 'Unlock'." The real-rig card opens the computer-app step; the charge
     * is two screens later on P8, which is where the store's price belongs.
     */
    assert.equal(c.P3.real.go, 'Unlock')
    assert.equal(c.P8.head(null), '$9.99 one-time')
    assert.equal(c.P8.head('\u20ac10,99'), '\u20ac10,99 one-time')
    assert.equal(c.P8.go(null), 'Unlock real-rig control  \u00b7  $9.99')
    assert.equal(c.P8.go('\u00a37.99'), 'Unlock real-rig control  \u00b7  \u00a37.99')

    /* One tip, and it does not advertise a second that was never written. */
    assert.equal(c.P5.count, 'QUICK TIP')
    assert.equal(c.P9.head, 'You\u2019re connected.')
    assert.equal(c.REPLAY, 'Show the walkthrough')

    /*
     * THE HYPHENS, which are the whole reason this test is this pedantic. Four
     * lines use a plain hyphen where an em dash would be the typographic
     * choice. That was his choice and it is not ours to improve.
     */
    for (const line of [
      c.CHAIN[2].phoneBody,
      c.D3.why[2].body,
      c.D3.note,
      c.P1.sub,
      c.P5.body,
      c.P5.foot,
      c.P6.yes
    ]) {
      assert.ok(!/[\u2014\u2013]/.test(line), `an em or en dash crept into: ${line}`)
    }
    assert.equal(c.CHAIN[2].phoneBody, 'Your remote - nearby or away')
    assert.equal(c.P6.yes, 'Yes - sign in to connect', 'the button promises a scanner that does not exist')
    assert.equal(c.P5.body, 'Tap toggles the block. Press and hold to choose channels A-D.')

    /* Wi-Fi keeps its capital and its hyphen. */
    assert.match(c.D3.why[2].body, /home Wi-Fi$/, 'Wi-Fi was rewritten')

    /*
     * AND THE LINES THAT CLAIM SOMETHING ARE FUNCTIONS, not strings. Each of
     * these names a fact — which unit answered, how many presets, whether a
     * phone arrived — and the one moment this screen exists for is somebody
     * deciding whether the app works. A typed-out "FM3 found" has answered that
     * question before asking the hardware.
     */
    for (const [name, fn] of [
      ['D2.found', c.D2.found],
      ['D2.detail', c.D2.detail],
      ['D5.status', c.D5.status],
      ['P4.go', c.P4.go],
      ['P8.verified', c.P8.verified],
      ['P9.tag', c.P9.tag],
      ['P9.status', c.P9.status]
    ]) {
      assert.equal(typeof fn, 'function', `${name} is a fixed string, so it can claim something untrue`)
    }
    assert.equal(c.D2.found('FM9'), 'FM9 found')
    assert.equal(c.D2.detail({ firmware: '8.02', presets: 512 }), 'USB  \u00b7  firmware 8.02  \u00b7  512 presets')
    /* And they say less rather than inventing, when a fact is missing. */
    assert.equal(c.D2.detail({}), 'USB')
    assert.equal(c.D5.status({ unit: 'FM3', phone: false }), 'FM3 on USB')
    assert.equal(c.D5.status({ unit: null, phone: true }), 'iPhone connected')
  })

  /*
   * REPLAYING THE WALKTHROUGH IS NOT A FIRST RUN.
   *
   * "I'm signed in and went to settings to restart the tutorial to get the
   * screenshots. Now my only option is to start the demo again, which made me
   * re sign in again to unlock."
   *
   * Two faults, one screen. Asking to see it again set the app to signed-out
   * on the way — which left the walkthrough's own exits as the only way back
   * in. And every one of those exits is a SETUP step: pick a demo unit, scan
   * a code, buy the unlock. The one that looked like a way forward started
   * the demo, which takes somebody off the rig they were driving.
   */
  test('replaying the walkthrough changes nothing about who is signed in', () => {
    const app = readFileSync(new URL('../mobile/App.js', import.meta.url), 'utf8')
    const onb = readFileSync(new URL('../mobile/src/screens/Onboarding.js', import.meta.url), 'utf8')

    const replay = app.match(/onReplay=\{\(\) => \{[^}]*\}/)
    assert.ok(replay, 'Settings can no longer ask for the walkthrough again')
    assert.ok(
      !/setAuth\(/.test(replay[0]),
      'asking to see the walkthrough again still changes who is signed in'
    )
    assert.match(replay[0], /setReplaying\(true\)/, 'a replay is no longer told apart from a first run')

    /* And a replay carries a door that does nothing but close. */
    assert.match(app, /replay=\{replaying\}/, 'the walkthrough is not told it is a replay')

    /*
     * AND IT HAS TO ACTUALLY APPEAR, which the first version of this test
     * forgot to check and therefore shipped broken.
     *
     * "When you click it you feel the haptic feedback, but then it doesn't go
     * to the screen." The branch read `auth === 'out' && !seenWalk`, which was
     * only ever true for a replay because asking for one ALSO set the app to
     * signed-out — the very thing that cost somebody their unlock and was
     * taken out here. Remove that and a signed-in person flips the flag into a
     * condition that stays false.
     *
     * So: the walkthrough being up is that flag's business alone. Checking
     * that setAuth is gone is worth nothing without this beside it.
     */
    /*
     * Now `=== false` rather than `!seenWalk`, because the flag has a third
     * value. It starts NULL — storage has not answered — and the spinner
     * covers that, so a brand-new install no longer flashes the sign-in
     * screen while the two reads that decide the opening race each other.
     * `!null` would have drawn the walkthrough on that guess instead, which
     * is the same fault pointing the other way.
     */
    assert.match(
      app,
      /\) : seenWalk === false \? \(/,
      'the walkthrough is gated on something other than the flag alone, so a replay flips it and nothing happens'
    )
    assert.match(app, /const \[seenWalk, setSeenWalk\] = useState\(null\)/, 'the walkthrough flag guesses again instead of waiting')
    assert.match(
      app,
      /\{auth === 'checking' \|\| seenWalk === null \? \(/,
      'the opening screen is chosen before both answers are in'
    )
    assert.match(onb, /replay \?[^]{0,120}label=\{CLOSE\}/, 'the replay lost its way out')
    const close = app.match(/onClose=\{\(\) => \{[^}]*\}/)
    assert.ok(close, 'the walkthrough cannot be closed')
    for (const damage of ['setAuth(', 'setDemo(', 'signOut(']) {
      assert.ok(
        !close[0].includes(damage),
        `closing the walkthrough calls ${damage}, so looking at it costs something`
      )
    }
  })

  /*
   * A WAY BACK TO AN ACCOUNT FROM INSIDE THE APP.
   *
   * "I am logged in and it shows this screen and says I still need to unlock.
   * There is no way to login with user name and password after you are in the
   * app on the demo."
   *
   * The demo has no session at all, so the unlock it is shown is the right
   * one — and there was no way from there to say "I already have an account".
   * Setup offered Sign out, which is no use to somebody with nothing to sign
   * out of, and the Unlock sheet offered Restore, which asks the STORE a
   * different question entirely.
   */
  test('an account can be signed into from inside the app, not only on the way in', () => {
    const app = readFileSync(new URL('../mobile/App.js', import.meta.url), 'utf8')
    const settings = readFileSync(new URL('../mobile/src/screens/Settings.js', import.meta.url), 'utf8')
    const paywall = readFileSync(new URL('../mobile/src/screens/Paywall.js', import.meta.url), 'utf8')

    /* All four doors, from the one handler — Setup, both unlock screens, and
       the walkthrough's, which got a paywall of its own when its Unlock
       button stopped merely advancing to the next step. */
    assert.equal(
      (app.match(/onSignIn=\{toSignIn\}/g) || []).length,
      3,
      'the sign-in route is no longer wired to Setup and both unlock screens'
    )
    /*
     * The walkthrough's door goes through the same handler, and out of the
     * walkthrough first. On toSignIn alone it did nothing visible: the
     * walkthrough is drawn ahead of the sign-in screen, so setting auth to
     * 'out' behind it changed nothing on screen.
     */
    assert.match(
      app,
      /onSignIn=\{\(\) => \{\s*markWalkthrough\(\)\s*setSeenWalk\(true\)\s*setReplaying\(false\)\s*toSignIn\(\)/,
      'the walkthrough’s sign-in leaves the walkthrough standing again'
    )
    assert.match(app, /const toSignIn = \(\) => \{/, 'the sign-in route is gone')
    assert.match(app, /const toSignIn = \(\) => \{[^}]*setAuth\('out'\)/, 'it no longer lands on the sign-in screen')
    /* It leaves the demo, because somebody heading for an account is heading
       for a real rig. */
    assert.match(app, /const toSignIn = \(\) => \{[^}]*setDemo\(false\)/, 'the demo keeps answering after leaving for an account')
    /* And it destroys nothing on the way: a phone paired by code keeps its
       session if the person backs out of the form. */
    assert.ok(
      !/const toSignIn = \(\) => \{[^}]*signOut\(/.test(app),
      'the sign-in route signs out first, so backing out of it costs a pairing'
    )

    for (const [name, file] of [['Settings', settings], ['Paywall', paywall]]) {
      assert.match(file, /onSignIn/, `${name} no longer offers a way to sign in`)
      assert.match(
        file,
        /label="Sign in with an email and password"/,
        `${name} lost the sign-in button`
      )
    }

    /*
     * And Setup stops claiming a session that is not there. `account` is null
     * both before the question is asked and when nobody is signed in; the old
     * line read "Signed in." for both, which is what the demo showed.
     */
    assert.ok(
      !settings.includes("'Signed in.'"),
      'Setup still says "Signed in." when there may be no account at all'
    )
    assert.match(settings, /setAsked\(true\)/, 'Setup answers before the account service has')
  })

  /*
   * A WAY IN THAT DOES NOT NEED A RUNNING COMPUTER.
   *
   * "Add login by email and password. I can't login to get my iPad
   * screenshots."
   *
   * The walkthrough's only door was a pairing code, and a pairing code comes
   * off a computer app that is running right now. Somebody already signed in
   * on another handset has no code and no way to say so — the walkthrough
   * offered them the demo and nothing else, which is being locked out of an
   * account they already have.
   *
   * It hands over to the sign-in screen rather than growing its own email and
   * password form: that screen already signs in, creates an account and
   * resets a password, and a second copy of all three would drift from it.
   */
  /*
   * THE EDIT SCREEN SAYS WHERE YOU ARE.
   *
   * "Can we show what preset name and scene they're on... maybe we don't even
   * say the word changes land on, just show the preset name and scene name
   * that they're currently on."
   *
   * It read "Changes land in scene 8 — Lead Mid…": three words explaining the
   * screen, then out of room for the part that identifies anything, and the
   * preset never named at all. Somebody deciding whether to save could not
   * tell from this screen what they were about to save over.
   */
  test('the Edit screen names the preset and the scene it is editing', () => {
    const edit = readFileSync(new URL('../mobile/src/screens/Edit.js', import.meta.url), 'utf8')

    /* The STRINGS, not the word anywhere in the file — the comment above the
       header quotes the old line, and a test that cannot tell a quotation
       from the thing itself makes the history unwritable. Same trap the
       coach mark's "Try it" comment fell into. */
    for (const gone of ["'Changes land in the preset'", 'Changes land in scene ${']) {
      assert.ok(
        !edit.includes(gone),
        'the Edit header still explains itself instead of saying where you are'
      )
    }
    assert.match(edit, /presetLabel\(preset\)/, 'the Edit header does not name the preset')
    assert.match(edit, /Scene \$\{scene \+ 1\}/, 'the Edit header does not name the scene')

    /* A unit with no scenes is not given a scene line to be wrong about. */
    assert.match(
      edit,
      /caps\?\.hasScenes === false \? null :/,
      'a unit without scenes is shown a scene line anyway'
    )

    /* And a preset still being read says nothing rather than "Untitled",
       the same dodge the Play screen uses. */
    assert.match(
      edit,
      /preset\?\.pending && !preset\?\.name \? '…'/,
      'a preset mid-read is named "Untitled" for a moment, which is a lie'
    )
  })

  test('the walkthrough lets somebody with an account in without a pairing code', () => {
    const onb = readFileSync(new URL('../mobile/src/screens/Onboarding.js', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../mobile/App.js', import.meta.url), 'utf8')

    assert.match(onb, /onAccount/, 'the walkthrough no longer offers an account')
    /* On the choice screen it is a footnote link now, not a full-width
       button — his mockup — so the shape to look for is the link's. */
    assert.match(
      onb,
      /label: P3\.signIn[^]{0,80}onAccount\?\.\(\)/,
      'the account button is gone from the pairing screen, or wired to something else'
    )
    assert.match(
      app,
      /onAccount=\{\(\) => \{[^]{0,200}setAuth\('out'\)/,
      'the account route no longer lands on the sign-in screen'
    )
    /* Marked seen on the way past, like every other exit. Sending somebody
       back to the start of a flow they just walked out of reads as the app
       forgetting what they did. */
    assert.match(
      app,
      /onAccount=\{\(\) => \{\s*markWalkthrough\(\)/,
      'walking out to the account screen does not mark the walkthrough seen'
    )

    /* And the screen it lands on really does take an email and a password. */
    const signIn = readFileSync(new URL('../mobile/src/screens/SignIn.js', import.meta.url), 'utf8')
    for (const needed of ['placeholder="Email"', 'placeholder="Password"', 'secureTextEntry']) {
      assert.ok(signIn.includes(needed), `the sign-in screen lost ${needed}`)
    }
  })

  /*
   * THE COACH MARK, AND THE PROMISE IN ITS OWN LAST LINE.
   *
   * "This tip appears here - exactly when the gesture becomes useful."
   *
   * So it is not a screen in the walkthrough and not a first-launch dialog.
   * It is drawn on Play, among the blocks, and only on a preset where the
   * hold it describes actually does something — which is the same condition
   * the grid uses to decide whether to wire the hold at all. Teaching a
   * gesture that is wired to `undefined` is worse than teaching nothing.
   */
  test('the channel tip waits for a preset where the hold does something', () => {
    const stage = readFileSync(new URL('../mobile/src/screens/Stage.js', import.meta.url), 'utf8')
    const coach = readFileSync(new URL('../mobile/src/components/Coach.js', import.meta.url), 'utf8')

    assert.match(
      stage,
      /const holdDoesSomething =[^\n]*chain === 'ok'[^\n]*blocks\.length > 0[^\n]*channels\?\.length > 1/,
      'the tip no longer waits for blocks with channels to hold'
    )
    assert.match(stage, /if \(!holdDoesSomething\) return undefined/, 'the tip is offered before the gesture works')
    assert.match(stage, /coachSeen\(\)\.then/, 'the tip no longer asks whether it has been seen')
    assert.match(stage, /markCoach\(\)/, 'the tip is not remembered, so it returns every launch')
    assert.match(
      stage,
      /if \(picking && coach\) closeCoach\(\)/,
      'the tip stays up after somebody has done the very thing it asked for'
    )

    /* Its own key. Sharing the walkthrough's would let finishing the
       walkthrough cancel a tip that had never been drawn. */
    const lib = readFileSync(new URL('../mobile/src/lib/coach.js', import.meta.url), 'utf8')
    assert.match(lib, /fractal\.coach\./, 'the tip lost its own storage key')
    assert.ok(
      !/fractal\.walkthrough/.test(lib),
      'the tip shares the walkthrough key, so finishing one silences the other'
    )

    /* And not one word of it is typed into the component. */
    assert.match(coach, /import \{ P5 \} from '\.\.\/lib\/onboarding'/, 'the tip stopped reading the copy file')
    for (const typed of ['Hold a block', 'Try it', 'QUICK TIP', 'Press and hold']) {
      assert.ok(
        !coach.includes(typed),
        `"${typed}" is typed into Coach.js, so his wording can drift from the copy file`
      )
    }
  })

}