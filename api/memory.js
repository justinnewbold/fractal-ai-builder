/**
 * POST /api/memory — the profile, updated from a conversation that finished.
 *
 * A separate, small model call, made by the app when a chat is put down or
 * every ten messages (src/lib/memory.js). It is handed the current profile
 * and the transcript and returns the profile with anything durable the user
 * stated added to it. The rules are in UPDATE_PROMPT; the answer is filtered
 * to [stated] bullets before it goes back, so a chatty reply cannot become
 * the profile.
 *
 * Same key and model resolution as the chat, because it is the chat's memory.
 */
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { cors } from './_cors.js'
import { UPDATE_PROMPT, transcriptText, cleanProfile, MEMORY_CAP } from './_memory.js'

const MODEL_NAME =
  process.env.MEMORY_MODEL ||
  process.env.CHAT_MODEL ||
  process.env.GENERATOR_MODEL ||
  'claude-sonnet-5'

function resolveModel(name) {
  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    return anthropic(name)
  }
  if (process.env.AI_GATEWAY_API_KEY) {
    return name.includes('/') ? name : `anthropic/${name}`
  }
  return null
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }
  const model = resolveModel(MODEL_NAME)
  if (!model) {
    res.status(500).json({ error: 'No model key configured.' })
    return
  }
  const { profile, turns } = req.body || {}
  const before = typeof profile === 'string' ? profile.trim().slice(0, MEMORY_CAP) : ''
  const transcript = transcriptText(turns)
  // Nothing was said, so there is nothing to learn — and nothing to pay for.
  if (!transcript) {
    res.status(200).json({ profile: before, changed: false })
    return
  }

  try {
    const { text, usage } = await generateText({
      model,
      maxOutputTokens: 2000,
      // Extraction, not reasoning: the cheapest honest setting.
      ...(typeof model === 'string'
        ? {}
        : { providerOptions: { anthropic: { thinking: { type: 'adaptive' }, effort: 'low' } } }),
      system: UPDATE_PROMPT,
      prompt: `CURRENT PROFILE:\n${before || '(empty)'}\n\nCONVERSATION:\n${transcript}`
    })
    const after = cleanProfile(text, before)
    res.status(200).json({
      profile: after,
      changed: after !== before,
      usage: usage ? { input: usage.inputTokens, output: usage.outputTokens } : null
    })
  } catch (err) {
    res.status(502).json({ error: err?.message || 'The profile could not be updated.' })
  }
}
