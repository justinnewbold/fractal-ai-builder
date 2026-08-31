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

  // Ends at the next view's conditional, or at the trailing sections.
  const rest = src.slice(start + 20)
  const next = rest.search(/\{status === 'live' && view === '|\{status === 'live' \? \(|<section hidden=/)
  return rest.slice(0, next === -1 ? undefined : next)
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
          const passed = [...body.slice(at, i).matchAll(/(\w+)=/g)].map((m) => m[1])
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

  test('each screen holds the panels it is meant to', () => {
    // Named in the UI as Library; they spent three PRs rendering in Edit.
    for (const name of ['LocalLibrary', 'Remote', 'Host', 'Ports', 'Diagnostics']) {
      assert.ok(components(view('library')).includes(name), `${name} should be in Library`)
      assert.ok(!components(view('edit')).includes(name), `${name} should not be in Edit`)
    }

    for (const name of ['Editor', 'GridEditor', 'Scenes', 'Modifiers', 'CabPicker', 'ParamSearch']) {
      assert.ok(components(view('edit')).includes(name), `${name} should be in Edit`)
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
    const to = src.indexOf("view === 'console' ? (")
    assert.ok(from !== -1 && to > from, 'the chrome no longer starts at the top bar')
    const chrome = src.slice(from, to)
    const allowed = new Set([
      'TopBar', // the bar itself
      'SaveBar', // rides in it
      'Remote', // the sign-in, on the screen that says there's no connection
      'Assistant', // the way the app is meant to be worked
      'Thinking',
      'Stages',
      'LiveGeneration',
      'Cost',
      'Preview' // what a generation produces, where it was asked for
    ])
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
    const firstView = src.indexOf("view === 'console' ? (")
    assert.ok(banner < firstView, 'the banner must render before any view block')
  })

  test('panels that need a preset are given one', () => {
    // Scenes read preset?.number without being passed a preset: silently
    // undefined, so its cache invalidation quietly did nothing.
    for (const [name, prop] of [
      ['Scenes', 'preset'],
      ['LocalLibrary', 'preset'],
      ['Backup', 'preset'],
      ['Grid', 'preset']
    ]) {
      const seg = src.slice(src.indexOf("view === 'console' ? ("))
      const props = tag(seg, name)
      assert.ok(props, `${name} is not rendered anywhere`)
      assert.ok(new RegExp(`\\b${prop}=`).test(props), `${name} is missing ${prop}`)
    }
  })

  test('panels that can fail can report it', () => {
    // A panel with no onError swallows its failures.
    for (const name of ['Editor', 'GridEditor', 'Scenes', 'Modifiers', 'TempoTuner', 'Remote']) {
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
    const keys = [...src.matchAll(/<Section key="([^"]+)"/g)].map((m) => m[1])
    assert.ok(keys.length > 10, 'expected the sections to be keyed')
    assert.equal(keys.length, new Set(keys).size, 'duplicate Section keys')
  })

  test('reorderable stacks are closed', () => {
    assert.equal(
      (src.match(/<SectionStack/g) || []).length,
      (src.match(/<\/SectionStack>/g) || []).length
    )
    assert.equal((src.match(/<Section /g) || []).length, (src.match(/<\/Section>/g) || []).length)
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
