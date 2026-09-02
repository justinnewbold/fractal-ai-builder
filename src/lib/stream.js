/**
 * Consume the NDJSON stream from /api/generate.
 *
 * One JSON object per line: partials as the model builds the spec, then a final
 * done frame carrying the complete object and token usage. Newline-delimited
 * rather than SSE because there's no reconnection or event-type story here —
 * one request, one stream, then it's over.
 *
 * Bounded, because an unbounded wait is indistinguishable from a hang. Nothing
 * here used to give up: if the model, the gateway or the network went quiet the
 * fetch simply never settled, and the app sat on a scripted "nearly there…"
 * forever. Two clocks now run — one on silence, one on the whole request — and
 * both say plainly what happened.
 */

/*
 * Both clocks are set by the server's ceiling, not by taste.
 *
 * The API function is capped at 60 seconds in vercel.json, and the platform
 * kills it there without letting it write anything — no `done`, no `error`,
 * just a severed stream. So the browser has to give up FIRST, or the only
 * thing it can report is that the response stopped for reasons it can't see.
 * That is exactly what happened while these sat at 75s and 240s: a generation
 * cut off at 60s was reported as the model giving up.
 *
 * Keep both under the maxDuration in vercel.json. test/limits.mjs holds the
 * two files to that, since nothing else connects them.
 */

import { aiUrl } from './ai.js'

/** No bytes at all for this long means something upstream stopped talking.
 *  Generous, because the first token legitimately takes ~25s on a big preset. */
const STALL_MS = 45000
/** Just inside the function's own 60s ceiling, so this fires before the axe. */
const HARD_CAP_MS = 55000

/**
 * What happened, in order, on the last few generations.
 *
 * The device side has had a wire log for a long time; the model side had
 * nothing, so "what was it doing for four minutes" had no answer that didn't
 * involve the browser's devtools. Kept in memory, capped, and shown in
 * Technical details.
 */
const genLog = []
const MAX_LOG = 60

function note(event, detail = {}) {
  genLog.push({ at: Date.now(), event, ...detail })
  if (genLog.length > MAX_LOG) genLog.splice(0, genLog.length - MAX_LOG)
}

export const getGenerationLog = () => genLog.slice()
export const clearGenerationLog = () => genLog.splice(0, genLog.length)

/**
 * One request to the model, streamed.
 *
 * Two clocks, and which one owns the first byte is the whole point. The
 * stall clock used to start at the request, so its 45 seconds were spent on
 * time-to-first-byte — which the note above admits is ~25 s cold, and which a
 * big preset on a cold function pushes past 45 routinely. The result was an
 * intermittent "nothing came back for 45 seconds" that blamed the model
 * service for a request the model had not started answering. Now the stall
 * clock starts at the first byte; the hard cap owns the wait before it, with
 * its own words.
 *
 * And one retry, only when nothing worth keeping had arrived: a stall before
 * the first partial is idempotent to retry, since nothing was written anywhere.
 */
export async function streamSpec(body, opts = {}) {
  const started = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(body, opts, started)
    } catch (err) {
      const canRetry = err?.generationFailure === 'stalled' && !err.partials && attempt === 0 && !opts.signal?.aborted
      if (!canRetry) throw err
      note('retrying', { ms: Date.now() - started })
      opts.onEvent?.({ kind: 'retrying', ms: Date.now() - started })
    }
  }
}

async function attemptOnce(body, { onPartial, onEvent, signal, host, timing } = {}, started = Date.now()) {
  const stallMs = timing?.stallMs ?? STALL_MS
  const capMs = timing?.capMs ?? HARD_CAP_MS
  const since = () => Date.now() - started
  const control = new AbortController()
  // The caller's Stop button and our own clocks both land on one signal.
  const onAbort = () => control.abort(signal?.reason ?? new Error('cancelled'))
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  let reason = null
  // Null until the first byte: the stall clock measures silence in a stream,
  // not the wait for one to start. That wait belongs to the cap below.
  let lastByteAt = null
  let partials = 0
  let firstByte = false
  const stallTimer = setInterval(() => {
    if (lastByteAt !== null && Date.now() - lastByteAt > stallMs) {
      reason = 'stalled'
      control.abort()
    }
  }, Math.min(2000, Math.max(5, Math.floor(stallMs / 4))))
  const capTimer = setTimeout(() => {
    reason = 'capped'
    control.abort()
  }, capMs)

  const finish = () => {
    clearInterval(stallTimer)
    clearTimeout(capTimer)
    signal?.removeEventListener?.('abort', onAbort)
  }

  const fail = (message, kind) => {
    note('failed', { kind, ms: since(), message, partials })
    onEvent?.({ kind: 'failed', ms: since(), message })
    const err = new Error(message)
    err.generationFailure = kind
    err.partials = partials
    return err
  }

  note('request', { model: body?.mode || 'design' })
  onEvent?.({ kind: 'request', ms: 0 })

  try {
    const res = await fetch(aiUrl('/api/generate?stream=1', host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-stream': '1' },
      body: JSON.stringify(body),
      signal: control.signal
    })

    if (!res.ok || !res.body) {
      // Streaming unavailable — fall back rather than failing the generation.
      note('fallback', { status: res.status, ms: since() })
      onEvent?.({ kind: 'fallback', ms: since() })
      const fallback = await fetch(aiUrl('/api/generate', host), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: control.signal
      })
      const spec = await fallback.json()
      if (!fallback.ok) throw fail(spec.error || 'Generation failed.', 'server')
      note('done', { ms: since(), via: 'fallback' })
      onEvent?.({ kind: 'done', ms: since() })
      return spec
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let final = null
    let failure = null

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      lastByteAt = Date.now()
      if (!firstByte) {
        firstByte = true
        note('first-output', { ms: since() })
        onEvent?.({ kind: 'first-output', ms: since() })
      }
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      // The last element is whatever arrived mid-line; keep it for the next chunk.
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let frame
        try {
          frame = JSON.parse(line)
        } catch {
          continue
        }
        if (frame.type === 'partial') {
          partials += 1
          onPartial?.(frame.object)
          onEvent?.({
            kind: 'partial',
            ms: since(),
            blocks: frame.object?.blocks?.length ?? 0,
            partials
          })
        } else if (frame.type === 'done') final = frame.object
        else if (frame.type === 'error') failure = frame.error
      }
    }

    if (failure) throw fail(failure, 'server')
    if (!final) {
      /*
       * Say what actually happened, which is not what this used to say.
       *
       * The server writes an `error` frame for anything it catches, so no
       * `done` AND no `error` means the response was cut off from outside —
       * the function hit its own time limit, or the connection dropped. The
       * model did not stop; something killed the pipe it was writing to. The
       * old wording sent a real debugging session off looking at the model
       * while the cause was a 60-second serverless ceiling the client was
       * happily waiting four minutes behind.
       */
      throw fail(
        partials
          ? 'The preset was still being written when the connection closed — the server hit its time limit, or the link dropped. Nothing was written to your unit. Ask again; a shorter, more specific request finishes sooner.'
          : 'The connection closed before the model sent anything. Nothing was written — ask again.',
        'truncated'
      )
    }
    note('done', { ms: since(), partials })
    onEvent?.({ kind: 'done', ms: since(), partials })
    return final
  } catch (err) {
    if (err?.generationFailure) throw err
    if (control.signal.aborted) {
      if (reason === 'stalled') {
        throw fail(
          `The model went quiet for ${Math.round(stallMs / 1000)} seconds mid-answer, so the request was dropped. Nothing was written to your unit. Ask again — if it keeps happening, the model service is the place to look.`,
          'stalled'
        )
      }
      if (reason === 'capped' && !firstByte) {
        throw fail(
          `The model hasn't started answering after ${Math.round(capMs / 1000)} seconds, so the request was dropped. Nothing was written to your unit. Try again.`,
          'capped'
        )
      }
      if (reason === 'capped') {
        throw fail(
          `The generation ran past ${Math.round(capMs / 1000)} seconds and was dropped — that is the server's own limit, so it would have been cut off a moment later anyway. Nothing was written to your unit. Ask again with a shorter, more specific request.`,
          'capped'
        )
      }
      throw fail('Stopped. Nothing was written to your unit.', 'cancelled')
    }
    throw fail(err?.message || 'The generation failed.', 'network')
  } finally {
    finish()
  }
}
