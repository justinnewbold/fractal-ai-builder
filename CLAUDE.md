# Working on Fractal Remote

## How to talk to Justin

**Put everything you need from him at the very END of your reply, under a
clear heading.** He has asked for this explicitly. Anything he has to decide
— a choice, a go-ahead, something only he can check — goes there, not
scattered through the message.

**Write it for a guitarist, not a developer.** Justin is not a programmer.
Say what a change does to the app in front of him, not what it does to the
code. Name the file only when he needs to find it. "The buttons move up next
to PLAY" beats "the control is lifted into the tab row". If a question needs
jargon to make sense, the question is not finished yet.

Give options as plain choices with the consequence attached, and say which
one you would pick.

## Things that cost real time to learn here

**Every change needs a new version number.** The `version` job in
`.github/workflows/web.yml` compares this branch's `package.json` against the
base branch and fails if they match. `desktop/package.json` has to move with
it — a test holds the two to each other.

**CI runs Node 20; a dev machine may not.** A bug that only appears on one
Node version will pass locally and fail on CI, which has already happened
once (a `localStorage` read that threw only because the two versions drain
the test queue in a different order). When a test passes here and fails
there, suspect the runtime before suspecting the test.

**`test/structure.mjs` reads App.jsx as text, not as code.** It finds screens
by searching for the literal conditional that opens them and takes the first
hit — so writing that same conditional higher up the file, *including inside
a comment*, hands the test the wrong block. Both of those have happened. Give
the condition a name instead.

**The phone and the browser share one relay allowlist.** `shared/relay-rules.mjs`
is the source; `mobile/src/lib/relay-rules.js` is generated from it by
`npm run sync:rules` and a test fails if it is stale. Never hand-edit the
generated copy.
