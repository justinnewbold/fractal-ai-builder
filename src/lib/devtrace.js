/**
 * Recording what the AI was given, for working out why a tone missed.
 *
 * "Can you look into how the AI actually is figuring out what tones to
 * generate and what knobs to do, where the source is coming from? A lot of the
 * tones don't really match up very well."
 *
 * Worth stating plainly, because the answer shapes what this can and cannot
 * show. There is no reference material behind a generation. No corpus of real
 * presets, no per-artist data, nothing looked up. What the model gets is:
 *
 *   - the rules in api/generate.js, which say how to behave, not how to sound
 *   - this unit's own model rosters and parameter ranges, read off the device
 *   - what each control does, in the device's own words, where it says
 *   - the tone asked for, in the player's words
 *   - a few lines about what this player has tended to keep (lib/taste.js)
 *
 * Everything else — that a Rectifier is scooped, that a Tube Screamer in front
 * tightens a high-gain amp, what a Papa Roach rhythm tone is — comes from what
 * the model already knows. So when a tone misses, it missed either because the
 * knowledge was wrong, or because one of those five inputs pointed it the
 * wrong way. This makes all five visible so the difference can be told.
 *
 * Off by default: the rosters alone are around 11k tokens, and there is no
 * sense paying to send that back to everyone who will never look at it.
 */
const KEY = 'fab.devtrace.v1'

/** Whether to ask the server for the trace on the next generation. */
export function traceEnabled() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // A browser refusing storage is a browser that does not want this on.
    return false
  }
}

export function setTraceEnabled(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Session-only is fine; the flag is read again on the next generation.
  }
}

/**
 * The trace, as sections a person can read in order.
 *
 * Ordered the way the model receives them rather than by how interesting they
 * are, because the question being answered is "what did it see, and in what
 * order" — a brief that arrives after its background reads differently from
 * one that arrives before.
 */
export function sections(trace) {
  if (!trace) return []
  const out = []
  if (trace.model) out.push({ key: 'model', title: 'Which model answered', body: trace.model })
  if (trace.system)
    out.push({
      key: 'system',
      title: 'The rules it works under',
      body: trace.system,
      note: 'How to behave and what it may not do. Nothing here says how anything should sound.'
    })
  if (trace.rosters && Object.keys(trace.rosters).length)
    out.push({
      key: 'rosters',
      title: 'What it could choose from',
      body: Object.entries(trace.rosters)
        .map(([slug, r]) => `${slug} (${r.count})\n  ${r.names.join(', ')}`)
        .join('\n\n'),
      note: 'Read off your unit. If the amp you wanted is not in this list, it could never have been picked.'
    })
  if (trace.reference && Object.keys(trace.reference).length)
    out.push({
      key: 'reference',
      title: 'What your unit says its controls do',
      body: JSON.stringify(trace.reference, null, 2),
      note: 'The only tone knowledge in the request that did not come from the model itself.'
    })
  if (trace.state)
    out.push({
      key: 'state',
      title: 'What was on the unit at the time',
      body: JSON.stringify(trace.state, null, 2),
      note: 'Blocks, their parameters and ranges, which scene was live.'
    })
  if (trace.task)
    out.push({
      key: 'task',
      title: 'What you asked for',
      body: trace.task,
      note: 'Your words, plus whatever the app added about scenes.'
    })
  if (trace.taste)
    out.push({
      key: 'taste',
      title: 'What it was told about your taste',
      body: trace.taste,
      note: 'Built from presets you kept. It settles what a short request leaves open — which of four fitting amps, what "a lot of gain" means to you.'
    })
  return out
}
