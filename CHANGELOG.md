# Changelog

Versions are `MAJOR.PHASE.PATCH` — major is the architecture, phase tracks the
roadmap in the README, patch is everything since.

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
