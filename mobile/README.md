# Fractal Remote for iOS and Android

The phone in your hand at the far side of a stage. Sign in with the same account
as the Mac holding the USB cable, and this drives the unit plugged into it — the
preset, the scenes, what's engaged, the tempo, the tuner.

## Why an app and not the web page

The hosted web app already does this, and on Android it does it well. Three
things it cannot do, all of which matter on a stage:

- **Safari.** iOS blocks a secure page from calling `http://localhost`, which is
  how the app reaches the device server. Safari has never been able to run this
  at the Mac, and a phone loading the hosted URL can't reach a LAN address
  either. An app has no such rule.
- **The screen going out.** A web page cannot stop a phone locking itself. This
  keeps the screen awake for as long as the stage screen is open, so the remote
  is still there when the count-in starts.
- **The case.** A control you press in the dark should say so through the case.
  Every button here does.

Nothing about the protocol changes. This is the same relay, joining the same
private channel, refused the same things by the same host.

## How it reaches your Mac

```
phone (this app) ──▶ account service ──▶ ForgeFX on your Mac ──▶ the unit over USB
```

Both ends sign in as the same person and meet on a private channel named after
that account. Nobody else can join it — not by convention, by policy: the
project's rules let a signed-in user read and write only their own channel, so a
stranger holding the app's publishable key gets a channel of their own with no
Mac on it.

Which means the setup is one step. Turn on phone remote in the desktop app,
sign in here with the same email, and the two find each other.

## What it will not do

Saving to a slot, backups, restores, firmware and raw SysEx are refused — by
your Mac, not by this app. A phone on a dark stage should not be able to
overwrite a preset you spent a week on. The app knows the same rule the host
enforces and says so in words before you press, rather than surfacing a status
code halfway through a song.

The rule lives in `shared/relay-rules.mjs` and is copied here by
`npm run sync:rules` at the repository root. `npm test` regenerates the copy in
memory and fails if it differs, so the two ends cannot drift.

## The tuner

`POST /tuner` is allowed remotely and works: the unit starts polling. The
readings are a different matter, and the reason is the host rather than this
app — ForgeFX's relay bridges discrete change events and deliberately filters
the roughly eight-per-second telemetry streams, tuner included, to keep the
channel quiet. So the poll runs at the Mac and every answer stays there.

After five silent seconds the tuner screen says exactly that, instead of showing
a needle that will never move. Adding `'tuner'` to that host-side set turns the
stream on for remote sessions; this app already listens and needs no change to
benefit.

## Two Macs on one account

A request is shouted on one channel per account, not addressed to a machine. So
with two Macs signed in, a read is answered by whichever was quicker and a
write is carried out on **both units**.

On connect the app takes a roll call — one read, every answer counted rather
than the first — and if more than one Mac answers it stops writing anything and
says which Macs and what to do. Choosing one addresses requests to it, and the
choice is then *proved* by asking that Mac one addressed question and counting
the answers: exactly one means the others stayed out of it. Anything else means
a Mac is running a version too old to tell requests apart, and writes stay
refused. A mixed pair fails safe rather than quietly.

## Building it

Cloud builds, no Xcode and no Android Studio:

1. Add an [Expo access token](https://expo.dev/settings/access-tokens) with build
   permission as the repository secret `EXPO_TOKEN`.
2. Actions → **mobile** → Run workflow. Pick a platform and a profile.
3. The build appears at [expo.dev](https://expo.dev) with an install link.

Profiles are in `eas.json`. `preview` is the one to start with — an installable
build for a device, an `.apk` on Android. `production` is what goes to the App
Store and Play.

Every pull request that touches this directory bundles both platforms already,
so a broken import is caught before a build machine ever sees it.

## Working on it locally

Only if you want to; the workflow above needs none of this.

```bash
cd mobile
npm install
npx expo start
```

Then open it in Expo Go, or in a development build if you need one. The stage
screen needs a Mac at the other end — there is no demo device here the way there
is in the web app.

## What's where

| File | What it holds |
| --- | --- |
| `src/lib/relay.js` | Signing in, joining, and one request over the channel |
| `src/lib/relay-rules.js` | Generated. What may travel and what may not |
| `src/lib/decode.mjs` | The three framings the host sends, without browser APIs |
| `src/lib/device.js` | The unit's own API, the slice a stage needs |
| `src/lib/unit.mjs` | What is true about a unit without asking it |
| `src/lib/rig.js` | One store, one event subscription, optimistic writes |
| `src/lib/link.js` | Staying joined across locks, backgrounds and handovers |
| `src/screens/Stage.js` | The stand, not the bench |
