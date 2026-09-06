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
    /*
     * Three shapes, because a class written the fourth way is invisible here
     * and reports a live anchor as dead. `className={cond ? 'a' : 'b'}` used to
     * be that fourth way: a real rule, really rendered, and this scan could not
     * see either name in it.
     */
    const rendered = files
      .flatMap((body) => [
        ...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)
      ])
      .flatMap((m) => (m[1] || m[2] || m[3] || '').split(/[\s${}?:'"`]+/))
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

  test('there is one conversation and one name for it', () => {
    /*
     * "It says Create, and then Ask on the same page, which kind of defeats the
     * purpose of having multiple chat bots."
     *
     * There is one bot. It was listed twice: the Create tab rendered `chat` and
     * `tones`, and a fourth ✦ Ask tab opened those same two elements in a
     * sheet — greying itself out on Create, because there was nothing left to
     * open. The screen carries the name and the ✦ now, and the duplicate is
     * gone.
     *
     * On a phone the tab row is the way in (the floating button is hidden there
     * because it sat over the controls). On a wide screen the floating button
     * still opens the sheet from Play and Edit, where nothing is under it.
     */
    const nav = src.slice(src.indexOf('<nav className="views"'), src.indexOf('</nav>'))
    assert.ok(
      !/ask-tab/.test(nav),
      'the duplicate Ask tab is back — it opens the conversation the Ask screen already is'
    )
    assert.match(nav, /\['ask', '✦ Ask'\]/, 'the conversation screen is not called Ask in the tab row')
    assert.equal(
      (nav.match(/\['(play|ask|shape)',/g) || []).length,
      3,
      'the tab row is no longer three screens'
    )
    // And the sheet route survives for the screens that are not the conversation.
    assert.match(
      src,
      /view !== 'ask' \? \(\s*\n?\s*<button\s*\n?\s*className="ask-anywhere"/,
      'the floating Ask button no longer opens the conversation from Play and Edit'
    )
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    assert.ok(
      !/button\.ask-tab \{/.test(styles),
      'the removed tab still has styling, which will dress up the next thing given that class by accident'
    )
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
    // The wording moved when keeping became a thing that happens at generation
    // rather than after a write. What the guard is actually for is the trailing
    // `true` — this is the app talking about itself, not a hand on the unit.
    assert.match(src, /record\('library', `[^`]*\$\{err\.message\}`, \[\], true\)/, 'a cloud-save failure is recorded as a hand edit')
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
     * the save itself it lies, without !dirty it hides pending changes.
     */
    assert.match(
      save,
      /: !dirty && justSaved\s*\n?\s*\? 'Saved'/,
      'the button says "Saved" about a preset that has never been saved'
    )
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
    assert.match(read('Console.jsx'), /useOverflow\(strip, \[chain\.length\]\)/, 'the chain strip keeps a private observer')
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
    /*
     * Rendered by reference on Create, wrapper or no wrapper. What this is
     * really holding is that there is one conversation and both places show
     * the same element — a second copy behaves subtly differently depending on
     * how it was opened, which nobody would think to check.
     */
    assert.match(
      src,
      /view === 'ask' \? (<div className="chat-screen">\{chat\}<\/div>|chat) : null/,
      'Create no longer renders the hoisted conversation'
    )
    /*
     * Still by reference, still only while open. The sheet now shows the
     * conversation and the tones under it — the same pair, in the same order,
     * as Create — so a tone asked for from the sheet is not invisible until you
     * walk to another screen.
     */
    assert.match(
      src,
      /\{sheet === 'chat' \? \(\s*<>\s*\{chat\}\s*\{tones\}\s*<\/>\s*\) : null\}/,
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
      /e\.kind === 'open'\)\s*\n?\s*setProgress\(/,
      "the working line ignores the server's hello, so it claims to be reaching the server long after it has"
    )
    /*
     * And it says which attempt is running. A quiet start is retried once, and
     * the retry used to announce itself only for the second before this hello
     * overwrote it — so two ninety-second waits read as one that never ended:
     * "said working on tone for over 3 minutes then just disappeared".
     */
    // Not the literal sentence — the wording moved to "Thinking… (second try)"
    // when the vague lines were cut. What has to hold is that `e.attempt` still
    // picks a different message, and that the difference names the retry.
    assert.match(
      src,
      /e\.attempt \? [^\n]*second try/i,
      'the second attempt looks exactly like the first, so a three-minute wait looks like a hang'
    )
  })

  test('the chat box is tall enough for the suggestion in it', () => {
    /*
     * "Chat box cuts off second line text."
     *
     * The box sizes itself from `scrollHeight`, which answers for a textarea's
     * VALUE — and a placeholder is not a value. So a suggestion long enough to
     * wrap ("Warm clean with a bit of shimmer" does, on a phone) was drawn into
     * a box one line tall and lost its second line: the invitation to type was
     * the one thing you could not read.
     *
     * Two halves, and both are needed. The measurement has to borrow the
     * suggestion as a value to have anything to measure, and it has to depend
     * on it so it runs again when the suggestion changes — the old effect
     * watched `text` alone, which never changes while the placeholder rotates.
     */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    assert.match(
      a,
      /const borrow = text \? null : `\$\{typedFull\}/,
      'the empty box is measured against nothing again, so a wrapping suggestion is clipped'
    )
    assert.match(
      a,
      /\}, \[text, typedFull\]\)/,
      'the height is not recomputed when the suggestion changes, so it fits only the first one'
    )
    // And the full line is what it measures, not the part typed so far —
    // otherwise the box gains a line mid-animation and the page jumps.
    assert.match(
      a,
      /return \{ shown: text, full \}/,
      'the hook no longer reports the whole suggestion, so the box can only chase the animation'
    )
    // The borrowed value must go back, or React's controlled field is left
    // holding a suggestion the player never typed.
    assert.match(
      a,
      /if \(borrow !== null\) el\.value = ''/,
      'the borrowed value is never given back, so the box fills with its own placeholder'
    )
  })

  test('a line that cannot say what it is doing says only that', () => {
    /*
     * "Instead of saying working out what that means just say Thinking whenever
     * it's not saying exactly what it's doing."
     *
     * Two kinds of woolliness went. `setProgress('Working out what that
     * means...')` is the one that was reported. The other was quieter and
     * worse: LiveGeneration carried eight STAGES on a three-second timer —
     * "Choosing an amp", "Shaping the EQ" — that nothing consulted the model
     * about. They read as progress and were a script, so the line claiming to
     * choose a cabinet appeared whether or not one was ever touched.
     *
     * The specific lines are not covered by this and must not be: "Reading X of
     * Y", "Building your chain — 3 blocks so far" and "Verifying …" are counts
     * of things that really happened.
     */
    const live = readFileSync(
      new URL('../src/components/LiveGeneration.jsx', import.meta.url),
      'utf8'
    )
    assert.match(live, /export const THINKING = 'Thinking'/, 'the one honest holding line is gone')
    assert.ok(
      !/const STAGES = \[/.test(live),
      'the scripted stage list is back — it advances on a timer and reports work nobody checked'
    )
    assert.ok(
      !/Working out what that means/.test(src),
      'the reported line is still there'
    )
    assert.ok(
      !/working on your tone/i.test(src),
      'a second woolly line is still there, saying nothing the lines around it do not'
    )
    // The specific ones survive, or this went too far.
    assert.match(src, /Building your chain/, 'the real block count stopped being reported')
    assert.match(src, /Verifying \$\{name\}/, 'the real verify count stopped being reported')
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
   * One fold per thing, and the empty case in a player's words.
   *
   * Opening FOOTSWITCHES in Setup showed a lone "Hide footswitches" button —
   * a second fold inside the section that is already a fold, offering to hide
   * something that was not being shown — and under it "This unit reported a
   * footswitch model but no per-switch detail", which is a sentence about a
   * wire protocol. On an FM3 that empty case is the normal one, so it is what
   * most people will ever see here.
   */
  test('the footswitch panel does not fold inside its own fold', () => {
    const fc = readFileSync(new URL('../src/components/Footswitches.jsx', import.meta.url), 'utf8')
    /*
     * Matched against the code, not the prose: the comment above the component
     * quotes the old label to explain why it went, and a guard that reads its
     * own explanation as the defect is a guard that can never pass.
     */
    const code = fc
      .slice(fc.indexOf('export default function'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/setOpen|Hide footswitches/.test(code), 'the inner toggle is back inside the Setup section')
    assert.ok(!/per-switch detail/.test(code), 'the empty case is written for whoever wrote it')
    assert.match(
      fc,
      /doesn&rsquo;t tell this app what each one is set to/,
      'a unit that will not report its switches says nothing a player can use'
    )
    // And the section still only appears where the unit has switches at all.
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(
      app,
      /capabilities\?\.fc\?\.model !== false \? \(/,
      'the panel is offered on units that have no footswitches to report'
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
      'the Mac is being asked again — a question whose only right answer is no'
    )
    assert.ok(
      !/setAskedSave/.test(app),
      'the state behind that notice is back'
    )
    // Both dead ends report to the phone, and say which one it was.
    const watcher = app.slice(app.indexOf('const req = await takeParkedSave()'))
    assert.match(watcher, /reportSave\(\{/, 'a request the Mac cannot carry out leaves the phone waiting for ever')
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
   * On the bar, where it can be read without opening anything — and not on a
   * phone, where the bar has no room to give: a long preset name is already
   * clipped at 390px, and this measured as costing it nothing only because
   * there is slack at desktop widths.
   */
  test('the version is on the main screen, and not where the bar is full', () => {
    const bar = readFileSync(new URL('../src/components/TopBar.jsx', import.meta.url), 'utf8')
    assert.match(bar, /className="topbar-version mono"/, 'the version is only in Setup again')
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const rule = css.slice(css.indexOf('.topbar-version'))
    assert.match(
      rule.slice(0, 400),
      /max-width: 620px[\s\S]{0,120}\.topbar-version[\s\S]{0,60}display: none/,
      'the version takes room from the preset name on a phone'
    )
  })

  /*
   * A generated tone is a card, not pages.
   *
   * "The generated tones take up pages of the chat box, maybe we can just list
   * those under it after they generate?" They did: a six-block preset is a
   * couple of thousand pixels of parameter rows, scene plan, cost and trace,
   * rendered inside a chat log 340 pixels tall. Measured after this change it
   * is 200px on a desktop and 296px on a phone — 12-15% of what it hid.
   */
  test('a tone answers as a card with its detail folded', () => {
    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
    assert.match(gen, /<details className="preview-detail">/, 'the whole tone is on the page again')
    assert.match(gen, /className="preview-count mono"/, 'the card does not say how much it changes')
    // A rejection is never folded away without a word on the card.
    assert.match(gen, /className="preview-refused"/, 'settings can be rejected and never mentioned')

    /*
     * What may never be folded: a decision, or a consequence.
     *
     * The bulk is the diff — thirty-odd rows nobody reads unless a tone
     * surprised them. Everything with a consequence stays on the card: what it
     * will rename, which scene the bypasses land in, which scenes get written
     * over. Those were put in front of people deliberately by earlier work,
     * and a decision behind a fold is a decision made for you.
     */
    const card = gen.slice(
      gen.indexOf('<div className="preview-head">'),
      gen.indexOf('<details className="preview-detail">')
    )
    assert.match(card, /preset-name/, 'the name is behind the fold')
    assert.match(card, /preview-actions/, 'the buttons are behind the fold')
    assert.match(card, /rename-choice/, 'the rename decision is behind the fold')
    assert.match(card, /write-target/, 'which scene the bypasses land in is behind the fold')
    assert.match(card, /scene-plan/, 'what gets written over is behind the fold')

    // And what is folded is the bulk, not the decisions.
    const folded = gen.slice(gen.indexOf('<details className="preview-detail">'))
    assert.match(folded, /className="diff"/, 'the diff is not what is folded')

    /*
     * And the cost and the trace ride inside it rather than stacking beside it.
     * Every card, not the first one found: there is more than one <Preview> in
     * App now — the live tone and each one kept in the conversation — and a
     * card that stacks its cost beside itself is the same regression whichever
     * of them does it.
     */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const cards = app.split('<Preview').slice(1).map((part) => part.slice(0, part.indexOf('</Preview>')))
    assert.ok(cards.length >= 2, 'the tones kept in the conversation are not drawn as cards')
    for (const card of cards) {
      assert.match(card, /<Cost\b/, 'the cost is a panel of its own beside the tone again')
      assert.match(card, /<DevTrace\b/, 'the trace is a panel of its own beside the tone again')
    }
  })

  test('every tone is kept, listed under the conversation, and cannot write', () => {
    /*
     * "Don't show the preset generation inside of the chat box — show it below
     * it separately, just like the LP Meteora. Have it in a collapsible
     * drop-down, but expanded by default after the tone is generated, and have
     * buttons to send it in there. The chat box should pretty much be just the
     * chats going back and forth."
     *
     * Two properties, and they are separable. Where the tones live is this
     * report. That none of them is destroyed by asking for another was the
     * one before it, and moving them must not quietly undo it.
     */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')

    /* Nothing is destroyed: four paths used to drop the live tone and all four
       keep it — a new generation, a refinement, loading a saved design over it,
       and Discard. */
    const kept = (app.match(/\bkeep\((?:shelved\(\)|replacing)\)/g) || []).length
    assert.ok(kept >= 4, `only ${kept} of the four paths keep the tone they replace`)

    /* And they are under the conversation rather than between its turns. */
    const tones = app.slice(app.indexOf('const tones ='), app.indexOf('const chat = status'))
    assert.ok(tones.length > 200, 'the tones are no longer built as a panel of their own')
    assert.match(tones, /<Section/, 'a tone is not something you can fold away')
    assert.match(tones, /defaultOpen/, 'a tone arrives folded shut, so it looks like nothing happened')
    /* Re-keyed per run: <details open> is a starting state, so a second tone
       would arrive inside a panel somebody had folded and be invisible. */
    assert.match(tones, /key=\{`tone-\$\{genAt\}-\$\{past\.length\}`\}/,
      'the panel is not re-keyed, so only the first tone opens itself')

    /* The conversation carries speech and the working line, and no tone. */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    assert.ok(!/designs/.test(a), 'the conversation is drawing tones between its turns again')
    assert.ok(!a.includes('turn-result'), 'a tone is still dressed as a reply inside the log')

    /*
     * The one that matters most, unchanged by the move: a card from three
     * requests ago describes a preset the app has since moved past, so a Send
     * button on it is an offer to overwrite whatever came after.
     */
    const past = tones.slice(tones.indexOf('past].reverse()'))
    assert.ok(past.length > 100, 'the kept tones are no longer listed')
    for (const handler of ['onApply', 'onDiscard', 'onScene', 'onWithScenes', 'onRenamePreset']) {
      assert.ok(!past.includes(handler), `a tone from earlier can still ${handler} — it would write the wrong preset`)
    }

    /* And the card itself offers nothing to press once it has an outcome. */
    const bare = gen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const head = bare.slice(bare.indexOf('{outcome ? ('), bare.indexOf(') : ('))
    assert.match(head, /preview-outcome/, 'a tone that has been answered does not say what happened to it')
    assert.ok(!head.includes('<button'), 'a tone that has been answered still offers a button')

    /* The scene names are the ones it was asked against, not whatever they
       have since been renamed to — the card is a record of a moment. */
    assert.match(app, /sceneNames=\{entry\.sceneNames\}/, 'a kept tone reads the live scene names')
  })

  test('the box you type in holds more than one line, and Enter still sends', () => {
    /*
     * It was a single-line field, so a request longer than about forty
     * characters scrolled away to the left as it was typed — and describing a
     * tone is exactly the kind of thing people write two sentences of.
     */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    const bare = a.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    assert.match(bare, /<textarea\b/, 'the conversation is typed into one line again')
    assert.ok(!/type='text'|type="text"/.test(bare), 'the single-line field is back')

    /* Enter sends, Shift+Enter starts a line — what every chat does, and what
       someone who has used one will try first. */
    const keys = bare.slice(bare.indexOf('onKeyDown={(e) => {'), bare.indexOf('enterKeyHint'))
    assert.match(keys, /e\.key !== 'Enter' \|\| e\.shiftKey/, 'shift+enter no longer starts a line')
    assert.match(keys, /e\.preventDefault\(\)/, 'Enter sends and inserts a newline as well')
    assert.match(keys, /submit\(\)/, 'Enter does not send')
    /* Enter also commits an IME's character; sending there swallows the word
       somebody is in the middle of. */
    assert.match(keys, /isComposing/, 'a request typed with an IME sends half a word')

    /* A textarea has one fixed height and scrolls inside it, which for two
       lines means the first disappears upwards — no better than the field this
       replaced. Measured from the content rather than counted from the text, so
       it stays right at any width. */
    /*
     * The arrow says what it does to eyes; the label says it to everything
     * else. A button whose whole face is a glyph is unnamed without one, and
     * both of its states need naming — Send and Stop share the button.
     */
    assert.match(bare, /aria-label="Stop"/, 'the stop arrow has no name')
    assert.match(bare, /aria-label=\{busy \? 'Send when the current tone finishes' : 'Send'\}/,
      'the send arrow has no name')
    assert.ok(!/>\s*Send\s*</.test(bare), 'the word Send is back on the button beside the arrow')

    assert.match(bare, /el\.style\.height = 'auto'/, 'the box never shrinks back down')
    assert.match(bare, /el\.style\.height = `\$\{el\.scrollHeight\}px`/, 'the box does not grow with what is in it')
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
    assert.match(fx, /const toWireCell = \(row, col\) => \(\{ row, col: col \+ 1 \}\)/,
      'the wire boundary changed; the chain may now be corrected twice or not at all')

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
      !/Tune there|only the app at the Mac/.test(bare),
      'the tuner still says a phone cannot do this, which is only true of one of its two routes'
    )
    assert.ok(
      !/don.{1,8}t cross the phone-remote link|carries changes, not/.test(bare),
      'the tuner still says readings cannot cross the link, which the host now bridges'
    )

    /* What is left is the two things still worth trying, and no diagnosis. */
    assert.match(stall, /this version of the app/, 'nothing names the Mac being on an older version')
    assert.match(stall, /same wifi/, 'the route that works whatever the Mac is running is not mentioned')
    assert.match(
      stall,
      /footswitch/,
      'nothing suggests engaging the tuner on the unit, which is how an AM4 is put into it'
    )
  })

  test('a switch says where the thing it switches on will appear', () => {
    /*
     * "Where do I view the generation from the AI from the Developer tab?"
     *
     * The trace stood on its own under the tone, and the switch said so: "adds
     * a panel under each new tone". Then the tone became a card and everything
     * explanatory moved behind its fold — the trace with it — and the switch
     * went on saying the old thing. So it was turned on, looked for under the
     * tone, and not found: a setting that worked, reported as broken, by its
     * own description.
     *
     * The fix is a sentence, and this is what keeps the sentence true: the
     * words on the fold and the words that send you to it are the same words.
     */
    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
    const trace = readFileSync(new URL('../src/components/DevTrace.jsx', import.meta.url), 'utf8')

    const summary = gen.slice(gen.indexOf('<details className="preview-detail">'))
    const label = summary.slice(summary.indexOf('<summary>') + 9, summary.indexOf('<span')).trim()
    assert.ok(label.length > 6, `the fold has no words on it to point at: ${JSON.stringify(label)}`)

    const hint = trace.slice(trace.indexOf('<p className="hint">'), trace.indexOf('</p>', trace.indexOf('<p className="hint">')))
    assert.ok(
      hint.includes(label),
      `the switch sends people to "${label.length ? '…' : ''}" but the fold now says "${label}"`
    )
    /* And it is genuinely inside that fold rather than beside it — the other
       half of the same claim, held by the tone-card test above. */
    assert.ok(
      gen.indexOf('{children}') > gen.indexOf('<details className="preview-detail">'),
      'the trace is outside the fold the switch points at'
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

  test('the model cannot name a block this preset does not have', () => {
    /*
     * Rule 1 has always forbidden it and a run still asked for effects 70, 82
     * and 94 on a four-slot AM4 holding 46, 118, 58 and 66 — every change on
     * them dropped at the validator, the tone half-applied. A rule is a
     * request; an enum built from the preset's own ids is not one.
     */
    const api = readFileSync(new URL('../api/generate.js', import.meta.url), 'utf8')
    assert.match(
      api,
      /const buildPresetSpec = \(eids/,
      'the spec schema is fixed, so it cannot be narrowed to a preset'
    )
    assert.match(
      api,
      /eids\.length \? z\.literal\(eids\)/,
      'the id field is not constrained to the ids the preset holds'
    )
    assert.match(
      api,
      /schema: buildPresetSpec\(blocks\.map\(\(b\) => b\.eid\)/,
      'the request builds its schema from something other than the blocks it sent'
    )
    // And somewhere for the intent to go, so a constrained model does not hang
    // a delay's settings on the reverb it is allowed to name.
    assert.match(api, /wanted: z\n?\s*\.array\(z\.string\(\)\)/, 'there is no way to say a block is missing')
    assert.match(
      api,
      /name its family in "wanted"/,
      'the model is never told what to do with a block it cannot name'
    )

    const val = readFileSync(new URL('../src/lib/validate.js', import.meta.url), 'utf8')
    assert.match(val, /wanted: wantedBlocks\(spec\.wanted\)/, 'the gap never leaves the validator')

    const gen = readFileSync(new URL('../src/components/Generate.jsx', import.meta.url), 'utf8')
    assert.match(gen, /wanted\.length > 0/, 'nothing on the card says what the chain was missing')
    assert.doesNotMatch(
      gen,
      /className="problems">[\s\S]{0,80}wanted/,
      'a missing block is reported among the rejections, which it is not'
    )
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
    assert.equal(pkg.productName, NAME, 'the Mac app is named something else')
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
    assert.match(
      flow,
      /inputs\.publish && github\.ref == 'refs\/heads\/main'/,
      'a branch build could publish a release tagged against main'
    )
  })

  test('the conversation is speech and what is happening, in that order', () => {
    /*
     * "The chat box should pretty much be just the chats going back and forth,
     * saying creating tone, what the AI is doing and things like that."
     *
     * It used to hold the tone as well, spliced in at the turn it was asked
     * for — which is where the older report about ordering came from: the
     * design was rendered after every turn, pinning it to the bottom for good,
     * so anything said afterwards appeared above it. That is answered by the
     * tone not being in the log at all. What is left has one order: everything
     * said, then whatever is happening right now.
     */
    const a = readFileSync(new URL('../src/components/Assistant.jsx', import.meta.url), 'utf8')
    const bare = a.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const log = bare.slice(bare.indexOf('className="assistant-log"'), bare.indexOf('ref={tail}'))
    assert.ok(
      log.indexOf('turns.map(renderTurn)') < log.indexOf('{children}'),
      'what is happening now is drawn above what was said'
    )
    /* The queue sits between them: what is about to be asked has been said,
       and has not happened yet. */
    assert.ok(
      log.indexOf('queue.map') > log.indexOf('turns.map(renderTurn)') &&
        log.indexOf('queue.map') < log.indexOf('{children}'),
      'what is waiting its turn is out of order'
    )

    // One renderer, so every turn keeps its confirm buttons.
    assert.match(a, /const renderTurn = /, 'the turn markup is duplicated and will drift')
    assert.equal(
      (a.match(/className="turn-confirm"/g) || []).length,
      1,
      'a pending turn is drawn twice'
    )

    /*
     * And the position a run was asked at is still recorded, read from a ref
     * rather than a closure — it is what re-keys the tone panel, so a second
     * tone opens itself instead of arriving folded away.
     */
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
    assert.match(app, /turnsNow\.current = turns\.length/, 'nothing tracks how long the conversation is now')
    assert.match(app, /setGenAt\(turnsNow\.current\)/, 'the run reads its position from a stale closure')
    assert.ok(!app.includes('setGenAt(turns.length)'), 'the run reads its position from a stale closure')
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
