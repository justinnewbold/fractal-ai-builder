#!/usr/bin/env node
/**
 * Render the app icon from the one drawing of it.
 *
 * `public/icon.svg` is the icon. The Mac app needs a raster of it, because
 * electron-builder converts a PNG into the .icns that macOS wants — so the
 * alternative to this script is a second, hand-made copy of the artwork that
 * drifts from the first the moment anyone touches either.
 *
 * It rasterises with the browser rather than an image library on purpose: the
 * icon is SVG, and the only thing that renders SVG exactly the way the app
 * does is the engine the app runs in. Round joins and caps in particular are
 * where hand-rolled rasterisers differ visibly at small sizes.
 *
 *   npm run icon
 *
 * Playwright is not a dependency of this project — the icon changes about once
 * a year, and carrying a browser download for it would be a poor trade. Install
 * it when you need it: `npm i -D playwright && npx playwright install chromium`.
 */
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'public/icon.svg')
/*
 * Every raster of the icon, from the one drawing of it.
 *
 * The Mac app needs a PNG because electron-builder makes the .icns from one.
 * The phone apps need three, and Expo will not read an SVG: the launcher icon,
 * Android's adaptive foreground (same artwork — the app's own rounded square
 * sits inside Android's mask rather than fighting it), and the splash mark.
 * They are the same 1024px render written to four places, which is the only
 * arrangement in which they cannot disagree about what the app looks like.
 */
const outputs = [
  'desktop/build/icon.png',
  'mobile/assets/icon.png',
  'mobile/assets/adaptive-icon.png',
  'mobile/assets/splash-icon.png'
].map((rel) => resolve(root, rel))
const SIZE = 1024

// createRequire rather than a bare import so an installation outside the
// project (a global, or NODE_PATH) resolves too.
const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error(
    'This needs Playwright, which is deliberately not a dependency:\n' +
      '  npm i -D playwright && npx playwright install chromium\n' +
      'The committed PNGs are what the builds use, so this only has to run when the icon changes.'
  )
  process.exit(1)
}

const svg = readFileSync(source, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
// No page background: the icon's own rounded square is the shape macOS masks to.
await page.setContent(
  `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`
)
for (const out of outputs) {
  mkdirSync(dirname(out), { recursive: true })
  await page.locator('svg').screenshot({ path: out, omitBackground: true })
  console.log(`${out.slice(root.length + 1)} — ${SIZE}x${SIZE} from ${source.slice(root.length + 1)}`)
}
await browser.close()
