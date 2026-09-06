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
import { signatureOf } from './history.js'

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
 * Copy everything on this device up to the account — each tone once.
 *
 * The migration path for exactly the loss that prompted this. Local entries
 * are left alone: this is a copy, not a move, because the two stores are not
 * the same thing and a failure part-way through should not have eaten the
 * originals.
 *
 * Two things it now gets right, both of which made it useless in the one place
 * it mattered most:
 *
 * A tone already on the account is skipped. Every insert was unconditional, so
 * the button was safe to press exactly once and doubled the account every time
 * after — and nothing about a button reading "copy your presets up" says it may
 * only ever be pressed once. Skipping by the same signature the library
 * deduplicates by means pressing it again is simply a no-op.
 *
 * And an item may be a tone or a way to fetch one. On a Mac with a folder
 * chosen, a design is written to disk INSTEAD of browser storage, and the
 * listing that surface holds is a name and a time, not the tone. Reading only
 * browser storage meant the machine that keeps its designs as files — the one
 * whose whole library is stranded on it — had nothing to copy up.
 *
 * Both sides of the network are injected, the way everything in host.mjs is,
 * so the rule about what gets skipped can be tested without an account.
 */
export async function pushLocalPresets(
  items,
  onProgress,
  { existing = listCloudPresets, save = saveCloudPreset } = {}
) {
  // Asked once, up front. Asking per item would be a round trip each, and the
  // answer cannot change under us: this is the only thing writing.
  const already = new Set((await existing()).map(signatureOf))
  const failed = []
  let saved = 0
  let skipped = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    onProgress?.(i + 1, items.length, item?.name)
    try {
      /*
       * Resolved before the check, never after: a folder listing has no
       * description, so its signature before loading is not the signature it
       * will have, and matching on that would skip the wrong things.
       */
      const entry = item?.spec ? item : await item?.load?.()
      if (!entry?.spec) {
        skipped++
        continue
      }
      const signature = signatureOf(entry)
      // The set grows as we go, so two copies of one tone inside this batch —
      // the browser's and the folder's — also count as one.
      if (already.has(signature)) {
        skipped++
        continue
      }
      already.add(signature)
      await save(entry)
      saved++
    } catch (err) {
      failed.push(`${item?.name || 'Untitled'} — ${err.message}`)
    }
  }
  return { saved, skipped, failed }
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
