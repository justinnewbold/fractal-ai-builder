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
import { readFileSync, readdirSync } from 'node:fs'

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
      for (const m of body.matchAll(
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

    for (const name of ['Chain', 'ParamSearch', 'GridEditor', 'Modifiers', 'Compare']) {
      assert.ok(components(view('shape')).includes(name), `${name} should be on Shape`)
    }

    // Setup on the stage screen is how you change the host address by accident.
    for (const name of ['Host', 'Remote', 'Ports', 'Diagnostics', 'LocalLibrary', 'Footswitches']) {
      assert.ok(!play.includes(name), `${name} is on Play`)
      assert.ok(!components(view('shape')).includes(name), `${name} is on Shape, not in a sheet`)
    }

    // And the sheets hold what was taken out of the views.
    for (const [title, names] of [
      ['Presets', ['PresetList', 'LocalLibrary', 'Backup', 'Versions', 'DeviceBackup']],
      ['Scenes', ['Scenes', 'SceneMatrix']],
      ['Setup', ['DeviceDetail', 'Host', 'Remote', 'Ports', 'ChangeLog', 'Diagnostics']]
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
      'Remote' // the sign-in, on the screen that says there's no connection
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
    for (const name of ['GridEditor', 'Scenes', 'Modifiers', 'Remote', 'BlockPanel', 'CabPicker']) {
      const props = tag(src, name)
      assert.ok(props, `${name} is not rendered`)
      assert.ok(/onError=/.test(props), `${name} cannot report errors`)
    }
  })

  test('Compare can show what it built', () => {
    // It lost state and onClear in a rewrite, which would have left it able to
    // build a comparison and unable to display one.
    const props = tag(src, 'Compare')
    assert.ok(/\bstate=/.test(props), 'Compare has no state to render')
    assert.ok(/\bonClear=/.test(props), 'Compare cannot be dismissed')
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
    // Terms that mean something to whoever built this and nothing to a
    // guitarist. Comments are allowed to say ForgeFX; the screen is not.
    const prose = src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    for (const term of ['npm run dev', 'localhost:5056', 'SysEx']) {
      assert.ok(!prose.includes(`>${term}`), `"${term}" is on screen`)
    }
  })
}
