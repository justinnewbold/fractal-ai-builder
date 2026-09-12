/**
 * Conversations you have finished, so a fresh one does not throw the last away.
 *
 * "The current chat is getting along in the app. Can we create a way to create
 * a fresh chat? ... Also make it so you can see previous chats and that those
 * always get saved to the cloud if signed in."
 *
 * `cloudChat.js` is the LIVE transcript — one per person, the same thing on the
 * phone as on the Mac. This is the shelf behind it. Starting a fresh chat puts
 * the one on screen here first, which is the whole reason a New chat button is
 * safe to press.
 *
 * ## Where it goes, and why there is only one answer
 *
 * Signed in: the account. Signed out: this browser. Not both, and never a
 * choice — "if I'm signed in everything should be saved to the cloud if I'm not
 * signed in everything there should be in the browser". A store that depends on
 * a preference is a store where half your chats are somewhere you did not
 * think to look.
 *
 * Reading is the other way round: both, merged, newest first. A person who has
 * signed in half way through a week still has the first half of it in this
 * browser, and hiding it would be a list that lies about what exists.
 *
 * ## Ids are made here
 *
 * A conversation keeps one identity whether it was first written to browser
 * storage and later to the account, so archiving the same chat twice updates a
 * row rather than laying down a second copy of it. That is what makes "open an
 * old chat, say one more thing, start a new one" leave two chats behind and not
 * four.
 */
import { supabaseClient } from './remote.js'
import { deviceName } from './cloudChat.js'

const KEY = 'fab.chatlog.v1'
const TABLE = 'chat_logs'
/** Enough that nobody loses real work; bounded because localStorage is small. */
const MAX_LOCAL = 40
/** How much of a transcript the list's one line can hold. */
const TITLE_CHARS = 70

/** Whether the account is the store right now. Signed out is not an error. */
export const chatLogCloudReady = () => !!supabaseClient()

function readLocal() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocal(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_LOCAL)))
    return true
  } catch {
    // Quota, private browsing, a disabled store. Losing the shelf is not worth
    // interrupting somebody mid-session over.
    return false
  }
}

/**
 * What the list calls a conversation.
 *
 * The first thing the player actually typed, which is the only line in a
 * transcript that says what it was for. App notes and hand edits are skipped —
 * "Chain in: Amp (3), Cab (4)" is a true sentence about a chat and tells you
 * nothing about which chat it was.
 */
export function titleFor(turns) {
  const said = (Array.isArray(turns) ? turns : []).find(
    (t) => t?.role === 'user' && typeof t.text === 'string' && t.text.trim()
  )
  const text = (said?.text || '').trim().replace(/\s+/g, ' ')
  if (!text) return 'Untitled chat'
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text
}

/** A conversation worth keeping is one somebody said something in. */
export const worthKeeping = (turns) =>
  (Array.isArray(turns) ? turns : []).some(
    (t) => t?.role === 'user' && typeof t.text === 'string' && t.text.trim()
  )

export const newChatId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function entryFrom(turns, id, started) {
  const at = Date.now()
  return {
    id: id || newChatId(),
    title: titleFor(turns),
    turns: Array.isArray(turns) ? turns : [],
    device: deviceName(),
    startedAt: started || at,
    at
  }
}

/**
 * Put a conversation on the shelf, and say which one it is now.
 *
 * Returns the id either way, so the caller can hand the same one back next time
 * and update this row instead of leaving copies of one chat down the list.
 *
 * Never throws. A phone archiving a chat on a dead network still has to be able
 * to start the new one — so a cloud write that fails falls back to this
 * browser, which is the only place left that can hold it.
 */
export async function archiveChat(turns, id, started) {
  if (!worthKeeping(turns)) return null
  const entry = entryFrom(turns, id, started)
  const client = supabaseClient()
  if (client) {
    try {
      const { data } = await client.auth.getUser()
      const userId = data?.user?.id
      if (userId) {
        const { error } = await client.from(TABLE).upsert(
          {
            id: entry.id,
            user_id: userId,
            title: entry.title,
            turns: entry.turns,
            device: entry.device,
            started_at: new Date(entry.startedAt).toISOString(),
            updated_at: new Date(entry.at).toISOString()
          },
          { onConflict: 'id' }
        )
        if (!error) return entry.id
      }
    } catch {
      // Offline, or signed out between the check and the write. Fall through.
    }
  }
  writeLocal([entry, ...readLocal().filter((e) => e?.id !== entry.id)])
  return entry.id
}

/** This browser's shelf, newest first. */
export function listLocalChats() {
  return readLocal()
    .filter((e) => e && Array.isArray(e.turns))
    .map((e) => ({ ...e, where: 'browser' }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
}

/**
 * The account's shelf, newest first, or an empty list when signed out.
 *
 * Never throws, for the same reason loadCloudChat does not: a network hiccup
 * must leave the browser's own list on screen rather than emptying it.
 */
export async function listCloudChats() {
  const client = supabaseClient()
  if (!client) return []
  try {
    const { data, error } = await client
      .from(TABLE)
      .select('id,title,turns,device,started_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (error || !Array.isArray(data)) return []
    return data.map((row) => ({
      id: row.id,
      title: row.title || titleFor(row.turns),
      turns: Array.isArray(row.turns) ? row.turns : [],
      device: row.device || null,
      startedAt: row.started_at ? Date.parse(row.started_at) : 0,
      at: row.updated_at ? Date.parse(row.updated_at) : 0,
      where: 'cloud'
    }))
  } catch {
    return []
  }
}

/** One turn, as the thing that says whether two transcripts start the same. */
const turnKey = (turn) =>
  `${turn?.role || ''}\u0000${typeof turn?.text === 'string' ? turn.text.trim() : ''}`

/**
 * Whether one transcript is the beginning of another.
 *
 * A conversation only ever grows: turns are appended and nothing in the middle
 * is edited. So a shelf row whose turns are the opening of a longer row's turns
 * is not a second conversation — it is an earlier snapshot of the same one,
 * shelved under an id that got lost somewhere and then made again.
 *
 * That is how ten rows all called "Make me a three days grace full preset"
 * happen. Nothing invented them; each one was a real write, of the same chat,
 * under a fresh id.
 */
export function continues(shorter = [], longer = []) {
  if (!shorter.length || shorter.length > longer.length) return false
  for (let i = 0; i < shorter.length; i++) {
    if (turnKey(shorter[i]) !== turnKey(longer[i])) return false
  }
  return true
}

/**
 * The snapshots of one conversation, folded into the one that contains them.
 *
 * The longest transcript in a group is the whole of it, so it is the row that
 * stays and the shorter ones are dropped — nothing said in them is hidden,
 * because the row that survives holds every one of their turns and more. It
 * carries the newest time of the group, and the ids of the rows folded in, so
 * deleting it deletes the pile rather than uncovering the next one down.
 *
 * A row with no turns to compare — an old entry, or a list drawn before the
 * transcripts arrive — is never folded. Being unable to tell is a reason to
 * show a conversation, not to hide it.
 */
function foldSnapshots(entries) {
  const kept = []
  const order = [...entries].sort(
    (a, b) => (b?.turns?.length || 0) - (a?.turns?.length || 0) || (b?.at || 0) - (a?.at || 0)
  )
  for (const entry of order) {
    const turns = Array.isArray(entry.turns) ? entry.turns : []
    const into = turns.length
      ? kept.find((k) => continues(turns, Array.isArray(k.turns) ? k.turns : []))
      : null
    if (!into) {
      kept.push({ ...entry, alsoIds: [] })
      continue
    }
    /* The ids folded in are kept, not dropped: the row on screen stands for
       all of them, so deleting it has to delete them, and the chat open in the
       app can still recognise itself in whichever row swallowed it. */
    into.alsoIds.push(entry.id)
    /* The group's clock is the last time anything was said in it, wherever
       that landed. A fold that moved a chat down the list would read as one
       that had thrown the recent half of it away. */
    if ((entry.at || 0) > (into.at || 0)) into.at = entry.at
  }
  return kept
}

/**
 * Both shelves as one list, newest first, each conversation once.
 *
 * The account's copy wins a tie on id: signing in copies this browser's chats
 * up, so for a while the same conversation is genuinely in both places, and the
 * account one is the copy that follows you to the next machine.
 *
 * Then the snapshots fold together — see foldSnapshots. Two rows with the same
 * id were one write; rows whose transcripts are the opening of a longer one
 * were one conversation, and a list that shows a chat once for every time the
 * page reloaded under it is a list that reports work nobody did.
 */
export function mergeChats(cloud = [], local = []) {
  const seen = new Set()
  const out = []
  for (const entry of [...cloud, ...local].sort((a, b) => (b?.at || 0) - (a?.at || 0))) {
    if (!entry?.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return foldSnapshots(out).sort((a, b) => (b?.at || 0) - (a?.at || 0))
}

/**
 * Throw one away, from whichever shelf it is on — and every snapshot of it.
 *
 * A folded row stands for several rows on the account. Deleting only the one
 * on screen would take the tap and then show the next snapshot down, which
 * looks exactly like a chat that refuses to be deleted.
 */
export async function deleteChat(entry) {
  const id = typeof entry === 'string' ? entry : entry?.id
  if (!id) return false
  const ids = [id, ...(Array.isArray(entry?.alsoIds) ? entry.alsoIds : [])].filter(Boolean)
  writeLocal(readLocal().filter((e) => !ids.includes(e?.id)))
  const client = supabaseClient()
  if (!client) return true
  try {
    await client.from(TABLE).delete().in('id', ids)
  } catch {
    // The browser copy is gone and the account copy is not. Better than
    // failing the tap: the next sign-in lists one row that can be deleted
    // again, rather than a chat that refuses to leave the screen.
  }
  return true
}

/**
 * Move this browser's chats onto the account, once there is one.
 *
 * The rule the player asked for is "signed in means the cloud", and a browser
 * that already held chats when they signed in would otherwise keep them for
 * ever on one machine. Ids survive the move, so nothing is duplicated by
 * running this twice.
 *
 * Returns how many went up. Silent about failure by design — this runs on its
 * own after a sign-in, and a network that is not there is a reason to try again
 * later, not to interrupt anybody.
 */
export async function liftChatsToCloud() {
  const client = supabaseClient()
  const local = readLocal()
  if (!client || !local.length) return 0
  try {
    const { data } = await client.auth.getUser()
    const userId = data?.user?.id
    if (!userId) return 0
    const { error } = await client.from(TABLE).upsert(
      local.map((e) => ({
        id: e.id,
        user_id: userId,
        title: e.title || titleFor(e.turns),
        turns: Array.isArray(e.turns) ? e.turns : [],
        device: e.device || null,
        started_at: new Date(e.startedAt || e.at || Date.now()).toISOString(),
        updated_at: new Date(e.at || Date.now()).toISOString()
      })),
      { onConflict: 'id' }
    )
    if (error) return 0
    writeLocal([])
    return local.length
  } catch {
    return 0
  }
}
