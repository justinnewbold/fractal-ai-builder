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
/*
 * AND ONE OF THEM MUST BE OPAQUE, which is an App Store rule rather than a
 * preference. Apple rejects an iOS app icon with an alpha channel: the icon
 * is a full square and the system applies its own corner mask, so a PNG with
 * transparent corners comes back as "the app icon can't contain alpha
 * channels or transparencies" before a human ever opens the build.
 *
 * The artwork's own rounded square is #0d0f12 and only its four corners are
 * clear, so making it opaque is a matter of painting that same colour behind
 * it rather than changing the drawing.
 *
 * The other three keep their transparency and need it. Android's adaptive
 * icon is a foreground layer the system masks itself — filling its corners
 * would put a dark square inside Android's circle. The splash mark sits on
 * the splash colour. And the Mac build wants the rounded shape, because macOS
 * does not mask app icons at all.
 */
const outputs = [
  { rel: 'desktop/build/icon.png', opaque: false },
  { rel: 'mobile/assets/icon.png', opaque: true },
  { rel: 'mobile/assets/adaptive-icon.png', opaque: false },
  { rel: 'mobile/assets/splash-icon.png', opaque: false }
].map((o) => ({ ...o, path: resolve(root, o.rel) }))
const SIZE = 1024

/* The fill of the artwork's own square, so the corners it rounds off are
   filled with the colour they were cut out of rather than a guess. */
const OPAQUE_BG = '#0d0f12'

/*
 * And the Windows tray icon, which is a different job at a different size.
 *
 * macOS gets `desktop/trayTemplate.png`, a TEMPLATE image: black on
 * transparent, which the system inverts for a light or a dark menu bar.
 * Windows does not do that. Handing it the same file paints a black shape on
 * a taskbar that is black by default, and the icon is simply not there —
 * the app looks like it failed to start.
 *
 * So Windows gets the artwork itself, rendered small. 32px because that is
 * what the notification area asks for at 200% scaling, which is most laptops;
 * Windows downsamples it for 100% far better than it upsamples 16.
 */
const TRAY_WIN = resolve(root, 'desktop/trayWin.png')
const TRAY_SIZE = 32

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
  mkdirSync(dirname(out.path), { recursive: true })
  /* The page background is what fills the corners when the shot is not
     omitting it — set per output rather than once, because three of the four
     want it gone. */
  await page.evaluate((bg) => {
    document.body.style.background = bg
  }, out.opaque ? OPAQUE_BG : 'transparent')
  await page.locator('svg').screenshot({ path: out.path, omitBackground: !out.opaque })
  console.log(
    `${out.rel} — ${SIZE}x${SIZE}${out.opaque ? ', opaque (App Store requires it)' : ''}`
  )
}

/* The same drawing, rendered at tray size rather than scaled down from 1024:
   a 1024→32 downsample of round joins and caps is mush. */
const small = await browser.newPage({
  viewport: { width: TRAY_SIZE, height: TRAY_SIZE },
  deviceScaleFactor: 1
})
await small.setContent(
  `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${TRAY_SIZE}px;height:${TRAY_SIZE}px}</style>${svg}`
)
mkdirSync(dirname(TRAY_WIN), { recursive: true })
await small.locator('svg').screenshot({ path: TRAY_WIN, omitBackground: true })
console.log(`${TRAY_WIN.slice(root.length + 1)} — ${TRAY_SIZE}x${TRAY_SIZE} from ${source.slice(root.length + 1)}`)

await browser.close()
