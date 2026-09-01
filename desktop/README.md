# The Mac app

Opens, serves the app from this machine, and puts a name on the network. A
phone on the same wifi opens that address and reaches the unit — no account, no
relay, nothing to install on the phone.

## What it actually is

A menu-bar item and a child process. ForgeFX — the device server — is started
with `FORGEFX_STATIC` pointed at the built web app, so the page and the device
API are the same origin. That one variable is the whole of local mode: a
browser lets an HTTPS page call `http://localhost` but not `http://10.0.0.x`,
which is why the hosted app could never reach the unit from a phone, and why
serving it from here removes the problem rather than working around it.

Everything worth getting right — where ForgeFX is, which port, what the phone
should scan — is in [`lib/host.mjs`](lib/host.mjs), shared with
`npm run serve` at the repository root and covered by the main test suite.
`main.js` is only the parts that genuinely need Electron.

## Building it

**Not from a Linux machine.** macOS binaries need a macOS runner, and the
native serial and MIDI modules compile per platform. `.github/workflows/desktop.yml`
builds it; run that workflow and take the `.dmg` from the artifacts.

Locally, on a Mac, with ForgeFX and its codec checked out as siblings:

```sh
cd ../ && npm run build      # the web app this bundles
cd desktop && npm install
npm start                    # run it unpackaged
npm run dist                 # produce a .dmg
```

## Signing

The workflow signs and notarises when four secrets exist, and produces a
working unsigned build when they don't:

| Secret | What it is |
|---|---|
| `MAC_CERT_P12` | Developer ID Application certificate, base64 |
| `MAC_CERT_PASSWORD` | its password |
| `APPLE_ID` / `APPLE_APP_PASSWORD` / `APPLE_TEAM_ID` | for notarisation |

Unsigned, macOS says "unidentified developer" and the first launch needs
right-click → Open. Fine for testing, wrong for anyone who signed up.

## Known unknowns

This has not been run on a Mac. It is written from ForgeFX's own documented
integration path and from what its CI does, and the shared logic is tested —
but the packaging itself is unproven, and the likely first problems are:

- **Native modules under Electron.** `serialport` and `@julusian/midi` are
  compiled against Node's ABI, not Electron's. If the app starts but sees no
  unit, that is the cause, and `@electron/rebuild` is the fix.
- **Bundling ForgeFX.** The workflow checks it out and builds it, but the
  packaged app currently expects to find it on disk (`FORGEFX_PATH`, or
  `~/src/forgefx`) rather than carrying it inside. Making it self-contained is
  the remaining step to a true one-click install, and it should be a deliberate
  decision: it means shipping someone else's beta inside our installer and
  owning its bug reports. It is MIT, so this is a support question rather than
  a licensing one. Pin to a tag when we do.
