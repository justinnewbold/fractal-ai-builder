# Fractal AI Builder

Describe a tone in plain language and get a working preset written to your Fractal
device.

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

### Block placement is deferred, not forgotten

`PUT /preset/grid/cell` and `POST /preset/grid/cable` exist, but ForgeFX flags
block placement as spec-derived and not hardware-confirmed, and the `?dryRun=true`
frame preview its docs describe **is not implemented in the code** — zero matches
across `server/src`. Writing preset structure with no way to preview the frame,
on a project where three separate encoding assumptions have already turned out
wrong, isn't a trade worth making yet.

Adding `dryRun` upstream is the unblocking move.

### The UI follows the device, not the FM3

Fractal units don't agree on what a preset is. The FM3 and Axe-Fx III lay one out
on a matrix where routing is part of the picture; the AM4 is a straight chain of
four slots with no routing at all. Rendering a 4×12 grid for an AM4 would be
inventing structure the hardware doesn't have.

So the shape, scene count, and channel names all come from `/device/detect`
rather than from an assumption about which unit is plugged in. A device that
reports no scenes doesn't get scene buttons.

### The generator reads the device's own manual

ForgeFX ships reference copy for every block family and every parameter, keyed
by param id. Without it the generator infers what a control does from its name —
which is exactly how "Amp1 Level" came to be dialled like a tone control.

That reference now goes in with the rosters, in the cached half of the request,
so it grounds every generation without costing tokens on repeat runs.

### References are grounded in real gear

Every model in the roster carries `manufacturer` and `basedOn` — the actual amp
or pedal it was modelled on. That's what makes "the mid-80s Mark IIC+ sound" a
answerable request rather than a vibe: the generator matches the reference to the
model built from that hardware, and says in the summary which one it matched. If
nothing in the roster is a close counterpart it says so, because a player who
knows the reference would rather hear that than be handed a substitute.

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

## Generation

Built on the [Vercel AI SDK](https://sdk.vercel.ai). `generateObject` constrains
the model to a Zod schema, so malformed replies are handled by the SDK rather
than by parsing text.

Two ways to supply a model, set in the Vercel project settings:

| Variable | Notes |
| --- | --- |
| `ANTHROPIC_API_KEY` | Direct. Preferred — works on a fresh account. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway. Needs credit; the free tier returns 403 for every Anthropic model. |
| `GENERATOR_MODEL` | Optional override. `claude-sonnet-5` direct, `anthropic/claude-sonnet-4.5` via gateway. |

Whichever key is set, it is read only inside `api/generate.js` and never reaches
the browser.

Nothing generated is trusted. At generation time the app reads the live model
roster and parameter ranges off the attached unit, hands those to the model as
the only legal vocabulary, then re-checks every value on the way back in
`src/lib/validate.js`. A model number that doesn't exist, or a gain of 15 on a
0–10 control, is dropped and reported rather than written.

Writes are sequential because they all travel down one serial port. Model swaps
go first, since changing a block's model resets its parameters.

### Which write encoding works is learned, not assumed

ForgeFX exposes two write paths — `continuous: false` builds a discrete frame,
`true` a continuous one. Both take a normalised 0–1 value, and nothing documents
which suits which control. On a real FM3, linear controls land on the discrete
path while frequency controls silently do not: they keep whatever value they
were last reset to, and the write still returns `{"ok":true}`.

So writes are confirmed. Each one is read back, and a value that didn't take is
retried on the other encoding. What worked is remembered per parameter, so a
preset full of frequency controls doesn't pay the retry cost twice.

### Gain staging is off limits

A block's output Level reads like a tone control by name — "Amp1 Level" sits in
the same list as Bass, Mid and Treble — so a generator will set it to -60 dB
while every other value is musically right. The preset then looks perfect and
makes no sound, and range checking can't catch it because -60 dB is legal.

So output levels, balance and pan are stripped from the schema before the model
sees them, and dropped again on the way back. The Gate block is excluded for the
same reason: a threshold set too high mutes quiet playing, and the safe value
depends on pickups and room rather than on a text description. See
`src/lib/guardrails.js`.

## Cost

Each generation is priced from the token counts the API returns and shown next
to the result, with a running session total. Rates live in `src/lib/cost.js`.

The request is split in two because the halves have very different lifetimes.
Model rosters are around 11k tokens and identical on every run; parameter values
and bypass states change constantly. Rosters go in their own content part marked
for caching and sorted by slug so the text is byte-identical between runs and
actually hits.

Cached reads bill at a tenth of base, so after the first run of a session the
bulk of the input is nearly free. The first run pays a write premium — the cost
panel says so rather than looking like a regression. Measured live: a second
identical run served 26,944 of 26,968 input tokens from cache.

A model with no published rate on file shows a blank rather than a guess.

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

## Browser support

Chrome works. **Safari does not** — it blocks a secure page from calling
`http://localhost`, which is how the app reaches ForgeFX. Safari users need to
run the app locally with `npm run dev`.

## Credits

Device protocol by [ForgeFX](https://github.com/sKuhLight/ForgeFX) and
[forgefx-midi](https://github.com/sKuhLight/forgefx-midi), both MIT/Apache-2.0 and
independent of Fractal Audio Systems. "FM3", "Axe-Fx" and "FM9" are trademarks of
Fractal Audio Systems, used here for identification only.
