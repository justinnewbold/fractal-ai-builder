#!/usr/bin/env node
/**
 * The photo list the app reads, built from the one the licences live in.
 *
 * public/gear/sources.csv is the record of WHY we are allowed to use each
 * photograph — where it came from, who took it, under what licence. That file
 * is the thing a person checks, and it stays a spreadsheet for exactly that
 * reason. This turns it into something the app can import.
 *
 * NOTHING SHIPS WITHOUT A RIGHTS URL, and that rule lives here rather than in
 * a reviewer's head. Every CC BY and CC BY-SA licence requires the
 * photographer be named wherever the picture appears, so a row that cannot say
 * who took it is a row we cannot legally show — and this refuses to emit one.
 * The last batch of 200 was thrown away over exactly this.
 *
 * A file on disk with no row is also an error rather than a warning. It would
 * sit in the deployed site, reachable by anybody who guessed the address,
 * with no record of where it came from.
 *
 *   npm run gear:photos
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'public/gear')

/* A small CSV reader rather than a dependency: this file is written by hand
   and by a bot, and the fields never contain a comma. Quoted fields are still
   handled, because the day one does contain a comma should not be a silent
   mis-parse. */
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/)
  const cols = head.split(',')
  return lines.filter(Boolean).map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, cols.length)
    const values = cells.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))
    return Object.fromEntries(cols.map((c, i) => [c, (values[i] ?? '').trim()]))
  })
}

const rows = parseCsv(readFileSync(join(dir, 'sources.csv'), 'utf8'))
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
const byStem = new Map(files.map((f) => [f.replace(/\.[^.]+$/, ''), f]))

const problems = []
const photos = {}

for (const r of rows) {
  const file = byStem.get(r.slug)
  if (!file) problems.push(`${r.slug}: a row with no photograph`)
  if (!r.rights_url) problems.push(`${r.slug}: no rights_url — we cannot say why we may use this`)
  if (!r.copyright_holder) problems.push(`${r.slug}: nobody named as the photographer`)
  if (!file || !r.rights_url || !r.copyright_holder) continue
  photos[r.slug] = {
    file,
    holder: r.copyright_holder,
    licence: r.licence,
    rights: r.rights_url
  }
}

for (const stem of byStem.keys()) {
  if (!rows.some((r) => r.slug === stem)) problems.push(`${stem}: a photograph with no row, so no record of where it came from`)
}

if (problems.length) {
  console.error(`\nThe gear photos are not shippable:\n\n${problems.map((p) => `  ${p}`).join('\n')}\n`)
  process.exit(1)
}

const out = join(root, 'src/data/gear-photos.json')
const sorted = Object.fromEntries(Object.keys(photos).sort().map((k) => [k, photos[k]]))
const text = `${JSON.stringify(sorted, null, 2)}\n`
const changed = !existsSync(out) || readFileSync(out, 'utf8') !== text
writeFileSync(out, text)
console.log(`src/data/gear-photos.json — ${Object.keys(sorted).length} photographs${changed ? '' : ' (unchanged)'}`)
