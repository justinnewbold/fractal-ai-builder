/**
 * Asking for a tone, from the phone.
 *
 * The whole run in one place: read what the rig currently is, ask the model for
 * a tone, check what came back against the rules, write it in the order the
 * unit needs, and say what actually landed.
 *
 * WHY THIS IS SAFE HERE, which is the thing worth reading before anything else.
 * A phone cannot save to a slot — the host refuses `POST /preset/store` from a
 * handset — so nothing written here is permanent. It all lands in the edit
 * buffer, and `selectPreset(current)` reloads the saved version over the top.
 * That is what makes a wrong tone an inconvenience rather than a loss, and it
 * is why this exists on a phone at all.
 *
 * WHAT IS SHARED AND WHY. The validator, the guardrails, the value scaling, the
 * write encodings and the write ORDER are all generated from the browser's
 * copies by scripts/sync-relay-rules.mjs. None of that is plumbing: a phone
 * that validated by looser rules would write something the Mac would have
 * refused, and a phone that wrote in a different order would produce a preset
 * nobody asked for without a single error. The test suite fails if any copy
 * drifts.
 *
 * THE UNIT IS HANDED IN rather than imported, the way deviceState's settling
 * policy takes its detect and its wait. Importing `./device` here would drag
 * the relay, and the account client behind it, into anything that wanted to
 * check what this module does — so the whole run would only be testable
 * against a phone, a Mac and a rig. It takes a client instead, and the tests
 * hand it one that never touches a port.
 *
 * NO STREAMING, deliberately. React Native's fetch has no `response.body`, so
 * there is no reader to pull tokens off. The server offers the same generation
 * without `?stream=1`, which is what this asks for — one request, one answer.
 * What is lost is the running commentary while the model thinks; what is kept
 * is every word of the result.
 */
/*
 * Imported with their extensions, unlike the rest of this directory. Metro is
 * happy either way; plain Node is not, and these tests run in Node against a
 * fake unit. An extensionless import here would make the whole run testable
 * only on a phone.
 */
import { validateSpec } from './validate.js'
import { safeParams } from './guardrails.js'
import { disambiguate } from './encoding.js'
import { stepsFor, rigBeforeScenes } from './tone-steps.js'

/**
 * Where the AI lives.
 *
 * Not the Mac. Generation is a route on the website, so the phone reaches it
 * over the internet like any other request — the relay is for the unit, and the
 * unit is not what is being asked.
 */
export const AI_ORIGIN = 'https://fractal.newbold.cloud'

/**
 * What the rig currently is, in the shape the model is asked to work on.
 *
 * One read per block, and each one makes the unit answer off its own hardware,
 * so this is the slow part of a run rather than the thinking. It reports
 * progress per block for that reason — a screen that says nothing for forty
 * seconds is a screen somebody force-quits.
 *
 * A block whose parameters cannot be read is skipped rather than failing the
 * run. A LINK that has gone is different: every block after it reads empty too,
 * and what comes out the far end is a rig with no controls in it that the model
 * then cheerfully designs against. So an empty schema is refused by the caller.
 */
export async function readSchema(unit, onProgress) {
  const blocks = await unit.presetBlocks()
  const schema = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    onProgress?.(i + 1, blocks.length, block.name)

    let params = []
    try {
      const res = await unit.blockParams(block.effectId)
      params = safeParams(disambiguate(res?.named || []))
    } catch {
      // No readable controls is not a failure — it is a block with nothing to
      // dial. It still belongs in the list so the model knows it is there.
    }

    let models = []
    try {
      models = await unit.blockTypes(block.slug)
    } catch {
      // A block family with no roster can still have its knobs moved.
    }

    schema.push({
      eid: block.effectId,
      name: block.name,
      slug: block.slug,
      bypassed: block.bypassed,
      channel: block.channel,
      params,
      models
    })
  }

  return schema
}

/**
 * Ask for a tone.
 *
 * `signal` is honoured so Stop actually stops: without one the only way out of
 * a stuck generation is force-quitting the app, which loses everything said.
 */
export async function requestSpec({ description, device, schema, sceneNames, signal }) {
  const res = await fetch(`${AI_ORIGIN}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description,
      device,
      blocks: schema,
      sceneNames,
      previous: null,
      mode: 'design'
    }),
    signal
  })

  const spec = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(spec?.error || `The tone service answered ${res.status}.`)
  }
  if (!spec || typeof spec !== 'object') {
    throw new Error('The tone service sent something this app could not read.')
  }
  return spec
}

/**
 * Write a validated tone to the unit.
 *
 * The order is not this module's to decide — it comes off tone-steps.mjs, which
 * the browser is held to as well. What is here is carrying the steps out and
 * keeping count of what failed.
 *
 * A failure on one step does not stop the run. Half a tone with a list of what
 * did not land is more use than a run that stopped at step three and left the
 * rig in a state nobody can describe.
 */
export async function applyChanges(unit, changes, onProgress) {
  const steps = stepsFor(changes)
  const failures = []
  /** Ranges re-read after a block moved, keyed by block. */
  const fresh = new Map()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    onProgress?.(i + 1, steps.length, step.label)

    try {
      if (step.kind === 'channel') {
        await unit.setChannel(step.eid, step.channel)
      } else if (step.kind === 'type') {
        await unit.setType(step.eid, step.type)
      } else if (step.kind === 'reread') {
        const res = await unit.blockParams(step.eid)
        fresh.set(
          step.eid,
          new Map((res?.named || []).map((p) => [p.id, { min: p.min, max: p.max, log: !!p.log }]))
        )
      } else if (step.kind === 'param') {
        const range = fresh.get(step.eid)?.get(step.param.id) ?? step.param.range
        const res = await unit.setParamConfirmed(step.eid, step.param.id, step.param.to, {
          ...range,
          name: step.param.name
        })
        if (!res.ok) {
          failures.push(`${step.name} · ${step.param.name} — the unit ignored both write paths`)
        }
      } else if (step.kind === 'bypass') {
        await unit.setBypass(step.eid, step.bypassed)
      }
    } catch (err) {
      if (step.kind === 'reread') {
        // Fall back to the ranges read before the move rather than skipping
        // every value on the block.
        continue
      }
      failures.push(`${step.name} — ${err.message}`)
    }
  }

  return failures
}

/**
 * Write the scenes, after the rig.
 *
 * A scene records which blocks are ON, not what they sound like, so the models
 * and values have to be in place before the states over them mean anything.
 * The rule is stated in tone-steps.mjs and checked here rather than assumed.
 */
export async function applyScenes(unit, scenes, onProgress) {
  const failures = []
  if (!scenes?.length) return failures

  /*
   * Where the player was, so they can be put back. Writing scenes means
   * standing in each one in turn — it is the scene that remembers a bypass and
   * a channel — so a run that does not restore leaves somebody on scene 8 with
   * no idea why.
   *
   * If the read fails the scenes are still worth writing. We just cannot
   * restore, and do not pretend to by guessing zero.
   */
  let cameFrom = null
  try {
    const now = await unit.getScene()
    cameFrom = typeof now?.index === 'number' ? now.index : null
  } catch {
    cameFrom = null
  }

  let step = 0
  const total = scenes.reduce(
    (n, s) => n + 1 + s.blocks.length + s.blocks.filter((b) => b.channel).length,
    0
  )
  const advance = (label) => onProgress?.(++step, total, label)

  for (const scene of scenes) {
    const label = scene.name || `Scene ${scene.index + 1}`
    advance(`Scene ${scene.index + 1} — ${label}`)
    try {
      await unit.setScene(scene.index)
    } catch (err) {
      failures.push(`Scene ${scene.index + 1} — ${err.message}`)
      continue
    }

    if (scene.name) {
      try {
        await unit.setSceneName(scene.index, scene.name)
      } catch (err) {
        /*
         * Said out loud rather than swallowed. Naming was refused outright over
         * a remote session for months and, because nothing said so, it read as
         * the feature simply not working. The scene itself is still written.
         */
        failures.push(`Scene ${scene.index + 1} — kept its old name: ${err.message}`)
      }
    }

    for (const block of scene.blocks) {
      advance(`${label} · ${block.name} ${block.bypassed ? 'off' : 'on'}`)
      try {
        await unit.setBypass(block.eid, block.bypassed)
      } catch (err) {
        failures.push(`${label} · ${block.name} — ${err.message}`)
      }
      // The channel this scene plays, written while standing in the scene for
      // the same reason the bypass is: the scene is what remembers it.
      if (block.channel) {
        advance(`${label} · ${block.name} → channel ${block.channel}`)
        try {
          await unit.setChannel(block.eid, block.channel)
        } catch (err) {
          failures.push(`${label} · ${block.name} channel — ${err.message}`)
        }
      }
    }
  }

  if (cameFrom !== null) {
    try {
      await unit.setScene(cameFrom)
    } catch {
      failures.push(`Wrote the scenes but could not switch back to scene ${cameFrom + 1}.`)
    }
  }

  return failures
}

/**
 * The whole run, start to finish.
 *
 * Returns what happened rather than throwing for anything a person can act on:
 * a screen that says "12 of 14 landed, and here are the two that did not" is
 * more use than a red box.
 */
export async function buildTone({
  unit,
  description,
  device,
  sceneNames,
  presetNumber,
  signal,
  onStage
}) {
  onStage?.({ stage: 'reading', text: 'Reading your rig…' })
  const schema = await readSchema(unit, (done, total, name) =>
    onStage?.({ stage: 'reading', text: `Reading ${name} — ${done} of ${total}` })
  )

  if (!schema.length) {
    throw new Error(
      'Nothing came back from the unit to design against. Check the Mac is still answering, then try again.'
    )
  }

  onStage?.({ stage: 'thinking', text: 'Designing the tone…' })
  const spec = await requestSpec({ description, device, schema, sceneNames, signal })

  /*
   * Checked against the rig it will be written to, not merely parsed. The
   * validator is the browser's, generated across, and it is what stops a value
   * outside a control's range or a change aimed at a block this preset does not
   * have.
   */
  const sceneCount = device?.capabilities?.sceneCount || 8
  const channelNames = device?.capabilities?.channelNames
  const validated = validateSpec(spec, schema, sceneCount, channelNames)

  onStage?.({ stage: 'writing', text: 'Writing it to the unit…' })
  const failures = await applyChanges(unit, validated.changes, (done, total, label) =>
    onStage?.({ stage: 'writing', text: `${done} of ${total} — ${label}` })
  )

  if (rigBeforeScenes(validated.changes, validated.scenes)) {
    const sceneFailures = await applyScenes(unit, validated.scenes, (done, total, label) =>
      onStage?.({ stage: 'writing', text: `Scenes — ${done} of ${total} · ${label}` })
    )
    failures.push(...sceneFailures)
  }

  /*
   * The validator's own words for what it did, not the raw spec's. `problems`
   * are changes it refused; `repairs` are ones it kept after matching the
   * control the model NAMED rather than the id it gave — and those two are
   * deliberately separate, because a correction listed under "rejected" reads
   * as a loss when it is the opposite.
   */
  return {
    name: validated.presetName || null,
    summary: validated.summary || null,
    changes: validated.changes,
    scenes: validated.scenes,
    problems: validated.problems || [],
    repairs: validated.repairs || [],
    failures,
    presetNumber
  }
}

/**
 * Put the saved version back.
 *
 * Not an undo stack — the unit already has one. Re-selecting the slot loads
 * what is stored over whatever is in the edit buffer, and since a phone cannot
 * save, what is stored is always the version from before the tone.
 */
export const revert = (unit, presetNumber) => unit.selectPreset(presetNumber)
