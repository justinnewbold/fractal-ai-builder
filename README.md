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
- [ ] Phase 4 — scenes, channels, cab/IR picker, block placement and cabling, live meters
- [ ] Phase 5 — .syx backup and restore, preset library with versions

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

## Browser support

Chrome works. **Safari does not** — it blocks a secure page from calling
`http://localhost`, which is how the app reaches ForgeFX. Safari users need to
run the app locally with `npm run dev`.

## Credits

Device protocol by [ForgeFX](https://github.com/sKuhLight/ForgeFX) and
[forgefx-midi](https://github.com/sKuhLight/forgefx-midi), both MIT/Apache-2.0 and
independent of Fractal Audio Systems. "FM3", "Axe-Fx" and "FM9" are trademarks of
Fractal Audio Systems, used here for identification only.
