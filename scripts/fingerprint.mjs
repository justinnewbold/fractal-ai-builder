#!/usr/bin/env node
/**
 * Whether this change costs an iOS build, answered before it is merged.
 *
 * AN UPDATE ONLY REACHES A BUILD WHOSE FINGERPRINT MATCHES IT. That is the
 * whole of the safety in EAS Update and it is the whole of the trap: change
 * anything native and every phone already carrying this app stops receiving
 * updates, silently, until somebody spends a build. There is no error. The
 * updates simply never arrive, and the way you find out is that a handset
 * sitting in front of you is on a version from last week.
 *
 * It has happened here. Three native changes went in after the last build —
 * two Expo packages at 7.328.0, the camera at 7.329.0, the opaque iOS icon at
 * 7.349.0 — and nothing said so. An update was published, reported as
 * published, and could never have landed on anything.
 *
 * So this compares what the app hashes to now against mobile/fingerprint.json,
 * and fails a pull request that moves either number.
 *
 *   npm run fingerprint          check, and fail if it moved
 *   npm run fingerprint -- --write   record the new values on purpose
 *
 * The second one is the point as much as the first. A native change is not
 * forbidden — it is a decision with a price, and the diff on that file is
 * where the price gets named.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'mobile/fingerprint.json')
const write = process.argv.includes('--write')

/* Run from mobile/, because that is where the app and its node_modules are —
   the fingerprint hashes the installed native packages, not just the config. */
const hashFor = (platform) => {
  const out = execFileSync(
    'npx',
    ['@expo/fingerprint', 'fingerprint:generate', '--platform', platform],
    { cwd: join(root, 'mobile'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const { hash } = JSON.parse(out)
  if (!hash) throw new Error(`no hash came back for ${platform}`)
  return hash
}

const recorded = JSON.parse(readFileSync(file, 'utf8'))
const now = { android: hashFor('android'), ios: hashFor('ios') }

const moved = ['android', 'ios'].filter((p) => recorded[p] !== now[p])

if (write) {
  writeFileSync(file, `${JSON.stringify({ ...recorded, ...now }, null, 2)}\n`)
  console.log(
    moved.length
      ? `Recorded. ${moved.join(' and ')} moved — this change needs a build before any phone sees it.`
      : 'Recorded. Nothing moved.'
  )
  process.exit(0)
}

for (const p of ['android', 'ios']) {
  console.log(`${p.padEnd(8)} ${now[p]}${recorded[p] === now[p] ? '' : `   was ${recorded[p]}`}`)
}

if (!moved.length) {
  console.log('\nUnchanged, so this ships as an update and costs no build.')
  process.exit(0)
}

/*
 * Named per platform, because the two do not cost the same. Android builds
 * are an ordinary runner and free; the iOS ones are a handful a month and
 * when they run out development stops until the month turns over.
 */
const cost = {
  ios: 'iOS: a build slot, and there are only a few a month.',
  android: 'Android: a free APK from .github/workflows/apk.yml.'
}
console.error(
  [
    '',
    `NATIVE CHANGE — ${moved.join(' and ')} moved.`,
    '',
    'Every copy of this app already on a phone stops receiving updates until a',
    'new build is made and installed. Nothing will say so at the time; the',
    'updates just stop arriving.',
    '',
    ...moved.map((p) => `  ${cost[p]}`),
    '',
    'If that is not what this change was meant to do, find the native part and',
    'take it out — a new dependency, an app.json plugin or permission, an icon,',
    'or an Expo package moving version.',
    '',
    'If it IS intended, run `npm run fingerprint -- --write` and commit the',
    'change to mobile/fingerprint.json, so the diff records what it cost.',
    ''
  ].join('\n')
)
process.exit(1)
