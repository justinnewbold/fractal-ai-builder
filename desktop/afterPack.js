/**
 * Sign the app with nothing, so an unsigned build can still run.
 *
 * Apple Silicon will not execute a Mach-O binary with no signature at all, and
 * packaging invalidates the signature Electron ships with — its own binary is
 * signed, then we rename it, add resources and repack. Without re-signing,
 * macOS reports the result as "damaged and can't be opened", which sounds like
 * a corrupt download and is not one: there is simply nothing to check.
 *
 * An ad-hoc signature (`--sign -`) is a signature with no identity behind it.
 * It proves nothing about who built the app, which is exactly right for a test
 * build — Gatekeeper still stops it with "unidentified developer", and that
 * warning has a way past it. "Damaged" does not.
 *
 * Skipped when a real certificate is present: electron-builder does the signing
 * then, and overwriting it would throw away the thing people are trusting.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing (no certificate)  ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
