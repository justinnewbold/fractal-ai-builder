/**
 * What a band plays, kept once it has been found out.
 *
 * "Isn't there a band database we can download and have in the app to look up
 * most of the info and save some tokens?"
 *
 * There isn't one, and that is worth writing down because it is the kind of
 * thing that sounds like it must exist. MusicBrainz, Discogs and Wikidata are
 * enormous and carry releases, credits and personnel — none of them carry what
 * amp anybody played. Equipboard is the one place that really is that database,
 * and it publishes no API and no export. So the fact has to be found out each
 * time, and the only thing the app can do about it is find it out ONCE.
 *
 * Which turns out to be most of what a download would have bought. A band's
 * rig does not change between Tuesday and Wednesday, and neither does what
 * "Chalk Outline" sounds like. The second Three Days Grace request should cost
 * no tokens, no searching and no waiting at all — and by the tenth band this is
 * the downloadable database, built out of answers this app actually used.
 *
 * ## Keyed on the band, not on the sentence
 *
 * "Make me a Three Days Grace preset with 8 scenes" and "three days grace, all
 * eight scenes" are the same lookup, and keying on the typed words would miss
 * that every time. The briefing names the artist on its first line for exactly
 * this reason, so what is stored is keyed on the BAND — and a later request
 * finds it by that name appearing anywhere in what was typed.
 *
 * ## Songs are the other half of the key
 *
 * A briefing researched for four songs cannot answer a request for eight; the
 * other four were never looked up. It can answer a request for three, because
 * four songs contains three. So a hit needs at least as many songs as are
 * being asked for.
 *
 * ## Where it lives
 *
 * This browser, and the account when there is one — the same two places and the
 * same rule as everything else here. Signed in, it follows you to the Mac; the
 * band you looked up on the phone at the bench is already known when you sit
 * down.
 */
import { supabaseClient } from './remote.js'

const KEY = 'fab.rigs.v1'
const TABLE = 'rig_lookups'
/** Bounded: this is a convenience, not an archive, and localStorage is small. */
const MAX_LOCAL = 60
/**
 * How long a rig is taken on trust.
 *
 * Gear does change — a band tours with something new, a record is made on
 * something else — so this is not forever. Ninety days is far longer than any
 * run of requests about one band and far shorter than a career.
 */
const KEEPS_FOR_MS = 90 * 24 * 60 * 60 * 1000

/** Matching is on words, so the punctuation and the case have to go first. */
export const tidy = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * The band this briefing is about, from its own first line.
 *
 * The lookup is asked to open with `ARTIST: <name>` precisely so this does not
 * have to guess. No line, no key — an un-keyed briefing is still used for the
 * tone it was fetched for, it just cannot be found again, which is a smaller
 * loss than filing it under the wrong band.
 */
export function artistOf(rig) {
  const line = String(rig || '')
    .split('\n')
    .find((l) => /^\s*ARTIST\s*:/i.test(l))
  if (!line) return null
  const name = line.replace(/^\s*ARTIST\s*:/i, '').trim()
  return name && tidy(name) ? name : null
}

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX_LOCAL)))
  } catch {
    // Quota or a disabled store. The lookup runs again, which is what it did
    // before any of this existed.
  }
}

/** Still worth trusting, and still about a band we can recognise. */
const usable = (row, now = Date.now()) =>
  !!row?.rig && !!row?.artist && now - (Number(row.at) || 0) < KEEPS_FOR_MS

/**
 * The briefing to use for this request, or null.
 *
 * Pure, and exported on its own: this is the part that decides whether the app
 * pays for a lookup, so it is the part worth testing without a network.
 *
 * The longest artist name wins where two match. "Grace" and "Three Days Grace"
 * would both be found in the same sentence, and the specific one is the one
 * somebody meant.
 */
export function pickRig(rows, description, songs = 0, now = Date.now()) {
  const said = ` ${tidy(description)} `
  let best = null
  for (const row of rows || []) {
    if (!usable(row, now)) continue
    const name = tidy(row.artist)
    if (!name || !said.includes(` ${name} `)) continue
    // Four songs researched cannot answer a request for eight; the other four
    // were never looked up.
    if ((Number(row.songs) || 0) < (Number(songs) || 0)) continue
    if (!best || tidy(best.artist).length < name.length) best = row
  }
  return best || null
}

/** What this browser knows, newest first. */
export const localRigs = () =>
  readLocal()
    .filter((r) => usable(r))
    .sort((a, b) => (b.at || 0) - (a.at || 0))

/**
 * What the account knows as well, merged in.
 *
 * Never throws: a rig lookup that cannot reach the account is a rig lookup
 * that runs, which is exactly what happened before this file existed.
 */
export async function knownRigs() {
  const mine = localRigs()
  const client = supabaseClient()
  if (!client) return mine
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('artist,songs,rig,updated_at')
      .limit(200)
    if (error || !Array.isArray(data)) return mine
    const seen = new Set(mine.map((r) => `${tidy(r.artist)}:${r.songs}`))
    for (const row of data) {
      const key = `${tidy(row.artist)}:${row.songs}`
      if (seen.has(key)) continue
      seen.add(key)
      mine.push({
        artist: row.artist,
        songs: Number(row.songs) || 0,
        rig: row.rig,
        at: row.updated_at ? Date.parse(row.updated_at) : 0
      })
    }
    return mine.filter((r) => usable(r))
  } catch {
    return mine
  }
}

/**
 * Write one down, here and on the account.
 *
 * Silent about failure by design. This runs after a tone has been designed and
 * the person is looking at it; nothing about their preset depends on the note
 * being filed, and interrupting them to say a cache write failed would be
 * noise about a thing that costs one lookup next time.
 */
export async function rememberRig(rig, songs = 0) {
  const artist = artistOf(rig)
  if (!artist) return null
  const row = { artist, songs: Number(songs) || 0, rig, at: Date.now() }
  const key = `${tidy(artist)}:${row.songs}`
  writeLocal([row, ...readLocal().filter((r) => `${tidy(r.artist)}:${r.songs}` !== key)])

  const client = supabaseClient()
  if (!client) return row
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (!userId) return row
    await client.from(TABLE).upsert(
      {
        id: `${userId}:${key}`,
        user_id: userId,
        artist,
        songs: row.songs,
        rig,
        updated_at: new Date(row.at).toISOString()
      },
      { onConflict: 'id' }
    )
  } catch {
    // As above. This browser still has it.
  }
  return row
}

/** Throw the lot away, for when a band has plainly changed rig. */
export async function forgetRigs() {
  writeLocal([])
  const client = supabaseClient()
  if (!client) return
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (userId) await client.from(TABLE).delete().eq('user_id', userId)
  } catch {
    // The browser's copy is gone, which is the half that gets read first.
  }
}
