# Photos of the real gear

The app names its models after real amplifiers and pedals — a "Brit 800" is a
JCM800 — and this is how a photograph of the real thing gets next to the model.

**Everything here is data, not code.** The photos live in Supabase, not in the
app bundle. That is the whole point: adding a photo, fixing a wrong one, or
adding fifty more never costs an App Store build and never needs a release.

## Where it goes

| | |
|---|---|
| Project | `fractal-ai-builder` — `biznwrqeckviawjuhvyg` |
| Bucket | `gear` (public, 1 MB per file, JPEG / PNG / WebP only) |
| Table | `public.gear` |
| Public URL | `https://biznwrqeckviawjuhvyg.supabase.co/storage/v1/object/public/gear/<file>` |

The bucket is readable by anyone and writable by nobody through the app's
public key. Rows and files arrive through the Supabase dashboard or the service
role — never from a phone.

## The photo

| | |
|---|---|
| Size | **1200 × 900**, exactly |
| Shape | 4:3 landscape |
| Format | **JPEG**, quality around 80 |
| Weight | **under 200 KB** — the bucket refuses anything over 1 MB |
| Background | plain and light, or the product shot as the maker published it |
| Framing | the whole unit, face on, small even margin, nothing else in frame |

1200 × 900 is picked from the screen it lands on: a tile the width of a phone
on a 3× display is about 1080 pixels, so this has enough and no more. Anything
larger is bytes somebody downloads on venue wifi and never sees.

## The file name

The slug, then `.jpg`. Lower case, dashes between words, nothing else — no
spaces, no capitals, no underscores, no brackets.

```
boss-ds-1.jpg
mesa-boogie-mark-iv.jpg
marshall-jcm800-2203.jpg
ibanez-ts808.jpg
electro-harmonix-big-muff-pi.jpg
```

The file name **is** the join key. `boss-ds-1.jpg` in the bucket belongs to the
row whose slug is `boss-ds-1`. Get the name right and nothing else has to be
wired up.

## The row that goes with it

One row per piece of gear. A CSV with these columns imports straight into the
table from the dashboard:

| Column | What goes in it |
|---|---|
| `slug` | `boss-ds-1` — matches the file name, without `.jpg` |
| `kind` | one of `amp`, `cab`, `pedal`, `mic` |
| `maker` | `Boss` |
| `model` | `DS-1 Distortion` |
| `year_from` | `1978`, or leave empty |
| `blurb` | one or two sentences, written for a player |
| `fractal_names` | what the unit calls it, in braces: `{"Master Fuzz","Fuzz Face"}` |
| `photo_path` | `boss-ds-1.jpg` — leave empty until the photo exists |
| `photo_credit` | who took it, or where it came from |
| `photo_license` | what we are allowed to do with it |

`fractal_names` can be empty (`{}`) where nothing in the unit matches — a row
with no model behind it is still worth having for a pedal somebody owns.

## Two things worth being careful about

**Photographs are somebody's property.** A picture pulled off a shop listing or
a forum is copyrighted, and this app goes on the App Store. Safe sources, in
order: photos taken of gear in this house; manufacturer press and product shots
(most makers publish these and permit their use); Wikimedia Commons, minding
the licence on each one. Fill in `photo_credit` and `photo_license` as the
photo is collected — going back later and working out where two hundred images
came from is a job nobody finishes.

**A missing photo is normal.** Rows are useful with `photo_path` empty; the app
shows the name and the blurb and leaves the space alone. Load every row first,
add photos as they arrive.

## Uploading

Through the Supabase dashboard: Storage → `gear` → Upload files, and a whole
folder can be dragged in at once. The table takes a CSV the same way, under
Table Editor → `gear` → Import data from CSV.

Nothing about this needs an API key, and nothing about it should be handed one.
