// Client for the ForgeFX device API (https://github.com/sKuhLight/ForgeFX).
//
// ForgeFX runs on the player's own machine and owns the USB serial port to the
// Fractal unit. This app is served from the cloud but every device call goes to
// localhost — the audio hardware is on their desk, not ours.
//
// Verified against FM3 firmware via ForgeFX 0.6.29-beta:
//   - blocks are addressed by effect id (the `page` field), NOT by slug
//   - parameter writes take real units ({"value": 9} for a 0-10 gain), not 0-1
//   - /preset/store commits to a slot even when capabilities report supportsSave:false

const DEFAULT_HOST = 'http://localhost:5056'

export function getHost() {
  return localStorage.getItem('forgefx.host') || DEFAULT_HOST
}

export function setHost(host) {
  localStorage.setItem('forgefx.host', host.replace(/\/+$/, ''))
}

class ForgeError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'ForgeError'
    this.status = status
    this.cause = cause
  }
}

async function request(path, options = {}) {
  const url = `${getHost()}${path}`
  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    })
  } catch (cause) {
    throw new ForgeError(
      'Could not reach ForgeFX. Check that the server is running and the Fractal unit is connected.',
      { cause }
    )
  }

  const body = await res.text()
  let parsed = null
  if (body) {
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = body
    }
  }

  if (!res.ok) {
    const detail = parsed?.message || parsed?.error || res.statusText
    throw new ForgeError(detail, { status: res.status })
  }
  return parsed
}

/** Liveness plus the model ForgeFX thinks is attached. */
export const health = () => request('/healthz')

/** Full capability report: grid size, scene count, preset count, what writes are allowed. */
export const detect = () => request('/device/detect')

/** The preset currently loaded on the unit. */
export const currentPreset = () => request('/preset')

/** Every block placed in the current preset, with grid position, bypass state and channel. */
export const presetBlocks = () => request('/preset/blocks')

/** Named parameters for one placed block. `eid` is the effect id from presetBlocks(). */
export const blockParams = (eid) => request(`/preset/blocks/${eid}/params`)

/** Model roster for a block family, e.g. 'amp' -> 331 amp models. */
export const blockTypes = (slug) => request(`/blocks/${slug}/types`)

/** Set one parameter. `value` is in the parameter's own units (see its min/max). */
export const setParam = (eid, paramId, value) =>
  request(`/preset/blocks/${eid}/params/${paramId}`, {
    method: 'PUT',
    body: JSON.stringify({ value })
  })

/** Engage or bypass a block. */
export const setBypass = (eid, bypassed) =>
  request(`/preset/blocks/${eid}/bypass`, {
    method: 'POST',
    body: JSON.stringify({ bypassed })
  })

/** Swap the model loaded in a block. */
export const setType = (eid, value) =>
  request(`/preset/blocks/${eid}/type`, {
    method: 'POST',
    body: JSON.stringify({ value })
  })

/** Commit the working preset to a numbered slot. Overwrites whatever is there. */
export const storePreset = (number) =>
  request('/preset/store', {
    method: 'POST',
    body: JSON.stringify({ number })
  })

export { ForgeError }

/**
 * Build the generation context: for every placed block, its live parameters and
 * the model roster its family offers.
 *
 * Read from the device rather than from a committed catalog, so it always
 * matches the firmware in front of the player. Sequential on purpose — the
 * transport is a single serial port and parallel reads collide.
 */
export async function readSchema(blocks, onProgress) {
  const editable = blocks.filter((b) => !['input', 'output', 'looper'].includes(b.slug))
  const typeCache = new Map()
  const schema = []

  for (let i = 0; i < editable.length; i++) {
    const block = editable[i]
    onProgress?.(i + 1, editable.length, block.name)

    let params = []
    try {
      const res = await blockParams(block.effectId)
      params = (res?.named || []).map((p) => ({
        id: p.id,
        name: p.name,
        value: p.value,
        min: p.min,
        max: p.max,
        unit: p.unit || ''
      }))
    } catch {
      // A block with no readable parameters is not a failure — skip it.
    }

    let models = []
    if (!typeCache.has(block.slug)) {
      try {
        typeCache.set(block.slug, (await blockTypes(block.slug)) || [])
      } catch {
        typeCache.set(block.slug, [])
      }
    }
    models = typeCache.get(block.slug)

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
 * Apply a validated set of changes, one write at a time.
 *
 * Sequential is a requirement, not a style choice: these all travel down one
 * serial port. Model swaps go first, since changing a model resets that block's
 * parameters and would otherwise undo the values we just wrote.
 */
export async function applyChanges(changes, onProgress) {
  const queue = []

  for (const change of changes) {
    if (change.type !== undefined) {
      queue.push({ label: `${change.name} → ${change.typeName}`, run: () => setType(change.eid, change.type) })
    }
  }
  for (const change of changes) {
    for (const param of change.params) {
      queue.push({
        label: `${change.name} · ${param.name} → ${param.to}${param.unit}`,
        run: () => setParam(change.eid, param.id, param.to)
      })
    }
    if (change.bypassed !== undefined) {
      queue.push({
        label: `${change.name} ${change.bypassed ? 'bypassed' : 'engaged'}`,
        run: () => setBypass(change.eid, change.bypassed)
      })
    }
  }

  const failures = []
  for (let i = 0; i < queue.length; i++) {
    const step = queue[i]
    onProgress?.(i + 1, queue.length, step.label)
    try {
      await step.run()
    } catch (err) {
      failures.push(`${step.label} — ${err.message}`)
    }
  }
  return failures
}
