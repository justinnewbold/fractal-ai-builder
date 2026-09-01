/**
 * Presets that follow the account rather than the machine.
 *
 * The reason this exists is a real loss: moving to a new Mac left every
 * generated tone behind, because they lived in `localStorage` under
 * `fab.history.v1` — per browser, per device, and not synced by anything.
 * There was no way back to them except the old machine.
 *
 * Rows are shaped like the local entry in history.js on purpose, so a preset
 * from the cloud and one from browser storage are the same object to
 * everything above this file. Nothing upstream should have to care where a
 * tone came from.
 *
 * Privacy is the database's job, not this file's. RLS is on and every policy
 * is keyed to auth.uid(), so a client that asked for someone else's rows would
 * simply receive none — the filtering here is for the query planner, not for
 * safety.
 */
import { supabaseClient } from './remote.js'

const TABLE = 'presets'

/** Whether saving to an account is possible at all right now. */
export const cloudReady = () => !!supabaseClient()

/** A database row as the rest of the app expects an entry to look. */
export function toEntry(row) {
  return {
    id: row.id,
    at: row.created_at ? Date.parse(row.created_at) : Date.now(),
    name: row.name || 'Untitled',
    description: row.description || '',
    summary: row.summary || '',
    spec: row.spec,
    device: row.device || null,
    blockNames: row.block_names || [],
    /** Which store this came from, so the UI can say so and delete correctly. */
    where: 'cloud'
  }
}

/**
 * This account's presets, newest first.
 *
 * Returns an empty list rather than throwing when signed out — a signed-out
 * browser has no cloud presets, which is an answer, not an error, and every
 * caller would otherwise have to guard.
 */
export async function listCloudPresets() {
  const client = supabaseClient()
  if (!client) return []
  const { data, error } = await client
    .from(TABLE)
    .select('id,name,description,summary,spec,device,block_names,created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(explain(error))
  return (data || []).map(toEntry)
}

/**
 * Keep a preset against the account.
 *
 * `user_id` is left to the column default, which is auth.uid(). Sending it
 * from the client would be a value the client could get wrong, and the policy
 * would then reject the insert for reasons the player cannot act on.
 */
export async function saveCloudPreset(entry) {
  const client = supabaseClient()
  if (!client) throw new Error('Sign in to keep presets with your account.')
  const { data, error } = await client
    .from(TABLE)
    .insert({
      name: (entry.name || 'Untitled').trim().slice(0, 120),
      description: entry.description || '',
      summary: entry.summary || '',
      spec: entry.spec,
      device: entry.device || null,
      block_names: entry.blockNames || []
    })
    .select('id,name,description,summary,spec,device,block_names,created_at')
    .single()
  if (error) throw new Error(explain(error))
  return toEntry(data)
}

export async function deleteCloudPreset(id) {
  const client = supabaseClient()
  if (!client) throw new Error('Sign in first.')
  const { error } = await client.from(TABLE).delete().eq('id', id)
  if (error) throw new Error(explain(error))
}

/**
 * Copy everything in this browser up to the account.
 *
 * The migration path for exactly the loss that prompted this. Local entries
 * are left alone: this is a copy, not a move, because the two stores are not
 * the same thing and a failure part-way through should not have eaten the
 * originals.
 */
export async function pushLocalPresets(entries, onProgress) {
  const done = []
  const failed = []
  for (let i = 0; i < entries.length; i++) {
    onProgress?.(i + 1, entries.length, entries[i]?.name)
    try {
      done.push(await saveCloudPreset(entries[i]))
    } catch (err) {
      failed.push(`${entries[i]?.name || 'Untitled'} — ${err.message}`)
    }
  }
  return { saved: done.length, failed }
}

/**
 * Say what went wrong in terms of the thing the player did.
 *
 * PostgREST reports a policy refusal as a bare code, and "new row violates
 * row-level security policy" is not a sentence anyone can act on. The only way
 * to hit it here is to be signed out or to have a session that expired.
 */
export function explain(error) {
  const message = error?.message || 'The request failed.'
  if (error?.code === '42501' || /row-level security/i.test(message)) {
    return 'Your session has expired. Sign in again and try once more.'
  }
  if (/relation .* does not exist/i.test(message)) {
    return 'This project has no preset storage set up yet.'
  }
  return message
}
