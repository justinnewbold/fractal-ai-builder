# Deep amp hunt: beyond Commons (2026-09-24)

Targets: `deep-missing-amp.csv` (77 rows). Working files: `/workspace/fractal-photos/deepamp/`.

## Added (1)

| slug | source | licence | credit |
|---|---|---|---|
| boutique (Matchless Chieftain) | https://www.flickr.com/photos/devilelephant/3736142367/ | CC BY-SA 2.0 | George Coller |

The photo shows a Matchless head with a "Chieftain" script on the faceplate and knobs for Volume, Bass, Mid, Treble, Brilliance, Master and Reverb. The same account's photo of the back panel (3736937626) also shows "Chieftain". It is shot at about 30° off-axis rather than straight on. It is cropped to the unit, padded to 1200x900 with the photo's own edge colours, and saved at q80, 130 KB. The row was appended to `sources.csv` under flock.

## What was searched
- **Flickr:** searched the site's pages with the licence filter set to 4,5,8,9,10,11,12 (CC BY/BY-SA 2.0 and 4.0, CC0, PDM, US Gov). Each model got 3–6 text and tag queries, for about 400 queries. I also ran broad queries up to 12 pages each ("marshall amp", "fender amp", "mesa amp", "amp head", "tweed amp", "guitar amplifier" and more). I scanned the full photostreams of Roadside Guitars, art-sarah and filippovancini (NAMM 2008).
- **Commons:** re-checked with about 60 more queries, including brand + NAMM, German/Spanish/French terms and model codes.
- **Openverse:** the box IP is Cloudflare-blocked (429). Via WebFetch it adds nothing beyond Flickr/Commons, and the other sources it covers (rawpixel, stocksnap, wordpress) only have generic amps.
- **Met Open Access:** no matching amps.
- **Smithsonian:** the API DEMO_KEY was rate-limited and the site was down.
- **Unsplash and Pexels:** both block scripted access (401 / Cloudflare). They were not searched.

## Near-misses I rejected, which you can review
- **brit-afs100 / brit-super:** Commons "Afd100 gold top.png" and "Goldtop with afd100.png" (CC BY-SA 4.0, Yehoash). The uploader says it's an AFD100, but the 768px bedroom snapshot doesn't show a readable badge, and the head would be about 300px wide.
- **brit-jm45:** Commons "JTM 45 MK II Reissue 1997.jpg" is the right model but licensed **GFDL only**, which isn't on the allowed list.
- **59-bassguy:** Roadside Guitars Flickr 3288593900 (CC BY-SA 2.0) is a '59 Bassman LTD reissue with the "Fender Bassman" badge. The cab worker already used it for `4x10-bassguy-ri`. I left it out here because mic stands cover much of the front and the amp is only about 340px wide. It is a fallback if a weak image beats none.
- **angle-severe:** Flickr 48324957456 (pasfam, CC BY) shows a readable "Savage 120" badge, but it is a 3D render, not a photo.
- **5f1-tweed:** Flickr 55042130733 (wbaiv, CC BY-SA 4.0) is tagged '56, which makes it a 5E1 rather than a 5F1. A dealer price tag also covers the front.
- **hot-kitty:** Commons "Badcatjem.jpg" (PD) is a Hot Cat **15**, not the Hot Cat 30.
- **5f8-tweed:** Commons Bonhams/Clapton photo (CC BY 2.0) is a 1957 **5E8-A** Twin, not the high-powered 5F8.
- **tremolo-lux:** Vacant Fever's '63 Tremolux is a blonde 6G9 piggyback in a Polaroid, not the blackface AA763. mobilesage's photo is a dark stage shot.
- **vibrato-lux:** only 1966 blackface Vibrolux Reverbs exist, not the brownface 6G11.
- **euro-blue:** filippovancini's "Bogner Stack" is a Shiva, not an Ecstasy.
- **solo-88:** the Soldano photos are a Decatone, SLO-100 and SP-77, not the X88R or X99.
- **ca3-plus:** the Custom Audio photos are OD-100 heads, not the 3+ SE preamp.
- **suhr-badger-30:** art-sarah's Guthrie Govan rig photo (CC BY-SA) is a dark stage shot with a guitar in front of the head.

## Most notable still missing
No openly licensed photo turned up for:
- **Modern/boutique heads:** Diezel VH4, Bogner Uberschall / Ecstasy 20th, Friedman BE-100 / HBE / Dirty Shirley / Small Box, Mesa Mark V / JP-2C / Triple Crown / Mark IIC+ / TriAxis, PRS Archon, Revv Generator, Suhr Badger 18/30, Marshall JVM410HJS / SV20H / 1987X / JMP-1, Engl Savage (real photo), Orange AD200B.
- **Vintage Fenders:** 5F1 Champ, 5F8 Twin, brownface 6G3 Deluxe and 6G11 Vibrolux, blackface Tremolux, Vibro-King.
- **Others:** Supro 1964T Dual-Tone and Black Magick, Gibson Scout, Trainwreck (all), Dumble-style and small-builder amps (Bludotone, Blankenship, Carol-Ann, Komet, Cameron, Splawn, Hook, Paul Ruby, Diamond, Morgan, Divided by 13, Dr. Z, Carr, Fuchs, Two-Rock, Swart, Cornford, Budda).

Realistic next steps are Unsplash/Pexels through a real browser, which couldn't be scripted here, or photographing or asking owners.
# Deep cab hunt: report (2026-09-24)

Scope: 29 slugs in `deep-missing-cab.csv`. Sources searched: Flickr (server-rendered search with the licence filter
4,5,9,10,11,12 = CC BY 2.0 / BY-SA 2.0 / CC0 / PDM / BY 4.0 / BY-SA 4.0, about 190 query variants including multi-page and
per-photographer searches), Openverse (the anon API hit a Cloudflare challenge after a few calls, so I only got partial
coverage, and what I did get just mirrored Flickr and Commons), Wikimedia Commons (re-checked with German and other
non-English terms), Unsplash and Pexels (search pages are blocked for both curl and the fetch tool, so I only did a few web
searches), and Smithsonian (API over its rate limit and the site was down).

## Added (2)

| slug | source (photo page = rights_url) | holder | licence | notes |
|---|---|---|---|---|
| 4x12-recto-slant | https://www.flickr.com/photos/32742419@N04/3193180622/ | Roadside Guitars | CC BY-SA 2.0 | Face-on shot of a Mesa Rectifier Standard 4x12 slant cab (the owner's caption says the V30s are original). Licence checked on the page. |
| 4x10-bassguy-ri | https://www.flickr.com/photos/32742419@N04/3288593900/ | Roadside Guitars | CC BY-SA 2.0 | Face-on tweed Fender Bassman ('59 Bassman LTD reissue per a companion photo, 3288600118). **Caveat:** 3 studio mics and stands sit in front of the grille. The whole unit and the badge are visible, but swap it out if a cleaner shot turns up. |

Files: 1200x900 JPEG, q75–80, <200 KB, padded with the median edge colour. Rows appended to `sources.csv` under an flock.

## Candidates rejected (and why)
- 1x8-5f1-tweed: baka_san (CC BY 2.0, flickr 4818185206) is a 5F1 **kit clone** with no badge, shot at an angle. It's not a Fender, so I rejected it. Bill Abbott's "1956 Champ" (CC BY-SA 4.0, 55042130733) is a 5E1-era Champ (6" speaker, smaller cab), not a 5F1, and it has a price tag on it. Roadside's Champion 600 photos show the wrong model.
- 1x12-black-magick: the only Flickr photos (Nicholas Branstetter, Alain Asenjo) are All Rights Reserved or BY-NC-ND.
- 2x12-chiefman: George Coller's photos (CC BY-SA 2.0, 3736937626 and 3736142367) show a Matchless Chieftain **head**, not the 2x12 cab or combo.
- 4x12-5153-stealth / 2x12-5153-stealth: fvancini only shot the standard ivory-grille 5150III stack (already used for 4x12-5153). Nothing shows the Stealth.
- 4x12-1960tv: all the Marshall cabs I found are 1960A slants (Roadside 3214237010 and others) or unidentified.
- 4x12-recto-straight / 4x12-usa-mc90: the only straight Recto shots are distant, blocked-off booth shots in fvancini's "Mesaboogie Family" (2874740969). Not usable.
- 4x12-solo-100: fvancini's Soldano photos show heads only.
- 1x15/2x10-heart-key: the only Hartke cab photo is a 4x10 Transporter (Henrik Ström 3095800951). Nothing for the 1x15 or 2x10.
- Friedman (GB/V30), Carr Rambler, Divided by 13 CJ11, Fuchs, Rockman/Scholz, Vox AC20, tweed Princeton, Tweed 20, Metro Blues: I found no openly licensed photos at all.

## Still missing (27)
1x8-5f1-tweed, 1x8-princetone, 1x10-metro-blues, 1x12-ac20, 1x12-black-magick, 1x12-car-ambler, 1x12-div13-cj11,
1x12-g12t-100, 1x12-nuclear-tone, 1x12-scholz, 1x12-tweed-20112, 1x15-heart-key, 2x10-heart-key, 2x12-5153-stealth,
2x12-65-bassguy, 2x12-chiefman, 2x12-lead-80, 4x12-1960tv, 4x12-5153-stealth, 4x12-friedman-gb, 4x12-friedman-v30,
4x12-lerxst, 4x12-recto-straight, 4x12-rumble-ev12l, 4x12-rumble-ev12s, 4x12-solo-100, 4x12-usa-mc90.

Notes: several slugs (g12t-100, lerxst, rumble-ev12l/s, lead-80, scholz) are generic or Fractal-internal IR cabs with no single
real product to photograph. Openly licensed coverage of boutique brands (Friedman, Carr, D13, Fuchs, Supro reissue) looks
close to zero. The raw scratch data (Flickr hit DB, contact sheets) is in /workspace/deepcab/.
# Deep pedal hunt: report (2026-09-24)

Targets: `deep-missing-pedal.csv` (35 drive/fuzz/boost slugs). Sources searched: Flickr (licence filter 4,5,9,10,11,12 = CC BY / BY-SA 2.0 and 4.0, CC0, PDM; text and tag queries, plus user-stream sweeps of pedal-heavy accounts: germanium/Johann Burkard, Mekkjp, ArtBrom, marcelodonati, wetwebwork, Roadside Guitars, Guitar Chalk, Bill Abbott), Openverse (including non-Flickr/Commons sources), Commons Special:Search re-check with quoted, variant and non-English terms, Smithsonian open access (via Openverse), and Unsplash/Pexels through web search. Unsplash, Pexels, collections.si.edu and the SI API all blocked direct access or were rate-limited.

## Added (5)
| slug | photo | licence | holder | rights_url |
|---|---|---|---|---|
| suhr-riot | Original purple Suhr Riot (Dist/Tone/Level knobs, Voice switch), angled 3/4 top view. The photographer's watermark is cropped out. | Public Domain Mark 1.0 | Андрей Вольский (Andrey Volskiy) | https://www.flickr.com/photos/141965115@N04/26225433820/ |
| distortion-ds1-mod | Boss DS-1, top-down, with an added mod toggle switch (Flickr title: "Keeley DS-1 Ultra Mod") | CC BY 2.0 | wetwebwork | https://www.flickr.com/photos/82832950@N00/5661482568/ |
| t808-mod | Ibanez TS808 Tube Screamer, face-on 3/4. It is a different frame from the one used for t808-od. | CC BY 2.0 | Guitar Chalk | https://www.flickr.com/photos/161844010@N02/48587942471/ |
| ts9dx-plus | Ibanez TS9DX Turbo Tube Screamer, top-down (4 knobs incl. MODE with HOT/+/TURBO markings) | CC BY 2.0 | Helterr | https://www.flickr.com/photos/79442148@N06/7383773138/ |
| ts9dx-plus-hot | Same TS9DX image as ts9dx-plus. "Hot" is a mode on the same pedal, and sources.csv already reuses one image for several slugs elsewhere. | CC BY 2.0 | Helterr | (same) |

Notes / caveats for review:
- **t808-mod and distortion-ds1-mod:** Fractal's "Mod" models are virtual mods of the stock TS808 and DS-1, so these images show the real base pedals. The DS-1 one really is a modded DS-1. Drop them if you want the "Mod" slugs to stay imageless.
- **suhr-riot:** PDM was applied by the photographer on Flickr. The photo is angled rather than top-down, and the background is grass and a box, padded in neutral grey.
- **ts9dx:** The source is a 1024 px Flickr size with dim lighting. The whole unit and graphics are readable. Flickr refused larger sizes (HTTP 429).
- All images are 1200x900 JPEG, q80, under 100 KB. sources.csv was appended under flock.

## Still missing (30), with nothing usable found
blackglass-b7k (Darkglass B7K), blues-od (Marshall Bluesbreaker Mk1; only BB-2 exists), box-ocrunch (MI Audio Crunch Box), heartpedal-11 (Lovepedal OD11; Burkard's Lovepedal shots show COT50/Eternity/Black Magic/Toxic only), hoodoo-drive (Voodoo Lab OverDrive), horizon-precision-drive, jam-ray (Vemuram Jan Ray; the only Flickr hit is a Facebook screenshot), mcmlxxxi-drv, octave-distortion (Tycobrahe Octavia; only a CC BY scan of a 1970s ad, no real unit), fat-rat, sonic-drive (SD-9), tone-of-kings (King of Tone), tube-drive (Butler Tube Driver), zen-master (Zendrive; germanium's "Hermida" tag is the Mosferatu), esoteric-bass-rcb, griddle-cake (Crowther Hot Cake), bosom-boost (Buxom Boost), nobelium-ovd-1 (only ODR-mini), sunrise-splendor and sunrise-splendor-hi-cut (JHS Morning Glory V4), gauss-drive (Flux-Drive), integral-pre, colortone-od (Colorsound Overdriver), mosfet-distortion (MT10), super-fuzz (Univox), 77-custom-od (MXR M77), guardian-photon-speed (Greer Lightspeed), paradigm-shifter (Barber Gain Changer), noamp-bass-pre (all CC SansAmp Bass Driver photos, from Roadside Guitars and 6SN7, are V1 without the Mid knob, not V2), royal-bass-di (Noble).

Rejected candidates: Marshall BB-2 (wrong generation), Nobels ODR-mini (wrong variant), SansAmp BDDI V1 (wrong version for the V2 slug), Vemuram Facebook screenshot, and group or pedalboard shots too small to crop (germanium "Pedal collection", marcelodonati inventories, Mekkjp boards, Vernon Reid board at NMAAHC, which has a RAT and MXR only).
