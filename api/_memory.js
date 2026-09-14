/**
 * What the agent knows about the person, put in front of its instructions.
 *
 * Two fields per user, kept by src/lib/memory.js and sent with every request:
 * `profile` (durable facts they stated) and `preferences` (how they want the
 * agent to behave). Both handlers prepend them to their system prompt through
 * withMemory, so the chat and the tone designer know the same person.
 *
 * The rules travel with the fields rather than living in each prompt, because
 * they are the same rules everywhere and the failure they prevent is the same
 * everywhere: an agent that says "based on your profile" is reading from a
 * file out loud, and an agent that brings up something sensitive unasked is
 * worse than one that forgot.
 */

/** How much of either field a request may carry. Client-supplied, so capped. */
export const MEMORY_CAP = 4000

const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, MEMORY_CAP) : '')

/** The two fields as the handlers accept them: strings, trimmed, capped. */
export function memoryFrom(raw) {
  return {
    profile: clean(raw?.profile),
    preferences: clean(raw?.preferences)
  }
}

export const MEMORY_RULES = `How to use what is above:
- Greet the user by name when they say hello. Use only their name in greetings — nothing else from the profile.
- Use a stored fact only when it changes your answer: what you recommend, conclude, or ask. If the reply would be just as good without it, leave it out.
- Never say "based on your profile", "I remember", "according to my notes" or anything like it. Just speak as if you know them.
- Never bring up sensitive or emotional details unless the user raises them first.
- Apply the format, tone and length preferences to every reply, whatever the topic.
- Never apply a stored preference that would mean flattering the user, hiding disagreement, or skipping honest feedback.
- If the user's current message conflicts with a stored preference, the current message wins.`

/**
 * The block that goes first in the system prompt.
 *
 * Always present, even empty: the tags are what the rules refer to, and a
 * prompt that changes shape between users is harder to reason about than one
 * whose block is sometimes blank.
 */
export function memoryBlock(memory) {
  const { profile, preferences } = memoryFrom(memory)
  return `<user_profile>\n${profile}\n</user_profile>\n\n<user_preferences>\n${preferences}\n</user_preferences>\n\n${MEMORY_RULES}`
}

/** A system prompt with the person in front of it. */
export const withMemory = (system, memory) => `${memoryBlock(memory)}\n\n${system}`

/**
 * The instruction the profile is updated with, after a conversation.
 *
 * Word for word what was asked for: durable facts the user stated directly,
 * nothing inferred, nothing sensitive, nothing the agent suggested.
 */
export const UPDATE_PROMPT = `Here is the user's current profile and the conversation that just finished. Add only durable facts the user stated directly: name, role, people in their life, ongoing projects, standing preferences. Skip one-off tasks, your own suggestions, and anything about health, finances, or other sensitive topics. Never record inferences — only what the user actually said. Return the full updated profile as markdown bullet points, each prefixed with [stated].`

/**
 * The transcript as the update call reads it: what the person and the agent
 * said, nothing the app wrote into the conversation for itself, and bounded.
 */
export function transcriptText(turns, { keep = 80, chars = 16000 } = {}) {
  if (!Array.isArray(turns)) return ''
  const said = turns
    .filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string')
    .slice(-keep)
    .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text.trim()}`)
  let out = said.join('\n')
  if (out.length > chars) out = out.slice(out.length - chars)
  return out
}

/**
 * The model's answer, kept to what was asked for.
 *
 * A bullet list where every line is a [stated] fact. Anything else the model
 * wrote around it — a preamble, a closing line — is dropped; if nothing in the
 * answer is a [stated] bullet the old profile stands, because an update that
 * throws the profile away is worse than one that changes nothing.
 */
export function cleanProfile(text, previous = '') {
  if (typeof text !== 'string') return previous
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s*\[stated\]/i.test(l))
    .map((l) => `- ${l.replace(/^[-*•]\s*/, '')}`)
  if (!lines.length) return previous
  return lines.join('\n').slice(0, MEMORY_CAP)
}
