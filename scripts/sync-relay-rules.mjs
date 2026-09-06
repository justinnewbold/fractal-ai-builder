/**
 * Copy the relay rules into the phone app.
 *
 * The web app imports `shared/relay-rules.mjs` directly, so it cannot drift by
 * construction. The phone app cannot: Metro would have to be pointed outside
 * its own directory, and an EAS build that uploads only `mobile/` would then
 * fail at bundle time — on a build machine, minutes in, for a reason that
 * looks nothing like "a file moved". Reaching outside is the kind of thing
 * that works on the laptop it was written on.
 *
 * So the phone gets a copy, and the copy is generated rather than edited. Run
 * this after touching the rules; `npm test` regenerates it in memory and fails
 * if what is on disk differs, so a stale copy cannot be merged.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = new URL('../shared/relay-rules.mjs', import.meta.url)
const TARGET = new URL('../mobile/src/lib/relay-rules.js', import.meta.url)

const BANNER = `/* Generated from shared/relay-rules.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run \`npm run sync:rules\`; the test suite
 * fails on any difference between the two. */

`

/** What the copy should contain, given what the source contains. */
export const generate = (source) => BANNER + source

export const sourceText = () => readFileSync(fileURLToPath(SOURCE), 'utf8')
export const copyText = () => readFileSync(fileURLToPath(TARGET), 'utf8')

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(fileURLToPath(TARGET), generate(sourceText()))
  console.log('mobile/src/lib/relay-rules.js is up to date with shared/relay-rules.mjs')
}
