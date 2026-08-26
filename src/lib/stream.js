/**
 * Consume the NDJSON stream from /api/generate.
 *
 * One JSON object per line: partials as the model builds the spec, then a final
 * done frame carrying the complete object and token usage. Newline-delimited
 * rather than SSE because there's no reconnection or event-type story here —
 * one request, one stream, then it's over.
 */
export async function streamSpec(body, { onPartial } = {}) {
  const res = await fetch('/api/generate?stream=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-stream': '1' },
    body: JSON.stringify(body)
  })

  if (!res.ok || !res.body) {
    // Streaming unavailable — fall back rather than failing the generation.
    const fallback = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const spec = await fallback.json()
    if (!fallback.ok) throw new Error(spec.error || 'Generation failed.')
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
      if (frame.type === 'partial') onPartial?.(frame.object)
      else if (frame.type === 'done') final = frame.object
      else if (frame.type === 'error') failure = frame.error
    }
  }

  if (failure) throw new Error(failure)
  if (!final) throw new Error('The stream ended before the preset was complete.')
  return final
}
