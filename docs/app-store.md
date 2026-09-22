# Getting onto the App Store

Everything App Store Connect asks for, answered. Copy the fields straight
across; the notes say why an answer is what it is where that matters.

**The one that gets apps like this rejected** is at the bottom, under *Review
notes*. Read that one even if you skip the rest.

---

## The listing

| Field | Limit | Value |
|---|---|---|
| **Name** | 30 | `Fractal Remote` |
| **Subtitle** | 30 | `Run your rig from your phone` |
| **Category** | — | Primary: **Music**. Secondary: **Utilities** |
| **Price** | — | Your call. Paid, per what we discussed |

### Promotional text (170, editable any time without a new build)

```
Your setlist, your scenes and your whole chain on the phone in your hand —
and a tuner you can read from the back of the stage.
```

### Keywords (100, commas, no spaces after them)

```
guitar,amp,fm3,fm9,axefx,am4,vp4,preset,scene,setlist,tuner,rig,stage,pedalboard
```

Naming the hardware you work with is ordinary and allowed — it is how someone
searching for it finds you. It is also why the affiliation disclaimer matters:
the listing says which gear this works with, and never implies it comes from
the people who make that gear.

### Description

```
Fractal Remote puts your rig on your phone.

Plug your Fractal unit into a computer, open Fractal Remote on your phone, and
everything the unit can do is in your hand — from the back of the stage, from
the couch, or from the other side of the room.

WHAT YOU CAN DO

• Change presets and scenes, with names you can actually read
• See your whole signal chain and switch blocks in or out
• Tune up, with a display readable at a distance in the dark
• Build setlists and star the presets you reach for
• Reach for a knob and change it without walking back to the rack

ON YOUR OWN WIFI, NOTHING LEAVES THE ROOM

No account. No sign-up. Your phone talks to your computer, your computer talks
to your unit, and that is all that happens. If you want to reach your rig from
somewhere else, sign in and it follows you.

BUILT FOR A STAGE, NOT A DESK

Big targets you can hit without looking. A screen that stays readable when the
lights go down. Nothing that needs two hands.

WHAT STAYS AT THE COMPUTER

Saving to a slot, backups, restores and firmware are refused from a distance —
by your computer, not by this app. A phone on a dark stage should not be able
to overwrite a preset you spent a week on.

WHAT YOU NEED

• A Fractal Audio unit — FM3, FM9, Axe-Fx, AM4 or VP4
• A Mac or Windows computer with a USB cable to the unit
• The free Fractal Remote app for that computer, from fractal.newbold.cloud

JUST LOOKING?

Tap "Try the demo" on the first screen. It is a simulated FM3 — every screen
works, with no hardware at all.

Fractal Remote is an independent app. It is in no way affiliated with,
endorsed by, or sponsored by Fractal Audio Systems, Inc.
```

### URLs

| Field | Value |
|---|---|
| Support URL | `https://fractal.newbold.cloud/support.html` |
| Marketing URL | `https://fractal.newbold.cloud` |
| Privacy Policy URL | `https://fractal.newbold.cloud/privacy.html` |

---

## Screenshots

Required for **6.9" iPhone** (1290 × 2796 or 1320 × 2868). Because
`supportsTablet` is on, **13" iPad** (2064 × 2752) is required too — turning
tablet support off is the alternative and would be a worse app.

Up to 10 each; 3–5 is plenty. Take them **in the demo**, so every screen is
full of real-looking presets rather than "no computer".

Worth showing, in this order:

1. The stage screen with a preset up and scenes along the bottom
2. The chain, with blocks on and off
3. The tuner
4. A setlist
5. Setup, showing it connected

---

## App Privacy (the nutrition label)

Answer **Yes** to collecting data, then declare exactly these. Everything is
**"used for App Functionality"**, and **nothing is used for tracking** — say No
to the tracking question, because it is true and it keeps you out of App
Tracking Transparency entirely.

| Data type | Collected | Linked to the user | Why |
|---|---|---|---|
| Contact Info → **Email Address** | Yes | Yes | Account sign-in, and answering a support message if they leave one |
| User Content → **Other User Content** | Yes | Yes | Setlists, so they follow you between devices |
| Identifiers → **User ID** | Yes | Yes | The account id that ties your setlists to you |
| Diagnostics → **Other Diagnostic Data** | Yes | Yes | The debug log, and only when somebody presses Send on a bug report |

Do **not** declare location, contacts, photos, audio, purchases, search
history, browsing history or advertising data. None are collected — and the
privacy page says so, so a wrong answer here contradicts a published document.

**Why the log is declared even though it is opt-in:** Apple asks what the app
is *capable* of sending, not what it usually sends. Declaring it and being able
to point at a policy that explains it is the strong position.

---

## Age rating

**4+.** Every question in the questionnaire is None / No. There is no user
generated content shown to other people, no web browsing, no gambling, no
contests and no messaging between users — a bug report goes to one inbox and
is never shown to anyone else.

---

## Export compliance

**Already handled — nothing to do.** The app uses HTTPS and nothing else,
which is standard encryption and exempt, and `mobile/app.json` already carries
`ITSAppUsesNonExemptEncryption: false` in its `infoPlist`. That answers the
question automatically on every submission rather than asking you each time.

---

## Only you can do these

- **Paid Applications Agreement** — App Store Connect → Business. Until it is
  signed and active, a paid app cannot be sold at all.
- **Banking and tax forms** — same place. These take the longest, sometimes
  days, so start them before you need them.
- **The app record itself** — bundle ID `cloud.newbold.fractalremote`.

---

## Review notes

**Paste this into App Review Information → Notes.** This is the paragraph that
decides whether the app is rejected as non-functional.

```
This app is a remote control for Fractal Audio guitar hardware. Normally it
connects to a computer that has the guitar unit plugged into it over USB.

You will not have that hardware, so the app includes a full demo mode that
needs nothing but the phone, and no account:

  1. Tap "Get started"
  2. Tap "Got it"
  3. Tap "Start free demo"
  4. Choose any unit, then tap "Play with ..."

That loads a simulated unit with twelve presets and named scenes. Every
screen works — presets, scenes, the signal chain, the tuner, tap tempo,
setlists, settings. Nothing in the demo reaches real hardware.

The demo is free and needs no account. An account is used for one thing
only: joining this phone to a computer that has the guitar unit plugged
into it.

If you would prefer to review a signed-in account instead, please ask and we
will provide credentials.
```

**Why this matters more than anything else here.** A reviewer opens the app,
sees "no computer", and has no way to know there is anything behind it. The
demo is three taps in, but only if somebody tells them it is there.

**AND WHY IT IS WRITTEN OUT TAP BY TAP.** The paragraph that used to be here
said *"On the first screen, tap 'Just looking? Try the demo'"* — a button that
had not existed for months, on a screen that is not the first one. A reviewer
following it would have looked for a label that was not there, on a screen
where it never was, and concluded the app does nothing. It also claimed the
app worked "on a local network" without an account and that signing in was
only for reaching a computer from outside your home wifi, both of which
stopped being true when pairing became account-only.

Store copy goes stale silently, because nothing in the build reads it. When a
button on the way into the demo is renamed, this is the other place to change.
