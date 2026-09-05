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
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

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
     * Three screens now, and the things you open are sheets. The original of
     * this test existed because five panels named in the UI as Library spent
     * three releases rendering in Edit; the same mistake is now possible in a
     * new direction — setup leaking onto a screen you look at on a stage.
     */
    const play = components(view('play'))
    assert.deepEqual(play, ['Gig'], `Play should be the gig screen alone, not ${play.join(', ')}`)

    for (const name of ['Chain', 'ParamSearch', 'GridEditor', 'Modifiers']) {
      assert.ok(components(view('shape')).includes(name), `${name} should be on Shape`)
    }

    // Setup on the stage screen is how you change the host address by accident.
    for (const name of ['PhoneRemote', 'LinkDetails', 'ConnectScreen', 'SignInSheet', 'Ports', 'Diagnostics', 'LocalLibrary', 'Footswitches']) {
      assert.ok(!play.includes(name), `${name} is on Play`)
      assert.ok(!components(view('shape')).includes(name), `${name} is on Shape, not in a sheet`)
    }

    // And the sheets hold what was taken out of the views.
    for (const [title, names] of [
      ['Presets', ['PresetList', 'LocalLibrary', 'Backup', 'Versions', 'DeviceBackup']],
      ['Scenes', ['Scenes', 'SceneMatrix']],
      ['Setup', ['DeviceDetail', 'PhoneRemote', 'Ports', 'ChangeLog', 'Diagnostics', 'LinkDetails']]
    ]) {
      for (const name of names) {
        assert.ok(components(sheet(title)).includes(name), `${name} should be in the ${title} sheet`)
      }
    }
  })

  test('emptiness is judged on editable blocks, not raw count', () => {
    // An empty AM4 slot still reports input and output rows. Both hardware
    // failures of the chain builder were this gap wearing different errors:
    // "two blocks" skipped the build, then the schema filtered both out and
    // sent the generator nothing.
    const at = src.indexOf('const editableBlocks = blocks.filter')
    assert.notEqual(at, -1, 'the editable filter is gone')
    const guard = src.indexOf('if (editableBlocks.length === 0)')
    assert.notEqual(guard, -1, 'the build trigger no longer counts editable blocks')
    assert.ok(src.includes('const landed = (builtBlocks || []).filter'), 'the read-back guard lost its filter')
  })

  test('a fresh chain is designed against, never refined against', () => {
    // The lingering-spec path: a failed attempt stores its spec, the next ask
    // builds a chain, then refine runs against state that predates the build
    // and reports "No blocks were read from the device" while the chain sits
    // there, built and invisible.
    const at = src.indexOf('if (builtBlocks) {')
    assert.notEqual(at, -1, 'the build handoff no longer branches on builtBlocks')
    const window = src.slice(at, at + 400)
    assert.ok(window.includes('setResult(null)'), 'a stale spec survives the chain build')
    assert.ok(window.includes('await generate('), 'a built chain must go to generate')
    assert.ok(
      src.indexOf('await refine(') > at,
      'refine must only be reachable when nothing was built'
    )
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
      'Screens'
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

  test('the block editor arrives over the screen, not below it', () => {
    /*
     * It used to be the last row of the console grid. Tapping a block on a
     * phone therefore scrolled the thing you tapped off the top of the screen,
     * and the controls you asked for landed below the fold — which is the
     * whole reason the sheet exists. Nesting is the guarantee: a BlockPanel
     * rendered as a sibling of the chain again is the old bug returning.
     */
    const open = src.indexOf('<Sheet')
    assert.notEqual(open, -1, 'nothing opens as a sheet')
    const shut = src.indexOf('</Sheet>', open)
    assert.notEqual(shut, -1, 'the sheet is never closed')
    const inside = src.slice(open, shut)
    assert.ok(inside.includes('<BlockPanel'), 'the block editor is not inside a sheet')
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

  test('every class this app scrolls to exists somewhere that renders it', () => {
    /*
     * `.local-library` didn't. The stylesheet had a rule for it, the assistant
     * scrolled to it after keeping something in the library, and no component
     * ever rendered the class — so "show me what you changed" quietly did
     * nothing, and a silent scroll is indistinguishable from a dead button.
     *
     * Anchors are strings matched at runtime against a DOM built somewhere
     * else, which is exactly the seam a text test can hold shut.
     */
    const dir = new URL('../src/', import.meta.url)
    const files = []
    const walk = (at) => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), at)
        if (entry.isDirectory()) walk(next)
        else if (/\.(jsx?|css)$/.test(entry.name)) files.push(readFileSync(next, 'utf8'))
      }
    }
    walk(dir)
    const rendered = files
      .flatMap((body) => [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)])
      .flatMap((m) => (m[1] || m[2] || '').split(/[\s${}?:'"]+/))
      .filter(Boolean)

    const anchors = [
      ...[...src.matchAll(/querySelector\('\.([\w-]+)'\)/g)].map((m) => m[1]),
      ...[...src.matchAll(/anchor: '\.([\w-]+)'/g)].map((m) => m[1])
    ]
    assert.ok(anchors.length >= 5, 'the anchor scan found nothing to check')
    for (const name of new Set(anchors)) {
      assert.ok(rendered.includes(name), `nothing renders .${name}, so scrolling to it does nothing`)
    }
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

  test('every panel and every sheet is closed', () => {
    // SectionStack is gone with the drag-to-reorder it existed for; what is
    // left is the pairing, which a bad splice still breaks.
    assert.equal((src.match(/<Section /g) || []).length, (src.match(/<\/Section>/g) || []).length)
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
    const techStart = src.indexOf('key="technical-details"')
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

  test('the phone remote is honest about whether the Mac answered', () => {
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
      'presence is deciding whether the Mac is there again — it never tracks presence, so this is always "no"'
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
      /if \(remoteActive\(\) && !remoteHostSeen\(\) && !\(await hostResponds\(\)\)\) \{\s*\n\s*setStatus\('fault'\)/,
      'read() no longer bounds a dead relay — every call waits out 20–45 s before admitting the fault'
    )

    // The phone gets a connect screen, not an error; the Mac keeps the notice.
    assert.match(src, /const showConnect =\s*\n\s*link\.role === 'remote' &&/, 'the connect screen is no longer keyed to the phone role')
    assert.match(src, /\{showConnect \? \(\s*\n\s*<ConnectScreen/, 'the connect screen is no longer the phone’s screen when not connected')
    assert.match(src, /if \(showConnect && status === 'live'\) setStatus\('fault'\)/, 'Play is rendered under the connect screen again')
    assert.ok(!/onAnotherDevice/.test(src), 'the user-agent guess is back; the role decides now')

    // The bar draws the link from state, never from the module at render.
    const topbar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    const chip = readFileSync(new URL('../src/components/LinkChip.jsx', import.meta.url), 'utf8')
    assert.ok(!/remoteActive|remoteHostSeen/.test(topbar + chip), 'the bar reads the connection module at render again — it is only as fresh as the last unrelated re-render')
    assert.match(src, /note=\{describeLink\(link\)\.note\}/, 'the Setup note no longer says what the link is')
  })

  test('the phone is never shown the Mac’s error while the app works out which end it is', () => {
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
    assert.match(src, /if \(isDemo\(\) \|\| servedLocally\(\)\) \{\s*\n\s*read\(\)/, 'the Mac and the demo no longer read at once')
    assert.match(src, /if \(s\.role !== 'remote'\) read\(\)/, 'the phone reads the unit over localhost')

    // The words are chosen by role, in one tested place.
    assert.match(src, /faultCopy\(\{/, 'the fault notice writes its own copy again')
    assert.match(src, /status === 'fault' && fault \? \(/, 'a notice renders before the role is known')
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    assert.ok(!/Try Chrome/.test(code), 'the Safari sentence is back in App, shown to everyone')
    assert.ok(!/this Mac/.test(code), '"this Mac" is written in App, where the role cannot be checked')

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

  test('the chat carries the scene names and the live scene into the plan', () => {
    /*
     * CREATE could not use PLAY's scene names — "make the lead scene brighter"
     * came back with "I only have indexes" — and a plan aimed at scene 2 was
     * checked without knowing scene 3 was live, so it wrote to scene 3.
     */
    const at = src.indexOf("aiUrl('/api/command'")
    assert.notEqual(at, -1)
    const body = src.slice(at, at + 900)
    assert.match(body, /\n\s*scene,\s*\n\s*sceneNames,\s*\n\s*sceneCount/, 'the chat request no longer carries the scene names')
    assert.match(
      src,
      /validatePlan\(body, withPositions, \{ \.\.\.\(device\?\.capabilities \|\| \{\}\), activeScene: scene, sceneNames \}\)/,
      'the plan is checked without knowing which scene is live'
    )
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

  test('the tabs run Play, Create, Edit — and a swipe agrees', () => {
    /*
     * "Move the edit button to the right of create." You make a tone and then
     * adjust it, so that is the order. The swipe order is a separate list and
     * has to move with it, or a swipe left goes somewhere the eye did not.
     */
    const tabs = src.slice(src.indexOf("['play', 'Play']"), src.indexOf("].map(([id, label])"))
    const at = (id) => tabs.indexOf(`'${id}'`)
    assert.ok(at('play') < at('ask') && at('ask') < at('shape'), `the tabs are not Play, Create, Edit — ${tabs}`)
    const screens = readFileSync(new URL('../src/components/Screens.jsx', import.meta.url), 'utf8')
    assert.match(
      screens,
      /export const ORDER = \['play', 'ask', 'shape'\]/,
      'a swipe still moves between the screens in the old order'
    )
  })

  test('on a phone, Ask lives in the tab row, not over the controls', () => {
    /*
     * The floating Ask button sat over scene tile 6 on Play, the pad's
     * Change button and Edit's Modifiers on a phone — the bottom-right corner
     * is where the last control in every grid lands. On a phone it is a
     * fourth tab now; the floating button stays for wide screens, where
     * nothing sits under it.
     */
    const nav = src.slice(src.indexOf('<nav className="views"'), src.indexOf('</nav>'))
    assert.match(nav, /className="view-tab ask-tab"/, 'the tab row has no Ask')
    assert.match(nav, /onClick=\{\(\) => setSheet\('chat'\)\}/, 'the Ask tab does not open the conversation')
    assert.match(nav, /disabled=\{view === 'ask'\}/, 'the Ask tab offers to open what is already open on Create')
  })

  test('polish: sheets close with the screen, hand edits are the only "You:", and the rest', () => {
    const read = (f) => readFileSync(new URL('../src/components/' + f, import.meta.url), 'utf8')
    // A block sheet stayed open across a tab press and its scrim ate the first tap on the new screen.
    assert.match(src, /useEffect\(\(\) => setSheet\(null\), \[view\]\)/, 'a sheet no longer closes when the screen changes under it')
    // "You: Done — 3 changes." — the app's own narration wore the player's label.
    assert.equal((src.match(/role: 'hand'/g) || []).length, 1, 'hand edits are not the one producer of the hand role')
    assert.match(src, /t\.role === 'hand'\s*\n?\s*\? \{ role: 'user', text: `\(I did this by hand/, 'the model is no longer told which turns were hand edits')
    const assistant = read('Assistant.jsx')
    // "You: Named scene 4 Solo" — a hand edit is an event, not speech. Nothing in the transcript wears "You:".
    assert.ok(!/You:/.test(assistant), 'a "You:" prefix is back in the transcript')
    assert.match(assistant, /<p className="turn-text">\{turn\.text\}<\/p>/, 'the turn text is decorated')
    // Two narration sites were filed as hand edits: the app's own words about itself must pass fromAssistant.
    assert.match(src, /record\('grid', 'Built a chain into the empty slot', \[\], true\)/, 'the design’s own chain build is recorded as a hand edit')
    assert.match(src, /record\('library', `Kept locally, but not to your account — \$\{err\.message\}`, \[\], true\)/, 'a cloud-save failure is recorded as a hand edit')
    // The typed placeholder follows the reduced-motion setting live, through the one shared hook.
    assert.match(assistant, /import \{ useAsks \} from '\.\.\/lib\/asks'/, 'Assistant reads reduced motion once at mount again')
    assert.match(assistant, /useAsks\('\(prefers-reduced-motion: reduce\)'\)/)
    assert.match(read('Sheet.jsx'), /import \{ useAsks \} from '\.\.\/lib\/asks'/, 'Sheet keeps a private copy of the media hook')
    // Tour dots are controls or nothing; search hits announce as buttons.
    const tour = read('Tour.jsx')
    assert.match(tour, /<button[^>]*className=\{i === card \? 'tour-dot on' : 'tour-dot'\}/, 'the tour dots look like a control and are not one')
    assert.match(tour, /aria-label=\{'Step ' \+ \(i \+ 1\) \+ ' of ' \+ CARDS\.length\}/)
    const search = read('ParamSearch.jsx')
    assert.ok(!/role="list"|role="listitem"/.test(search), 'a search hit announces as a list item, not a button')
    /*
     * The search was mouse-only: no keys on the field, thirty tab stops to
     * the row you wanted. The field is a combobox driving a listbox now —
     * arrows move, Enter opens, Escape clears — and the rows sit outside the
     * Tab order. "Reading the blocks…" flickered because every keystroke
     * started another read of every block; one read per chain, debounced,
     * and the line only when a first read is taking its time.
     */
    assert.match(search, /role="combobox"/, 'the search field is not a combobox')
    assert.match(search, /aria-activedescendant=/, 'the active row is not announced')
    assert.match(search, /role="listbox"/, 'the hits are not a listbox')
    assert.match(search, /role="option"/, 'a hit is not an option')
    assert.match(search, /tabIndex=\{-1\}/, 'the hits are back in the Tab order')
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      assert.match(search, new RegExp(`e\\.key === '${key}'`), `${key} does nothing in the search`)
    }
    assert.match(search, /pending\.current\?\.key === chainKey/, 'a read already in flight is started again on the next keystroke')
    assert.match(search, /setTimeout\(\(\) => \{\s*ensureIndex\(\)/, 'the read is not debounced')
    assert.match(search, /slow && index === null \? <p className="hint mono">Reading the blocks/, 'the reading line still shows on every read, at once')
    assert.ok(!/index && !reading \?/.test(search), 'the hits are hidden again while a re-read runs')
    // The chain strip says when it scrolls — through the observer it now shares with the grid.
    const overflow = readFileSync(new URL('../src/lib/overflow.js', import.meta.url), 'utf8')
    assert.match(overflow, /el\.dataset\.overflow = /, 'the chain strip no longer says whether there is more to the right')
    assert.match(overflow, /new ResizeObserver\(look\)/)
    assert.match(read('Console.jsx'), /useOverflow\(strip/, 'the chain strip does not use the shared observer')
    // The account project is not something to type into Setup.
    const details = read('LinkDetails.jsx')
    assert.ok(!/<input/.test(details), 'the Supabase project fields are back in Setup')
    assert.ok(!/saveRemoteConfig/.test(details))
    assert.match(details, /Test the link/, 'the link test went with the fields')
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
    assert.match(mock, /keepSceneNames\(state\.sceneNames\)/, 'a demo rename is not kept')
    assert.match(mock, /sceneNames: storedSceneNames\(\) \|\|/, 'the demo does not read its kept names on load')
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
     * savedHere it lies, without !dirty it hides pending changes.
     */
    assert.match(
      save,
      /: !dirty && savedHere\s*\n?\s*\? 'Saved'/,
      'the button says "Saved" about a preset that has never been saved'
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
    assert.match(read('Console.jsx'), /useOverflow\(strip, \[chain\.length\]\)/, 'the chain strip keeps a private observer')
  })

  test('the model picker says its name, and Modifiers says what it needs', () => {
    const read = (f) => readFileSync(new URL('../src/components/' + f, import.meta.url), 'utf8')
    const console_ = read('Console.jsx')
    assert.ok(!/\{m\.basedOn \? ` — \$\{m\.basedOn\}` : ''\}/.test(console_), 'the model option carries the whole "based on" sentence again')
    assert.match(console_, /className="hint pad based-on">Based on \{basedOn\}/, 'what a model is based on is not shown under the picker')
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

  test('the introduction is offered once, and only when there is something to see', () => {
    /*
     * Two mistakes a tutorial can make, both of which turn it from help into
     * the thing people remember hating. It can arrive over a broken
     * connection, burying the one message that mattered and touring screens
     * that cannot be reached. And it can come back after being dismissed.
     */
    assert.match(
      src,
      /if \(status !== 'live' \|\| tourSeen\(\)\) return\s*\n\s*markTourSeen\(\)/,
      'the introduction no longer waits for a working connection, or no longer remembers being shown'
    )

    const tour = readFileSync(new URL('../src/components/Tour.jsx', import.meta.url), 'utf8')
    /*
     * Marked seen wherever it closes, not only where it finishes. The X, the
     * back gesture and a swipe down all arrive at Sheet's onClose, and all of
     * them mean "not now" — so onClose has to be the thing that records it,
     * rather than a Done handler the other three routes never touch.
     */
    assert.match(
      tour,
      /onClose=\{finish\}/,
      'closing the introduction any way but Done no longer counts as having seen it, so it comes back'
    )
    assert.match(tour, /const finish = \(\) => \{\s*\n\s*markTourSeen\(\)/, 'finish no longer records the visit')

    // The way forward keeps the same corner on every card. It was Done on the
    // left and Back on the right, so the fourth tap where the last three were
    // went backwards.
    assert.match(
      tour,
      /onClick=\{last \? finish : \(\) => setCard\(card \+ 1\)\}/,
      'the right-hand button is no longer the way forward on every card'
    )

    assert.match(src, /Show the introduction/, 'there is no way back to the introduction once it is dismissed')
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

  test('what the player has kept reaches the generator, and reaches them', () => {
    /*
     * Three links, and the feature is invisible if any one of them is missing
     * — which is the problem with it. A profile that is computed and never
     * sent, or sent and never shown, fails silently: generations carry on
     * looking plausible, and nobody can tell a personalised one from a
     * generic one by looking at it. Only the wiring can be checked cheaply,
     * so it is.
     */
    assert.match(
      src,
      /taste: describeProfile\(taste\)/,
      'the generation request no longer carries the taste profile — the whole feature is inert without this line, and nothing about a generation would look wrong'
    )
    assert.match(
      src,
      /suggestions=\{suggestionsFrom\(taste\)\}/,
      'the conversation no longer offers starting points from past work'
    )
    assert.match(
      src,
      /summariseProfile\(taste\)/,
      'the player can no longer see what has been inferred from their history'
    )
    assert.match(
      src,
      /setTasteEnabled\(!tasteOn\)/,
      'the switch that turns the profile off is gone — an inference drawn from someone’s history has to be refusable'
    )

    /*
     * Derived, not stored, and derived from the same list the player is shown.
     *
     * The moment this reads from a table it can disagree with the library it
     * claims to describe, and deleting a preset stops un-learning it. And the
     * moment it reads from a different set of presets than Create lists, the
     * profile becomes something the player cannot check against anything.
     */
    /*
     * Every store, merged at the point of use. Three now: this browser, the
     * account, and a chosen folder — which was the one that could swallow a
     * design whole, since picking a folder skips browser storage and nothing
     * ever listed what went in there.
     */
    assert.match(
      src,
      /const library = useMemo\(\s*\n\s*\(\) => newestFirst\(listPresets\(\), cloudSaves, folderSaves\)/,
      'the library is no longer every store merged at the point of use'
    )
    assert.match(
      src,
      /files\s*\n?\s*\.filter\(\(f\) => f\.kind === 'design'\)/,
      'the folder is never read, so designs kept there stay invisible'
    )
    assert.match(
      src,
      /profileFrom\(library\)/,
      'the profile is no longer read from the same list the player is shown'
    )
    assert.match(
      src,
      /entries=\{library\}/,
      'the Create screen no longer lists the library it learns from'
    )
  })

  test('earlier generations are one tap from where they were made', () => {
    /*
     * The most common recovery there is — "the one before this was better" —
     * used to be two taps away behind the bar, on a screen you had to leave to
     * reach. It belongs under the box that made it.
     *
     * Restoring goes through the same `reload` the presets sheet uses, which
     * validates the saved spec against whatever the unit has loaded now and
     * stops at the preview. A second path that wrote directly would be a way
     * to replay a design onto a chain it was never checked against.
     */
    assert.match(src, /<Recent\b/, 'the Create screen no longer lists what was generated')
    const call = src.slice(src.indexOf('<Recent'), src.indexOf('/>', src.indexOf('<Recent')))
    assert.match(call, /onRestore=\{reload\}/, 'restoring no longer goes through the validated reload path')

    /*
     * Create only. `chat` is one element rendered in two places, so anything
     * inside it appears in the Ask sheet too — and a library is the longest
     * thing that could be put in a surface whose whole point is being short.
     */
    assert.match(
      src,
      /\{status === 'live' && view === 'ask' \? \(\s*\n\s*<Recent/,
      'the list is no longer confined to the Create screen'
    )
  })

  test('the empty box offers the player their own past requests', () => {
    const assistant = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    /*
     * The personal suggestions have to join the rotation the empty box already
     * runs, not sit beside it. This app shipped a row of suggestion buttons
     * once and removed it — two copies of one list, and a wall of grey pills
     * between the box and the page. A guard here is cheaper than rediscovering
     * that.
     */
    assert.match(
      assistant,
      /\[\.\.\.own, \.\.\.SUGGESTIONS\]/,
      'the player’s own suggestions are no longer merged into the rotating placeholder'
    )
    assert.ok(
      !/suggestion-chip|suggestion-row|suggestions\.map/.test(assistant),
      'the row of suggestion buttons is back — it was removed on purpose'
    )
  })

  test('the conversation is written once and shown in two places', () => {
    /*
     * The Assistant now appears on Create as the screen and everywhere else in
     * a sheet. The tempting way to do that is to write the tag twice, and it
     * carries eleven props plus six children — so the second copy drifts, and
     * what drifts is a conversation that behaves differently depending on how
     * it was opened. Nobody tests both routes; they test the one they used.
     *
     * So: exactly one `<Assistant` in the file, hoisted into a variable, and
     * both render sites reach for that variable.
     */
    const tags = src.match(/<Assistant[\s>]/g) || []
    assert.equal(
      tags.length,
      1,
      `${tags.length} <Assistant> tags in App.jsx — the conversation must be built once and rendered by reference`
    )
    assert.match(src, /const chat = /, 'the hoisted conversation is gone')
    assert.match(
      src,
      /\{view === 'ask' \? chat : null\}/,
      'Create no longer renders the hoisted conversation'
    )
    assert.match(
      src,
      /\{sheet === 'chat' \? chat : null\}/,
      'the chat sheet no longer renders the hoisted conversation — and mounting it unconditionally would leave a second live turn list behind Create'
    )

    // The way in, on the screens that are not already it.
    assert.match(src, /className="ask-anywhere"/, 'the button that opens the chat from elsewhere is gone')
    assert.match(
      src,
      /status === 'live' && view !== 'ask' \? \(/,
      'the ask button no longer hides on Create, where it would offer to open what is open'
    )
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
      'nothing asks whether this browser could host, so the demo cannot tell a Mac from a phone'
    )

    /*
     * The bar's chip is the live path — Setup's panel already refuses in the
     * demo (`cloud?.demo`), and the reported screenshot came from tapping the
     * chip. It must not offer a setup that calls a helper this end cannot have.
     */
    assert.match(
      chip,
      /link\.canHost/,
      "the bar offers the Mac's setup without asking whether this end could ever be one"
    )
    assert.match(
      chip,
      /'leave-demo'/,
      'the bar has no way out of the demo, which is how a phone got stuck wearing the Mac’s screen'
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
      'leaving the demo does not reload, so the phone goes on believing it is the Mac'
    )
  })

  test('the working line is drawn once, and carries the clock', () => {
    /*
     * There were three of them on screen at the same time, and a photograph of
     * it is what made this a bug rather than a quibble:
     *
     *     Sent to the model - waiting for the first line...
     *   ||| Sent to the model - waiting for the first line...
     *   ..| Waiting on the model - 27s
     *
     * Assistant printed `progress` plainly, App printed the identical string
     * again inside <Thinking>, and App then hand-built a second copy of
     * Thinking's own meter bars around <Stages>, which counted. Nothing was
     * wrong with any one of them; there were simply three.
     *
     * These three assertions are those three lines. The bars belong to one
     * component, so no caller may draw its own; the message belongs to that
     * component, so the transcript may not print it; and the clock has to reach
     * it, or the merge would have thrown away the only thing the third line
     * knew that the other two did not.
     */
    const assistant = readFileSync(
      new URL('../src/components/Assistant.jsx', import.meta.url),
      'utf8'
    )
    assert.ok(
      !/>\s*\{progress\}\s*</.test(assistant),
      'the transcript prints the progress message itself again - <Thinking> already says it, one line lower'
    )
    assert.ok(
      !/className="thinking-bars"/.test(src),
      'App draws its own copy of the working line - the bars belong to <Thinking>, and a second set of them is a second line saying the same thing'
    )
    assert.match(
      src,
      /<Thinking message=\{progress\} active=\{thinking\} startedAt=\{genStarted\} \/>/,
      'the one working line has lost the elapsed clock, which was the only thing the third line knew that the other two did not'
    )

    /*
     * And it says which of the two waits is running. The server sends a hello
     * before it asks the model anything, so this line changing at all is proof
     * to the person watching that the round trip works — which is most of what
     * anyone staring at a long wait actually wants to know. Dropped, the line
     * would sit on "Reaching the server…" for the whole generation and say
     * something false for most of it.
     */
    assert.match(
      src,
      /e\.kind === 'open'\) setProgress\(/,
      "the working line ignores the server's hello, so it claims to be reaching the server long after it has"
    )
  })

  /*
   * What the app tells the AI about the hardware.
   *
   * For a long time it told it something false: that a scene changes only what
   * is switched on, and that every scene shares one set of values. Both routes
   * said it, the tour taught it, and the chat refused legitimate asks because
   * of it — while this app's own device layer had the truth written down the
   * whole time ("bypass and channel are per-scene on this hardware — that IS
   * what a scene is"). A scene remembers a channel per block, and a channel
   * holds its own model and its own values, which is the mechanism scenes
   * exist for. This is the guard that keeps the instructions honest.
   */
  test('the AI is not told that scenes share one set of values', () => {
    const generate = readFileSync(new URL('../api/generate.js', import.meta.url), 'utf8')
    const command = readFileSync(new URL('../api/command.js', import.meta.url), 'utf8')

    for (const [name, text] of [['generate', generate], ['command', command]]) {
      assert.ok(
        !/shared by every scene|Every scene shares|values are shared/i.test(text),
        `${name} still tells the model every scene shares one set of values`
      )
      assert.ok(
        !/cannot give a scene its own|not a hotter amp/i.test(text),
        `${name} still tells the model a scene cannot have its own amp`
      )
      assert.match(text, /channel/i, `${name} says nothing about channels at all`)
    }

    // And the designer can actually say it: a channel per block, and a channel
    // per block per scene.
    assert.match(
      generate,
      /channel: z\s*\n?\s*\.string\(\)/,
      'the block spec has no channel, so values can only ever be written to the one the block is on'
    )
    assert.match(
      generate,
      /channels: z\s*\n?\s*\.array\(/,
      'a scene cannot name the channels it plays'
    )
  })

  /*
   * What the app tells the AI about levels.
   *
   * Levels were withheld outright, and the model was never told — so asked for
   * a lead sound louder than the rhythm one it argued rather than declining:
   * "I told the AI the amp should be louder when it's on than when it's off and
   * it told me I was wrong." A rule it cannot see is a rule it will talk its
   * way around. Both routes must now name the window, so a refusal it does hit
   * is one it can explain.
   */
  test('the AI is told what it may do with a level, not left to guess', () => {
    const generate = readFileSync(new URL('../api/generate.js', import.meta.url), 'utf8')
    const command = readFileSync(new URL('../api/command.js', import.meta.url), 'utf8')

    for (const [name, text] of [['generate', generate], ['command', command]]) {
      assert.ok(
        !/Do not set anything named Level|never set .*\bLevel\b/i.test(text),
        `${name} still tells the model levels are off limits, which is no longer true`
      )
      assert.match(
        text,
        /Level you may move, but only a little/,
        `${name} does not tell the model a level may be nudged`
      )
      assert.match(
        text,
        /bottom fifth/,
        `${name} names no floor, so the model cannot say why a request was refused`
      )
    }
  })

  /*
   * The learning loop is wired end to end, or it is theatre.
   *
   * Every piece of this can be present and the feature still do nothing: a
   * knob editor that reports a sentence and not the numbers, a recorder nobody
   * calls, a summary the request body never carries. Each of those failures
   * looks exactly like success from the outside — the panel fills up, the
   * generations do not change — which is why this checks the whole chain
   * rather than the ends of it.
   */
  test('what the player fixes by hand reaches the next generation', () => {
    const console_ = readFileSync(new URL('../src/components/Console.jsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const api = readFileSync(new URL('../api/generate.js', import.meta.url), 'utf8')

    // The knob editor hands over the numbers, not just the sentence.
    assert.match(
      console_,
      /onChanged\(`\$\{block\.name\} · \$\{p\.name\} → \$\{next\}`, \{/,
      'a hand change reports a sentence and drops the before-and-after that makes it useful'
    )

    // The app records one, and only against a generation it just wrote.
    assert.match(app, /rememberCorrection\(change\)/, 'nothing records a correction')
    assert.match(
      app,
      /if \(applied && change && tasteOn\)/,
      'a knob turned on the player own preset is counted as correcting the model'
    )
    assert.match(app, /rememberNote\(instruction\)/, 'the words used to correct a tone are thrown away')

    // And it travels.
    assert.match(app, /corrections: tasteOn \? describeCorrections\(corrections\) : ''/, 'the summary never leaves the app')
    assert.match(api, /corrections,/, 'the endpoint does not read it')
    assert.match(api, /\(fixes \? `\\n\\n\$\{fixes\}` : ''\)/, 'the endpoint reads it and never puts it in the prompt')

    // Switched off with the rest of it, and visible where the rest of it is.
    assert.match(app, /summariseCorrections\(corrections\)/, 'the player cannot see what is being sent about them')
    assert.match(app, /Forget what I keep fixing/, 'there is no way to erase it')
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
   * "Is the generation just generating one scene? … And what happens to the
   * other three scenes if it's a new empty preset?"
   *
   * The answer was: one scene, into whichever was live, and the others were
   * left — but nothing on the screen said any of that, and nothing asked. A
   * preset where no scene is named has nothing to lose, so that is the moment
   * to ask; a preset that is laid out needs to be told which of its scenes is
   * about to be written over, by name.
   */
  test('a build says which scenes it writes and which it writes over', () => {
    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
    assert.match(gen, /const overwritten =/, 'nothing works out which scenes already have names')
    assert.match(gen, /Overwrites \$\{list\(overwritten/, 'the preview never says what is being written over')
    assert.match(
      gen,
      /left exactly as/,
      'the preview never says what happens to the scenes the plan does not touch'
    )
    assert.match(gen, /replaces \$\{nameOf\(scene\.index\)\}/, 'a scene row does not say what it replaces')
  })

  test('a preset with nothing laid out is asked before it is built', () => {
    assert.match(
      src,
      /const nothingLaidOut = \(\) => !sceneNames\.some/,
      'nothing decides whether this preset has anything to lose'
    )
    assert.match(
      src,
      /if \(opts\.wantScenes === undefined && sceneCount > 1 && nothingLaidOut\(\)\) \{\s*\n\s*setSceneAsk/,
      'the build no longer stops to ask on a preset with no scenes named'
    )
    // Asked before the model runs, so the answer costs one generation, not two.
    assert.match(
      src,
      /requestSpec\(schema, description, null, \{ wantScenes: opts\.wantScenes \}\)/,
      'the answer never reaches the model, so asking changed nothing'
    )
    const api = readFileSync(new URL('../api/generate.js', import.meta.url), 'utf8')
    assert.match(api, /wantScenes/, 'the designer route ignores the answer')
    assert.match(api, /SET OF SCENES/, 'a request for a set is not made plain to the model')
    assert.match(api, /ONE SOUND/, 'a request for one sound is not made plain to the model')
    assert.match(api, /Name every scene you return/, 'the model is not told to name the scenes it makes')
  })

  test('naming the preset is its own decision', () => {
    /*
     * Applying a generation renamed the slot as a side effect, so laying a set
     * of scenes into a preset you had already named renamed it underneath you.
     * The scene names still go on — they are what the footswitch shows.
     */
    assert.match(
      src,
      /if \(renamePreset && generatedName/,
      'the preset is renamed whatever the player chose'
    )
    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
    assert.match(gen, /className="rename-choice"/, 'there is no way to decline the rename')
    assert.match(
      gen,
      /scene names are written either way/i,
      'declining the rename does not say what still happens'
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
    assert.match(grid, /const doubtful = \(res\)/, 'nothing says what ok:false actually means here')
    assert.match(grid, /re-read/, 'the answer to a doubtful write is not to re-read the chain')
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
    assert.match(grid, /const label = \(col\) => col \+ 1/, 'the only place that counts from one should be the label')
    assert.match(grid, /placeBlock\(1, i, block\.page\)/, 'the starter chain starts one column late')
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
  test('both ways in are offered, and the local one says what it costs', () => {
    /*
     * "Currently can a user login if they're just on the same network without
     * signing in to the online account? If not, there should be two options —
     * one just to sign in and control the device and use local browser
     * storage… and then there should be a cloud login where they can save all
     * their stuff between devices."
     *
     * They could, and it worked: a phone on the page the Mac serves needs no
     * account at all. Every word about it lived behind servedLocally(), which
     * is to say it was only ever shown to someone already there. The hosted
     * screen offered exactly one route.
     */
    const connect = readFileSync(new URL('../src/components/ConnectScreen.jsx', import.meta.url), 'utf8')
    assert.match(connect, /className="connect-local"/, 'the hosted screen offers only the account route')
    assert.match(connect, /no account/i, 'the local route does not say the thing that makes it a choice')
    assert.match(connect, /stays\s+on this phone/i, 'nothing says where the settings live on the local route')
    assert.match(connect, /follow you\s+to any device/i, 'nothing says what signing in buys')
    // And it goes somewhere: an address typed in lands on the Mac's own page.
    assert.match(connect, /window\.location\.href = `http:\/\//, 'the address typed in goes nowhere')
    assert.match(connect, /:5056/, 'a bare hostname is not given the port the Mac serves on')
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

  test('the Mac app can actually install what it downloads', () => {
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
    assert.match(
      flow,
      /inputs\.publish && github\.ref == 'refs\/heads\/main'/,
      'a branch build could publish a release tagged against main'
    )
  })

  test('the newest thing in the chat is at the bottom', () => {
    /*
     * "It puts recent messages above the generated tones, which is weird. Most
     * recent generations should be at the bottom of the chat. Shouldn't have to
     * scroll to find what was just talked about."
     *
     * The design was rendered after every turn, which pinned it to the bottom
     * of the log for good — so anything said afterwards appeared above it, and
     * the newest thing on screen was an old design. It is placed where it
     * happened instead: after the turns that existed when it started, and above
     * everything said since.
     */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    assert.match(a, /const before = turns\.slice\(0, cut\)/, 'the log does not split around the design')
    assert.match(a, /const since = turns\.slice\(cut\)/, 'nothing renders below the design')
    assert.match(a, /since\.map/, 'turns said after the design are dropped')

    // One renderer, so a turn below the design keeps its confirm buttons.
    assert.match(a, /const renderTurn = /, 'the turn markup is duplicated and will drift')
    assert.equal(
      (a.match(/className="turn-confirm"/g) || []).length,
      1,
      'a pending turn is drawn twice, or only on one side of the design'
    )

    // And App has to say when the design started, or the split is always a no-op.
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(app, /setGenAt\(turns\.length\)/, 'nothing records where the design belongs')
    assert.match(app, /at=\{genAt\}/, 'the chat is never told where the design belongs')
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

  test('an empty preset reaches the model instead of being refused', () => {
    /*
     * "Still need to fix the issue when generating on an empty preset."
     *
     * One guard clause defeated a feature that was already finished. buildChain
     * exists precisely to lay a chain into an empty preset; the instructions
     * already explain it, and already say that a tone description on an empty
     * preset is still designTone because the chain is put there first. None of
     * it could run: the request was refused before the model was ever asked.
     *
     * So the route checks the shape of `blocks` and not its length. The length
     * check is the defect, which is why it is named here rather than described.
     */
    const command = readFileSync(new URL('../api/command.js', import.meta.url), 'utf8')
    assert.ok(
      !/blocks\.length === 0/.test(command),
      'an empty preset is refused before the model can offer to build a chain'
    )
    assert.match(command, /if \(!Array\.isArray\(blocks\)\)/, 'the shape of blocks is no longer checked at all')

    // And the instructions that make it work have to still be there.
    assert.match(command, /buildChain places blocks into it/, 'the model is not told how to fill an empty preset')
    assert.match(
      command,
      /still just designTone/,
      'the model is not told that a tone on an empty preset builds the chain first'
    )
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

  test('the chat keeps moving while a tone is being built', () => {
    /*
     * "When generating a new tone the suggestion typewriter stops and freezes.
     * Can we keep the live suggestions going? Maybe queue messages sent while
     * generating?"
     *
     * The suggestions stopped on `busy`, which is the whole of a generation —
     * so the one moment nothing else is happening on screen is the moment the
     * screen went still, and a thirty-second wait looked like a hang. And
     * sending returned early while busy with the box disabled, so a thought
     * had mid-run was simply dropped.
     */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    assert.match(
      a,
      /useTypedSuggestion\(!text && !focused, suggestions\)/,
      'the suggestions still freeze for the whole of a generation'
    )

    // What is typed mid-run is kept, and goes one at a time afterwards.
    assert.match(a, /if \(busy\) \{\s*\n\s*setQueue/, 'anything sent mid-generation is still dropped')
    assert.match(a, /const \[next, \.\.\.rest\] = queue/, 'the queue is not drained one at a time')
    assert.match(a, /ask\.current\(next\)/, 'the queue is drained through a changing function identity')
    assert.match(a, /turn-queued/, 'what is waiting is never shown, so it looks ignored')

    // And the box stays usable, or there is nothing to queue with.
    const box = a.slice(a.indexOf('className="refine-input"') - 400, a.indexOf('className="refine-input"') + 400)
    assert.ok(!/disabled=\{busy\}/.test(box), 'the box is still disabled while the model works')
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

  test('the tour teaches what a scene actually is', () => {
    const tour = readFileSync(new URL('../src/components/Tour.jsx', import.meta.url), 'utf8')
    const card = tour.slice(tour.indexOf('Scenes are one rig'), tour.indexOf('Scenes are one rig') + 1200)
    assert.match(card, /channel/i, 'the scenes card never mentions channels, which is what a scene remembers')
    assert.ok(
      !/every scene shares/i.test(card),
      'the scenes card still teaches that every scene shares one set of values'
    )
    assert.ok(
      !/rather than a\s*\n?\s*hotter amp|not a hotter amp/i.test(card),
      'the scenes card still says a lead scene cannot have a hotter amp'
    )
  })
}
