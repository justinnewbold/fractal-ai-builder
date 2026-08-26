/**
 * POST /api/generate
 *
 * Turns a plain-language tone description into a concrete preset spec.
 *
 * The key never reaches the browser — that's the whole reason this runs
 * server-side. The model is given the *live* catalog and parameter schema read
 * off the player's own unit, so it can only choose models that exist on that
 * hardware and only set parameters that block actually has.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = process.env.GENERATOR_MODEL || 'claude-sonnet-5'

const SYSTEM = `You are a Fractal Audio preset designer. You translate a guitarist's
description of a tone into concrete settings for the blocks that exist in their
currently loaded preset.

HARD RULES

1. Only use block effect ids that appear in the supplied block list. Never invent one.
2. When choosing a model for a block, use only the numeric "value" of an entry in
   that block's supplied model list. Never invent a model or guess a number.
3. Only set parameter ids that appear in that block's supplied parameter list.
4. Every parameter value must fall inside that parameter's own min and max, and be
   expressed in that parameter's own units. A gain that runs 0-10 takes 7.5, not 0.75.
5. Bypass blocks that don't belong in the described tone rather than leaving them
   engaged and neutral.
6. Do not attempt to move blocks, add blocks, or change routing. Work only with the
   blocks already placed.

TONE JUDGEMENT

Set the amp's gain, EQ, presence and master to values a working engineer would
actually dial for the description — not defaults, and not everything at noon.
Consider the whole chain: a drive block in front changes how much amp gain the
tone needs. If the player names a band, era, or record, pick the amp model whose
real-world counterpart made that sound.

OUTPUT

Reply with JSON only. No prose, no markdown fences.

{
  "presetName": "short name, 12 chars or fewer, uppercase",
  "summary": "one sentence on the approach taken",
  "blocks": [
    {
      "eid": 58,
      "bypassed": false,
      "type": 82,
      "typeName": "5153 100W Blue",
      "params": [{ "id": 7, "name": "Gain 1", "value": 7.5 }]
    }
  ],
  "notes": "anything the player should know, or empty string"
}

Omit "type" for blocks whose model you are not changing. Omit blocks you are not
touching at all.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({
      error: 'No API key configured. Set ANTHROPIC_API_KEY in the Vercel project settings.'
    })
    return
  }

  const { description, device, blocks } = req.body || {}

  if (!description || typeof description !== 'string') {
    res.status(400).json({ error: 'Describe the tone you want.' })
    return
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    res.status(400).json({ error: 'No blocks were read from the device.' })
    return
  }

  const context = {
    device: device?.name || 'FM3',
    grid: device?.capabilities?.grid,
    blocks: blocks.map((b) => ({
      eid: b.eid,
      name: b.name,
      slug: b.slug,
      currentlyBypassed: b.bypassed,
      channel: b.channel,
      models: b.models,
      params: b.params
    }))
  }

  let upstream
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Tone wanted: ${description}\n\nWhat's on the unit right now:\n${JSON.stringify(
              context
            )}`
          }
        ]
      })
    })
  } catch (err) {
    res.status(502).json({ error: `Could not reach the model: ${err.message}` })
    return
  }

  if (!upstream.ok) {
    const detail = await upstream.text()
    res.status(upstream.status).json({ error: `Model request failed: ${detail.slice(0, 400)}` })
    return
  }

  const data = await upstream.json()
  const text = (data.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim()

  let spec
  try {
    spec = JSON.parse(cleaned)
  } catch {
    res.status(502).json({ error: 'The model did not return usable JSON.', raw: text.slice(0, 600) })
    return
  }

  res.status(200).json(spec)
}
