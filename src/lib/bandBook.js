/**
 * A band's finished tone, kept so the next request for them costs nothing.
 *
 * The rig cache (./rigCache.js) keeps what was LOOKED UP about a band — what
 * amps they played — and that spared the second request the search. It still
 * paid for the design: every roster on the unit sent again, the model thinking
 * again, the same eight scenes coming back a second time, and a minute of
 * waiting to get a tone the app had already been handed once.
 *
 * This keeps what was DESIGNED. Once a tone for a band has been built and
 * checked, the whole of it — which model on which block, every value, every
 * scene and which channel it plays — is written down against the band's name.
 * The next time that name is typed, the tone is rebuilt from the note onto
 * whatever preset is loaded, with no model asked anything at all. It is the
 * band book Axiom carries as hand-written code, except that this one writes
 * itself out of designs this app actually produced, and it grows by a band
 * every time somebody asks for one it has not met.
 *
 * ## Written by family, not by id
 *
 * A design names blocks by effect id, and an id belongs to one preset. The
 * amp is 106 here and 58 on the next slot, or on the AM4 in the other room. So
 * the note names each block by its FAMILY and its place among that family —
 * "the first amp", "the second delay" — names its model by the model's own
 * name rather than its number, and names each control by its name. Rebuilding
 * onto a preset is then a matter of finding the first amp, the model called
 * "Recto2 Red Modern" in that amp's own list, and the control called "Input
 * Drive" on it. Anything the loaded preset lacks — no delay placed — is listed
 * in "wanted", which is the same word the designer uses, so the app places
 * the block and asks again exactly as it would after a design.
 *
 * ## When it is used, and when it is not
 *
 * Only a design, never a refine — "warmer" is an adjustment to the tone on
 * screen, and the tone on screen is what it has to be applied to. Only when
 * the band's name is in what was typed, by the same rule the rig cache uses.
 * Only when the note holds at least as many scenes as are being asked for; a
 * four-scene note cannot answer for eight. And never when the words ask for
 * something new — "fresh", "different", "from scratch" — because a player
 * who says that has heard the note already and wants the other take.
 *
 * ## Where it lives
 *
 * This browser and, signed in, the account — the same two places and the
 * same rule as the rig cache, so a band designed on the Mac is known on the
 * phone.
 */
import { supabaseClient } from './remote.js'
import { tidy } from './rigCache.js'

const KEY = 'fab.book.v1'
const TABLE = 'band_book'
/** Bounded: a convenience, not an archive, and localStorage is small. */
const MAX_LOCAL = 40
/** A design is kept for half a year. Gear changes slower than that; taste does not. */
const KEEPS_FOR_MS = 180 * 24 * 60 * 60 * 1000

const same = (a, b) => tidy(a) === tidy(b)

/**
 * Where each block sits among its own family: {slug, nth}.
 *
 * The schema is in the order the unit reports its blocks, which is grid order
 * — so "the first amp" is the same amp on every read of the same preset, and
 * the amp nearest the input on a preset that holds two.
 */
export function slotsOf(schema) {
  const seen = {}
  const slots = new Map()
  for (const block of schema || []) {
    const nth = seen[block.slug] || 0
    seen[block.slug] = nth + 1
    slots.set(block.eid, { slug: block.slug, nth })
  }
  return slots
}

/**
 * A checked design, written down without any of this preset's ids in it.
 *
 * Takes the VALIDATED result rather than the raw spec on purpose: everything
 * in it has already been matched to a real control and a real model, so the
 * note holds names the unit actually uses and values the unit actually
 * accepted. What the validator dropped is not written down, which is right —
 * a change that was wrong here would be wrong next time too.
 */
export function portable(validated, schema) {
  if (!validated || !Array.isArray(schema)) return null
  const slots = slotsOf(schema)
  const blocks = []
  for (const change of validated.changes || []) {
    const slot = slots.get(change.eid)
    if (!slot) continue
    blocks.push({
      ...slot,
      bypassed: typeof change.bypassed === 'boolean' ? change.bypassed : !!change.wasBypassed,
      ...(change.channel ? { channel: change.channel } : {}),
      ...(change.typeName ? { typeName: change.typeName } : {}),
      params: (change.params || [])
        .filter((p) => p && typeof p.name === 'string' && typeof p.to === 'number')
        .map((p) => ({ name: p.name, value: p.to }))
    })
  }
  const scenes = []
  for (const scene of validated.scenes || []) {
    const engaged = []
    const channels = []
    for (const b of scene.blocks || []) {
      const slot = slots.get(b.eid)
      if (!slot) continue
      if (!b.bypassed) engaged.push(slot)
      if (b.channel) channels.push({ ...slot, channel: b.channel })
    }
    scenes.push({
      index: scene.index,
      name: scene.name || '',
      ...(scene.why ? { why: scene.why } : {}),
      engaged,
      channels
    })
  }
  if (!blocks.length && !scenes.length) return null
  return {
    presetName: validated.presetName || '',
    summary: validated.summary || '',
    notes: validated.notes || '',
    blocks,
    scenes
  }
}

/**
 * The note, rebuilt onto the preset that is loaded now, as the spec shape the
 * designer would have returned — so it goes through the validator like any
 * other design and nothing reaches the unit on the strength of a note alone.
 *
 * Null when the preset has none of the blocks the note needs; "wanted" names
 * the families it is missing when it has some.
 */
export function replay(design, schema, { scenes: keep } = {}) {
  if (!design || !Array.isArray(schema) || !schema.length) return null
  const byKey = new Map()
  for (const [eid, slot] of slotsOf(schema)) byKey.set(`${slot.slug}:${slot.nth}`, schema.find((b) => b.eid === eid))
  const find = (slot) => byKey.get(`${slot?.slug}:${slot?.nth ?? 0}`) || null
  const missing = new Set()

  const blocks = []
  for (const b of design.blocks || []) {
    const block = find(b)
    if (!block) {
      missing.add(b.slug)
      continue
    }
    const model = b.typeName ? (block.models || []).find((m) => same(m.name, b.typeName)) : null
    const params = []
    for (const p of b.params || []) {
      const known = (block.params || []).find((k) => same(k.name, p.name))
      if (known && typeof p.value === 'number') params.push({ id: known.id, name: known.name, value: p.value })
    }
    blocks.push({
      eid: block.eid,
      bypassed: !!b.bypassed,
      channel: b.channel || null,
      type: model ? model.value : null,
      typeName: model ? model.name : null,
      params
    })
  }

  const wantedScenes = [...(design.scenes || [])].sort((a, b) => a.index - b.index)
  const kept = Number.isInteger(keep) && keep >= 0 ? wantedScenes.slice(0, keep) : wantedScenes
  const scenes = kept.map((s) => ({
    index: s.index,
    name: s.name || '',
    why: s.why || '',
    engaged: (s.engaged || []).map(find).filter(Boolean).map((b) => b.eid),
    channels: (s.channels || [])
      .map((c) => {
        const block = find(c)
        return block ? { eid: block.eid, channel: c.channel } : null
      })
      .filter(Boolean)
  }))

  // A note none of whose blocks this preset has is nothing to build from —
  // scene names over no settings are not a tone.
  if (!blocks.length) return null
  return {
    presetName: design.presetName || '',
    summary: design.summary || '',
    wanted: [...missing],
    blocks,
    scenes,
    notes: design.notes || ''
  }
}

/**
 * Words that mean "not the one you already have".
 *
 * Whoever says these has heard the note and wants the other take, and a book
 * that hands the same tone back to "something different" is a book that
 * cannot be got past. "Again" is deliberately not here: "do Metallica again"
 * is asking for Metallica, and the note is the best Metallica this app has.
 */
export function wantsFresh(text) {
  return /\b(fresh|from scratch|redo|re-do|start over|different|another (?:take|version|go|try)|new (?:take|version|design|tone)|other songs|mix it up|not the (?:same|last|usual)|skip the book|don'?t use the book|without the book)\b/i.test(
    String(text || '')
  )
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
    // Quota or a disabled store. The design runs again, which is what it did
    // before any of this existed.
  }
}

const usable = (row, now = Date.now()) =>
  !!row?.design && !!row?.artist && now - (Number(row.at) || 0) < KEEPS_FOR_MS

/**
 * The note to build from, or null.
 *
 * Pure, and exported on its own: this is the part that decides whether the
 * app pays for a design, so it is the part worth testing without a network.
 *
 * The band with the longest name wins where two are in the sentence, as with
 * the rig cache. Among notes for one band, the one with the fewest scenes
 * that still covers the ask — a four-scene note answers "four scenes" better
 * than an eight-scene one cut in half — and the newest of those.
 */
export function pickDesign(rows, description, { songs = 0, wantScenes, now = Date.now() } = {}) {
  if (wantScenes === false) return null
  if (wantsFresh(description)) return null
  const said = ` ${tidy(description)} `
  let best = null
  for (const row of rows || []) {
    if (!usable(row, now)) continue
    const name = tidy(row.artist)
    if (!name || !said.includes(` ${name} `)) continue
    const has = Number(row.songs) || 0
    if (has < (Number(songs) || 0)) continue
    if (!best) {
      best = row
      continue
    }
    const bestName = tidy(best.artist)
    if (bestName.length !== name.length) {
      if (name.length > bestName.length) best = row
      continue
    }
    const bestHas = Number(best.songs) || 0
    if (has !== bestHas) {
      if (has < bestHas) best = row
      continue
    }
    if ((row.at || 0) > (best.at || 0)) best = row
  }
  return best || null
}

/** What this browser knows, newest first. */
export const localDesigns = () =>
  readLocal()
    .filter((r) => usable(r))
    .sort((a, b) => (b.at || 0) - (a.at || 0))

const keyOf = (artist, songs) => `${tidy(artist)}:${Number(songs) || 0}`

/** What the account knows as well, merged in. Never throws. */
export async function knownDesigns() {
  const mine = localDesigns()
  const client = supabaseClient()
  if (!client) return mine
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('artist,songs,device,design,updated_at')
      .limit(200)
    if (error || !Array.isArray(data)) return mine
    const seen = new Set(mine.map((r) => keyOf(r.artist, r.songs)))
    for (const row of data) {
      const key = keyOf(row.artist, row.songs)
      if (seen.has(key)) continue
      seen.add(key)
      mine.push({
        artist: row.artist,
        songs: Number(row.songs) || 0,
        device: row.device || null,
        design: row.design,
        at: row.updated_at ? Date.parse(row.updated_at) : 0
      })
    }
    return mine.filter((r) => usable(r))
  } catch {
    return mine
  }
}

/**
 * Write a design down against its band, here and on the account.
 *
 * Silent about failure by design: this runs after a tone has been designed and
 * the person is looking at it, and nothing about their preset depends on the
 * note being filed.
 */
export async function rememberDesign(validated, schema, { artist, device } = {}) {
  const name = typeof artist === 'string' ? artist.trim() : ''
  if (!name || !tidy(name)) return null
  const design = portable(validated, schema)
  if (!design) return null
  const row = {
    artist: name,
    songs: design.scenes.length,
    device: device || null,
    design,
    at: Date.now()
  }
  const key = keyOf(row.artist, row.songs)
  writeLocal([row, ...readLocal().filter((r) => keyOf(r.artist, r.songs) !== key)])

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
        artist: row.artist,
        songs: row.songs,
        device: row.device,
        design,
        updated_at: new Date(row.at).toISOString()
      },
      { onConflict: 'id' }
    )
  } catch {
    // As above. This browser still has it.
  }
  return row
}

/**
 * Throw one band's note away, here and on the account.
 *
 * Keyed the way it was filed — band plus scene count — so forgetting the
 * eight-scene Metallica leaves the four-scene one alone. The next request
 * naming that band is designed fresh, which is the whole point of pressing it.
 */
export async function forgetDesign(artist, songs) {
  const key = keyOf(artist, songs)
  writeLocal(readLocal().filter((r) => keyOf(r.artist, r.songs) !== key))
  const client = supabaseClient()
  if (!client) return
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (userId) await client.from(TABLE).delete().eq('id', `${userId}:${key}`)
  } catch {
    // The browser's copy is gone, which is the half that gets read first.
  }
}

/** Throw the lot away. */
export async function forgetDesigns() {
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
