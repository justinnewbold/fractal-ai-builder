# Changelog

Versions are `MAJOR.PHASE.PATCH` — major is the architecture, phase tracks the
roadmap in the README, patch is everything since.

## 7.151.0

**Setup can tell you what every amp and pedal really is.** Fractal can't print
"Marshall JCM800" on a menu, so your unit says "Brit 800 2204 High" — and until
now the app would only translate the one model you already had open in the
editor. There's a new row at the bottom of Setup, **Amp and pedal names**, that
opens the whole list: 426 models, every amp and drive on the unit plus the wahs,
compressors and delays, each with the real thing it was modelled on underneath.

**And you can search it by the real name**, which is the part that makes it
useful. Type "tube screamer" — words that appear nowhere in the unit's own
"T808 OD" — and all five come back. Search the unit's word for it and that works
too. The tab counts follow the search, so looking for a pedal while the Amps tab
is open tells you the answers are in Drives rather than saying nothing.

Nothing here is invented. Every line comes from the same catalog the model
picker already quotes, sourced from Yek's guide and Fractal's own blocks guide,
and models Fractal designed themselves say so rather than borrowing somebody's
amp. Cabinets aren't listed at all: nothing is recorded for any of the 45 of
them, and a tab of blanks is worse than no tab.

## 7.150.0

**Sending from your phone stops writing everything twice.** After each write
the app reads the value back to check it landed, and to do that it has to clear
the unit's cache first — which only works at the Mac. From a phone that clear
is refused, so the read proves nothing, which the app already said. What it
did anyway was treat "couldn't check" as "the unit ignored it" and send the
same value again in a different format. A log from an iPhone had Drive, Tone,
Level, Mix and Treble each written twice for no reason. It now sends once and
says plainly that it can't be checked from here.

**And it stops asking a question it knows the answer to.** That cache clear was
attempted before every single write, and refused every single time, putting a
line in the debug log each time. In a 110-line log, thirty lines were that one
refusal — and six real errors from the unit were buried underneath them. It is
no longer asked from a phone, and the pointless read that followed it is no
longer made, so sending a preset from your phone is meaningfully quicker.

## 7.149.0

**A level sitting at zero can be raised again.** "Drive 1 / Level: levels can be
nudged, not reset — 5 is outside 2 to 1.5, so it was skipped." That range has no
numbers in it. The rule that keeps the AI from turning a block down to silence
works out two ends — how far a level may move, and how near the bottom it may
go — and on a control already sitting at the very bottom the two crossed over,
so no value at all could be written. A level at zero was the one value in the
app that could never be changed, on exactly the preset that needs it changed.
Now the window always includes where the control already is, and always reaches
far enough to lift it clear of the bottom in one go. It still only ever offers a
raise when a level starts down there — nothing here can make a block quieter
than you had it.

**The price under each run is right again.** Sonnet's rate carried "promotional
through 31 Aug 2026, then $3/$15". That date has gone, and the rise it warned
about was cancelled — $2/$10 is simply the price now — so the line is gone. The
rates themselves were already correct. A test now fails the day any price note
outlives the date it names, so the next one cannot sit there quietly being
wrong.

## 7.148.0

**Setup is four things now, not twelve.** It opened on a column of twelve
identical grey panels — button size the same size, colour and weight as the
debug log — so nothing on the screen stood out and the whole list had to be
read every time. They are sorted now, by the reason you opened the sheet:
**Screen** for how Play looks, **My rig** for the unit and the phone and the
footswitches, **Something's wrong** for the checks, the log and telling us, and
**What the AI knows** for what it has picked up from your presets. Four rows
instead of twelve, with the introduction still loose at the bottom. Nothing was
removed and nothing moved out of Setup; the headings are in plain sentence case
rather than the wide capitals the panels use, so the two levels tell themselves
apart at a glance.

## 7.147.0

**The header stays put.** It was pinned already — sticky at the top — but the
page reserved a strip above it for the update notices, and on a notched phone
that strip also had to clear the clock. So the bar started some seventy pixels
down and rose to the top the moment anything scrolled. Nothing renders above it
now: the notices sit under it, still the first thing on the page, and the bar
covers the notch with the inset it has always carried. It is at the top from
the first frame and does not move — and the seventy pixels go to the screen.

## 7.146.0

**The last row of effects fits on the screen.** The preset tile was sized to a
scene tile from when it was shaped like one — a number stacked over a name —
and it has been one line of text in a 62px box ever since the number moved onto
the name's line. It takes the 44px every pressable thing gets now, and the gaps
around the meter, the scenes, the effects and the foot each give up a step: 40
pixels back, which on a preset with nine effects is the row that was hanging off
the bottom.

## 7.145.0

**The volume is behind a speaker in the header.** It was a permanent row across
the top of Play — the slider, the two steps and the figure — holding a strip of
the one screen whose currency is scene buttons you can hit without looking, for
a control wanted twice a night. There is a speaker beside the gear now; tapping
it slides the same control up on a sheet, unchanged. A preset with no output
block has no volume to move, so it gets no speaker, and Play says that is why.

## 7.144.0

**Setlists and stars follow your account.** They lived in browser storage — a
setlist built at the bench on the Mac simply was not on the phone on the stand.
Signed in, they are kept with the account now and come back on every machine
you sign in from: the lists, the stars, and which of them Previous and Next are
stepping through, per unit, because an FM3's running order is not an AM4's.

Merging is per setlist and per star rather than per device, so a list built on
the Mac and one built on the phone both survive meeting each other: the later
edit of a list wins, a delete travels rather than being undone by the other
device still holding a copy, and the stars go with the later tap so unstarring
one on the phone actually unstars it. What this phone played tonight stays on
this phone. The sheet says which of the two is true instead of promising that
everything stays in the browser.

## 7.143.0

**A save in flight says Saving, and shows it.** The button read "Waiting…"
after a save was handed to the Mac — which is what the app was doing, not what
was happening to the preset — and nothing on it moved while the answer came
back. It says Saving now, with a dot that pulses until the write lands, then
✓ Saved, and it holds that word for ten seconds rather than four, because a
save asked for from across a room is read when you look back at the phone.

**And the rename tick box stops offering to rename a preset to its own name.**
It appeared whenever a tone's name matched the preset's — every reload of a
saved tone — as "Rename X to X", a decision with one outcome. The write path
has always skipped a rename in that case; now the question isn't asked. Where
the name genuinely changes it is still there, and what a save will overwrite is
still named where it is actually asked: the Save sheet says which slot and what
is in it.

## 7.142.0

**Reloading a saved preset shows you the preset.** Tapping one kept with your
account, or pressing Reload on one saved in the browser, was doing the whole
job — reading the unit, re-checking the saved tone against what is loaded now,
putting it on the tone card with a Send button — and showing you none of it:
the card lives in the Ask sheet, and the press happened in the Presets sheet,
which stayed over the top of it. So did the progress, and so did the error
banner when a load failed. A load now takes you to the sheet it lands in and
says what is happening: a line when it starts, a line naming what came back
and how many changes are ready to send, and a line if it fails — or, when
nothing in the saved tone fits the preset on the unit, a line saying that
instead of promising a button that isn't there. The rows kept with your account
show what each preset is, in text rather than in a tooltip a phone can't show.

**And the Backups panel comes back.** It read a prop nobody declared or passed,
so it threw the moment it rendered and that section of the Presets sheet was an
apology from the error boundary.

## 7.141.0

**Setup can ask the unit why a preset makes no sound.** A new section, *This
preset*, reads the preset you are standing on — every block, where it sits,
whether it is on in this scene, which channel it is on, every parameter with
its value and range, and the routing grid in the unit's own words — and then
says what in there would keep it quiet: no output block, a block nothing is
wired into, everything off in this scene, a level sitting on its floor. Copy
report puts the whole read on the clipboard, the same three ways the debug log
does, so it can be pasted into the chat. It reads on a tap rather than on a
timer: it is a dozen round trips down the port that is carrying the audio.

## 7.140.1

**One line less in Setup on a phone.** "through your Mac" is gone: the header
already says CONNECTED and Phone remote below it names the Mac, so it was the
third thing in the sheet saying one fact. The address stays on the machine
with the cable, where it is the thing you change, and the demo still says it
is a simulation.

## 7.140.0

**The built presets kept their output block.** "The volume slider disappeared
and no presets have sound" turned out to be one fault, not two: the slider
moves the output block's level, and the chain builder had been writing over
the output block to get to column 0. A slot this app calls empty is a slot
with nothing *editable* in it — the input and the output are filtered out of
that count on purpose — so "empty" was never empty, and building into it took
the preset's only route to the amp with it. The chain now goes in the free
cells between the input and the output, neither of them is touched, and a
preset that has no output block at all is given one at the end of the chain.
On Play, a preset with no output block says so where the slider would be,
rather than quietly showing nothing.

## 7.139.0

**The built presets make a sound now.** A chain built into an empty slot was
placed and never wired: on an FM3 an empty preset has no cabling in it, and
putting a block in a cell does not join that cell to anything. So the blocks
went in, every value landed, the unit read them all back, the preset saved —
and none of it was in the signal path. That is why every tone built from an
empty slot was silent. Both places that build a chain now run the wire the
length of the row, from the input, through every block, out to the output; if
the unit refuses a connection it is said plainly, and if the unit reports a
block with nothing feeding it the app says the preset won't make a sound until
the row is joined up, instead of reporting a finished preset.

**And the debug log stops accusing writes that landed.** Clearing the unit's
parameter cache only works at the Mac, so from a phone the read that checks a
write comes back one write behind — which is how five parameters in a row came
to be reported as "DID NOT LAND" while each one read back the previous write's
value. A check that could not clear the cache now says it could not check,
in the log and in the verification table, rather than blaming the unit.

## 7.138.1

**Whole effect names, and the preset name in the middle of its tile.** On
Play the effect names came out with their tops sliced off — a row of
half-letters where CMP, WAH and PHA should be — because two lines of type
and 12px of padding came to more than the tile is tall, and the phone
answered that by cutting the tile rather than growing it. The tile now
uses the 8px the scene tiles above it always have, and both its lines are
given a stated height instead of whatever the font felt like, so the
names read whole at every button size. The preset tile's number and name
sat against its top edge; they sit in the middle of the box now.

## 7.138.0

**One debug log, a Save button after a send, and a shorter header.**
Setup's Technical details is now Debug log: everything that happens in a
session — what the AI did and when, what was written to the unit and what
it said back, what the app changed, every error and crash — in one list,
in order, with a Copy log button that puts the whole thing on the
clipboard with the version and unit at the top. Paste it into the chat
when something goes wrong. The wire tables and the link test sit under
it. After a tone's changes are sent, the greyed "Changes sent" button
becomes "Save to FM3" (or whatever unit is connected) and opens the Save
sheet. And on Play the header no longer repeats the preset name — the
tile under it is the same button — so the version and the link word have
room.

## 7.137.0

**Four Play-screen tweaks.** The version number is in the header on a
phone as well as a desktop. The round green tick beside the gear is the
word again: CONNECTED in green, DISCONNECTED in red, CONNECTING in amber
while it is on its way. The volume row is tighter — smaller knob, narrower
plus and minus, no inset, half the space around it — without any of its
targets getting shorter. And the preset tile puts the slot number on the
same line as the name, both at the size of a scene name.

## 7.136.0

**A wait that ends, a line that says what it is doing, and a chat that
stays put.** "Stuck thinking for almost 4 minutes, finally had to stop
it." The AI's heartbeat was keeping the wait alive for as long as the
heartbeat came, and a second try doubled it. Now a design that has not
started writing after two minutes stops and says so, with nothing sent to
the unit, and the app only asks again on its own when the connection went
dead — not when the AI was plainly still working. The working line says
what it is thinking about: designing your tone, adjusting the tone, or a
second try because the first got no answer. Its clock's sentence wraps
instead of running off the side of a phone, and the conversation no
longer slides sideways under a thumb. And "make a full Metallica preset"
with a Killswitch design still waiting on screen no longer reshapes the
Killswitch tone under its old name: the chat is asked whether you mean an
adjustment or a new tone, a new tone starts over, and the old design goes
into the log as not sent. A tone that is being adjusted says so on its
card.

## 7.135.0

**The Ask sheet is the whole screen.** On a phone the conversation opened
in a sheet two thirds of the way up, with a blurred strip of the page above
it doing nothing and the chat itself in a small window inside. "We should
be using all the screen space." The sheet now fills the screen under the
status bar and the conversation takes all of it; a designed tone still
sits under the box you type in. On a desktop the docked panel gets the
same room.

## 7.134.0

**A reply starts in view, and the two sides of the chat look different.**
"After typing a question and the AI gives an output it leaves it at the
bottom of the chat, so I have to scroll back to the top to see what it
started saying." A new reply now lands with its first line at the top of
the box; your own question, a note, and the working line still go to the
bottom, and the actions running under a reply no longer pull it away
mid-read. And "make the chat more obvious of whether I'm talking or the
AI is talking": your words sit to the right in an amber-tinted bubble,
the agent's to the left in a bubble of their own; notes about what the
app did sit small and quiet down the middle.

## 7.133.1

**No code words in the chat.** It told a player about "the designTone
path", which is a name from the code, not a thing anyone should read.
The agent is told the labels in its instructions and data are its own,
never the player's, and to say what it is doing rather than what is done,
since its actions run after its words appear.

## 7.133.0

**Ask can add blocks, and a design adds the blocks it wanted.** "How come
it said it couldn't place the pitch block? I thought it can change blocks
out freely." It could never add one: the chat asked the app for the unit's
block list with a call that was never imported, the error was swallowed,
and every request went out saying nothing was placeable — on the Mac and
the phone alike. So "add a whammy" was answered with "this unit has no
block called whammy". The list is read properly now, remembered per unit
so a phone whose read fails still has last time's, and a read that fails
with nothing remembered is said as a failure rather than an empty unit.
"Whammy", "pitch shifter", "octaver", "overdrive", "noise gate" and the
like resolve to the unit's own block names. And when a design comes back
saying the tone wanted a block the preset lacks, the app adds it and
designs again against the new chain, once, instead of leaving a note
asking you to add it by hand.

## 7.132.2

**No more "I couldn't work out what to change" for a question.** "If I
want you to make a tone based on Eva Under Fire, what are you going to
do?" got the app's fallback line, which shows when the model sends back
nothing at all. The route now asks the model once more, telling it the
reply was empty, before that line can show. And a band is something the
agent knows, not something it looks up in the preset: it no longer hedges
that it "doesn't have preset details" for a band, and "what would you do"
gets the plan — amp, cab, what goes in front, scenes, what it would
overwrite — and an offer to go ahead.

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
