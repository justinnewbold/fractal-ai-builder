# Changelog

Versions are `MAJOR.PHASE.PATCH` — major is the architecture, phase tracks the
roadmap in the README, patch is everything since.

## 7.193.0

**Rename the preset and its scenes by hand.** "Would also like to be able to
rename presets and scenes in the app directly without having to ask the
chat." There is a pencil beside the preset on the Play screen now. It opens
the sheet the scene names already lived in, with the preset's own name at the
top as a field you can type in. Like a design's rename it changes the loaded
preset, and sticks once you save it to a slot.

**And a rename no longer gets undone by the next save.** "Rename preset to
Tool" — done, said the chat. Six seconds later the save sheet asked the Mac
to save it as "Tool - Adam Jones", the name the design had proposed, and the
Mac renames before it stores, so the old name went straight back on. The save
sheet now follows the unit's name when it changes, unless you typed a
different one yourself.

**A block placed in an empty AM4 preset is no longer called refused when it
is sitting right there.** "Build a chain: drive → amp → cab → delay → reverb —
The unit refused Drive." Then, from the player: "It did accept the drive
block." It had. Over USB-MIDI the AM4 never sends the short acknowledgement
the Mac's server listens for after a write — the same report showed 59
parameter writes in a row marked "unit said ok:false" and every one of them
read back exactly as sent. Parameters were already checked by reading them
back, so that only cost a column in the log. A placement was taken at the
unit's word, so the chain stopped at its first block. A rename over MIDI would
have been refused the same way with the new name on the unit's display.

The Mac's server now treats that acknowledgement as a hint and the read as the
answer: with no ack, it looks at the slot (and, for a rename, at the name the
unit reports) and says whether the thing landed. This is in the device server
the Mac app carries (desktop/forgefx.lock.json moves to it), so it takes a
new Mac app to get.

## 7.192.0

**The AM4 is driven over MIDI, not over the serial port it also shows the
Mac.** The first report of the Mac's own account (7.191.0) said it all:
"resolved: midi AM4", no Fractal serial port listed, 59 of 59 writes verified,
not a single fault. Every failure earlier in the day — "lost its connection to
the unit" on every preset read and scene change, while the tuner worked and
the unit switched presets underneath a screen that could not read it — carried
the serial transport's own words. So the AM4 shows up on the Mac both ways at
times, the Mac's server took serial first because on the FM3 that is the fast
link, and the AM4's serial side answers the first handshake and then loses the
port on the first real read.

The server now takes an AM4 (or a VP4) over its USB-MIDI port before serial
gets a look, matched on the port's name — the one thing known before a byte
is exchanged. An FM3 that shows up both ways keeps its serial link. A
connection picked by hand under Connection still wins.

This is in the device server the Mac app carries (desktop/forgefx.lock.json
moves to it), so it takes a new Mac app to get.

**And the report says when a Mac app is too old to give its port history**,
rather than "port lost and reopened: 0 times", which is not what that means.

## 7.191.0

**Copy log now carries the Mac's own account of its port to the unit.** From
a phone every failure at the unit is one sentence — "the Fractal app on your
Mac has lost its connection to the unit" — and today that sentence sat next to
live tuner readings and a preset change that plainly reached the unit. The
Mac's device server knew exactly what was happening and said so, to nowhere:
an app opened from the Finder keeps none of what its server prints.

So the server now keeps the last ten times it found its port to the unit
closed and opened it again — when, which port, and why (whether the unit went
away) — and the last eighty lines it said. Copy log on the phone asks the Mac
for all of that and pastes it under the usual log, with whether the port is
open right now, which port it is, the serial ports the Mac can see, and how
long the server has been up. A port lost once is a cable. A port lost every
few seconds is something else, and now the two can be told apart from the
far end.

This is in the device server the Mac app carries (desktop/forgefx.lock.json
moves to it), so the section fills in once the Mac app is on this version; an
older Mac app answers without it.

## 7.190.0

**The phone's debug report says which Mac app it is talking to.** A phone
runs today's web build the moment it reloads. The Mac runs whatever was
installed, and a fix that lives inside the Mac app — the device server, the
network name — is not on until that app has been restarted into it. The
report said only the Mac's name, so "still broken" and "not updated yet" read
exactly alike, and today they were confused for each other.

The Mac app now writes its version beside its name, where the phone already
looks, and the report's link line reads "remote · Connected to Justins
MacBook Pro · Mac app v7.190.0". A Mac app older than this one does not say,
and the report says that instead.

## 7.189.0

**The Mac stops renaming itself.** "This computer's local hostname
Justins-MacBook-Pro-958.local is already in use on this network. The name has
been changed to Justins-MacBook-Pro-1019.local." After every restart, and only
once this app had been running — 910, 958, 1019, counting up.

The Mac app announces itself on the network so a phone can find it by name.
The library that does the announcing is a complete network responder of its
own, and left to itself it announced the app AT THE MAC'S OWN NAME — answering
"Justins-MacBook-Pro.local is here" alongside macOS, which answers for that
name itself and checks, at every boot and wake, that nobody else does. This
app did. So the Mac decided its name was taken, gave itself a new number, and
said so.

The app now announces itself under its own name — fractal-justins-macbook-pro
.local, the one the menu and the QR code already show — and answers for that
name only. The Mac's name is the Mac's again. As a side effect the .local
address in the menu now actually works; until now nothing on the network was
answering for it.

The Mac keeps whatever number it has by now. To put the name back, open System
Settings, General, Sharing, and edit Local hostname.

## 7.188.0

**The preset list can be read off the unit again.** "Unit is showing the
wrong preset name compared to what's actually on the device compared to what
it shows in the preset menu. It's stale and stays that way for days." The
header said 98 · 3DG Verse-Rhythm-Lead is loaded; the list underneath said
098 TIGHT MODERN.

The app writes a slot's name down at the moments it can see — a save it made,
a slot it read — and nothing else ever touched the copy. A preset stored from
AM4-Edit, or renamed at the front panel, kept its old name in the list for as
long as the list lived, which is for ever. ⟳ could not fix it: it reads the
slots that have never been read, and a wrong name has been.

So the picker has a new chip under the list, beside "101 of 104 named": Read
them again. It forgets every name and reads the whole unit again, from the
phone over the relay as well as at the Mac. A scan already running is stopped
and started over rather than left to finish a walk that would never come back
for slot 98.

And the one name the app can always be sure of is now written down without
being asked: the slot the unit says it is on, under the name it says it has,
in one answer, on every read. The row for the loaded preset can no longer
disagree with the header above it. Not while this app has edited the buffer
— the name on an edited buffer may not be the name in the slot.

## 7.187.0

**The Mac finds the unit again after losing it.** From a log on stage: the
header says CONNECTED, the Mac says CONNECTED, the AM4 is on and its cable is
in — and every scene tap and every preset select comes back "the Fractal app
on your Mac has lost its connection to the unit". Try again does nothing.
Dismiss does nothing. It stays that way until the Mac app is quit and opened
again.

The device server inside the Mac app opens its USB port to the unit once and
shares that one open between everything that asks. When the port closed
underneath it — the unit switched off and on, the cable out and back, the Mac
waking from sleep, USB deciding to re-enumerate — the server kept handing out
the closed port for ever. The only thing that ever cleared it was an open that
FAILED; a port that opened fine and then went away was never let go of. So
the phone's Try again was asking, over and over, and the Mac was answering
"port not open" every time, while its own health check said all was well
because it only looks at whether the unit is LISTED, which it was.

Now the server notices the port is no longer open and opens it again for that
request. The next tap after the unit is back goes through, and the app's own
backing-off retry picks it up on its own. The Mac's log also says when the
port closed and whether the unit went away, because until now that looked
only like "port not open" from the far end.

This is in the device server the Mac app carries (desktop/forgefx.lock.json
moves to it), so it takes a new Mac app to get — the phone side needs nothing.

## 7.186.0

**A band looked up once is not looked up again.** There is no band-gear
database to download — MusicBrainz, Discogs and Wikidata are enormous and carry
releases, credits and personnel, and not one of them carries what amp anybody
played. Equipboard really is that database and publishes no API and no export.

So the fact is found out once and kept. Ask for Three Days Grace a second time
and there is no searching, no tokens spent and no waiting — the rig and the
songs go straight into the design. By the tenth band this is the database that
could not be downloaded, built out of answers the app actually used.

It is filed under the band rather than under the sentence, so "Make me a Three
Days Grace preset with 8 scenes" and "three days grace, all eight" are the same
lookup. A briefing researched for four songs answers a request for three and
not one for eight, because the other four were never looked up. And it is kept
for ninety days rather than forever, because bands do change rig.

Kept in this browser and, signed in, with the account — so a band looked up on
the phone at the bench is already known when you sit down at the Mac.

## 7.185.0

**The rig lookup keeps what it found instead of throwing it away.** Raising its
time limit was the wrong lever and two failed builds in a row proved it: sixty
seconds timed out, two minutes timed out as well, and the second time the
design that followed was cut off by the app's own three-minute clock with
nothing written at all. Five minutes of waiting for two tones that never
arrived.

The fault was never the number. The answer arrived in one piece at the end, so
being stopped anywhere before that threw away every search it had made — and
eight songs is not a job with a predictable length. It now comes back as it is
written and is kept as it arrives, so ninety seconds of searching yields ninety
seconds of findings. The briefing is ordered for it too: the amps first and
complete, because every scene needs them, then the songs most worth having,
each finished before the next is begun. Stopped part-way, what survives is the
part that matters.

**And the wait for the lookup is no longer counted against the tone.** The
clock that gives up on a model that has not started writing was running from
before the search began, so a minute and a half of searching came out of the
tone's own budget and the build was stopped for "thinking too long" when most
of that time was not the tone being thought about. The tone's clock starts when
the lookup ends now, and the overall limit still covers the whole thing.

## 7.184.0

**The rig lookup was running out of time and nothing said so.** On a real Three
Days Grace build it searched for sixty seconds, hit its own sixty-second
timeout, was cut off, and the design went ahead on what the model already knew
— coming back on a Peavey 6505 with a summary calling it "Barry Stock's actual
5150/6505 tone". No source says that. The band play Diezel VH4s and modded
Marshall JMP-1s. And from the log, a lookup killed mid-search looked exactly
like a lookup that had never run.

Three things were wrong and all three are fixed. The lookup now gets two
minutes rather than one, which is what eight songs actually take. It runs
inside the stream instead of before it, so the phone gets proof of life and a
line saying what is being waited on rather than a blank minute. And it says how
it went — "Looked up the rig after 21s", or "The rig lookup ran out of time
after 120s — designed from memory instead", in the log and in the conversation.

A tone built without the lookup is still a tone worth having. It is not a tone
worth mistaking for a researched one, which is what happened here.

## 7.183.0

**The songs get looked up too, not just the band.** The lookup added last
version found the band's real rig and stopped there — the designer then picked
which songs to build scenes from out of its own memory, and nothing ever
established what "Chalk Outline" sounds like as against "Home". So eight scenes
came back named after eight songs over three amp voicings, one drive setting
and one delay setting.

Now it runs in the order a person would: find the band, find what they played,
pick the songs — ones a fan would name *and* ones that genuinely sound
different from each other — then look up each song's own tone in turn. Album
and year, so the right era's rig is used. Amp and roughly how much gain. Drive
pedal or none. Delay time, feedback and how loud. What the song actually sounds
like in one line. Those songs are then the scenes, in that order, each voiced
from its own lines rather than from the band's general sound.

The number of songs it researches is the number of scenes you asked for, so
four songs can no longer turn into eight scenes with half of them guessed. Ask
for one sound and it looks up the rig and no songs at all.

Where a song's own tone isn't documented anywhere, it says so and falls back to
the band's usual rig rather than inventing one. Adds time to a generation — a
song is at least one search — and if the lookup fails the tone is designed the
way it was before rather than not at all.

## 7.182.0

**It looks up what actually made the sound before it builds anything.** Ask for
a band and the preset came back on whatever amp the AI happened to remember —
for Three Days Grace, a Peavey 6505 and a Mesa TriAxis. The band play Diezel
VH4s and modded Marshall JMP-1s into ENGL power amps, and your FM3 models all
three of them: Das Metall and Dizzy V4 are the VH4, Brit Pre and JMPre-1 are the
JMP-1, Energyball and Angle Severe are the ENGLs.

The app has always known what every model on the unit is in real life — that is
what puts "Marshall JCM 800" under "Brit 800 2204 High". What it never knew was
the other half: what the band played. So it searches for it now, before the
design starts, and the amps, pedals and tuning it finds go in as findings that
outrank what the AI thought it remembered. A request with no band or song in it
— "a tight modern metal rhythm" — searches for nothing and costs nothing.

Adds a few seconds to a generation. If the search fails, or the app is running
on the gateway key rather than the Anthropic one, the tone is designed exactly
as it was before rather than not at all.

**And eight scenes over three sounds now says so.** A scene holds no sound of
its own — it remembers which blocks are on and which channel each one plays,
and what a channel sounds like is dialled once. So eight scenes named after
eight songs, sharing one delay setting and one drive setting, are eight names
over one tone. The preview now names any two scenes that play exactly the same
thing, and the designer is told the budget it actually has: four channels per
block, so voice the amp, the drive and the delay across them, and return fewer
scenes rather than more names than sounds.

## 7.181.0

**Reloading a saved tone brings its scenes back with it.** An eight-scene tone
reloaded from your library came back as the sound only — every value landed,
and every scene kept the name and the layout of whatever preset happened to be
underneath it. Scenes are switched off by default on a fresh design, on purpose:
the card offers "Also set up 8 scenes" and tells you which of the ones you laid
out it would write over. Reloading never said anything about them either way,
so it sent whatever that switch was left on from earlier — and after clearing a
tone off the screen, that is off.

Reloading is not a proposal about scenes. It is the tone you saved, and the
scenes are part of what you saved — the app will even stop and ask which of
them should come across when a tone has more than the unit holds, then tell you
which ones made it. Asking that and then writing none of them was the thing
worth fixing. The tick is still there on the card if you want to send the sound
without the scenes.

## 7.180.0

**The chat can see your preset list now.** "What presets do we have named
Metallica?" came back with "I don't have a way to browse your slot list or
library by name from here" — while the list was on screen at the time. It was
never sent. Three things in one conversation failed for that one reason: a
preset could not be found by name, an empty slot could not be found at all,
and "switch to an empty preset first before we write this" came back as an
offer to delete every block on the preset that was loaded, which is a
different thing and throws work away.

It now gets the slot numbers, the names it has learned, and which slots are
empty. "Load the Metallica preset" and "switch to an empty preset" are both
just a slot number it can look up.

**And it is told what it has not seen.** Learning a slot's name costs a whole
preset dump on an FM3, so the list is very often only part-read — which is
exactly how "you don't have a preset called that" gets said about a list
nobody has looked at. The unread slots are named as unread, and saying a preset
does not exist while any remain is now against the rules it works to.

## 7.179.1

**The phone can tell the unit it isn't drawing meter bars again.** A player
reported the audio cutting out for as long as the app was open and coming back
the moment it was closed. Most of that was fixed a while ago, and the last
piece was a route the Mac added specifically so a phone could say "I'm not
showing a meter, stop reading them" — which this app then refused to send,
because its own copy of the list of what may cross the relay had never been
told about it. Every remote session since has logged "POST /telemetry/meters
failed". The unit was doing four meter reads every tenth of a second, while
making sound, for a bar nobody was looking at.

## 7.179.0

**"Save this to slot 499" works from the phone now.** Asking for it in the chat
came back with "Saving to a slot only works at the Mac, so slot 499 was left
alone" — while the Save button two screens away had been saving from the phone
all along. It does it by parking the request where the Mac can see it and
letting the Mac do the writing, which is the one thing the relay has always
allowed. Saying it out loud now goes the same way: the chat asks the Mac, the
Mac saves it, and the answer comes back to the conversation that asked. It
still stops to ask before overwriting a slot.

**And two things that genuinely can't be done from the phone say so up front.**
Backing up a preset to a file, and keeping one in the folder on the Mac, both
need a dump the relay won't carry and a folder a phone doesn't have. They were
proposed anyway and failed at the end of a plan that had already applied
everything else — which reads as "it worked" right up until the next preset
change takes it away.

## 7.178.0

**A scene can no longer be sent to a sound that was never built.** Two of four
generated scenes came back with no sound at all. A scene does not hold a sound
— it points at one. The tone put the rhythm on the amp's channel A and the lead
on channel B, and then pointed two of its scenes at channels C and D, which
nothing in the build had ever dialled. Those scenes played whatever happened to
be sitting on those channels in the preset underneath, which is nothing anybody
designed and can be nothing at all. A scene is now kept on a channel this tone
actually built, and the preview says which scene was moved and why.

Only for blocks the tone dials a channel of. Channels you set up by hand months
ago are invisible to the app — reading a block reads the channel it is on and
no other — so a scene naming a channel of a block this tone leaves alone is
still taken at its word.

**And checking the tone no longer moves a scene off its own channel.** Which
channel a block plays is part of the scene, not of the block. The pass that
reads everything back to confirm it landed has to stand on a channel to read
it, so it finishes by putting every block back where the write pass left it —
and it was running after the scenes, landing in whichever scene you were
returned to and overwriting what the plan had just written there. One scene
came out with every block on the last channel dialled instead of the one it was
designed to play. The check now runs before the scenes, so the scene plan is
the last word.

## 7.177.0

**New chat puts the conversation down for good.** Pressing it emptied the box
and then the same chat came back. The box really did clear — what came back was
the account's copy. There is one live transcript per person so the chat is the
same on the phone as on the Mac, and New chat was never telling it anything:
the account went on holding the conversation, and the next time the phone
reloaded the page — which on a phone is constantly — an empty box next to a
full account read as a device that had not caught up yet, so it filled back up.
The account is told now, and the moment a chat was put down is written down
here first, so losing the page in the couple of seconds before that message
lands does not bring the chat back either.

A conversation started on the Mac *after* you pressed New chat on the phone is
a real one waiting for you, and it still arrives.

## 7.176.1

**One conversation is one row in History again.** The list showed the same
chat over and over — the same opening line at ten different times on one
afternoon — for a conversation that had only been had once. Nothing was
invented: each row was a real write of that chat under a new id. The app notes
down which conversation is on screen when the page goes away, and it was
writing that down and never reading it back, so every reload restored the
transcript, found no id, made a fresh one, and put another row on the shelf.
A phone reloads that page a lot.

**And the rows already there fold together.** Fixing the cause does nothing
about an account that is already holding ten copies of one chat, so the list
now recognises them: a conversation only grows, so a row whose transcript is
the opening of a longer row's is that same chat earlier in the day, and the
whole one is what gets shown. Nothing is hidden — the row that stays holds
every word of the ones folded into it — and deleting it deletes the pile
rather than uncovering the next copy down.

## 7.176.0

**"Connected" now means the Mac answered just now, not that it answered once.**
A phone showed MAC CONNECTED in green with the Mac switched off at the wall.
The word came from a latch: something answered at some point, and it stayed
true until a request failed and flipped it — so while nothing was being asked,
which on that screen is most of the time, the word was a memory. It can only be
said now if the Mac has answered inside the last twenty seconds, which is one
keepalive question plus the time it takes to give up on it, and the check runs
on the clock so it can fall over on its own with nobody touching anything.

**And nothing is said about your unit once the Mac has gone quiet.** The same
screen carried "THE MAC CAN'T SEE YOUR UNIT", which is a sentence only
something at the Mac could have said. It had been said — once, while the Mac
was on — and the app kept the answer and kept reading it. That answer is now
dropped the moment the Mac stops answering, so the notice can only say what is
still true: your Mac stopped answering.

**A Mac that is switched off is asked once, not five times.** The asking exists
because a unit answers "no" while it is loading a preset, and it is worth
several seconds for that. A Mac that is off never answers at all, so each of
the five attempts spends its whole twenty-second timeout — a minute and a half
in which the screen cannot say anything true and goes on showing the last thing
it knew. One attempt is enough to learn that nobody is there; a unit that is
merely busy still gets all five.

## 7.175.0

**A test that would have caught tonight's blank page.** The suite reads the code
rather than running it, which is what let a hook watching something defined
further down the same file get all the way to the app: 640 tests passed and the
screen was a sentence on an empty page.

That hazard is visible in the ORDER of the file, which is exactly what these
tests are good at reading. Every hook's watch list is now checked against where
the things it names are declared, in App.jsx and in every component, and a hook
that reaches into a dead zone fails the suite by name and line. Console.jsx has
carried a comment warning about this trap for months; a comment is not a test.

## 7.174.0

**Fixes a blank page.** 7.173.0 shipped an app that could not draw at all: "The
app couldn't draw — Cannot access 'we' before initialization", and nothing else
on the screen.

The check added in 7.173.0 — the one that asks the unit before believing a
single failed write — listed `read` among the things it watches, and `read` is
defined further down the same file. A watch list is read while the screen is
being drawn, so it reached for something that did not exist yet and the whole
app stopped there. The check now sits below the thing it watches. Nothing else
changed.

## 7.173.0

**The word beside the lamp is a whole word again.** "NO UN…", and "LOOKI…"
while it looks for the unit. Nine characters of a tracked, capitalised display
face is about five letters, and half a word says nothing at all. The cap is
there so a long unit name — "Axe-Fx III" — cannot spend the preset's eight
characters, and it stays for exactly that: while the unit is answering. When it
is not, the bar carries no preset at all, so the word gets the empty middle of
the bar and says NO UNIT, LOOKING…, NO ANSWER in full.

**And the two ends of that bar stop looking like they disagree.** "The phone
app says it has lost the unit, but also says it's connected in the right hand
corner." Both were true: the left of the bar is the UNIT and the right is the
MAC, and neither said so. While something is wrong — which is the only time the
two can be read as contradicting, and the only time there is room — the right
one says "Mac connected".

**A screen is no longer torn down over one failed write.** The red "your Mac
has lost the unit" notice was raised the moment any single call came back with
the port shut. One call can fail that way while the next is answered perfectly
— the Mac's own screen is asking that same port several times a second — so a
working rig could end up looking broken. The claim is now checked with a read
before anything is acted on: if the unit answers, the screen simply carries on;
only a read that fails too closes what is open. And when the notice does come
up it carries the far end's own words underneath — "port not open" is nothing a
player can act on, but it is the line that tells us which end to look at.

**The block editor stops jumping every time you turn a knob.** Two screenshots
half a second apart, the same sheet at two completely different heights: "when
I change any parameter the screen basically shakes up and down."

Turning a knob wrote the value and then asked the unit to read everything back
— the preset, the whole chain, the scene, its names, the tempo — five round
trips down the line to the Mac for a change to none of them. That re-read
handed the editor what looked like a different block, so it threw its six knobs
away, drew "Reading amp…" while it asked for values it had just read one line
earlier, and put them back. The sheet is as tall as what is in it, so that is
about two hundred pixels out of the middle of the screen and back, once per
knob.

Now the parameters are read again only when something actually changes what a
knob on that panel means: a different block, a different channel on it, or a
different scene — a block's settings are per-scene, so a footswitch on the
floor still brings the right values up. When a read does happen the knobs stay
on screen while it runs; "Reading…" is kept for a panel with nothing in it yet,
which is the one time it costs no height. And a knob no longer asks for the
chain at all. The switches beside it — channel, engaged, the model — do change
the chain, and those still ask.

## 7.172.0

**A block you switch off and a link that has gone are two different things,
and the chain screen was showing neither.** From a log on stage: every write
to the unit coming back `port not open` — the Fractal app on the Mac had lost
its serial port — and the chain sheet sitting there with all four blocks
reading On, tap after tap, saying nothing at all. "When I tap one of the
buttons it will turn it off on the unit, but there's no way to turn it back
on, and the buttons always say on."

Four things were wrong with that, all of them silent:

- **The explanation was drawn under the sheet.** The app raises every failure
  into one notice on the page, and a sheet is a surface over that page with
  the page made inert behind it. So the reason was there — in a place nobody
  could see or reach. Sheets that write to the unit show their own failures
  now, at the top, where the tap was.
- **The same failure twice looked like nothing happening.** The message was
  kept as text, so tapping again set the identical string and the screen had
  no reason to redraw. It is stamped with when it was raised now, so a repeat
  re-announces rather than sitting silent.
- **"port not open" is not a sentence anybody can act on.** It now reads: the
  Fractal app on your Mac has lost its connection to the unit, nothing sent
  from here is reaching it, check the unit is on and its cable is in. The
  server's own words are still written to the debug log, where they belong.
- **The app kept drawing a chain it could no longer stand behind.** A Mac with
  no port to the unit means nothing on screen is known to be true, so the app
  leaves that screen for the fault notice — the one screen with a Try again on
  it — with copy that says which end of the room to go to, rather than blaming
  a link that is working fine.

**A refused toggle asks the unit what it actually has.** The chain screen used
to trust its own roll-back: the button goes back the way it was and the strip
carries on. But a write that comes back as a failure can still have landed —
the frame goes out and it is the answer that gets lost — and then the strip is
showing the opposite of the truth, so the next tap sends the same thing again
and the block can never come back on. It re-reads instead, which is what the
stage screen has always done.

**And a dead link is asked once, not five times.** A chain read that fails is
asked again up to five times from a phone, because a busy port is the usual
reason and trying again is the whole fix. A port that is gone answers the same
way instantly, so one tap spent five relay round trips proving it — the log
from that stage is pages of exactly that. A read that fails because there is no
port stops there; a busy one keeps every retry it had.

**Try again now does what force-quitting the app does.** "I have to force close
the app completely and then reopen it for it to connect again." Closing the app
has one power: it rebuilds every piece. The connection to the Mac was the one
piece a reconnect kept — the phone still called the socket joined, so the button
was handed it back unchanged and read the unit down the same dead line as the
time before. A socket this end believes in and the server has let go of cannot
be told apart from a working one from inside the app, so the button stops trying
to tell and asks for a new one. Both Try agains do it — the one on the fault
notice and the one on the connect screen, which is where you land when the Mac
stops answering. The automatic check every few seconds still keeps a good
connection; only pressing the button pays for a fresh one.

**And that screen stops stating two things it doesn't know.** 7.169.0 taught it
to tell a Mac that went quiet from a unit that isn't there; this adds the fourth
case, which is the one from the log above — a Mac that answered perfectly well
and said it has no port to the unit at all. "Your Mac has lost the unit", and
what is on screen can no longer be trusted.

"It asked five times over a few seconds" was written into the sentence. Five is
what a phone does when it was not already connected; a unit that WAS answering a
moment ago is asked three times, and the app at the Mac asks once — and all
three were reported as five. It counts now and says the number it actually
asked. Where there is no specific explanation for a fault, the last thing that
came back is printed underneath it, because that screen has been photographed
twice with the one useful fact missing.

## 7.171.0

**A saved preset is called what you saved it as, in the list too.** Slot 98
held "3DG Verse-Rhythm-Lead" on the unit and on the Play screen, and the
Choose a preset list still said TIGHT MODERN — the name the slot had before
you overwrote it. Force-quitting the app and opening it again changed nothing.

Saving used to do one thing to the list: forget that slot's name and wait for
somebody to read it again. At the Mac that costs nothing, because the unit is
a cable away. On the phone it is a dead end — an AM4 won't hand over a preset
over the relay, so every name the phone shows came from the Mac, and the Mac's
copy was only ever merged in for slots the phone didn't already know about. A
slot it knew under the old name kept it, for good.

It was also throwing away the best evidence in the app. Nothing knows what
slot 98 is called better than the save that just put a name in it. So that is
what gets written down now, on all three routes — saving at the Mac, the Mac
carrying out a save you asked for from the phone, and the phone hearing back
that it landed — along with that preset's scene names, which the phone had the
same problem reading.

**And where the phone and the Mac disagree about a slot, the Mac now wins.**
The Mac is the end with the cable; the phone only knows what the Mac told it.
Until now a name that had gone wrong on the phone could never be corrected,
because the merge skipped any slot the phone already had a name for. A slot
the Mac hasn't learned yet is still left alone — "I haven't read it" is not
"it has no name" — so a half-scanned list can't empty the one on your phone.

---

## 7.170.0

**Saving a preset no longer ends on "the Mac can't see your unit".** The red
screen came up mid-save, with the unit plugged in and the Mac happily writing
to it.

The app was blaming the rig for its own request. A save takes the unit away
for a few seconds — the whole preset goes to flash and it answers nothing
while it does — and the app re-reads the moment the save reports done. That
read lands on a port still busy with the very thing it was told to do, the
answer comes back "nothing plugged in", and a working screen was replaced by a
cable to go and check. All three routes did it: saving at the Mac, the Mac
carrying out a save asked for from the phone, and the phone hearing back that
it landed.

A read that follows an order the app itself gave now keeps asking for about
five seconds before it believes a no. A unit that really was unplugged is
still named as one — it just takes those few seconds to say so, and only right
after a save.

**And the phone was being given the fewest chances exactly when it needed the
most.** There were two reasons to ask again — the unit was answering a moment
ago, and the question went over the relay — and they were written as either /
or, so a phone with both reasons got three asks where a phone with one got
five. Backwards, and the one with both is the one mid-gig. It now takes
whichever is the more patient.

---

## 7.169.0

**A phone that says "no unit" while the Mac says it is connected now tells you
which of the two is actually true, and keeps looking on its own.**

The phone was showing NO UNIT in red, over a notice reading "Your Mac
answered, but the unit didn't", while the Mac in the same room had the AM4 on
screen and answering. The Mac was right. What had happened on the phone was
that one question about the unit went out and nothing came back — the Mac's
own screen is polling that same port several times a second, and a question
that lands in the middle of that gets no reply. The phone had no way to say
so. It described the failure from the last thing it knew about the unit, which
before the first good answer of a session is nothing at all, and nothing fell
through to the wrong sentence: the Mac answered. It hadn't. Nothing had.

Now the phone says which of three things happened, and the three read
differently:

- **Your Mac stopped answering** — the question never came back. Nothing to
  check at the unit; check the Fractal app is still open on the Mac and that
  the Mac is awake.
- **Your Mac answered, but the unit wouldn't read** — the Mac is there, the
  unit didn't finish answering it. Usually something else is holding the
  port: another editor, or a second copy of the Fractal app.
- **The Mac can't see your unit** — the Mac answered and said nothing is
  plugged into it. This is the only one that is about a cable.

The word beside the lamp at the top left follows the same rule. It said NO
UNIT for all three; it now says NO ANSWER when it was the Mac that went quiet,
and keeps NO UNIT for the one case that is genuinely about the rig.

**And the red screen is no longer the end of it.** Once a read failed, nothing
ever asked again — the link was up, so the app had no reason to think anything
had changed, and the only thing still asking was your thumb on Try again. That
is the whole of why it "connects on the fifth or sixth tap". The app now asks
again by itself, three seconds later, then six, then twelve, up to every
thirty for as long as the screen is showing the fault. A rig that comes good
comes back on its own, with nothing in your hand. The notice says so, so a
screen that is working does not look like a screen that has given up.

The same loop runs at the Mac: plug a unit into a Mac that was showing "no
device" and the app finds it within half a minute instead of waiting for a
reload.

## 7.168.0

**Ask for a band and the scenes get named after their songs.** "Make me a Three
Days Grace preset" came back with three scenes called Verse, Rhythm and Lead —
a preset that could have been anybody's. The band's name reached the AI and
none of it reached your footswitch.

Now the name of the band is the point of the build. Name a band, an artist, an
album or an era and every scene is one of THEIR songs — named for it, and
dialled for it, with the amp and the gain and the effects that record actually
used. The summary says which song each scene is. Name one song instead and the
scenes are the parts of that song: intro, verse, chorus, solo. Describe a plain
sound with nobody's name on it and the scenes are still Clean, Rhythm and Lead,
because that is what they are.

A long title is shortened on purpose rather than chopped: the unit keeps 16
characters, so "Animal I Have Become" goes on as "Animal I" and still reads as
itself from the front panel.

The preset name follows the same idea — a Three Days Grace build is called
Three Days Grace, not "3DG Verse-Rhythm-Lead".

And Ask stopped losing the band on the way to the designer. Typing "make me a
three days grace full preset" was being rewritten into "modern alt-metal rhythm
crunch, cleaner verse tone and a cutting lead" before the tone was designed —
a description of nobody in particular that also asked, in so many words, for
exactly the three generic scene names that came back. Whatever you name is
carried through word for word now.

---

## 7.167.0

**An FM3 preset loaded onto an AM4 now asks which sounds you want.** The AM4
holds four scenes and the FM3 holds eight, so half the library was written
with more sounds in it than the unit in front of you has room for. Loading one
went ahead anyway: the first four scenes came across, the rest were thrown out,
and the only word about it was four lines in the "Rejected during checking"
panel at the bottom of the tone card.

Nothing was lost — the tone is still in your library, still eight scenes, and
still loads whole onto the FM3. What was wrong is that the four which survived
were picked by their numbering rather than by you, and on a set laid out clean,
verse, chorus, lead, solo, harmony, ambient, outro, the four that matter are
not the first four.

So the app asks first. Tap a tone the unit has no room for and a sheet lists
every sound in it by its own name, with a tick against the ones coming across
and the scene number each one will land on. Untick one, tick another. The
button says how many are coming; you cannot tick more than the unit holds.
There is also "Load the sound only" — every block and every setting, no scenes
written — for when the sounds you came for are the ones that do not fit.

What you pick is renumbered on the way in. Pick scenes 1, 3, 6 and 8 off an
FM3 tone and they arrive on the AM4 as scenes 1, 2, 3 and 4, in that order,
keeping their names — so the footswitch under scene 2 plays what was scene 6
and is still called what it was called.

None of this names a unit. The count comes off whatever is plugged in, so the
same question covers an Axe-Fx III tone on a VP4 and anything else the two
generations disagree about. A tone that fits is never asked about at all.

And the History list now says which unit a tone was made on, under its name,
when it was not the one you are on — so "made on the FM3" is something you can
see before you tap it rather than something you find out afterwards.

## 7.166.0

**The chain shows its two ends now.** They were always there on the unit and
the strip quietly dropped them, drawing a plain arrow at each end instead — so
a preset running out of Output 2, or one with no input block at all, looked
exactly like every other one. Input and Output are tiles at each end of the
strip now, with the unit's own name for them underneath: "Input 1", "Output 1".

Drawn quieter than the blocks between them, because they are the plumbing
rather than the tone, and with no on/off under them — a preset with its output
bypassed is one nobody can hear, and that is not a switch to put under a thumb.
Tapping one opens it, which is how you see what the input gate is doing or
where the output level sits. Where a preset genuinely has no block at one end,
the arrow still stands in, and now means something.

The stage screen is untouched: nobody kicks an input block between two bars,
and it still filters both out.

## 7.165.0

**A saved tone reloaded onto an empty slot now builds its own chain.** Asking
for a tone on an empty preset has put a chain in first since 7.140, because
that is plainly what you meant. Reloading a tone you already made is the same
sentence and never learned it: the saved design was checked against a preset
with nothing in it, every change was dropped for naming a block that was not
there, and the app told you to go and type "add an amp and a cab" yourself.

From a real log: slot 478 empty, nine changes proposed, nine dropped, none
written, and the empty preset saved back to 478 — then Chain, correctly,
showing an empty chain. The blocks now come from the design's own record of
what it was made of, so what gets placed is what that tone actually needs
rather than a generic starter chain, and a copy of the slot is taken first the
same way the design path takes one.

**And an empty chain says so.** It was two signal arrows with a gap between
them, which reads as a panel that failed to load rather than as a preset with
nothing in it yet.

**Blocks are resolved by name as well as by slug when a chain is built.** The
model says "drive"; a saved design says "Amp 1", "Cab 1", "Vol/Pan 1" — those
are the names it recorded when it was made, and putting them back has to work.
Two names that mean the same block now place it once rather than twice.

## 7.164.0

**The preset list, a third time, and this time it does not depend on the thing
that was failing.** Twice now the list has opened at 000 with the loaded preset
four hundred rows below it, against code that lands it in the middle in every
browser this can be driven in. The retry added last time did not help, which
rules out the two timing explanations and points at the write itself: a
scrollTop set on a box that owns its own compositor layer is dropped on iOS
often enough that it cannot be assumed to have worked — the assignment succeeds,
the list does not move, and from inside that is indistinguishable from success.

So the list now sets an absolute position rather than nudging a relative one,
checks whether that actually took, and if it did not, asks the browser to put
the row on screen itself and puts the page's own scroll back afterwards. If it
cannot even find a scrollbox after two thirds of a second of looking, it asks
the browser anyway rather than giving up. The target is clamped to the scroll
that exists, so a preset near either end of the list is judged against a
position the box can actually reach.

A thumb still wins, and is now recognised by an actual gesture rather than by
reading the scroll position back — on iOS the value read after a write is
routinely not the value written, so the old guard could fire on its own and
switch off the very retry that platform needs.

**And it writes down what it did.** One line in the debug log each time the list
opens, naming where it put the row or why it could not. This has been reported
twice with nothing to go on afterwards but a screenshot.

## 7.163.0

**The preset list opens where you are standing, and this time it holds.** It
was already supposed to — the code has been there since 7.155 — but it took
exactly one look, on the instant the list appeared, and gave up for good if it
found nothing to scroll. Two perfectly ordinary things make that instant the
wrong one: the sheet takes about a third of a second to arrive, and on iOS a
scroll written to a box inside a panel that is still sliding into place is
quietly thrown away. Both look exactly like success from inside a single look,
and both leave a list of 512 sitting at 000 with the loaded preset four hundred
rows below it.

It now keeps looking for about two thirds of a second, holds the position while
the sheet lands, and puts the loaded preset in the MIDDLE of the screen so the
ones either side of it are there to read. The moment anything else moves the
list — a thumb, most of all — it stands down: being dragged back to the middle
while you are already reading is worse than opening at the top.

Typing in the filter still goes to the top, because then the matches are the
thing you asked for.

## 7.162.0

**History is a button at the top of Setup now, not a fold at the bottom.** It
sits in the first row the gear opens onto, beside Demo mode and Read the unit
again — one tap, no scrolling, and no panel to open first.

**And a stale app finds out about a new one within a minute.** The check ran
every ten minutes and only noticed an app coming back through one of the three
ways iOS brings one back, so a deploy that was live and correct could sit
unannounced for a quarter of an hour — which from the outside is
indistinguishable from a deploy that never happened. It now looks every minute
and on every way an app returns to the front.

Reload had the same problem in a worse form: on an app installed to the home
screen, `reload()` is entitled to hand back the copy already in the browser's
cache — a button that looks like it worked and leaves you on the same old
version. It fetches the page from the network and replaces that copy first now.

## 7.161.0

**You can start a fresh chat, and the old one is still there when you want
it.** There was one conversation and no way to put it down — a chat that had
been going for days meant scrolling past days to read the last thing said. New
chat, above the transcript, clears the box and shelves what was in it. The tone
on screen and the last design go with it, because a fresh chat that still
remembered the last tone would just be the same conversation with its
transcript hidden.

**And yes, it was reading the conversation all along.** Every request already
carries the last two dozen turns, labelled so the model knows which were yours,
which were its own, and which were notes the app wrote — which is why "a bit
more" and "put that back" have always worked. Nothing about that changed; what
changed is that a conversation can now be ended deliberately instead of running
for ever.

**History, behind the gear.** Every chat you have had and every tone you have
designed, in one sheet, with one list of presets rather than a panel per place
they are stored. Signed in it is all kept with your account; signed out it is
all in this browser, and the sheet says which in one line at the top. The
Presets sheet still has its three panels, because "where is this kept" is a
real question when you are moving a library — it is just not the question you
are asking when you want the tone back that you made on Tuesday.

**The chain is reachable from a phone.** Chain, on the bottom bar beside Ask:
every block in the preset in order, with its knobs, the block list to add and
remove from, and the modifiers. The Edit screen it comes from is still not one
swipe from the stage screen — that rule is about what a thumb lands on in the
dark — but there was no way to it at all before, so a phone could see which
blocks were on and never what any of them was set to.

**A chain built into an empty preset gets an input block.** It already got an
output, because a preset without one makes no sound and leaves the volume
slider with nothing to move. It never got an input, which is the same silence
from the other end of the row: the guitar reaches nothing, every value lands,
the unit reads them all back, the preset saves. Both the assistant's chain
builder and the Starter chain button put in whatever is missing and step around
whatever is already there, and the preset check in Setup names a missing input
the way it already named a missing output.

## 7.155.0

**The watcher now writes down the misses too, which is the only way it can
measure anything.** It was only recording what it caught — so a session with no
lines in it read exactly the same whether it had caught nothing or was never
asked. A real log came back with two chat requests and no lines at all, and the
only way to tell which had happened was to read the entries beside them and try
the words by hand.

**Both had missed, and both for reasons worth fixing.** "Change amp to channel
b" missed because "change" was not among the words it knew for that; renaming a
scene missed because it was never built. Both work now, along with "rename scene
3 as Solo" and "call scene 1 Clean".

It still acts on none of it.

## 7.154.0

**The cost under each run was overstating itself by about 42%.** The token count
the app reads back is the *total* — it already includes the tokens written to
the cache. The app was taking the cached-read tokens back out of it but not the
written ones, so every written token was charged twice: once at full price
inside the total, and again at the write premium on top. A real run reported as
20.5¢ actually cost 14.4¢.

The line under the figure now adds up too. It used to print the total input
beside the cache write, which reads as though they were separate — that is what
made a run look like 78k tokens when it was 48.6k. It now shows what was
actually charged at full price, so fresh plus cached plus written is the total.

Nothing about what gets sent has changed; the meter was wrong, not the usage.

## 7.153.0

**The app is now watching for the questions it never needed the AI for.**
"Scene 3." "Bypass the delay." "Tempo 120." "More treble." Every one of those
goes to the AI today — costs money, takes a round trip — for a sentence with one
reading and no judgement in it. There is now a matcher that can answer them
without asking anybody.

**It is not switched on.** It runs, works out what it would have done, writes
that to the debug log, and then does nothing: your request goes to the AI
exactly as before. Nobody can guess what share of the things you actually type
are the plain kind, and a matcher switched on against a guess is one that writes
to your unit on the strength of a guess. So it reports first. A few sessions of
that and the real hit rate is a number instead of an estimate — and any match
that reads wrong is caught while it is still only a line in a log.

It is deliberately timid. It answers only when the whole sentence is understood,
exactly one block or control matches, and the value is one the control can
actually hold. Two delays and "bypass the delay" is ambiguous, so it misses. An
amp Gain and a drive Gain and "more gain" is ambiguous, so it misses. Anything
with judgement in it — "make it brighter" — was never its to answer. A miss
costs nothing; that is the whole design.

Where it does answer a nudge, it uses your own numbers: what it has watched you
reach for on that control, rather than a share of the range.

## 7.152.0

**Writes from your phone can be checked again.** After writing a value the app
reads it back to confirm it stuck, and to read honestly it first has to clear
the unit's memory of the old value — which only ever worked at the Mac, so from
a phone nothing could be confirmed at all. The device server the app carries now
lets that clear travel, so a preset sent from your phone is verified the same
way one sent from the Mac is. A Mac still on an older build refuses it; the app
asks once, takes the answer, and stops asking until you reconnect.

**And six of your presets get their names back.** Slots 488 to 494 showed blank
in the preset list because reading them crashed the decoder — an empty slot made
it read a compressed body that wasn't there and loop until it ran out of room.
Empty slots now come back empty instead of taking the reader down with them.

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
