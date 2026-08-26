# Build prompt: Fractal AI Builder

Paste everything below into the tool of your choice.

---

Build a web app that turns a plain-language description of a guitar tone into a
working preset on a Fractal Audio FM3, written directly to the hardware.

## Architecture

The UI is a static site and can be hosted anywhere. It talks to **ForgeFX**
(https://github.com/sKuhLight/ForgeFX), an open-source HTTP API that speaks the
Fractal wire protocol over USB, running on the player's own machine at
`http://localhost:5056`. Generation runs in a serverless function so the API key
never reaches the browser.

```
browser ──▶ /api/generate (serverless, holds key) ──▶ Claude
        └─▶ localhost:5056 (ForgeFX)               ──▶ FM3 over USB
```

Stack: Vite + React, Vercel AI SDK (`generateObject` with a Zod schema),
deployed on Vercel.

## Read this before writing any code

Every item below was established by testing against real hardware. None of it is
in ForgeFX's documentation, and several contradict it. Getting any of these wrong
produces a preset that reports success and is silently wrong.

### 1. Blocks are addressed by effect id, not slug

`GET /preset/blocks` returns `effectId` for each placed block. Use that number in
every per-block route. The server README documents `:slug`; the router reads
`:eid`. Passing a slug yields an empty response, not an error.

The `page` field from `GET /blocks` is the same number.

### 2. Reads return real units. Writes take normalised 0–1.

This asymmetry is the single most expensive thing to discover. Verified on Amp 1
Gain, range 0–10:

| sent | reads back |
| --- | --- |
| `0.5` | 5 |
| `0.65` | 6.5 |
| `42597` | 0 (raw encoding is rejected) |

**An out-of-range write does not error.** It clamps and returns `{"ok":true}`.
So sending `7.5` for a 0–10 gain pins it at 10 and reports success. You cannot
detect this from the response.

Convert using each parameter's own reported `min`/`max` from
`GET /preset/blocks/{eid}/params`.

### 3. Frequency controls are logarithmic

Parameters carry a `log: true` flag. Linear interpolation puts them nowhere near
where the device shows them.

```js
norm = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min))
```

Confirmed against the device's own reported values: Low Cut Frequency reads
71.999 Hz with `norm: 0.42866`; the formula gives 0.4287 for 72 Hz. Linear would
have given 0.063.

### 4. Model swaps reset the block

`POST /preset/blocks/{eid}/type` resets that block's parameters **and can change
their ranges** — different amp models cover different low-cut spans. Apply model
changes first, then **re-read that block's parameters** and convert against the
new ranges before writing values.

### 5. Writes are sequential

Everything travels down one serial port. Parallel requests collide. Expect a full
preset to be dozens of sequential calls; show progress.

### 6. Reads can be stale

ForgeFX caches block parameters and exposes no invalidation hook. After a busy
session a read can report a value the hardware doesn't hold; restarting the
server clears it. **Verify writes**: after applying, read the affected blocks
back and report anything that differs from what was sent. This is the only way to
tell a write that landed from one that didn't.

### 7. Never let the generator set output levels

A block's output level is named like a tone control — "Amp1 Level" sits in the
same list as Bass, Mid and Treble, with a range of −80 to +20 dB. A model will
dial it to −60 while every other value is musically correct, producing a preset
that looks perfect and makes no sound. Range checking cannot catch this, because
−60 dB is legal.

Strip these from the schema before the model sees them, and drop them again on
the way back. Match on name: `Level`, `Balance`, `Pan`, `Output *`, `Mute`.
Exempt `Boost Level` and `Input Level` (they drive gain). Keep `Master Volume`
available — on a Fractal amp block it shapes power-amp saturation.

Exclude the **Gate** block entirely: a threshold set too high mutes quiet
playing, and the safe value depends on pickups and room, not a text description.

### 8. Empty presets have no blocks

A preset with nothing on its grid returns an empty block list. Say so plainly
rather than reporting a read failure.

### 9. Browser support

Chrome permits an HTTPS page to call `http://localhost`. **Safari blocks it.**
Say this in the failure state.

### 10. Grid editing is unverified

`PUT /preset/grid/cell` and `POST /preset/grid/cable` exist but ForgeFX flags
block placement as spec-derived and not hardware-confirmed. Their docs describe a
`?dryRun=true` flag for previewing frames — **it is not implemented in the code**.
Treat placement as risky and test on a scratch slot with a full backup first.

## Setup ForgeFX needs

ForgeFX's `package.json` declares its codec as `file:../../forgefx-midi`, a
sibling repo that isn't part of the clone and isn't on npm. Clone
`sKuhLight/forgefx-midi` next to `ForgeFX`, run `npm install && npm run build` in
it, then install the server. **Node 20 specifically** — the engine pins
`>=20 <21`. Quit FM3-Edit first; only one process can hold the USB port.

macOS also needs MIDIServer running. If `pgrep MIDIServer` returns nothing, open
Audio MIDI Setup → Window → Show MIDI Studio, or ForgeFX crashes on startup with
`error creating OS-X MIDI client object (-304)`.

## Endpoints used

```
GET  /healthz
GET  /device/detect                        capabilities, grid size, scene count
GET  /preset                               current slot number and name
GET  /preset/blocks                        placed blocks: effectId, row, col, bypassed, channel
GET  /preset/blocks/{eid}/params            named params: id, name, value, min, max, log, unit
GET  /blocks/{slug}/types                   model roster with manufacturer and basedOn
PUT  /preset/blocks/{eid}/params/{paramId}  body {value: <0-1>, continuous: false}
POST /preset/blocks/{eid}/bypass            body {bypassed: bool}
POST /preset/blocks/{eid}/type              body {value: <ordinal>}
POST /preset/select                         body {number}
POST /preset/name                           body {name} — working buffer only
POST /preset/store                          body {number} — makes it permanent
GET  /presets/{n}                           name of a stored slot
GET  /scene, POST /scene, POST /scene/name
GET  /cab/irs
GET  /events                                SSE: tuner, tempo, scene, meters
```

`/device/detect` may report `supportsSave: false` while `/preset/store` works.
The capability flag is wrong, not the feature.

The FM3 reports `canScanNames: false`, so `/preset/locations` is unavailable —
fetch names one slot at a time via `/presets/{n}` and page them. 512 sequential
reads down a serial port is not a page load.

## What the app should do

**Device link.** Connect, show model and capabilities, handle the failure state
with the Safari caveat named.

**Routing grid.** Render the live 4×12 matrix with block position, bypass state,
and channel. This is the most characteristic thing about the instrument and
should be what the app leads with. Collapse unused rows by default — most presets
occupy row 1.

**Generation.** Read the live model roster and parameter schema off the attached
unit at generation time and give the model that as its only legal vocabulary, so
it cannot name a model the unit doesn't have. Use structured output with a schema.
Ask for values in real units — that's how a player thinks and how the device
displays.

**Validation.** Re-check everything on the way back: unknown effect ids, unknown
model ordinals, unknown parameter ids, out-of-range values. Drop them and report
what was dropped. The failure mode should be "it did less than you hoped", never
"it wrote garbage to your amp".

**Preview.** Show a per-parameter diff, current versus proposed, before anything
is written. Applying is a separate deliberate action.

**Write and verify.** Sequential, with progress. Then read back and report drift.

**Save.** Name the preset (default to the generated name), pick a slot, store.
Write the name before storing — store is what persists it.

**Hand editing.** Per-block parameter editing with the same staged-then-confirmed
contract, so there is one rule for how values reach hardware. Show output levels
read-only.

**Change log.** Timestamped record of every write. A preset carries no history,
and "what did it actually change?" is the first question when something sounds
wrong.

**Diagnostics.** A panel showing what went on the wire per write: value wanted,
normalised value sent, what that converts back to, and the range used. Copyable as
text. Given that out-of-range writes report success, this is the only way to
debug the write path without reading browser devtools.

**Cost.** Price each run from returned token counts. The input side is dominated
by the model roster and block schema and grows with the preset, so cost per
generation is not obvious. Show a session total.

**Version.** Show the app version and git commit. A stale deployment is easily
mistaken for a code bug.

## Design

Ground it in the instrument: anodised black chassis, warm silkscreen lettering,
and colour used only where it means something — one colour for signal path, one
for device connection. Nothing coloured for decoration. Equipment-panel
typography, wide and letterspaced for labels. The routing grid is the signature
element; keep everything around it quiet.
