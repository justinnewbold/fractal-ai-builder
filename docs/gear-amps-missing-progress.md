# Missing amp families — photo progress

**Date:** 2026-09-18 (MT)

## Counts

| Status | Count |
|--------|------:|
| ok | **14** |
| substituted | **2** |
| missing | **0** |
| **Total** | **16 / 16** |

All files under `processed/{slug}.jpg` are **1200×900** JPEG ~q80, **&lt; 200 KB**, white canvas, centered (no stretch).

## Per-slug

| slug | status | source |
|------|--------|--------|
| archean | ok | Andertons / PRS Archon Classic 50 |
| deluxe-6g3 | ok | GuitarPlayer / brownface Deluxe 6G3 |
| diamante | ok | SoundUnlimited / Diamond Del Fuego |
| friedman-hbe | ok | Friedman Amplification BE-100 Deluxe (HBE) |
| plexi | ok | Wikimedia / Marshall 1959SLP Plexi |
| plexi-studio-20 | ok | Andertons / Marshall SV20H |
| recto2 | ok | Andertons / Mesa Dual Rectifier 3ch |
| revv-gen | ok | Andertons / Revv Generator 120 |
| solo-99 | ok | Audiofanzine / Soldano Caswell X99 (rembg) |
| suhr-badger-18 | substituted | Suhr Badger family face-on (panel reads Badger 35) |
| suhr-badger-30 | substituted | Suhr Badger family face-on (same as 18; Badger 35 panel) |
| supro-black-magick | ok | Swee Lee / Supro 1695TJ Black Magick |
| triple-crest | ok | Guitar Center / Mesa Triple Crown TC-100 |
| usa-jp | ok | Andertons / Mesa JP-2C |
| usa-mk-iv | ok | Wikimedia Commons MarkIV.jpg (rembg) |
| usa-mk-v | ok | Russo Music / Mesa Mark V |

## Outputs

- Photos: `/workspace/fractal-photos/processed/{slug}.jpg`
- CSV: `/workspace/fractal-photos/gear-amps-missing.csv` (16 rows + header)
- Manifest: appended to `/workspace/fractal-photos/manifest.jsonl`
- Progress: `/workspace/fractal-photos/gaps/missing-amps-progress.md`

## Notes

- **substituted (2):** Suhr Badger 18/30 unique labeled product shots not found; used official Suhr Badger family front (chassis family match; panel text says Badger 35).
- Friedman HBE uses BE-100 Deluxe manufacturer front (HBE is a BE-100 channel/mode) — marked **ok**.
- Mark IV is a combo shot (same Mark IV control panel as the head).
- Git: **not pushed**.

