/**
 * The two clocks, kept in agreement.
 *
 * A generation is bounded twice: the serverless function has a ceiling set in
 * `vercel.json`, and the browser has its own stall timeout and hard cap in
 * `src/lib/stream.js`. Nothing connects the two files, and for a while they
 * disagreed badly — the function was cut off at 60 seconds while the client
 * sat waiting for 240.
 *
 * What made that expensive is how it presented. The server writes an `error`
 * frame for anything it catches, so a function killed by the platform sends no
 * frame at all: the stream just ends. The client saw partial blocks and then
 * silence, and reported that *the model* had stopped — so every instinct was
 * to go and look at the model, the prompt, the schema. The cause was a number
 * in a config file.
 *
 * The invariant that prevents it: the server must be able to run for at least
 * as long as the client is prepared to wait. Then the client's own cap is
 * always the binding one, it fails with a message it can actually explain, and
 * a truncated stream goes back to meaning something genuinely unusual.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

export function run(test) {
  test('the server can run for as long as the browser will wait', () => {
    const { functions } = JSON.parse(read('vercel.json'))
    const seconds = functions?.['api/*.js']?.maxDuration
    assert.ok(Number.isFinite(seconds), 'no maxDuration is set for the API functions')

    const stream = read('src/lib/stream.js')
    const capMs = Number(stream.match(/const HARD_CAP_MS = (\d+)/)?.[1])
    const stallMs = Number(stream.match(/const STALL_MS = (\d+)/)?.[1])
    assert.ok(Number.isFinite(capMs) && Number.isFinite(stallMs), 'the client caps moved')

    assert.ok(
      seconds * 1000 >= capMs,
      `the function is cut off at ${seconds}s but the browser waits ${capMs / 1000}s — ` +
        'a generation between the two dies with no error frame and blames the model'
    )
    // A stall is meant to catch a silent connection, so it has to be the
    // shorter of the two or it never fires before the cap does.
    assert.ok(stallMs < capMs, 'the stall timeout is not shorter than the hard cap')
  })

  test('a verification report is rendered field by field, never as the object', () => {
    /*
     * `verifyChanges` returns objects — {block, param, wanted, got} — and App
     * rendered one bare as a React child. That is error #31, which unmounts
     * the whole tree: the page went blank the first time a written value
     * actually failed to read back.
     *
     * It survived because of what it takes to reach: a real unit, a real
     * write, and a real drift between them. No test and no demo session ever
     * produces all three, so the only thing that can catch it is the shape of
     * the code. Same failure as the cab picker rendering {value,label} pairs.
     */
    const app = read('src/App.jsx')
    const at = app.indexOf('applied.mismatches.map(')
    assert.ok(at !== -1, 'the mismatch list moved — retarget this test')
    const body = app.slice(at, app.indexOf('))}', at))
    const param = body.match(/\.map\(\((\w+)/)?.[1]

    assert.ok(
      new RegExp(`\\b${param}\\.\\w+`).test(body),
      `the mismatch list renders ${param} without reading a field off it`
    )
    assert.ok(
      !new RegExp(`\\{\\s*${param}\\s*\\}`).test(body),
      `the mismatch list renders {${param}} bare — that object is not a valid React child`
    )
  })

  test('picking a save destination cannot load it', () => {
    /*
     * The one way this feature can destroy work.
     *
     * The slot list in the save sheet is the same `PresetList` the preset menu
     * uses, and there `onSelect` LOADS the preset — which is right there and
     * catastrophic here: loading a preset replaces the edit buffer, so
     * choosing where to save would discard the very thing being saved.
     *
     * The two call sites must therefore differ, and they look nearly
     * identical. This asserts the save sheet's handler only sets the slot.
     */
    const sheet = read('src/components/SaveSheet.jsx').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const at = sheet.indexOf('onSelect=')
    assert.ok(at !== -1, 'the save sheet no longer offers a slot list')
    const handler = sheet.slice(at, at + 160)
    assert.match(handler, /onSlot\(/, 'the save sheet does not set the slot when a row is picked')
    assert.ok(
      !/jumpTo|selectPreset|onLoad/.test(handler),
      'the save sheet loads the preset it was asked to save into'
    )
  })

  test('the generator asks for an output ceiling rather than taking the default', () => {
    /*
     * The provider must send max_tokens on every request, so leaving it unset
     * is not "no limit" — it is the provider's 4096, which a full chain runs
     * past. Truncation there fails schema validation at the very end, after
     * the whole preset has been watched being built.
     */
    const gen = read('api/generate.js').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    const cap = Number(gen.match(/maxOutputTokens:\s*(\d+)/)?.[1])
    assert.ok(Number.isFinite(cap), 'no maxOutputTokens — the request runs on the provider default')
    assert.ok(cap >= 8000, `maxOutputTokens is ${cap}, low enough to truncate a full chain`)
  })
}
