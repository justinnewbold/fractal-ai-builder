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
 * So the fact is fetched. One short search-backed call before the design, whose
 * whole job is to come back with the rig: the amps, the pedals, the tuning, and
 * anything per-song worth knowing. The designer then matches that against
 * "basedOn" the way it was always told to, with something true to match against.
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

/** Long enough for a search and a read, short enough not to double the wait. */
const RIG_TIMEOUT_MS = 30000

/** What comes back is a paragraph for a prompt, not a document. */
const MAX_CHARS = 4000

/**
 * The exact words that decide whether this costs anything at all.
 *
 * Naming music is not something an app can detect with a regular expression —
 * "Riot" is a band, a song and a plain English word — so the model is asked,
 * and is told in the same breath to answer NONE and stop when the request is
 * just a description of a sound. "A tight modern metal rhythm tone" must not
 * send anybody searching.
 */
const RIG_SYSTEM = `You research guitar rigs for a preset designer.

You are given one request a guitarist typed. Decide first whether it names real
music — a band, an artist, an album, an era, or a song. If it does not, reply
with exactly NONE and nothing else. A description of a sound with nobody's name
on it ("tight modern metal", "warm blues lead", "eighties clean") is NONE.

If it does name music, search for what actually made those sounds and report it.
Cover, as far as the sources support:

- AMPS: the specific heads or preamps, by make and model. Name the ones the
  records were made on and the ones used live if they differ.
- DRIVE AND EFFECTS: overdrive or distortion pedals in front, and the delays,
  reverbs, modulation actually used. Name models.
- TUNING: how the guitars are tuned, and say if it changed between records.
- PER SONG: where a named song is voiced differently from the band's usual
  sound — a cleaner verse, a different amp, a particular delay — say which song
  and how.
- ERAS: where the rig changed over the band's career, say which records each
  belongs to.

Rules:

- Report what the sources say. Where they disagree or say nothing, say so — a
  designer told "unknown" will pick something sensible, a designer told
  something false will build the wrong preset and sound certain about it.
- Never pad. If all you can establish is the amp and the tuning, that is the
  answer.
- No preamble and no sign-off. Plain lines, no markdown headers.
- Write for somebody choosing between amp models by their real-world
  counterparts, so always give makes and models rather than adjectives.`

/**
 * The rig behind a request, as text for the designer's prompt, or null.
 *
 * Takes its model and its search tool from the caller so the route keeps one
 * place where a provider is chosen — and so a deployment with no direct
 * Anthropic key, where the server-side search tool is not reachable, simply
 * passes null and skips this.
 */
export async function researchRig({ description, model, generateText, webSearch, signal } = {}) {
  const asked = typeof description === 'string' ? description.trim() : ''
  if (!asked || !model || typeof generateText !== 'function' || !webSearch) return null

  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), RIG_TIMEOUT_MS)
  const stop = () => control.abort()
  signal?.addEventListener?.('abort', stop)

  try {
    const res = await generateText({
      model,
      system: RIG_SYSTEM,
      /*
       * Low effort on purpose. This is a lookup and a summary, not a judgement
       * — the judgement is the designer's job, on a bigger prompt, afterwards —
       * and the whole point of this step is that it costs a few seconds rather
       * than doubling a generation that already takes a minute.
       */
      providerOptions: { anthropic: { effort: 'low' } },
      maxOutputTokens: 1500,
      tools: { web_search: webSearch },
      abortSignal: control.signal,
      messages: [{ role: 'user', content: asked }]
    })
    return cleanRig(res?.text)
  } catch {
    // Offline, no credit, a search that would not answer, or simply slow. The
    // design goes ahead without it, which is what it did before this existed.
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', stop)
  }
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

Match it against the roster through "basedOn": the amp named here is the amp
whose model you pick, and the pedal named here is the drive you place. Where
this unit has no counterpart for something named, pick the nearest and say in
the summary what it is not. Where this says a named song is voiced differently,
that is what its scene should sound like.`
}
