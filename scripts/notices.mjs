#!/usr/bin/env node
/**
 * Every piece of somebody else's work this app ships, and what it asks of us.
 *
 * WHY THIS EXISTS AS A FILE RATHER THAN A GOOD INTENTION. Both projects the
 * desktop apps carry inside themselves come with conditions, and neither is
 * satisfied by linking to a repository:
 *
 *   ForgeFX (the device server) is MIT, which says the copyright notice "shall
 *   be included in all copies or substantial portions of the Software". We put
 *   a copy inside a signed installer, so that is us.
 *
 *   forgefx-midi (the preset codec) is Apache-2.0, which asks for more: the
 *   licence itself, the contents of its NOTICE file, and — section 4(b) —
 *   "prominent notices stating that You changed the files". We changed them,
 *   so that is us too, and licences/MODIFICATIONS.md is that notice.
 *
 * And the npm tree underneath both apps is several hundred packages, nearly
 * all MIT or ISC or BSD, nearly all of which say the same thing about their
 * copyright notice travelling with the code. A paid app on a store is exactly
 * the situation those clauses were written for.
 *
 * WHAT IT PRODUCES is one file, generated rather than maintained:
 *
 *   NOTICES.md          committed, so a change to it shows up in a diff
 *   public/notices.txt   served at fractal.newbold.cloud/notices.txt, which is
 *                        the address the apps link to and the one that can be
 *                        given to a store
 *
 * A test fails if either is stale, the same way the phone's generated copies
 * work — a notices file that drifts from what is installed is worse than none,
 * because it reads as a claim that somebody checked.
 *
 *   npm run notices
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* The same sentence the two About screens show. It appeared here first, typed
   by hand, which is exactly the drift shared/affiliation.mjs exists to stop. */
import { NOT_AFFILIATED, TRADEMARKS } from '../shared/affiliation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The two we carry whole, in the order they matter. */
const VENDORED = [
  {
    name: 'ForgeFX',
    what: 'the device server — the part that actually talks to the unit',
    home: 'https://github.com/sKuhLight/forgefx',
    licence: 'MIT',
    file: 'licences/forgefx-MIT.txt',
    notice: null
  },
  {
    name: 'forgefx-midi',
    what: 'the preset codec ForgeFX reads and writes presets with',
    home: 'https://github.com/sKuhLight/forgefx-midi',
    licence: 'Apache-2.0',
    file: 'licences/forgefx-midi-APACHE-2.0.txt',
    notice: 'licences/forgefx-midi-NOTICE.txt'
  }
]

const read = (p) => readFileSync(join(root, p), 'utf8')

/**
 * The runtime closure of a package.json, resolved through node_modules.
 *
 * Production dependencies only, and then transitively — a build tool that
 * never reaches a user's machine is not something we distribute, and listing
 * it would bury the hundred packages we do. Walked by hand rather than with a
 * tool, so this needs no dependency of its own to explain.
 */
function closure(manifest, modules) {
  const seen = new Map()
  const queue = Object.keys(JSON.parse(read(manifest)).dependencies || {})

  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue

    const dir = join(root, modules, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) {
      /* Not installed here. Said rather than skipped: a package that is
         depended on and absent is a notices file with a hole in it. */
      seen.set(name, { name, missing: true })
      continue
    }

    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    seen.set(name, {
      name,
      version: pkg.version,
      licence: licenceOf(pkg),
      home: homeOf(pkg),
      text: licenceText(dir)
    })
    for (const dep of Object.keys(pkg.dependencies || {})) queue.push(dep)
  }
  return seen
}

/** `license` is a string, or an object, or the old array. All three happen. */
function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ')
  return 'unstated'
}

function homeOf(pkg) {
  const r = pkg.repository
  const url = typeof r === 'string' ? r : r?.url || pkg.homepage || ''
  return String(url)
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
}

/** The licence text as shipped, which is the thing the clause asks for. */
function licenceText(dir) {
  const names = readdirSync(dir).filter((f) => /^(licen[cs]e|copying)/i.test(f))
  for (const f of names) {
    try {
      const text = readFileSync(join(dir, f), 'utf8').trim()
      if (text) return text
    } catch {
      /* A directory named LICENSE, or something unreadable. Next. */
    }
  }
  return null
}

const stamp = new Date().toISOString().slice(0, 10)

const lines = [
  '# Third-party notices',
  '',
  'Fractal Remote is built on other people’s work. This file is the list, and',
  'it carries the notices those licences require rather than pointing at them.',
  '',
  '**Generated — do not edit.** `npm run notices` rebuilds it from what is',
  'actually installed, and a test fails if it is stale. Edit the sources, not',
  'this.',
  '',
  `Last generated: ${stamp}`,
  '',
  '---',
  '',
  '## Fractal Audio Systems',
  '',
  NOT_AFFILIATED,
  '',
  TRADEMARKS,
  '',
  '---',
  '',
  '## Carried inside the desktop apps',
  '',
  'The Mac and Windows apps bundle these two whole. We ship modified copies of',
  'both — [what we changed](licences/MODIFICATIONS.md).',
  ''
]

for (const v of VENDORED) {
  lines.push(
    `### ${v.name}`,
    '',
    `${v.what}.`,
    '',
    `- Home: ${v.home}`,
    `- Licence: ${v.licence}`,
    '',
    '```',
    read(v.file).trim(),
    '```',
    ''
  )
  if (v.notice) {
    lines.push(
      `#### ${v.name} NOTICE`,
      '',
      'Reproduced because Apache-2.0 section 4(d) requires it.',
      '',
      '```',
      read(v.notice).trim(),
      '```',
      ''
    )
  }
}

/*
 * Every place that installs something which reaches a user's machine, because
 * they do not install the same things and a person is entitled to the list for
 * the one they have.
 *
 * THE DESKTOP SHELL WAS MISSED ON THE FIRST PASS, which is the kind of gap a
 * notices file exists to prevent: `desktop/package.json` installs
 * bonjour-service and electron-updater, both of which go inside the signed
 * installer, and neither appeared. It is listed here now.
 *
 * Electron itself is a devDependency and ships anyway — electron-builder puts
 * its runtime inside the app — so it is named below rather than walked, since
 * walking a devDependency tree would drag in electron-builder and a hundred
 * things that never leave this machine.
 */
const apps = [
  { title: 'The web app, and the page the desktop apps serve', manifest: 'package.json', modules: 'node_modules' },
  { title: 'The Mac and Windows apps', manifest: 'desktop/package.json', modules: 'desktop/node_modules' },
  { title: 'The iPhone and Android app', manifest: 'mobile/package.json', modules: 'mobile/node_modules' }
]

/*
 * And the two things the desktop apps carry that npm cannot see from here.
 *
 * The device server brings its own node_modules, including the two compiled
 * addons that talk to the hardware, and that tree only exists after
 * `npm run vendor:forgefx` has run. Generated on a machine that has not
 * vendored, those are absent — so they are named explicitly rather than left
 * to a directory walk that would silently find nothing.
 */
const NATIVE = [
  { name: 'serialport', what: 'the USB serial link to the unit', licence: 'MIT' },
  { name: '@julusian/midi', what: 'the MIDI link to the unit', licence: 'MIT' }
]

lines.push(
  '---',
  '',
  '## Also inside the desktop apps',
  '',
  'These reach a user’s machine without appearing as a production dependency of',
  'anything above, so they are named here rather than found by a walk.',
  '',
  '### Electron',
  '',
  'The runtime the Mac and Windows apps are built on — Chromium and Node.js,',
  'each with their own notices. Licence: MIT · https://github.com/electron/electron',
  '',
  'Electron ships its own full licence file inside every app built with it, at',
  '`LICENSES.chromium.html` in the installed application folder. That file is',
  'the authoritative one for Chromium’s own dependencies and is not reproduced',
  'here, because it is 8 MB and it is already in the product.',
  '',
  ...NATIVE.flatMap((n) => [
    `### ${n.name}`,
    '',
    `${n.what}. Licence: ${n.licence}`,
    '',
    'Installed by the device server rather than by this project, and compiled',
    'for the machine the installer was built on.',
    ''
  ])
)

let missing = 0
for (const app of apps) {
  const found = closure(app.manifest, app.modules)
  const sorted = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  lines.push('---', '', `## ${app.title}`, '', `${sorted.length} packages.`, '')

  for (const p of sorted) {
    if (p.missing) {
      missing += 1
      lines.push(`### ${p.name}`, '', '_Not installed when this was generated._', '')
      continue
    }
    lines.push(
      `### ${p.name} ${p.version}`,
      '',
      `Licence: ${p.licence}${p.home ? ` · ${p.home}` : ''}`,
      ''
    )
    if (p.text) lines.push('```', p.text, '```', '')
  }
}

const md = lines.join('\n')
writeFileSync(join(root, 'NOTICES.md'), `${md}\n`)

/*
 * And a plain-text copy at the address the apps link to. `public/` is copied
 * to the root of the deployed site, so this is reachable at
 * fractal.newbold.cloud/notices.txt from the phone, from the desktop apps, and
 * from a store listing that wants a URL rather than a file.
 */
writeFileSync(join(root, 'public/notices.txt'), `${md.replace(/```/g, '')}\n`)

const count = md.match(/^### /gm)?.length ?? 0
console.log(`NOTICES.md and public/notices.txt — ${count} entries${missing ? `, ${missing} not installed` : ''}`)
