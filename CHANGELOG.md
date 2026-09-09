# Changelog

Versions are `MAJOR.PHASE.PATCH` — major is the architecture, phase tracks the
roadmap in the README, patch is everything since.

## 7.132.1

**The chat says which model answered.** When the chat's model is refused
and the designer's model answers instead, the reply now carries both
names and the reason, so the cost panel and the logs can tell "the
account has no Opus" from "the chat is set to Sonnet".

## 7.132.0

**Ask is your Fractal agent now.** "Why did you choose the tones that you
did? Where did you get your information from?" came back as "That
question isn't about the Fractal preset or your rig." It was built as a
command parser, and that is what the instructions said it was. Now it is
told who it is: the player's Fractal agent, which knows the unit, the amps
the models are based on, the players and their records, and what it has
just done itself. It answers questions properly, in paragraphs when they
deserve it, and never tells you a question is off topic. To answer "why",
it is handed the last design with the designer's own reasoning, whether
that design has been written yet, and the same taste profile the designer
uses. It reads dictation typos for what was meant. It remembers more of the
conversation, and the app's own notes in it are labelled so they are not
read as things you said. Each change it proposes now shows its reason
under it. The chat runs on Claude Opus 5 by default — its own CHAT_MODEL
setting, apart from the designer's. Also: a save reported from the Mac no
longer lands in the conversation twice.

## 7.131.0

**Previous and Next follow a setlist.** "Let's set up favorite presets and
setlist when in gig mode — hitting next or previous cycles through songs
on the favorites or setlists." The two buttons at the bottom of Play used
to step the slot number by one: 44, 45, 46, which is the unit's order and
never the night's. A new button between them says what they step through
and opens a sheet to change it: every preset as before, the presets you
have starred in the picker (in slot order), or a setlist — a named list
you build in the order you play it, from the preset you are on or by
finding one by name, with up, down and remove on each song. A setlist
wraps, so after the last song Next goes back to the first. The button
shows where you are, "Saturday 3/12". Starred and setlists are kept per
unit and per browser, like the stars.

## 7.130.0

**The scene plan names the amp on each channel.** "Does the AI check and
replace different amps based on what it finds out about the artist, or is
it just copying the amps and changing the settings?" It picks — each channel
of the amp block carries its own model — but the plan only said "Amp 1 on
channel C", so three channels looked like one amp three times. Each channel
line now names the model the plan puts there and the real amp it was
modelled on: "Amp 1 on channel C · USA Lead+ (Mesa Mark IIC+)".

## 7.129.0

**Volume first.** "Move the volume slider above the preset button." The
volume row is the first thing on Play now, above the preset tile; the
meter stays under the preset.

## 7.128.0

**The word Volume, on the phone too.** "Add the word volume somewhere on
the volume slider bar." It stood at the left on a Mac and was dropped on a
phone to keep the track wide. It now sits over the dB figure at the right,
on every screen, costing the slider no width.

## 7.127.0

**Previous / Next at the bottom.** "Move Previous / Next directly above the
bottom tap bar." The two preset buttons sat between the volume and the
scenes. They now sit right above Tuner, Tap and Ask, and the two rows stick
to the bottom of the screen together, so stepping presets is always under
your thumb however far the effects have scrolled.

## 7.126.0

**Hold a block, get a sheet of channels.** "It's tiny right now. Maybe pull
up a slide-up menu when you hold the button down to switch between A B C
D?" Holding an effect on Play (or right-clicking it on the Mac) now slides
up a sheet with the block's name and one big button per channel, the height
of a scene tile and a quarter of the screen wide. The live channel is lit;
tapping another writes it and the sheet goes down. It was four thin pills
inside the tile you were holding.

## 7.125.0

**The preset is a tile, and the size steps live in Setup.** "Make this
button smaller, the same size as the presets, move the sizing to the
Settings menu, and add the preset number to it as well as the name." The
preset name on Play was a headline that wrapped to three lines on a phone,
with the − / + size steps crammed beside it. It is now a tile the shape and
height of a scene button: the slot number small on top, the name under it,
one line. It grows and shrinks with the other tiles. The size steps are
under Button size in Setup, with the size's name between them.

## 7.124.0

**A tick or a cross in the bar.** "Make the connected button just a round
green checkmark when it is connected and a red X when it's not, the same
size as the settings gear." The word beside the gear is a round mark now:
green with a tick when the phone is connected to the Mac (or the Mac's
phone remote is on), red with a cross when it is not, amber with dots while
it is connecting. Tapping it still opens the same options, and the words
are still there for a screen reader.

## 7.123.0

**Rounded corners on Play.** "Let's make all these buttons rounded like
iOS." Every button on the Play screen — the preset name, the size and
volume steps, Previous and Next, the scenes, the effects, the channel
picker, Tuner, Tap and Ask — takes the rounder corner the app's sheets
already use, and the meter and volume track become pills. The rest of the
app keeps its hardware edge.

## 7.122.0

**A garbled preset dump is asked for again.** "PRESET_DUMP_HEADER: expected
func 0x77 at offset 0, got 0x78" on switching presets, once more. The unit
answers a preset dump as a header frame and then body chunks; a read that
lands while the unit is still loading the preset it was just sent can find a
body chunk where the header should be, and until now that came straight to
the screen as DIDN'T WORK.

- Any read that fails in those words is asked for again, twice, a moment
  apart, before anything is shown. Selecting a preset or a scene gets the
  same, because selecting twice is harmless; other writes are never re-sent.
- The volume slider re-reads the Output level when the preset changes, not
  on every re-read of the preset. Keyed the old way it added one more
  dump-hungry read at exactly the wrong moment.

## 7.121.0

**A shorter bar at the bottom of Play.** "Make the bottom tab bar buttons
smaller." Tuner, Tap and Ask stood 60px tall on a phone, with the tempo
stacked under the word Tap. They are the 44px touch minimum now, the tempo
sits beside the word, and the strip gives the row of effects above it the
room back.

## 7.120.0

**A dB at a time.** "Do a plus minus on the sides of the volume slider that
does 1 dB at a time." A − and a + now sit either side of the Play screen's
volume slider. Each press moves the Output level by exactly one dB, goes to
the unit the same way a drag does, and reads back what landed. The buttons
grey out at the ends of the range. On a phone the word "Volume" steps aside
so the track keeps its width.

## 7.119.0

**A volume slider on Play.** "Add volume slider to the play screen to
quickly turn volume up or down." It sits under the signal meter and moves the
Output block's Level — the whole preset's volume, the knob on the unit's front
panel. The number beside it is what the unit holds, read back when you let
go, not where the thumb happens to be.

- A drag sends one write at a time and the newest value wins, so a two-second
  sweep does not queue a hundred writes for the unit to work through after
  your thumb has stopped.
- The slider is absent, not greyed, on a unit whose output block reports no
  level the app can move.
- The Output level stays the player's alone: the model still may not touch it.

## 7.118.0

**The red mark on every push.** "I keep getting a failed notification from
GitHub every time you push." The check that every change carries a new version
compared the branch against the main branch as it stood when the check ran.
Pull requests here are merged within seconds of being pushed, so by then main
already had the new version, and the check said "still the same" about a change
that had moved it. It now compares against the commit the pull request was
based on, which is fixed at the push and cannot be overtaken by the merge.

## 7.117.0

**"Turn the volume down a little" does something.** It answered "Nothing to
change." — the model had returned no actions and no words, because the whole
preset's Output is the player's and it had nowhere else to go, and "nothing to
change" was the app's default for a silence.

- The model is told what volume means here: the amp block's Level, nudged
  within the window it is already allowed, or the last block with a Level when
  there is no amp. Output stays the player's, and is never a reason to refuse.
- The model is told never to answer with silence: say what changed, or say why
  not and what would work.
- And the app keeps the same promise on its side. A reply with nothing in it
  now reads "I couldn't work out what to change for that" and shows what to
  say instead, and a plan whose every change was refused says so with the
  reasons beneath it.

## 7.116.0

**One clock while the model thinks.** The line read "Thinking… 30s · 37s":
the server's heartbeat wrote its own count, rounded to tens, beside the live
clock that already counts every second. "Only show it counting the actual
amount of seconds." The rounded one is gone; the heartbeat still keeps the
line alive, and the seconds are the real ones.

## 7.115.0

**The save button stays under your thumb.** "On the phone … clicking on a
preset does absolutely nothing and nothing saves." Tapping a row was doing
what it was meant to — choosing the slot — but the button that saves sat at
the top of the sheet, above a list of 512 rows, so by the time a slot was
picked it was two screens up and out of sight.

- The Save button lives in the sheet's footer now, which does not scroll. Pick
  a slot anywhere in the list and the button is right there, reading "Save to
  slot 474" and, when that slot holds something else, "Replaces Metallicaz".
- On the phone it still reads "Ask the Mac to save", because the Mac does the
  writing; the footer says when it is queued and when it lands.

## 7.114.0

**The Mac app closes, updates, and reopens.** "After installing … it closes
the app and restarts and then it still says the same update is available. …
It said ForgeFX was currently using the port. The only way to get around it
was to restart the Mac completely. … The app does not close out all the way
when you click the close button."

- **Closing the window quits the app.** It used to keep running in the menu bar
  with nothing on screen, which read as an app that would not close and led
  to Force Quit — the one thing that skips the quit an update needs.
- **A device server left behind is cleaned up.** Force Quit kills the app but
  not the server it started, which kept the port; the next launch said
  "ForgeFX is already running" and quit. Now the app recognises a server of its
  own left holding the port, stops it, and carries on. The server also runs
  inside a small watchdog that leaves the moment the app is gone, however it
  went, so this stops happening in the first place.
- **An app run from Downloads is offered a move to Applications.** macOS runs
  such an app from a hidden read-only copy and cannot replace it in place: the
  update downloads, "installs", relaunches the old version, and is offered
  again for ever. The app now asks to move itself on launch, and Setup →
  Updates offers the move too.
- **"Ready" means macOS has it.** The app said an update was ready when it had
  only downloaded the file; macOS's own updater still had to take a copy and
  check it. Restart pressed in between did nothing. Now the line says
  "Preparing…" until macOS has it, and any refusal from macOS — a signature it
  will not accept, a place it cannot write — is shown in its own words.
- **A failed install is reported, with why.** Before restarting to update, the
  app notes which version it expects to come back as. If it comes back on the
  old one, Setup → Updates says the update didn't install, shows what macOS
  wrote while it tried under Technical details, and offers Move to
  Applications and Download from GitHub — instead of offering the same update
  again as if nothing had happened.

## 7.113.0

**Hold Tap to type the tempo.** "On the tap button, let's do where they hold
the tap button they can manually enter in the beats per minute they want. On
the Mac let them right click to pull up the text box to enter the BPM."

- On the stage screen, hold the Tap button — or right-click it on a Mac — and
  a box opens above it with the current tempo selected. Type the number, press
  Enter, and the unit is set to it; Escape or a tap elsewhere leaves the tempo
  alone. Holding never sends a stray beat.
- The phone apps get the same hold on their Tap button, opening a number field
  under it with a Set button.
- Both check what was typed by one shared rule: a whole number from 20 to 400,
  the unit's own range. Anything else is refused in words, never clamped into
  a number nobody typed.
- The typeable tempo box had been sitting in the code with nothing showing it.
  It is its own component now, and this is where it appears.

## 7.112.0

**"Restart to update", like every other Mac app.** "On most Mac apps that
update it usually says refresh app to update and they click one button and it
closes the app for them. Is it possible for us to do that?" It already did:
the notice had an Install now button that closes the app and reopens it on
the new version. But the notice led with "installs when you quit" and the
button read as a technicality under a wait.

- The notice now says the version is ready to install, that restarting closes
  and reopens the app in a few seconds, and offers **Restart to update** as
  the thing to press. **Later** is still there, and still means it installs
  the next time you quit — nothing restarts itself.
- The same button appears in Setup → Updates while an update is waiting, so
  dismissing the notice is not the end of it.

## 7.111.0

**Nobody has to sign in to connect a phone.** "User shouldn't be required to
sign in unless they want to save and sync across the cloud. It's requiring a
login to connect." The phone's Connect button opened a sign-in form, and the
Mac's Set up phone remote opened the same form. Both ends now lead with a code.

- At the Mac, **Set up phone remote** makes a pairing code and shows it as a
  QR and as text — `XXXX-XXXX-XXXX-XXXX`. No email, no password. Signing in
  with an account is still offered beside it, for what it buys: presets and
  what the AI has learned about your taste following you between devices.
- On the phone, the first thing on the connect screen is the code. Point the
  camera at the Mac's QR and the app opens already connected; or type the
  code. The same-wifi route is second, and signing in is third.
- The phone apps take the same code on their first screen, with the account
  form one tap behind it.
- Underneath, the link still runs on a private channel between two ends signed
  in as the same account — that is the security model and it has not moved.
  The code stands for an account the person never sees, derived the same way
  at both ends from `shared/pairing.mjs`, which the phone app carries a
  generated copy of. The address the Mac signs in with carries only half the
  code, so no screen that names the account gives away enough to connect.
- The one thing that can stop pairing is the account service insisting on a
  confirmation email for every new account. The Mac says so in words if it
  happens, and offers the account route instead.

## 7.90.1

**The check that only passed on the machine that wrote it.** `npm test` reads
the phone's payload decoder against a real gzip frame, and that decoder needs
two small libraries — which live in `mobile/node_modules`, a second install CI
has no reason to have made. So the check imported packages that were not there
and failed on every runner, while passing locally for whoever had run
`npm install` inside `mobile/`. It merged red.

- The root carries `base64-js` and `fflate` as dev dependencies now, so the
  suite stands on the root install alone, the way every other check in it does.
- Which is fine until the two sides are bumped apart, at which point the suite
  is checking a decoder the phone does not ship. The specifiers are pinned to
  each other by a test rather than left to good intentions.

## 7.90.0

**The phone apps.** iOS and Android, in `mobile/`, joining the same private
channel the web app does.

- One React Native codebase, built in the cloud by the `mobile` workflow — no
  Xcode and no Android Studio. Every pull request that touches it bundles both
  platforms with Metro, which is the only thing that catches an import Metro
  can't resolve; `npm test` never would, and an EAS build finds it minutes in on
  a machine at the far end of a queue.
- Three things a web page cannot do, all of which matter on a stage. Safari
  blocks a secure page from calling `http://localhost`, so iOS has never been
  able to run this at the Mac. No page loaded over the network can reach ForgeFX
  either. And a page cannot stop a phone locking itself — a remote gone dark by
  the count-in is not a remote. The stage screen holds the screen awake and
  every control answers through the case.
- The allowlist has one home now. `shared/relay-rules.mjs` holds what may travel
  the relay, how long to wait for it, and the words for a refusal; the web app
  imports it and the phone carries a generated copy. That list drifted once
  before in both directions at once — blocking GETs the host serves, allowing
  writes the host refuses, eight routes disagreeing by the time anyone compared
  them — and `npm test` now regenerates the copy in memory and fails on any
  difference. A hand-kept second copy was the bug.
- What the phone deliberately cannot do: generate, edit the grid, or save. The
  host refuses a slot write from a distance and is right to, and a generate
  button within reach of a stage tap is a hazard. What it can do is the set a
  player reaches for between songs — preset, scenes, what's engaged, channels,
  tempo, tuner.
- The tuner says why it is silent. `POST /tuner` travels and starts the poll,
  but the host filters the eight-per-second telemetry streams out of the relay,
  so every reading stays at the Mac. After five silent seconds the screen says
  that, rather than showing a needle that will never move.
- Two Macs on one account are still refused a write, and still proved rather
  than trusted: the roll call counts every answer instead of taking the first,
  and addressing one Mac is confirmed by asking it one addressed question and
  counting the replies. A mixed pair of versions fails safe.

## 5.5.2

**Saving.** The button was in the wrong place, and on a phone it was also
telling the truth too late.

- Save is now a bar pinned to the bottom of the screen, on every view except
  gig. It used to be a panel at the foot of a long page, shown only while the
  app believed something had changed — off-screen and intermittent, which is a
  hard thing to learn the location of. It's always in the same place now, and
  saving an unchanged preset just writes the same bytes back.
- The tap that did nothing: ForgeFX refuses a slot write over the remote relay,
  and it's right to. But the refusal arrived after the tap, in a banner at the
  top of a page you weren't looking at. The button now says "Saving happens at
  the Mac" before you press it, and any other save failure shows on the bar
  itself.
- One button for the common case — the slot already loaded, nothing typed. Name
  and slot fields fold away behind Options, along with revert and the pre-edit
  copy.
- Thumb-sized targets, and the fields use 16px text so iOS stops zooming the
  page when you tap into them.

## 5.5.1

**The gig screen on a phone.** Scene names and block buttons were both missing
over a remote session, for two unrelated reasons that looked like one.

- Scene names on an AM4 live inside a preset dump, and dumps are refused over the
  relay by design. They're now published to ForgeFX's own document store while
  the Mac has the cable, and read back from there on the phone. The cache is
  keyed per unit — an AM4 slot 97 and an FM3 slot 97 are different presets and
  were sharing one entry.
- The block list read makes an AM4 dump its whole preset over serial, which
  outran the relay's fifteen-second timeout. Slow reads now get forty-five
  seconds, and the meter poll drops to every two seconds when remote instead of
  competing with them for the port twice a second.
- A failed chain read used to render as an empty row, indistinguishable from a
  preset with nothing in it. It now says what happened and offers to try again.
- The device bar said `localhost:5056` during a remote session, which is where
  the request wasn't going. It says "remote session", and no longer prints a
  grid size for a unit that has no grid.

## 2.3.0

Version and commit shown in the header, so which build is running is readable
rather than inferred.

## 2.2.x — generation

- **Cost per run** ([#9](https://github.com/justinnewbold/fractal-ai-builder/pull/9)).
  Each run sends the full model roster plus every placed block's parameter
  schema, so input tokens scale with the preset.
- **Diagnostics panel** ([#8](https://github.com/justinnewbold/fractal-ai-builder/pull/8)).
  Shows what actually went on the wire. The device accepts an out-of-range
  write silently — it clamps and returns `ok` — so the response can't tell you
  whether a write landed.
- **Normalised writes** ([#7](https://github.com/justinnewbold/fractal-ai-builder/pull/7)).
  Reads return real units; writes take 0–1. Undocumented, and the reason every
  generated preset had been landing with its controls pinned at maximum.
  Includes log-scale handling for frequency controls.
- **`continuous: false`** ([#6](https://github.com/justinnewbold/fractal-ai-builder/pull/6)).
  A wrong fix for the above, kept because discrete writes get a rejection
  watch. Both write paths normalise; the flag was never the bug.
- **Gain staging off limits** ([#4](https://github.com/justinnewbold/fractal-ai-builder/pull/4)).
  Output levels read like tone controls by name, so they were being dialled
  like tone controls. Range checking can't catch it — −60 dB is legal.

## 2.1.0 — control ([#5](https://github.com/justinnewbold/fractal-ai-builder/pull/5))

Preset browser, rename, hand editing, change log, and write verification.

Verification was added to catch stale cache reads and has since caught two
bugs it wasn't built for. It stays.

## 2.0.0 — the rewrite ([#1](https://github.com/justinnewbold/fractal-ai-builder/pull/1), [#2](https://github.com/justinnewbold/fractal-ai-builder/pull/2), [#3](https://github.com/justinnewbold/fractal-ai-builder/pull/3))

Retired the Electron and Computer Use app — screenshots in, mouse clicks out —
and replaced it with a web app driving the hardware through the ForgeFX HTTP
API. Generation moved to the Vercel AI SDK.

## 1.x

Electron app driving FM3-Edit with Claude's Computer Use API. macOS only,
roughly a dollar a session, and it clicked in the wrong place on any display
that wasn't exactly 2560px wide.
