/**
 * Starting points for a tone description.
 *
 * Written the way a player would actually describe a sound to another player —
 * feel, context, and what it's for — rather than a list of settings. The
 * generator has the whole model roster; what it needs from a prompt is intent.
 *
 * Grouped so a shuffle returns a spread rather than four variations on high
 * gain, which is what a flat random list produces.
 */
const POOL = {
  clean: [
    'Warm blackface clean with a little spring reverb',
    'Glassy Strat clean that stays tight in the low end',
    'Jazz box tone — round, dark, no bite',
    'Chimey clean with just enough breakup when I dig in',
    'Pristine clean for fingerstyle, wide and quiet',
    'Country clean with snap and a fast attack',
    'Clean platform for pedals — flat and uncoloured'
  ],
  crunch: [
    'Cranked plexi crunch, no pedals, just the amp working',
    'AC30 jangle on the edge of breakup',
    'Blues drive that cleans up when I roll the volume back',
    'Tweed grit — loose, woody, a bit unruly',
    'Classic rock rhythm, mid-forward and punchy',
    'Garage rock fuzz, raw and slightly falling apart',
    'Late-70s British crunch with the presence up'
  ],
  highGain: [
    'Tight modern metal rhythm in drop A, scooped but not thin',
    'Thrash rhythm with a razor edge and fast note decay',
    'Djent chug — dry, percussive, no flab under it',
    'Death metal rhythm, dark and thick, tuned low',
    '80s hair metal lead, bright and singing',
    'Doom riff tone — slow, enormous, sagging',
    'Hardcore rhythm with a boosted midrange bark'
  ],
  lead: [
    'Ambient lead with long delay trails and a soft edge',
    'Singing sustain lead, violin-like, no pick attack',
    'Fusion lead — smooth, compressed, a little vocal',
    'Cutting solo tone that sits above a dense mix',
    'Bluesy lead with touch dynamics and a bit of hair',
    'Sparse lead for slow bends, lots of air around it'
  ],
  texture: [
    'Shoegaze wall — drenched, blurred, huge',
    'Post-rock swell with reverse-feeling reverb',
    'Lo-fi bedroom tone, small amp, slightly broken',
    'Surf tone with heavy spring and fast tremolo',
    'Funk rhythm — thin, percussive, quick decay',
    'Dark cinematic pad, almost synth-like',
    'Psychedelic swirl with modulation doing the work'
  ],
  practical: [
    'Something that sits under a vocal without fighting it',
    'A tone I can practise on quietly at 11pm',
    'Rhythm tone that stays clear with lots of low tuning',
    'One preset that covers a whole set — clean to lead',
    'Something forgiving for sloppy playing',
    'Direct-to-desk tone for recording without a mic'
  ]
}

const GROUPS = Object.keys(POOL)

/**
 * A spread of suggestions, one per group, cycling so repeated presses keep
 * offering new material rather than reshuffling the same handful.
 */
export function suggest(count = 4, seen = new Set()) {
  const picks = []
  const order = [...GROUPS].sort(() => Math.random() - 0.5)

  for (const group of order) {
    if (picks.length >= count) break
    const fresh = POOL[group].filter((s) => !seen.has(s))
    const source = fresh.length ? fresh : POOL[group]
    picks.push(source[Math.floor(Math.random() * source.length)])
  }

  return picks
}

export const totalSuggestions = GROUPS.reduce((n, g) => n + POOL[g].length, 0)
