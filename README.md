# Fractal Remote

A remote for Fractal Audio units — the FM3, FM9, Axe-Fx III, AM4 and VP4 — on the
phone, in the browser, and on the computer the unit is plugged into.

The AI features this project began with — describing a tone and having a preset
written, and the Ask screen that took instructions in words — are gone from the
app. Nothing a player sees generates or asks anything.

## What changed in v2

v1 drove FM3-Edit with Claude's Computer Use API — screenshots in, mouse clicks
out. That approach is retired. It was slow, cost about a dollar a session, only
worked on macOS, and clicked in the wrong place on any display that wasn't
exactly 2560px wide.

v2 talks to the device directly through [ForgeFX](https://github.com/sKuhLight/ForgeFX),
an open-source HTTP API for Fractal hardware. No screenshots, no clicking.

## How it works

The UI is a static site and can be hosted anywhere. Device calls go to ForgeFX
running on the player's own machine, because that's where the USB cable is.

```
browser (this app)  ──▶  ForgeFX @ localhost:5056  ──▶  FM3 over USB
```

## Verified against hardware

Confirmed on an FM3 running ForgeFX 0.6.29-beta:

- Blocks are addressed by **effect id** (the `page` field), not by slug. The
  server README documents `:slug`; the router actually reads `:eid`.
- **Reads return real units. Writes take normalised 0–1.** The asymmetry isn't
  documented, and an out-of-range write doesn't error — it clamps and returns
  `{"ok":true}`. Verified on Amp 1 Gain (range 0–10):

  | sent | reads |
  | --- | --- |
  | `0.5` | 5 |
  | `0.65` | 6.5 |
  | `42597` | 0 (clamped; raw isn't accepted) |

  So `{"value": 7.5}` for a gain pins it at 10 and reports success. Conversion
  lives in `src/lib/scale.js` and uses each parameter's own reported range —
  including `log: true` controls like frequencies, where linear interpolation
  puts values nowhere near where the device shows them.
- `/preset/store` **works** even though `/device/detect` reports
  `supportsSave: false`. The capability flag is wrong, not the feature.

## Running it

```bash
npm install
npm run dev
```

You also need ForgeFX running locally on **Node 20**:

```bash
cd path/to/ForgeFX/server
npm run dev
```

ForgeFX needs its sibling codec repo checked out next to it — clone
`sKuhLight/forgefx-midi` alongside `ForgeFX` and run `npm install && npm run build`
in it first, or the server won't start.

Quit FM3-Edit before starting. Only one program can hold the USB port.

## Roadmap

- [x] Phase 1 — device link, live routing grid, catalog grounding
- [x] Phase 2 — tone description to validated parameter set, preview, write, save
- [x] Phase 3 — preset browser, rename, hand editing, change log, write verification
- [x] Phase 4a — scenes, channels, adaptive write encoding
- [x] Phase 4b — cab/IR picker, live meters *(block placement deliberately deferred, see below)*
- [x] Phase 5 — .syx backup and restore, saved preset library
- [x] Phase 6 — native iOS and Android remote, in `mobile/`

### Block placement, and the probe that makes it safe

`PUT /preset/grid/cell` writes preset structure rather than values, and ForgeFX
flags it as spec-derived rather than hardware-confirmed. The `?dryRun=true` frame
preview its docs describe **is not implemented** — zero matches across
`server/src`.

Two things make it workable anyway. Placement writes go through the reject-watch
path, so a refusal comes back as `ok: false` instead of passing silently (`0x0b`
is an impossible grid position, `0x0c` is DSP overload). And
`POST /preset/grid/select` writes nothing at all — it moves the unit's edit
cursor, so you can point at a cell and watch the FM3's screen to confirm the app
and the hardware agree about which cell is which.

That probe matters because two indexing conventions are in play: `/preset/blocks`
reports columns 0-indexed, the grid write routes take them 1-indexed to match
FM-Edit. Conversion happens at the client boundary so the rest of the app deals
in one convention, and the probe is what catches it if that's wrong.

Grid editing stays behind an explicit unlock that asks for a device backup first.

### The UI follows the device, not the FM3

Fractal units don't agree on what a preset is. The FM3 and Axe-Fx III lay one out
on a matrix where routing is part of the picture; the AM4 is a straight chain of
four slots with no routing at all. Rendering a 4×12 grid for an AM4 would be
inventing structure the hardware doesn't have.

So the shape, scene count, and channel names all come from `/device/detect`
rather than from an assumption about which unit is plugged in. A device that
reports no scenes doesn't get scene buttons.

### Scenes can only be read by visiting them

A scene isn't a saved set of values — it's which blocks are engaged and which
channel each is on. `GET /preset/scene-state` reports the scene that is
*currently active*; there is no query for a scene you aren't in.

So the scene map is built by switching to each scene, reading, and returning to
where you started. That is audible, which is why it happens on request rather
than on load, and why editing a cell announces that it will switch. It always
returns to the starting scene, including when a read throws — leaving someone on
scene 6 because a query failed would be its own bug.

### Discrete selectors are not knobs

`GET /preset/blocks/{eid}/params` returns `enums` alongside `named`. Enums carry
an ordinal from a fixed option list — bypass mode, input select, cab IR slot —
and normalising one is meaningless: option 2 of 5 is not "40% along". They go out
on the discrete path with the ordinal intact, the same way a model change does.

## Reads can lie

ForgeFX caches block parameters and exposes no invalidation hook, so after a
busy session a read can report a value the hardware does not hold. This cost us
an evening: a preset that read `Amp1 Level = -80` and appeared silent was in
fact fine, and a server restart showed the real value of `-8`.

So writes are verified. After applying, the affected blocks are read back and
anything that differs from what was sent is reported rather than assumed. If
values look wrong and a restart changes them with no writes in between, that is
the cache, not your preset.

### Which write encoding works is learned, not assumed

ForgeFX exposes two write paths — `continuous: false` builds a discrete frame,
`true` a continuous one. Both take a normalised 0–1 value, and nothing documents
which suits which control. On a real FM3, linear controls land on the discrete
path while frequency controls silently do not: they keep whatever value they
were last reset to, and the write still returns `{"ok":true}`.

So writes are confirmed. Each one is read back, and a value that didn't take is
retried on the other encoding. What worked is remembered per parameter, so a
preset full of frequency controls doesn't pay the retry cost twice.

## Nothing is permanent until you save it

Everything this app writes lands in the **edit buffer**. `/preset/store` is the
only call that commits to a slot. So a generated preset is already there to play
before you decide anything, and switching presets discards it.

That makes revert one call: reselecting the same slot reloads it from flash and
throws the edit buffer away. The app shows a bar whenever the buffer differs
from what's stored, so "am I playing something I've saved?" is never a guess.

For the case revert can't reach — changing your mind *after* saving — a verbatim
`.syx` copy of the slot is taken before the first write of a session and can be
pushed back into the edit buffer.

## Snapshots vs saved presets

Two different things, and the difference decides which one answers your question.

A **saved preset** stores a generated spec — an intent. It can be replayed
against any preset, re-validated against whatever ranges are current. That
answers *"do that again."*

A **snapshot** is a raw `.syx` dump of one slot at one moment, taken by ForgeFX
before it overwrites anything. That answers *"put it back how it was"* — and only
it can, because only it knows what "it was" actually contained.

Snapshots can be played into the edit buffer without occupying a slot, or written
back to the slot they came from.

## Saved presets

Every preset that gets written is saved locally and can be reloaded onto any
preset later, with export and import for moving them between machines.

What's stored is the generated **spec** — blocks, models and target values — not
the diff that was applied. A diff only means anything against the preset it was
computed from; replaying one elsewhere would write values derived from ranges
that no longer apply. Reloading re-validates the spec against whatever is on the
unit now and stops at the preview, so a saved tone meeting a different block
layout is caught by the same checks as a fresh generation.

## Demo mode

There's a simulated FM3 built from data captured off a real unit — the 331 amp
models, the drive and cab rosters, and the amp block's 98 named parameters with
their real ranges and log flags. Toggle it in the device bar, or from the
connection failure state.

It reproduces the write semantics deliberately, not just the shapes: writes take
normalised 0–1 while reads return real units, an out-of-range write clamps
silently and reports success, and a model swap resets that block's parameters
and can shift their ranges. Those three behaviours produced presets that looked
correct and were wrong, and none of them were reproducible away from the amp
until now.

Demo mode routes through the same exported functions as the real client, so
there's no second code path to drift.

## Tests

```bash
npm test
```

Covers the conversion, guardrail and validation logic. Every case comes from a
real failure, including the device's own reported norm values used as fixtures —
71.999 Hz reads `norm 0.42866` on a 10–1000 log range, and the conversion has to
agree.

## The phone apps

`mobile/` is a React Native app — one codebase, iOS and Android — that joins the
same private channel this app does and drives the unit at your Mac. Its own
README covers building it; what follows is why it exists and what it shares.

Two of the three reasons are in the section below: Safari cannot call
`http://localhost`, and no page loaded over the network can either. The third is
that a web page cannot stop a phone from locking itself, and a remote that has
gone dark by the time the count-in starts is not a remote.

Nothing about the protocol changes. Same channel, same host, same refusals — and
the rule that decides those refusals is now in `shared/relay-rules.mjs`, which
`src/lib/remote.js` imports directly and the phone app carries as a generated
copy (`npm run sync:rules`). A hand-written second copy of that allowlist is
exactly what drifted before, in both directions at once: it blocked GETs the
host happily serves and allowed writes the host refuses. `npm test` regenerates
the copy in memory and fails on any difference, so the two ends cannot disagree
about what a phone may do.

What the app does *not* carry is the rest of this one. No generation, no grid
editing, no library, no saves — a generate button within reach of a stage tap is
a hazard, and the host refuses a slot write from a distance anyway.

## Browser support, and using it from a phone

Chrome works. **Safari does not** — it blocks a secure page from calling
`http://localhost`, which is how the app reaches ForgeFX.

The same rule is why the hosted app can't be used from a phone. Browsers make an
exception letting an HTTPS page call `http://localhost` — that exemption is the
only reason the hosted app works at all — and it does not extend to a LAN
address. So a phone loading the hosted URL cannot reach ForgeFX on your Mac, and
no app-side work changes that. What does change it is not being a web page: see
`mobile/`.

ForgeFX can serve the app itself, which makes everything same-origin and
sidesteps the rule:

```bash
npm run build
FORGEFX_STATIC=/path/to/fractal-remote/dist npm run dev   # in ForgeFX/server
```

Then browse to `http://<your-machine-ip>:5056` from the phone. Gig mode works
from there. `/remote/enable` looks like it should help and doesn't — it belongs
to Axis's cloud relay and returns 503 in the plain server runtime.

### The tuner over a remote session

The tuner works here the way it works in Axis: `POST /tuner` starts ForgeFX
polling the unit (on an AM4, the always-live tuner block), and readings arrive
as `{type:'tuner'}` events on the event stream. At the Mac that stream is SSE
and the tuner just works.

Over a remote session it can't, and the reason is the host, not this app:
ForgeFX's relay bridges only discrete change events — param, scene, tempo —
and deliberately filters the ~8×/s telemetry streams, tuner included, to keep
the channel quiet (`server/src/remote.ts`, the `RELAYED` set). `POST /tuner`
*is* allowed remotely, so a phone can start the poll and then never see a
reading: the unit is being polled at the Mac and every answer stays there.
The gig screen says exactly that after five silent seconds instead of showing
a needle that never moves. Adding `'tuner'` to that host-side set turns the
stream on for remote sessions; this app already listens and needs no change
to benefit.

## Credits

Device protocol by [ForgeFX](https://github.com/sKuhLight/ForgeFX) and
[forgefx-midi](https://github.com/sKuhLight/forgefx-midi), both MIT/Apache-2.0 and
independent of Fractal Audio Systems. "FM3", "Axe-Fx" and "FM9" are trademarks of
Fractal Audio Systems, used here for identification only.
