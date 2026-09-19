# Missing drives photo progress

- Total requested: **21**
- ok: **20**
- substituted: **1**
- missing: **0**
- processed files: **21**

All outputs are **1200×900** JPEG (~q80), **under 200 KB**, white canvas, centered (no stretch).

## Per-drive status

| slug | status | bytes | notes |
|---|---|---|---|
| `klone-chiron` | ok | 64805 | Music Zoo Klon Centaur gold horsie face-on |
| `esoteric-bass-rcb` | ok | 62247 | Thomann Xotic Bass RC Booster V2 |
| `griddle-cake` | ok | 52018 | Equipboard Crowther Hot Cake |
| `bosom-boost` | ok | 52801 | Thomann Friedman Buxom Boost |
| `od-one-overdrive` | ok | 48080 | ModularGrid Boss OD-1 |
| `nobelium-ovd-1` | ok | 55774 | Thomann Nobels ODR-1 BC (Nobelium based-on) |
| `sunrise-splendor-hi-cut` | ok | 53429 | Same Morning Glory V4 photo as sunrise-splendor (Hi-Cut = switch) |
| `gauss-drive` | ok | 59650 | Thomann Mesa Flux-Drive |
| `sunrise-splendor` | ok | 53429 | Thomann JHS Morning Glory V4 |
| `integral-pre` | ok | 59970 | ModularGrid TC Integrated Preamp + rembg |
| `colortone-booster` | ok | 41847 | Kitrae Colorsound Power Boost + rembg |
| `colortone-od` | ok | 40966 | Equipboard Colorsound Overdriver |
| `mosfet-distortion` | ok | 29673 | Equipboard Ibanez MT10 Mostortion |
| `super-fuzz` | ok | 84918 | Coda Effects Univox Super-Fuzz + rembg |
| `77-custom-od` | ok | 54520 | Thomann MXR M77 Custom Badass |
| `angry-chuck` | ok | 41591 | Thomann JHS Angry Charlie V3 |
| `guardian-photon-speed` | ok | 47608 | Greer Amps Lightspeed manufacturer PNG |
| `paradigm-shifter` | ok | 105531 | Andertons Barber Gain Changer SR |
| `noamp-bass-di` | ok | 68172 | Thomann Tech 21 SansAmp Bass Driver DI V2 |
| `noamp-bass-pre` | substituted | 68172 | Substituted: same Bass Driver DI (speaker-sim off mode) |
| `royal-bass-di` | ok | 55438 | Noble Amps Preamp DI manufacturer shot |

## Output paths
- Processed: `/workspace/fractal-photos/processed/{suggested_slug}.jpg`
- CSV: `/workspace/fractal-photos/gear-drives-missing.csv` (columns match `gear-amps.csv`, `kind=pedal`)
- Manifest: appended to `/workspace/fractal-photos/manifest.jsonl` with `kind=pedal`

## Notes
- `sunrise-splendor-hi-cut` uses the same Morning Glory V4 product photo as `sunrise-splendor` (Hi-Cut is a switch on the same pedal) — marked **ok**.
- `noamp-bass-pre` reuses the SansAmp Bass Driver DI photo (Fractal Pre = speaker emulation bypassed) — marked **substituted**.
- Prefer unique real product photos from manufacturers, Thomann, Equipboard, ModularGrid, Kitrae, Coda Effects.

**Git: not pushed** (local only).
