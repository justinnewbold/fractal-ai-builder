# Later

Things Justin wants, but not yet. Each one says what it is in plain words and
what it would take. Start from here when he says "let's do the next one".

## Justin's own tools (only on justinnewbold@icloud.com)

Built so far: **Give someone access** with the **Customer lookup** under it, and
**Sales at a glance**. Both in Settings, at the bottom. "Do number one and five
for now, and then after that, let's put them on a list of to do sometime
later."

Still to do:

- **Messages from users.** Everything people send through Troubleshooting →
  "tell us", readable inside the app with the log they attached, instead of
  only arriving by email. The messages already land in Supabase (see
  `supabase/migrations/20260905_feedback_email.sql`); this is a page to read
  them, behind the same lock as `supabase/functions/grant-access`.
- **View as a new customer.** See the walkthrough, the paywall and the first
  screens exactly as a stranger sees them, without signing out or deleting
  anything. Useful for checking changes to those screens.
- **Help someone sign in.** From the Customer lookup: resend their "confirm your
  email" message, or send them a password reset. The lookup already says when
  somebody has not confirmed; this puts the button next to it.
- **What's live.** Which version each piece is on (iPhone, Android, website,
  computer app), and whether the latest update has reached phones. Answers
  "why am I still on 1.66?" at a glance.

## Older Fractal units

The Axe-Fx II (Mark I, Mark II, XL and XL+) is in as of 1.86.0: presets,
scenes, blocks on and off, X/Y, placing blocks, knobs. None of it has been on
a real one yet — a friend of Justin's is the first tester. After that:

- **Axe-Fx II: tuner, tempo, scene names, the preset name list.** Each needs a
  recording of what the unit sends, from the tester's rig.
- **AX8.** Easy once the Axe-Fx II is proven: it is an Axe-Fx II with fewer
  blocks and a different model byte. Needs an AX8 owner to test.
- **FX8 and FX8 Mk II.** Medium to hard. Fractal never published how it talks,
  and it has an 8-slot chain instead of a grid. Needs an owner and recordings
  of FX8-Edit.
- **Original Axe-Fx (Standard, Ultra).** Hard. A different language, no USB
  (a MIDI cable interface), no scenes, no X/Y. Needs an owner.

## Waiting on something

- **The GitHub description** still says "AI-powered preset builder…". It
  needs changing by hand on the repository's page (the gear next to About).
- **RevenueCat's sample products.** The test store still holds the three
  sample packages RevenueCat starts every project with. They need deleting
  in the RevenueCat dashboard.
