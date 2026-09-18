# The desktop apps

Mac and Windows, one codebase. Each one opens, serves the app from that
machine, and puts a name on the network. A phone on the same wifi opens that
address and reaches the unit — no account, no relay, nothing to install on the
phone.

## What it actually is

A menu-bar item (a tray icon on Windows) and a child process. ForgeFX — the
device server — is started with `FORGEFX_STATIC` pointed at the built web app,
so the page and the device API are the same origin. That one variable is the
whole of local mode: a browser lets an HTTPS page call `http://localhost` but
not `http://10.0.0.x`, which is why the hosted app could never reach the unit
from a phone, and why serving it from here removes the problem rather than
working around it.

Everything worth getting right — where ForgeFX is, which port, what the phone
should scan — is in [`lib/host.mjs`](lib/host.mjs), shared with
`npm run serve` at the repository root and covered by the main test suite.
`main.js` is only the parts that genuinely need Electron.

**The one place the two platforms differ on purpose** is the tray icon.
macOS wants a template image — a black-and-transparent silhouette it recolours
for light and dark menu bars — and drawing that same file on a Windows tray
gives you a black square on a black taskbar. So there are two: `trayTemplate.png`
and `trayWin.png`, both generated from `public/icon.svg` by `npm run icon` at
the repository root, and `main.js` picks by `process.platform`.

## Building it

**Not from a Linux machine, and not from the other platform.** Each installer
needs a runner of its own kind, and the native serial and MIDI modules compile
per platform. `.github/workflows/desktop.yml` has a job for each; run the
workflow and take the `.dmg` or the `.exe` from the artifacts.

Locally, on the matching machine:

```sh
cd ../ && npm run build      # the web app this bundles
npm run vendor:forgefx       # the device server, into desktop/vendor
cd desktop && npm install
npm start                    # run it unpackaged
npm run dist                 # a .dmg   (on a Mac)
npm run dist:win             # an .exe  (on Windows)
```

`dist:win` produces two files and needs both: the NSIS installer people
download, and a `.zip` beside it that `electron-updater` is the only consumer
of. Without the zip the app finds a release it can never install, so the
workflow fails the build rather than publishing half of one.

## Signing

Different answers on the two platforms, for a reason worth keeping straight.

**macOS.** The workflow signs and notarises when four secrets exist, and
produces a working unsigned build when they don't:

| Secret | What it is |
|---|---|
| `MAC_CERT_P12` | Developer ID Application certificate, base64 |
| `MAC_CERT_PASSWORD` | its password |
| `APPLE_ID` / `APPLE_APP_PASSWORD` / `APPLE_TEAM_ID` | for notarisation |

Unsigned, macOS says "unidentified developer" and the first launch needs
right-click → Open. That is why a Mac release only ever publishes signed: an
unsigned `.dmg` on the download page is a support ticket, not a download.

**Windows.** `WIN_CERT_P12` and `WIN_CERT_PASSWORD` sign it if they exist, and
**the unsigned build publishes anyway**. SmartScreen shows a blue "Windows
protected your PC" box with *More info → Run anyway* underneath, and the
installer then works exactly as a signed one would. Holding the Windows
release back for a certificate would mean no Windows app at all, over a
warning the connect screen already tells people to expect. A certificate
(around $100–400/year from a CA, and an EV one clears SmartScreen from day
one) is still worth buying — it is the difference between "Run anyway" and no
box — but it is not what stands between a PC and this app.

## Known unknowns

The workflow vendors ForgeFX, builds it, and loads both native modules under
Electron-as-Node on every run, so the old worry about ABI mismatch now fails
in CI rather than on a desk. What CI still cannot answer:

- **Whether the app finds the unit.** That needs the hardware plugged in.
  Everything up to "the serial port opens" is checked; the port itself is not.
- **Windows USB in particular.** A Fractal unit is class-compliant, so it
  should need no driver, but `serialport` naming differs (`COM3` rather than
  `/dev/tty.usbmodem…`) and that path has never had a unit on the end of it.
