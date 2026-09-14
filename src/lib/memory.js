/**
 * What the agent knows about the person: two text fields, kept and sent.
 *
 * `profile` is durable facts they stated — name, role, people, ongoing
 * projects. `preferences` is how they want the agent to behave — tone, length,
 * format. Both go with every chat and tone request and are put in front of
 * the model's instructions (api/_memory.js), which is how the agent greets
 * someone by name and answers in the shape they asked for without either
 * being asked for twice.
 *
 * Kept the way the rest of the account is kept: in browser storage always, so
 * the agent knows you on a device that is signed out, and in Supabase when
 * signed in (`user_memory`, one row per person, created empty the first time
 * they appear) so a phone and a Mac know the same person. Newest write wins.
 *
 * The profile updates itself: when a chat is put down, or every ten messages,
 * the transcript goes to /api/memory and comes back as the profile with
 * anything durable the person said added to it. Preferences are only ever
 * edited by hand, in Setup — the agent must not decide how you want to be
 * spoken to.
 */
import { supabaseClient } from './remote.js'
import { aiUrl } from './ai.js'

const KEY = 'fab.memory.v1'
const TABLE = 'user_memory'

/** How much of either field travels with a request. api/_memory.js caps too. */
export const MEMORY_CAP = 4000

/** How many said things (yours and the agent's) between profile updates. */
export const MEMORY_EVERY = 10

export const EMPTY_MEMORY = Object.freeze({ profile: '', preferences: '', updatedAt: 0 })

const clip = (v) => (typeof v === 'string' ? v.trim().slice(0, MEMORY_CAP) : '')

/** A record with both fields as strings, whatever came in. */
export function normalise(raw) {
  return {
    profile: clip(raw?.profile),
    preferences: clip(raw?.preferences),
    updatedAt: Number(raw?.updatedAt) || 0
  }
}

/** The record on this device, or an empty one. Never throws. */
export function loadMemory(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    const raw = store?.getItem(KEY)
    return raw ? normalise(JSON.parse(raw)) : { ...EMPTY_MEMORY }
  } catch {
    return { ...EMPTY_MEMORY }
  }
}

function keepLocal(record, storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    store?.setItem(KEY, JSON.stringify(record))
  } catch {
    // Private windows throw; the cloud copy, if any, still has it.
  }
}

/** The two fields as a request carries them. */
export const memoryForRequest = (record) => {
  const m = normalise(record)
  return { profile: m.profile, preferences: m.preferences }
}

/**
 * Save both fields — here, and on the account when there is one.
 *
 * Returns the record as saved. A cloud write that fails leaves the local
 * copy whole and is retried by the next sync.
 */
export async function saveMemory(next, storage) {
  const record = { ...normalise(next), updatedAt: Date.now() }
  keepLocal(record, storage)
  const client = supabaseClient()
  if (client) {
    try {
      const { data } = await client.auth.getUser()
      const userId = data?.user?.id
      if (userId) {
        await client.from(TABLE).upsert(
          {
            user_id: userId,
            profile: record.profile,
            preferences: record.preferences,
            updated_at: new Date(record.updatedAt).toISOString()
          },
          { onConflict: 'user_id' }
        )
      }
    } catch {
      // Offline, or signed out between the check and the write.
    }
  }
  return record
}

/**
 * Bring the account's copy and this device's copy together.
 *
 * Signed out, the local copy is all there is. Signed in: the row is read; if
 * there is none, an empty one is created so the person has a record from the
 * moment they first appear; whichever of the two copies was written last
 * wins, and both ends are brought up to it. Returns the record to use.
 */
export async function syncMemory(storage) {
  const local = loadMemory(storage)
  const client = supabaseClient()
  if (!client) return local
  try {
    const { data: who } = await client.auth.getUser()
    const userId = who?.user?.id
    if (!userId) return local
    const { data, error } = await client
      .from(TABLE)
      .select('profile,preferences,updated_at')
      .maybeSingle()
    if (error) return local
    if (!data) {
      // First appearance: a record exists from now on, with whatever this
      // device already knew.
      await client
        .from(TABLE)
        .upsert(
          { user_id: userId, profile: local.profile, preferences: local.preferences },
          { onConflict: 'user_id' }
        )
      return local
    }
    const cloud = normalise({
      profile: data.profile,
      preferences: data.preferences,
      updatedAt: data.updated_at ? Date.parse(data.updated_at) : 0
    })
    if (cloud.updatedAt >= local.updatedAt) {
      keepLocal(cloud, storage)
      return cloud
    }
    // This device is newer: the account catches up.
    await client.from(TABLE).upsert(
      {
        user_id: userId,
        profile: local.profile,
        preferences: local.preferences,
        updated_at: new Date(local.updatedAt).toISOString()
      },
      { onConflict: 'user_id' }
    )
    return local
  } catch {
    return local
  }
}

/** How many things have been said in a conversation, by either side. */
export const saidCount = (turns) =>
  Array.isArray(turns) ? turns.filter((t) => t?.role === 'user' || t?.role === 'assistant').length : 0

/** Whether a conversation of this length is due an update, on the count alone. */
export const dueForUpdate = (count) => count > 0 && count % MEMORY_EVERY === 0

/**
 * Ask the server to fold a conversation into the profile, and keep the answer.
 *
 * Returns the record (updated or not); never throws, because a profile that
 * failed to update is a profile that is a little out of date, not an error
 * worth a red bar in the middle of a conversation.
 */
export async function refreshProfile(record, turns, { host } = {}) {
  const current = normalise(record)
  if (!saidCount(turns)) return current
  try {
    const res = await fetch(aiUrl('/api/memory', host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: current.profile,
        turns: turns
          .filter((t) => t?.role === 'user' || t?.role === 'assistant')
          .map((t) => ({ role: t.role, text: typeof t.text === 'string' ? t.text : '' }))
      })
    })
    if (!res.ok) return current
    const body = await res.json()
    if (typeof body?.profile !== 'string') return current
    if (body.profile === current.profile) return current
    return saveMemory({ ...current, profile: body.profile })
  } catch {
    return current
  }
}
