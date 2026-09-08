# Changelog

Versions are `MAJOR.PHASE.PATCH` — major is the architecture, phase tracks the
roadmap in the README, patch is everything since.

## 7.115.0

**The save button stays under your thumb.** "On the phone … clicking on a
preset does absolutely nothing and nothing saves." Tapping a row was doing
what it was meant to — choosing the slot — but the button that saves sat at
the top of the sheet, above a list of 512 rows, so by the time a slot was
picked it was two screens up and out of sight.

- The Save button lives in the sheet's footer now, which does not scroll. Pick
  a slot anywhere in the list and the button is right there, reading "Save to
  slot 474" and, when that slot holds something else, "Replaces Metallicaz".
- On the phone it still reads "Ask the Mac to save", because the Mac does the
  writing; the footer says when it is queued and when it lands.

## 7.114.0

**The Mac app closes, updates, and reopens.** "After installing … it closes
the app and restarts and then it still says the same update is available. …
It said ForgeFX was currently using the port. The only way to get around it
was to restart the Mac completely. … The app does not close out all the way
when you click the close button."

- **Closing the window quits the app.** It used to keep running in the menu bar
  with nothing on screen, which read as an app that would not close and led
  to Force Quit — the one thing that skips the quit an update needs.
- **A device server left behind is cleaned up.** Force Quit kills the app but
  not the server it started, which kept the port; the next launch said
  "ForgeFX is already running" and quit. Now the app recognises a server of its
  own left holding the port, stops it, and carries on. The server also runs
  inside a small watchdog that leaves the moment the app is gone, however it
  went, so this stops happening in the first place.
- **An app run from Downloads is offered a move to Applications.** macOS runs
  such an app from a hidden read-only copy and cannot replace it in place: the
  update downloads, "installs", relaunches the old version, and is offered
  again for ever. The app now asks to move itself on launch, and Setup →
  Updates offers the move too.
- **"Ready" means macOS has it.** The app said an update was ready when it had
  only downloaded the file; macOS's own updater still had to take a copy and
  check it. Restart pressed in between did nothing. Now the line says
  "Preparing…" until macOS has it, and any refusal from macOS — a signature it
  will not accept, a place it cannot write — is shown in its own words.
- **A failed install is reported, with why.** Before restarting to update, the
  app notes which version it expects to come back as. If it comes back on the
  old one, Setup → Updates says the update didn't install, shows what macOS
  wrote while it tried under Technical details, and offers Move to
  Applications and Download from GitHub — instead of offering the same update
  again as if nothing had happened.

## 7.113.0

**Hold Tap to type the tempo.** "On the tap button, let's do where they hold
the tap button they can manually enter in the beats per minute they want. On
the Mac let them right click to pull up the text box to enter the BPM."

- On the stage screen, hold the Tap button — or right-click it on a Mac — and
  a box opens above it with the current tempo selected. Type the number, press
  Enter, and the unit is set to it; Escape or a tap elsewhere leaves the tempo
  alone. Holding never sends a stray beat.
- The phone apps get the same hold on their Tap button, opening a number field
  under it with a Set button.
- Both check what was typed by one shared rule: a whole number from 20 to 400,
  the unit's own range. Anything else is refused in words, never clamped into
  a number nobody typed.
- The typeable tempo box had been sitting in the code with nothing showing it.
  It is its own component now, and this is where it appears.

## 7.112.0

**"Restart to update", like every other Mac app.** "On most Mac apps that
update it usually says refresh app to update and they click one button and it
closes the app for them. Is it possible for us to do that?" It already did:
the notice had an Install now button that closes the app and reopens it on
the new version. But the notice led with "installs when you quit" and the
button read as a technicality under a wait.

- The notice now says the version is ready to install, that restarting closes
  and reopens the app in a few seconds, and offers **Restart to update** as
  the thing to press. **Later** is still there, and still means it installs
  the next time you quit — nothing restarts itself.
- The same button appears in Setup → Updates while an update is waiting, so
  dismissing the notice is not the end of it.

## 7.111.0

**Nobody has to sign in to connect a phone.** "User shouldn't be required to
sign in unless they want to save and sync across the cloud. It's requiring a
login to connect." The phone's Connect button opened a sign-in form, and the
Mac's Set up phone remote opened the same form. Both ends now lead with a code.

- At the Mac, **Set up phone remote** makes a pairing code and shows it as a
  QR and as text — `XXXX-XXXX-XXXX-XXXX`. No email, no password. Signing in
  with an account is still offered beside it, for what it buys: presets and
  what the AI has learned about your taste following you between devices.
- On the phone, the first thing on the connect screen is the code. Point the
  camera at the Mac's QR and the app opens already connected; or type the
  code. The same-wifi route is second, and signing in is third.
- The phone apps take the same code on their first screen, with the account
  form one tap behind it.
- Underneath, the link still runs on a private channel between two ends signed
  in as the same account — that is the security model and it has not moved.
  The code stands for an account the person never sees, derived the same way
  at both ends from `shared/pairing.mjs`, which the phone app carries a
  generated copy of. The address the Mac signs in with carries only half the
  code, so no screen that names the account gives away enough to connect.
- The one thing that can stop pairing is the account service insisting on a
  confirmation email for every new account. The Mac says so in words if it
  happens, and offers the account route instead.

## 7.90.1

**The check that only passed on the machine that wrote it.** `npm test` reads
the phone's payload decoder against a real gzip frame, and that decoder needs
two small libraries — which live in `mobile/node_modules`, a second install CI
has no reason to have made. So the check imported packages that were not there
and failed on every runner, while passing locally for whoever had run
`npm install` inside `mobile/`. It merged red.

- The root carries `base64-js` and `fflate` as dev dependencies now, so the
  suite stands on the root install alone, the way every other check in it does.
- Which is fine until the two sides are bumped apart, at which point the suite
  is checking a decoder the phone does not ship. The specifiers are pinned to
  each other by a test rather than left to good intentions.

## 7.90.0

**The phone apps.** iOS and Android, in `mobile/`, joining the same private
channel the web app does.

- One React Native codebase, built in the cloud by the `mobile` workflow — no
  Xcode and no Android Studio. Every pull request that touches it bundles both
  platforms with Metro, which is the only thing that catches an import Metro
  can't resolve; `npm test` never would, and an EAS build finds it minutes in on
  a machine at the far end of a queue.
- Three things a web page cannot do, all of which matter on a stage. Safari
  blocks a secure page from calling `http://localhost`, so iOS has never been
  able to run this at the Mac. No page loaded over the network can reach ForgeFX
  either. And a page cannot stop a phone locking itself — a remote gone dark by
  the count-in is not a remote. The stage screen holds the screen awake and
  every control answers through the case.
- The allowlist has one home now. `shared/relay-rules.mjs` holds what may travel
  the relay, how long to wait for it, and the words for a refusal; the web app
  imports it and the phone carries a generated copy. That list drifted once
  before in both directions at once — blocking GETs the host serves, allowing
  writes the host refuses, eight routes disagreeing by the time anyone compared
  them — and `npm test` now regenerates the copy in memory and fails on any
  difference. A hand-kept second copy was the bug.
- What the phone deliberately cannot do: generate, edit the grid, or save. The
  host refuses a slot write from a distance and is right to, and a generate
  button within reach of a stage tap is a hazard. What it can do is the set a
  player reaches for between songs — preset, scenes, what's engaged, channels,
  tempo, tuner.
- The tuner says why it is silent. `POST /tuner` travels and starts the poll,
  but the host filters the eight-per-second telemetry streams out of the relay,
  so every reading stays at the Mac. After five silent seconds the screen says
  that, rather than showing a needle that will never move.
- Two Macs on one account are still refused a write, and still proved rather
  than trusted: the roll call counts every answer instead of taking the first,
  and addressing one Mac is confirmed by asking it one addressed question and
  counting the replies. A mixed pair of versions fails safe.

## 5.5.2

**Saving.** The button was in the wrong place, and on a phone it was also
telling the truth too late.

- Save is now a bar pinned to the bottom of the screen, on every view except
  gig. It used to be a panel at the foot of a long page, shown only while the
  app believed something had changed — off-screen and intermittent, which is a
  hard thing to learn the location of. It's always in the same place now, and
  saving an unchanged preset just writes the same bytes back.
- The tap that did nothing: ForgeFX refuses a slot write over the remote relay,
  and it's right to. But the refusal arrived after the tap, in a banner at the
  top of a page you weren't looking at. The button now says "Saving happens at
  the Mac" before you press it, and any other save failure shows on the bar
  itself.
- One button for the common case — the slot already loaded, nothing typed. Name
  and slot fields fold away behind Options, along with revert and the pre-edit
  copy.
- Thumb-sized targets, and the fields use 16px text so iOS stops zooming the
  page when you tap into them.

## 5.5.1

**The gig screen on a phone.** Scene names and block buttons were both missing
over a remote session, for two unrelated reasons that looked like one.

- Scene names on an AM4 live inside a preset dump, and dumps are refused over the
  relay by design. They're now published to ForgeFX's own document store while
  the Mac has the cable, and read back from there on the phone. The cache is
  keyed per unit — an AM4 slot 97 and an FM3 slot 97 are different presets and
  were sharing one entry.
- The block list read makes an AM4 dump its whole preset over serial, which
  outran the relay's fifteen-second timeout. Slow reads now get forty-five
  seconds, and the meter poll drops to every two seconds when remote instead of
  competing with them for the port twice a second.
- A failed chain read used to render as an empty row, indistinguishable from a
  preset with nothing in it. It now says what happened and offers to try again.
- The device bar said `localhost:5056` during a remote session, which is where
  the request wasn't going. It says "remote session", and no longer prints a
  grid size for a unit that has no grid.

## 2.3.0

Version and commit shown in the header, so which build is running is readable
rather than inferred.

## 2.2.x — generation

- **Cost per run** ([#9](https://github.com/justinnewbold/fractal-ai-builder/pull/9)).
  Each run sends the full model roster plus every placed block's parameter
  schema, so input tokens scale with the preset.
- **Diagnostics panel** ([#8](https://github.com/justinnewbold/fractal-ai-builder/pull/8)).
  Shows what actually went on the wire. The device accepts an out-of-range
  write silently — it clamps and returns `ok` — so the response can't tell you
  whether a write landed.
- **Normalised writes** ([#7](https://github.com/justinnewbold/fractal-ai-builder/pull/7)).
  Reads return real units; writes take 0–1. Undocumented, and the reason every
  generated preset had been landing with its controls pinned at maximum.
  Includes log-scale handling for frequency controls.
- **`continuous: false`** ([#6](https://github.com/justinnewbold/fractal-ai-builder/pull/6)).
  A wrong fix for the above, kept because discrete writes get a rejection
  watch. Both write paths normalise; the flag was never the bug.
- **Gain staging off limits** ([#4](https://github.com/justinnewbold/fractal-ai-builder/pull/4)).
  Output levels read like tone controls by name, so they were being dialled
  like tone controls. Range checking can't catch it — −60 dB is legal.

## 2.1.0 — control ([#5](https://github.com/justinnewbold/fractal-ai-builder/pull/5))

Preset browser, rename, hand editing, change log, and write verification.

Verification was added to catch stale cache reads and has since caught two
bugs it wasn't built for. It stays.

## 2.0.0 — the rewrite ([#1](https://github.com/justinnewbold/fractal-ai-builder/pull/1), [#2](https://github.com/justinnewbold/fractal-ai-builder/pull/2), [#3](https://github.com/justinnewbold/fractal-ai-builder/pull/3))

Retired the Electron and Computer Use app — screenshots in, mouse clicks out —
and replaced it with a web app driving the hardware through the ForgeFX HTTP
API. Generation moved to the Vercel AI SDK.

## 1.x

Electron app driving FM3-Edit with Claude's Computer Use API. macOS only,
roughly a dollar a session, and it clicked in the wrong place on any display
that wasn't exactly 2560px wide.
