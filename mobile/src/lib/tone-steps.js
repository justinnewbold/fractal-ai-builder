/* Generated from shared/tone-steps.mjs by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * The order a tone is written to a unit, as data rather than as a loop.
 *
 * Two apps now write tones — the browser through `src/lib/forgefx.js`, and the
 * phone through `mobile/src/lib/tone.js` — and the order is not a detail. Get
 * it wrong and nothing errors: the unit accepts every write and ends up holding
 * a preset nobody asked for, which is the worst shape a bug can take here
 * because the only report is somebody playing it and frowning.
 *
 * Four rules, and each one is a thing that has to be true before the next
 * write means anything:
 *
 *   1. CHANNEL FIRST. A block's parameters belong to the channel it is on. Set
 *      gain on channel A and then move the block to B and you have dialled a
 *      channel nobody is going to hear.
 *
 *   2. THEN THE MODEL. Swapping a model replaces the whole parameter set —
 *      values written before it are values written to a block that no longer
 *      exists in that form.
 *
 *   3. RE-READ IF EITHER MOVED. Ranges belong to the model on the channel. A
 *      Plexi's gain and a Recto's gain are the same word over a different span,
 *      so a value computed against the old range lands somewhere else entirely.
 *
 *   4. PARAMETERS, THEN BYPASS. Bypass last so a block is never briefly
 *      audible holding half its new values — that is a noise through the amp
 *      at exactly the moment somebody is listening to hear whether the tone
 *      worked.
 *
 * And scenes go after all of it, never with it: a scene records WHICH BLOCKS
 * ARE ON, not what they sound like. Write them the other way round and every
 * scene is a pattern over a preset that has not been dialled yet.
 *
 * Pure on purpose. No device calls, no imports, no environment — it turns a
 * validated plan into a list of steps and each app carries them out with its
 * own client. That is what makes the order testable in Node against no
 * hardware, and what stops the two apps drifting apart on the one thing they
 * cannot afford to disagree about.
 */

/**
 * Every write a set of changes implies, in the order they must happen.
 *
 * Each step is `{ kind, eid, name, label }` plus what that kind needs. `label`
 * is what a progress line says while it runs — written here so both apps
 * describe the same work in the same words.
 */
export function stepsFor(changes) {
  const steps = []
  if (!Array.isArray(changes)) return steps

  for (const change of changes) {
    if (!change || typeof change.eid !== 'number') continue
    const name = change.name || `Block ${change.eid}`
    const moved = change.channel !== undefined || change.type !== undefined

    if (change.channel !== undefined) {
      steps.push({
        kind: 'channel',
        eid: change.eid,
        name,
        channel: change.channel,
        label: `${name} → channel ${change.channel}`
      })
    }

    if (change.type !== undefined) {
      steps.push({
        kind: 'type',
        eid: change.eid,
        name,
        type: change.type,
        label: `${name} → ${change.typeName || 'a different model'}`
      })
    }

    /*
     * The re-read is a STEP, not something the executor is trusted to
     * remember. It was a conditional inside a loop in one app, which is
     * exactly the kind of thing a second implementation leaves out — and
     * leaving it out is silent: every value still writes, just against the
     * ranges of a model that is no longer there.
     */
    if (moved) {
      steps.push({ kind: 'reread', eid: change.eid, name, label: `Re-reading ${name}` })
    }

    for (const param of change.params || []) {
      steps.push({
        kind: 'param',
        eid: change.eid,
        name,
        param,
        label: `${name} · ${param.name} → ${param.to}${param.unit || ''}`
      })
    }

    if (change.bypassed !== undefined) {
      steps.push({
        kind: 'bypass',
        eid: change.eid,
        name,
        bypassed: change.bypassed,
        label: `${name} ${change.bypassed ? 'bypassed' : 'engaged'}`
      })
    }
  }

  return steps
}

/**
 * How many writes a plan is, for a progress line that does not lie.
 *
 * The re-read counts: it is a round trip to the unit over the same relay as
 * everything else, and a bar that skips it stalls visibly on every block that
 * changed model while claiming nothing is happening.
 */
export const stepCount = (changes) => stepsFor(changes).length

/**
 * Whether the rig has to be written before this plan's scenes.
 *
 * Always, when there is a rig to write. Stated as a function rather than left
 * implicit so the rule has somewhere to be tested.
 */
export const rigBeforeScenes = (changes, scenes) =>
  Boolean(changes?.length) && Boolean(scenes?.length)
