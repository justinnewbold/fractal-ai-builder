/**
 * What actually made that sound, looked up rather than remembered.
 *
 * "All the songs generated here absolutely don't match these songs in real
 * life. I don't think it's matching up the real song names to what the amps
 * and delays and tones should truly be."
 *
 * He was right, and the failure has one cause. The app already knows what every
 * model on the unit IS in real life — src/lib/lineage.js carries a maker and a
 * real amp for each one, and the roster reaches the designer with those on it.
 * What nothing carried is the other half of the join: what gear the BAND used.
 * That was left to the model's memory, and memory is where it went wrong.
 *
 * Asked for Three Days Grace, it built the preset on a Peavey 6505 and a Mesa
 * TriAxis. The band plays Diezel VH4s and modded Marshall JMP-1s into ENGL
 * power amps — and this unit has all three: Das Metall and Dizzy V4 are the
 * VH4, Brit Pre and JMPre-1 are the JMP-1, Energyball and Angle Severe are the
 * ENGLs. Everything needed was in the request except the one fact that decides
 * which of them to pick.
 *
 * So the fact is fetched. One search-backed call before the design, in the order
 * a person would do it: find the band, find what they played, then pick the
 * songs the scenes will be — songs a fan would name AND songs that genuinely
 * sound different from each other — and look up each one's own tone in turn.
 * The designer then matches that against "basedOn" the way it was always told
 * to, with something true to match against, and voices each scene from its own
 * song's line rather than from the band's general sound.
 *
 * The song half is the part that was missing first time round. The rig went in,
 * the designer picked the songs afterwards out of its own memory, and nothing
 * ever looked up what "Chalk Outline" sounds like as against "Home". Eight
 * scenes came back named after eight songs over three amp voicings, one drive
 * setting and one delay setting, which is what prompted: "so that way we're
 * getting accurate tones on every scene".
 *
 * ## Never fails the generation
 *
 * A tone designed without this is the tone the app produced yesterday, which is
 * worth having. A tone nobody gets because a search timed out is not. Every
 * failure here returns null and the design goes ahead exactly as it did before.
 *
 * ## Why it is a separate call
 *
 * The designer is a structured-output request — it is pinned to a Zod schema so
 * a malformed reply cannot reach the unit — and a schema-constrained call
 * cannot also carry tools. Splitting it keeps that guarantee untouched: this
 * step returns prose, the designer stays constrained, and if this step returns
 * nothing the designer never knows it ran.
 */

/**
 * How long the lookup gets before the design has to start without it.
 *
 * Raising this was the wrong lever and it took two runs to see why. Sixty
 * seconds timed out; two minutes timed out as well, and then the design —
 * which needs a minute or two of its own — was cut off by the client's
 * three-minute "still has not written a word" clock with nothing to show. Two
 * failed generations, five minutes of waiting, no tone.
 *
 * The fault was never the number. It was that this was all-or-nothing: the
 * answer arrived in one piece at the end, so being stopped anywhere before
 * that threw away every search it had made. Eight songs is not a job with a
 * predictable length, and no budget makes it one.
 *
 * So the answer is streamed and kept as it arrives (see below), and the budget
 * goes back down to something that leaves the design room to work. Ninety
 * seconds of searching now yields ninety seconds of findings rather than
 * nothing at all.
 */
const RIG_TIMEOUT_MS = 90000

/** What comes back is a briefing for a prompt, not a document. */
const MAX_CHARS = 8000

/** Songs to cover when the player has not said how many scenes they want. */
const SONGS_BY_DEFAULT = 4

/**
 * The exact words that decide whether this costs anything at all.
 *
 * Naming music is not something an app can detect with a regular expression —
 * "Riot" is a band, a song and a plain English word — so the model is asked,
 * and is told in the same breath to answer NONE and stop when the request is
 * just a description of a sound. "A tight modern metal rhythm tone" must not
 * send anybody searching.
 */
function rigSystem(songs) {
  const wantsSongs = Number.isInteger(songs) && songs > 0
  return `You research guitar rigs for a preset designer.

You are given one request a guitarist typed. Decide first whether it names real
music — a band, an artist, an album, an era, or a song. If it does not, reply
with exactly NONE and nothing else. A description of a sound with nobody's name
on it ("tight modern metal", "warm blues lead", "eighties clean") is NONE.

If it does name music, search and report what actually made those sounds.

RIG

- AMPS: the specific heads or preamps, by make and model. Name the ones the
  records were made on and the ones used live if they differ.
- DRIVE AND EFFECTS: overdrive or distortion pedals in front, and the delays,
  reverbs, modulation actually used. Name models.
- TUNING: how the guitars are tuned, and say if it changed between records.
- ERAS: where the rig changed over the band's career, say which records each
  belongs to.
${
  wantsSongs
    ? `
SONGS

Then pick exactly ${songs} songs and look each one up in turn.

Pick them on two counts at once: songs a fan of theirs would name, AND songs
that genuinely sound different from one another. ${songs} of their biggest
singles that are all the same drop-tuned rhythm tone is a worse answer than
their four biggest plus the one clean song everybody knows. Spread across
eras where the rig changed.

Search for each song's own tone rather than answering from the band's general
sound, and give, as far as the sources support:

  SONG: <title>
  ALBUM/YEAR: <record and year, so the era's rig is the right one>
  TUNING: <if it differs from the band's usual>
  AMP: <which of the amps above, which channel, roughly how much gain>
  DRIVE: <pedal in front, or none>
  DELAY: <roughly how long, how much feedback, how loud in the mix, or none>
  REVERB/MOD: <what is audible, or none>
  CHARACTER: <one line a guitarist would recognise — "clean verse into a wall
  of gain on the chorus", "dry tight chug, no delay", "wide delayed lead">

Where a song's own tone is not documented, say so on its line rather than
inventing one, and say what it most likely shares with the band's usual rig.

Order matters, because you may be stopped part-way and whatever you have
written by then is what gets used. Finish RIG completely before starting
SONGS — the amps are what the whole preset is built on and every scene needs
them. Then take the songs most worth having first, and finish each one's block
before beginning the next. Half a song's lines are worth less than one song
fewer.
`
    : ''
}
Rules:

- Report what the sources say. Where they disagree or say nothing, say so — a
  designer told "unknown" will pick something sensible, a designer told
  something false will build the wrong preset and sound certain about it.
- Never pad. If all you can establish is the amp and the tuning, that is the
  answer.
- No preamble and no sign-off. Plain lines, no markdown headers.
- Write for somebody choosing between amp models by their real-world
  counterparts, so always give makes and models rather than adjectives.`
}

/**
 * The rig behind a request, as text for the designer's prompt, or null.
 *
 * Takes its model and its search tool from the caller so the route keeps one
 * place where a provider is chosen — and so a deployment with no direct
 * Anthropic key, where the server-side search tool is not reachable, simply
 * passes null and skips this.
 */
export async function researchRig({
  description,
  songs = SONGS_BY_DEFAULT,
  model,
  streamText,
  webSearch,
  signal
} = {}) {
  const began = Date.now()
  const asked = typeof description === 'string' ? description.trim() : ''
  if (!asked || !model || typeof streamText !== 'function' || !webSearch) {
    return { rig: null, why: 'off', ms: 0 }
  }
  const wanted = Number.isInteger(songs) && songs > 0 ? Math.min(songs, 8) : 0

  const control = new AbortController()
  let ranOut = false
  const timer = setTimeout(() => {
    ranOut = true
    control.abort()
  }, RIG_TIMEOUT_MS)
  const stop = () => control.abort()
  signal?.addEventListener?.('abort', stop)

  /*
   * Kept as it arrives, so being stopped costs only what had not been written.
   *
   * This waited for the whole answer and threw it away on a timeout, twice —
   * the second time after ninety searches' worth of work. A rig briefing is
   * prose that accumulates: the amps, then a song, then another song. Stopping
   * it mid-way leaves something genuinely useful behind, and the prompt above
   * puts the most valuable parts first so that what survives is the right part.
   */
  let sofar = ''
  try {
    const res = streamText({
      model,
      system: rigSystem(wanted),
      /*
       * Low effort on purpose. This is a lookup and a summary, not a judgement
       * — the judgement is the designer's job, on a bigger prompt, afterwards —
       * and the whole point of this step is that it costs a few seconds rather
       * than doubling a generation that already takes a minute.
       */
      providerOptions: { anthropic: { effort: 'low' } },
      maxOutputTokens: 4000,
      tools: { web_search: webSearch },
      abortSignal: control.signal,
      messages: [{ role: 'user', content: asked }]
    })
    for await (const part of res.textStream) sofar += part
    const rig = cleanRig(sofar)
    return { rig, why: rig ? 'found' : 'none', ms: Date.now() - began }
  } catch {
    /*
     * Offline, no credit, a search that would not answer, or simply slow. The
     * design goes ahead on whatever arrived, which on a timeout is now usually
     * the rig and some of the songs rather than nothing.
     *
     * Either way it no longer goes ahead in silence. A timed-out lookup and a
     * lookup that never ran produced the same empty log line, and the
     * difference between them is the difference between "raise the budget" and
     * "check the key": one real run cost a whole round trip to tell apart.
     */
    const rig = cleanRig(sofar)
    const why = ranOut ? (rig ? 'partial' : 'timeout') : rig ? 'partial' : 'failed'
    return { rig, why, ms: Date.now() - began }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', stop)
  }
}

/**
 * What the lookup did, in words, for the log and for the progress line.
 *
 * Deliberately says the timeout out loud rather than folding it in with the
 * other empty answers: a tone built from memory because a search was killed
 * mid-way is a tone somebody should know was built from memory.
 */
export function rigOutcome({ why, ms } = {}) {
  const secs = Number.isFinite(ms) && ms > 0 ? ` after ${Math.round(ms / 1000)}s` : ''
  if (why === 'found') return `Looked up the rig${secs}`
  if (why === 'partial')
    return `The rig lookup ran out of time${secs} — designed from as much of it as it had reached`
  if (why === 'none') return 'Nothing named to look up'
  if (why === 'timeout') return `The rig lookup ran out of time${secs} — designed from memory instead`
  if (why === 'failed') return `The rig lookup failed${secs} — designed from memory instead`
  return 'The rig lookup is not configured here'
}

/**
 * NONE means nothing, and nothing must read as nothing.
 *
 * A model that says "NONE" and then explains itself for a paragraph would
 * otherwise put that paragraph in front of the designer as though it were a
 * rig. So the check is on how the answer opens, and anything that opens with
 * NONE is discarded whole.
 */
export function cleanRig(text) {
  const out = typeof text === 'string' ? text.trim() : ''
  if (!out) return null
  if (/^none\b/i.test(out)) return null
  return out.slice(0, MAX_CHARS)
}

/**
 * How the rig is put to the designer.
 *
 * As findings rather than as orders, and said out loud: the designer is told
 * this came from a search rather than from its own memory, because the two
 * disagreed and the search is the one with sources behind it. It is also told
 * what to do when the unit has no counterpart, which is the case this is most
 * likely to create — somebody's signature amp that Fractal never modelled.
 */
export function rigInstruction(rig) {
  if (!rig) return ''
  return `\n\nWHAT MADE THIS SOUND

Looked up for this request, from sources, rather than recalled. Where this and
your own memory disagree, this wins.

${rig}

Match the RIG against the roster through "basedOn": the amp named here is the
amp whose model you pick, and the pedal named here is the drive you place.
Where this unit has no counterpart for something named, pick the nearest and
say in the summary what it is not.

Where SONGS are listed, those are your scenes — one scene per song, in the
order given, named for that song under rule 14's sixteen characters. Voice each
one from ITS OWN lines, not from the band's general sound: its amp and gain
decide which channel that scene plays, its drive decides whether the drive
block is on in that scene and on which channel, and its delay decides the delay
block's time, feedback and mix. Two songs whose lines differ must not come back
as two scenes playing the same channels — that is the failure this lookup
exists to end. A song whose own tone the lookup could not establish is the one
place to fall back on the band's usual rig, and say so in the summary.`
}
