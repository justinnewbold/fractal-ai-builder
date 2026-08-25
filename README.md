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
- Parameter writes take **real units** — `{"value": 9}` for a gain that runs
  0–10, not a normalised 0–1.
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
- [ ] Phase 2 — tone description to validated parameter set
- [ ] Phase 3 — preset naming, save flow, scenes

## Credits

Device protocol by [ForgeFX](https://github.com/sKuhLight/ForgeFX) and
[forgefx-midi](https://github.com/sKuhLight/forgefx-midi), both MIT/Apache-2.0 and
independent of Fractal Audio Systems. "FM3", "Axe-Fx" and "FM9" are trademarks of
Fractal Audio Systems, used here for identification only.
