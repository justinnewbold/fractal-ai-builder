# Working on Fractal Remote

## How to talk to Justin

**Ask him for something only when you actually need it.** This started as
"put what you need from him at the end of the reply" and turned into a
numbered block of questions on every single reply, most of them asking him
to go and test the app. He does not want that:

> "Also remove the 123 questions at the end. Only ask things that you
> absolutely need of me, not just tell me to test the app. I'm obviously
> going to test the app. I'll let you know if something's wrong."

So: most replies should ask him nothing. Never ask him to test — he tests
everything and reports back on his own. Never ask him to confirm a fix
worked; ship it and wait. Only genuinely blocked work gets a question —
something only he can decide, or something only he can see (his rig, his
account, a screen you cannot reach).

When there IS such a question, it goes at the END of the reply, on its own,
in plain words. One question, not a numbered list. If there are somehow two,
two lines will do — the numbering was never the point.

What he asked for originally was that questions be *readable*, not that they
be *collected*: "I don't want a bunch of developer jargon, it's hard for me
to read and understand, so I just need crystal clear questions when you ask
them, that's all."

**Write it for a guitarist, not a developer.** Justin is not a programmer.
Say what a change does to the app in front of him, not what it does to the
code. Name the file only when he needs to find it. "The buttons move up next
to PLAY" beats "the control is lifted into the tab row". If a question needs
jargon to make sense, the question is not finished yet.

Give options as plain choices with the consequence attached, and say which
one you would pick.

**Never start an Expo build without asking him first.**

> "I have a very limited amount of free expo builds for iOS so I need to make
> sure that everything is actually correct before we push a build. We can't
> just do it every little tiny change."

This is the one place in the project where being wrong costs him something
that does not come back. A test suite can be run a hundred times; an iOS
build slot is spent. Three went on one evening, and only the first had to.

So: say what the build is for and wait. It is not covered by "he said keep
going" earlier in a session, because the cost is per build rather than per
task.

**And while the phone is being brought up to the browser, the answer is no.**

> "You can do it in passes but don't push to expo until it's all done."

The port of the browser's screens onto the phone lands in several pieces,
each one merged and each one useless to look at on a handset until the last
of them is in. Building after every pass would spend a slot to show him a
third of a screen. Work, merge, and let the builds wait for the end of it.

What does NOT need asking, because none of it spends anything:

- `npm test`, and `npx expo export` for either platform, which is the real
  check that the app still bundles
- the `check` job in `.github/workflows/mobile.yml`, which runs on every pull
  request and does exactly that
- anything on GitHub Actions at all

Which means the honest sequence is: bundle both platforms locally, get CI
green, and only then ask whether it is worth a build.

And when a build has already succeeded, a failed SUBMISSION does not need
another one. The workflow has a Submit only box for exactly that: it sends
the build sitting on Expo's servers rather than making a byte-identical
replacement. Reach for it before reaching for Build.

## Things that cost real time to learn here

**Every change needs a new version number.** The `version` job in
`.github/workflows/web.yml` compares this branch's `package.json` against the
base branch and fails if they match. `desktop/package.json` has to move with
it — a test holds the two to each other.

**CI runs Node 24, and the Mac app does not — yet.** The runners moved off
Node 20 in 7.334.0. What did NOT move is the Node the packaged Mac app runs
the device server on: that one comes from Electron (`desktop/main.js` spawns
`process.execPath` with `ELECTRON_RUN_AS_NODE`), so it is whatever the
pinned Electron bundles. Electron 33 carries Node 20.18; Node 24 first
appears in Electron 40.

The watching brief that used to live here is discharged. Both of its
triggers had fired — GitHub forces the build actions onto Node 24 now, and
eas-cli 24.6.0 refuses to install on Node 20 at all, which is why
`mobile.yml`'s build job went to 22 ahead of everything else.

The fear it was written around turned out to be smaller than it read. The
two compiled addons are `serialport` (`@serialport/bindings-cpp`) and
`@julusian/midi`, and BOTH declare N-API: `napi_versions` 8 and 7. N-API is
ABI-stable by design — it is the whole reason those packages publish it — so
a module built for one Node loads under another, and under Electron, without
being rebuilt. Node 24 offers N-API 10 and everything below it.

And half of what the note called unprovable is already automated.
`.github/workflows/desktop.yml` has a step, "The native modules load under
Electron", that loads both addons under Electron-as-Node on every desktop
build. A move that broke them goes red there, before it reaches his machine.
What that step still cannot answer is whether the app FINDS the FM3 — that
needs the unit plugged in, and that is the one part to ask him about.

So an Electron bump is an ordinary change with one hardware check at the end,
not a change to be avoided. Nothing forces it today: nothing is broken on
Electron 33.

**A test that a Node version can hide.** Two `test(...)` calls once sat
inside another test's body, so they registered while the queue was draining
rather than while the file was read — which put one of them past the point
`settle()` counts the score. The tally printed "808 passed" on a run whose
809th test had FAILED, and the count moved with the runtime (809 on Node 22,
808 on Node 20 and 24). `settle()` now re-awaits until the chain stops
growing, and a structural check fails on any `test(` registered inside
another test's callback. If the count ever disagrees with itself across two
Node versions again, that is the shape of the bug to look for.

**`test/structure.mjs` reads App.jsx as text, not as code.** It finds screens
by searching for the literal conditional that opens them and takes the first
hit — so writing that same conditional higher up the file, *including inside
a comment*, hands the test the wrong block. Both of those have happened. Give
the condition a name instead.

**The phone and the browser share one relay allowlist.** `shared/relay-rules.mjs`
is the source; `mobile/src/lib/relay-rules.js` is generated from it by
`npm run sync:rules` and a test fails if it is stale. Never hand-edit the
generated copy.
