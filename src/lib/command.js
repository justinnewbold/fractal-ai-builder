/**
 * One request to the chat route, held open while the model thinks.
 *
 * /api/command used to be a plain fetch waiting on a plain JSON body, and for a
 * knob tweak that is exactly right. For anything the model has to think about
 * it is not: a request that took two and a half minutes came back to an iPhone
 * as "That didn't work: Load failed", which is Safari hanging up on a
 * connection that had sent nothing since it opened. The model was very likely
 * still working. Nothing said so, because nothing had been sent.
 *
 * So the route streams the same answer as its last frame, with a beat every ten
 * seconds before it, and this reads that. The frames are the ones /api/generate
 * already uses — open, waiting, done, error — so the two timelines read the
 * same way in the log.
 *
 * Three things are true of this route that are not true of the designer, and
 * they set every clock below: it writes nothing to the unit, it is one answer
 * rather than a stream of partials, and a chat turn that has thought for three
 * minutes is not going to produce a better answer in the fourth.
 */
import { aiUrl } from './ai.js'
import { noteAi } from './stream.js'

/** The whole request, kept well inside the route's own 300-second ceiling. */
export const COMMAND_CAP_MS = 180000

/**
 * Silence, with a beat due every ten seconds.
 *
 * Nothing at all for this long is a pipe that died rather than a model that is
 * busy — the server proves it is busy by beating. Generous enough that a phone
 * dipping between wifi and cellular does not count as a death.
 */
export const COMMAND_QUIET_MS = 45000

const NETWORK =
  'The connection to the AI dropped before it answered. Nothing was written to your unit — ask again.'
const TOO_LONG =
  'The AI thought about that for three minutes without answering, so we stopped waiting. ' +
  'Nothing was written to your unit. A whole rig in one go is a big ask — try asking for the ' +
  'chain first, then the scenes.'

function looksLikeNetwork(err) {
  if (err?.name === 'AbortError') return true
  // Safari says "Load failed", Chrome "Failed to fetch", Firefox "NetworkError".
  return /load failed|failed to fetch|networkerror|network error|connection/i.test(
    String(err?.message || '')
  )
}

async function once(body, { host, signal, onEvent } = {}, started = Date.now()) {
  const since = () => Date.now() - started
  const control = new AbortController()
  const onAbort = () => control.abort(signal?.reason ?? new Error('cancelled'))
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  let reason = null
  let lastByteAt = Date.now()
  const quietTimer = setInterval(() => {
    if (Date.now() - lastByteAt > COMMAND_QUIET_MS) {
      reason = 'quiet'
      control.abort()
    }
  }, 2000)
  /*
   * What is left of the budget, not a fresh one.
   *
   * The cap is on the ask, not on each try of it — a retry that starts its own
   * three minutes turns one long wait into two, which is the exact shape of
   * "said working on tone for over 3 minutes then just disappeared" that the
   * designer had to be fixed for.
   */
  const capTimer = setTimeout(() => {
    reason = 'capped'
    control.abort()
  }, Math.max(1000, COMMAND_CAP_MS - (Date.now() - started)))
  const finish = () => {
    clearInterval(quietTimer)
    clearTimeout(capTimer)
    signal?.removeEventListener?.('abort', onAbort)
  }

  noteAi('chat-request', {})
  onEvent?.({ kind: 'request', ms: 0 })

  try {
    const res = await fetch(aiUrl('/api/command?stream=1', host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-stream': '1' },
      body: JSON.stringify(body),
      signal: control.signal
    })

    /*
     * A body that is not ndjson is the old shape, and still an answer.
     *
     * The route's own refusals — nothing to act on, no key, no blocks — are
     * written before it decides to stream, and a deployment that predates the
     * streaming half never streams at all. Both are read here rather than
     * treated as a failure.
     */
    const kind = res.headers.get('content-type') || ''
    if (!res.body || !kind.includes('ndjson')) {
      const plain = await res.json()
      if (!res.ok) throw failure(plain.error || 'That request failed.', 'server', since())
      noteAi('chat-done', { ms: since(), via: 'plain' })
      onEvent?.({ kind: 'done', ms: since() })
      return plain
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let final = null
    let error = null

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      lastByteAt = Date.now()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let frame
        try {
          frame = JSON.parse(line)
        } catch {
          continue
        }
        if (frame.type === 'open') {
          onEvent?.({ kind: 'open', ms: since() })
        } else if (frame.type === 'waiting') {
          onEvent?.({ kind: 'waiting', ms: since(), thinkingMs: frame.ms })
        } else if (frame.type === 'done') final = frame.object
        else if (frame.type === 'error') error = frame.error
      }
    }

    if (error) throw failure(error, 'server', since())
    if (!final) throw failure(NETWORK, 'truncated', since())
    noteAi('chat-done', { ms: since() })
    onEvent?.({ kind: 'done', ms: since() })
    return final
  } catch (err) {
    if (err?.chatFailure) throw err
    if (control.signal.aborted) {
      if (reason === 'capped') throw failure(TOO_LONG, 'capped', since())
      if (reason === 'quiet') throw failure(NETWORK, 'quiet', since())
      throw err
    }
    if (looksLikeNetwork(err)) throw failure(NETWORK, 'network', since())
    throw err
  } finally {
    finish()
  }
}

function failure(message, kind, ms) {
  noteAi('chat-failed', { kind, ms, message })
  const err = new Error(message)
  err.chatFailure = kind
  return err
}

/**
 * Ask, and ask once more if the line went dead.
 *
 * Safe to repeat, and that is not a guess about this route — it reads the
 * preset, asks the model, and hands back a plan. Every write happens later,
 * after the plan has been checked and, where it matters, shown. So a dropped
 * connection costs a second ask and nothing else, where today it costs the
 * whole turn and shows the browser's own words for it.
 *
 * A model that thought for its whole budget is not asked again: it will think
 * just as long the second time, and a six-minute silence is worse than an
 * answer that says what happened.
 */
export async function askPlan(body, opts = {}) {
  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(body, opts, started)
    } catch (err) {
      const canRetry =
        (err?.chatFailure === 'network' ||
          err?.chatFailure === 'quiet' ||
          err?.chatFailure === 'truncated') &&
        attempt === 0 &&
        !opts.signal?.aborted &&
        /* And only while there is enough budget left for the second ask to be
           worth making. */
        Date.now() - started < COMMAND_CAP_MS / 2
      if (!canRetry) throw err
      noteAi('chat-retrying', { ms: Date.now() - started })
      opts.onEvent?.({ kind: 'retrying', ms: Date.now() - started })
    }
  }
}
