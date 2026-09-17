/**
 * The demo, answered at the same door every real request goes through.
 *
 * ONE PLACE, NOT TWENTY-EIGHT. `device.js` has twenty-eight functions and every
 * one of them ends at `remoteRequest`, `post` or `put` — so this is the only
 * seam where the simulated unit can stand in without every call site learning
 * about it. Put the check in each function instead and the demo becomes a
 * second implementation of the app, which is how a demo starts telling you
 * things that are not true about the real thing.
 *
 * WHAT IT IS: the path-to-method mapping the host does on a real computer,
 * done here against `mockDevice`. The routes are the host's own, so if this and
 * ForgeFX ever disagree about what `/preset/blocks` means, the demo is the one
 * that is wrong and it shows up as a screen that works on a rig and not here.
 *
 * NO ARTIFICIAL DELAY, deliberately, and it is the whole point of the thing:
 *
 *   "It helps me make sure the lag isn't just the app, also."
 *
 * A demo that pretended to be as slow as a serial port would be prettier and
 * would answer nothing. This answers instantly, so a screen that is STILL slow
 * in the demo is slow because of this app — and one that is quick here and slow
 * on a rig is waiting on the wire. Nothing else in this project can tell those
 * two apart.
 */

/*
 * HANDED THE UNIT RATHER THAN FETCHING IT, so this file can be run.
 *
 * Reaching for the demo switch here would drag React and the phone's storage
 * in with it, and neither of those exists in the test runner — which would
 * leave the one piece of this worth exercising as the one piece nobody could.
 * The mapping is the whole risk: miss a route and the failure is not an error,
 * it is an empty screen in a mode built for looking around.
 */

/** A path with its numbers pulled out: '/presets/12/summary' → parts. */
const bits = (path) => String(path || '').split('?')[0].split('/').filter(Boolean)

/**
 * Answer one request from the simulated unit, or throw the way the unit would.
 *
 * Throwing on an unknown route rather than answering null is the honest choice:
 * a demo that quietly returns nothing for a route it has not implemented shows
 * an empty screen that looks like a bug in the screen.
 */
export async function demoRequest(mock, path, options = {}) {
  if (!mock) throw new Error('The demo is not running.')

  const method = String(options.method || 'GET').toUpperCase()
  const part = bits(path)
  const body = options.body ? JSON.parse(options.body) : null
  const num = (i) => Number(part[i])

  if (method === 'GET') {
    if (path === '/healthz') return mock.healthz()
    if (path === '/device/detect') return mock.detect()
    if (path === '/preset') return mock.preset()
    if (path === '/preset/blocks') return mock.presetBlocks()
    if (path === '/preset/grid') return mock.grid()
    if (path === '/scene') return mock.getScene()
    if (path === '/tempo') return mock.tempo()
    if (path === '/mod/model') return mock.modModel()
    if (path === '/blocks/catalog') return mock.blockCatalog()
    /* /presets/{n}/summary and /presets/{n} */
    if (part[0] === 'presets' && part.length === 3 && part[2] === 'summary') {
      return mock.presetSummary(num(1))
    }
    if (part[0] === 'presets' && part.length === 2) return mock.presetName(num(1))
    /* /preset/blocks/{eid}/params */
    if (part[0] === 'preset' && part[1] === 'blocks' && part[3] === 'params') {
      return mock.blockParams(num(2))
    }
    /* /blocks/{slug}/types */
    if (part[0] === 'blocks' && part[2] === 'types') return mock.blockTypes(part[1])
  }

  if (method === 'POST') {
    if (path === '/preset/select') return mock.selectPreset(body?.number)
    if (path === '/scene') return mock.setScene(body?.index)
    if (path === '/scene/name') return mock.setSceneName(body?.index, body?.name)
    if (path === '/preset/name') return mock.setPresetName(body?.name)
    if (path === '/tempo') return mock.setTempo(body?.bpm)
    if (path === '/tempo/tap') return mock.tapTempo()
    /* The tuner is a stream on a real unit and the demo has one, but nothing on
       the phone subscribes to it — the readings arrive as relay events, and the
       demo has no relay. Switching it on succeeds and no needle moves, which is
       honest: see the note the tuner shows in the demo. */
    if (path === '/tuner') return { ok: true }
    if (path === '/mod/bind') {
      return mock.bindModifier(body?.slot, body?.targetEffectId, body?.targetParam, body?.source)
    }
    if (part[0] === 'preset' && part[1] === 'blocks' && part[3] === 'bypass') {
      return mock.setBypass(num(2), body?.bypassed)
    }
    if (part[0] === 'preset' && part[1] === 'blocks' && part[3] === 'channel') {
      return mock.setChannel(num(2), body?.channel)
    }
    if (part[0] === 'preset' && part[1] === 'blocks' && part[3] === 'type') {
      return mock.setType(num(2), body?.value)
    }
    if (path === '/preset/grid/block') return mock.placeBlock(body?.row, body?.col, body?.blockId)
    if (path === '/preset/grid/cable') return { ok: true }
  }

  if (method === 'PUT') {
    /* /preset/blocks/{eid}/params/{id} — normalised in, exactly as the unit. */
    if (part[0] === 'preset' && part[1] === 'blocks' && part[3] === 'params') {
      const eid = num(2)
      const id = num(4)
      if (typeof body?.ordinal === 'number') return mock.setEnum(eid, id, body.ordinal)
      return mock.setParam(eid, id, body?.value)
    }
  }

  /* The demo holds no read cache; dropping it is a yes. */
  if (method === 'DELETE' && path === '/device/cache') return { ok: true }

  const err = new Error(`The demo has no answer for ${method} ${path}.`)
  err.status = 404
  throw err
}
