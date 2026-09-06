/**
 * The phone end of the link to the Mac.
 *
 * ForgeFX on the Mac acts as a host agent: signed in to Supabase, it subscribes
 * to the private channel `remote:<uid>` and executes allowlisted requests
 * against its own local server, replying on the same channel. This is the other
 * end of that — the phone in your hand at the far side of a stage.
 *
 * The channel is private and RLS-scoped to one user, so both ends must be
 * signed in as the same person. That is the whole of the security model, and it
 * is a good one: nobody else can join, by construction rather than by
 * convention.
 *
 * This is a port of src/lib/remote.js, not a redesign. Every behaviour here was
 * paid for on a stage — the grace period around a dropped socket, the roll call
 * that counts how many Macs are listening, the refusal to write while more than
 * one is. Three things differ, and only because the platform differs: the
 * session is kept in AsyncStorage rather than localStorage, payloads are
 * decoded without browser APIs (see decode.js), and the rules that must match
 * the host word for word are a generated copy (see relay-rules.js).
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

import { DEFAULT_PROJECT } from './project'
import { decode } from './decode'
import {
  RELAY_GRACE,
  explainAuth,
  forbiddenRemotely,
  hostConflict as conflictBetween,
  hostNamesFrom as namesFrom,
  repeatable,
  timeoutFor
} from './relay-rules'

export { DEFAULT_PROJECT, RELAY_GRACE, forbiddenRemotely, explainAuth }

let client = null
let channel = null // the joined channel, and null the moment it stops being joined
let session = null // what we built: the channel object and the client it belongs to
let userId = null
/*
 * A rejoin is under way. Between disconnect tearing the old session down and
 * the new one being registered there is no session at all, and a request caught
 * in that window would otherwise be told "not connected" and give up — over a
 * link that was seconds from coming back.
 */
let connecting = false
let hostSeen = false
let answeredAt = 0

const waiting = new Map()
const listeners = new Set()
const watchers = new Set()
const seers = new Set()

/* Every Mac that answered the last roll call, by the name it calls itself. */
let hosts = []
/** Which of them requests are addressed to. Null while there is only one. */
let chosen = null
/** Whether addressing one Mac has been PROVED to leave the others out. */
let targeted = false
/** Roll calls in progress: an id, and every answer that has come back to it. */
const censuses = new Map()

/* ------------------------------------------------------------------ */
/* Signing in                                                          */
/* ------------------------------------------------------------------ */

/**
 * One client for the life of the app.
 *
 * supabase-js writes its session through the storage adapter it was built
 * with, so building a second one mid-session gives you two views of the same
 * account that disagree about whether it is signed in. `remoteConnect` already
 * refuses to reuse a channel that belongs to a different client; this keeps
 * there from being a different client to begin with.
 */
function supabase() {
  if (!client) {
    client = createClient(DEFAULT_PROJECT.url, DEFAULT_PROJECT.anonKey, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        /*
         * A phone has no URL to read a session out of. Left on, supabase-js
         * looks for one at startup and, on some versions, warns about a
         * `window` it will never find.
         */
        detectSessionInUrl: false
      }
    })
  }
  return client
}

export const supabaseClient = () => supabase()

export async function signIn({ email, password }) {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password })
  if (error) throw new Error(explainAuth(error.message))
  userId = data?.user?.id || null
  if (!userId) throw new Error('Signed in but the account service returned no id.')
  return userId
}

/** Create the account, when there isn't one yet. Same project, same policies. */
export async function signUp({ email, password }) {
  const { data, error } = await supabase().auth.signUp({ email, password })
  if (error) throw new Error(explainAuth(error.message))
  // Confirmation may be required, in which case there is no session yet.
  if (data?.session?.user?.id) userId = data.session.user.id
  return { needsConfirmation: !data?.session, userId: data?.user?.id || null }
}

/**
 * Pick up the session left over from last time.
 *
 * Returns the user id when one is still good, null otherwise. Never throws and
 * never prompts: an expired session is a normal thing to find, and the answer
 * is to show the sign-in form, not an error.
 */
export async function restoreSession() {
  try {
    const { data } = await supabase().auth.getSession()
    userId = data?.session?.user?.id || null
    return userId
  } catch {
    return null
  }
}

/** Who is signed in, or null. Email included because that is what a person recognises. */
export async function currentAccount() {
  try {
    const { data } = await supabase().auth.getUser()
    if (!data?.user) return null
    return { id: data.user.id, email: data.user.email || '' }
  } catch {
    return null
  }
}

/**
 * Sign out here, and nowhere else.
 *
 * Scope 'local' on purpose: signing out on a phone must not sign out the Mac
 * that is hosting, which would drop the link for everyone mid-set.
 */
export async function signOut() {
  await remoteDisconnect()
  try {
    await supabase().auth.signOut({ scope: 'local' })
  } finally {
    userId = null
  }
}

export async function changePassword(password) {
  const { error } = await supabase().auth.updateUser({ password })
  if (error) throw new Error(explainAuth(error.message))
}

export async function sendPasswordReset(email) {
  const { error } = await supabase().auth.resetPasswordForEmail(email)
  if (error) throw new Error(explainAuth(error.message))
}

/* ------------------------------------------------------------------ */
/* What the link is doing                                              */
/* ------------------------------------------------------------------ */

export const remoteUserId = () => userId
export const remoteActive = () => !!channel
export const remoteLinked = () => !!session
export const remoteHostSeen = () => hostSeen
export const lastAnswerAt = () => answeredAt
export const remoteHosts = () => hosts
export const remoteChosenHost = () => chosen

export const hostConflict = (list = hosts, pick = chosen, proved = targeted) =>
  conflictBetween(list, pick, proved)

export const hostNamesFrom = (answers, read = decode) => namesFrom(answers, read)

/**
 * The one way `hostSeen` changes, so anyone who cares hears about it.
 *
 * Every answered request is proof the Mac is there and every timeout is proof
 * it is not. Announced on change, ordinary traffic keeps every indicator honest
 * for free — a screen that went red turns green again on the next thing that
 * works, without polling for it.
 */
function seen(v) {
  const now = !!v
  if (now) answeredAt = Date.now()
  if (now === hostSeen) return
  hostSeen = now
  for (const fn of seers) {
    try {
      fn(now)
    } catch {
      // One bad listener shouldn't stop the others.
    }
  }
}

export function subscribeHostSeen(fn) {
  seers.add(fn)
  return () => seers.delete(fn)
}

let lastState = false
function announce() {
  const up = !!channel
  if (up === lastState) return
  lastState = up
  for (const fn of watchers) {
    try {
      fn(up)
    } catch {
      // One bad watcher shouldn't stop the others.
    }
  }
}

export function subscribeRemoteState(fn) {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

/** Device events bridged from the host, same shape as the Mac's own event stream. */
export function subscribeRemoteEvents(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Ask the Mac whether it's there, and remember the answer.
 *
 * Short-fused on purpose: this is asked at moments someone is waiting through —
 * just after connecting, and on a screen already saying something is wrong. A
 * host that is there answers /healthz in well under a second, so a probe that
 * took eight seconds to answer "no" would itself be the reason a lamp was slow.
 */
export async function hostResponds() {
  if (!channel) {
    seen(false)
    return false
  }
  try {
    await remoteRequest('/healthz', { timeoutMs: 6000, graceMs: 0 })
    seen(true)
  } catch {
    seen(false)
  }
  return hostSeen
}

/* ------------------------------------------------------------------ */
/* Joining                                                             */
/* ------------------------------------------------------------------ */

/** realtime-js keeps its own channel state; 'joined' is the only one that can carry a request. */
const isJoined = (chan) => {
  try {
    return chan?.state === 'joined'
  } catch {
    return false
  }
}

/**
 * Whether an existing channel is worth keeping instead of rebuilding.
 *
 * A channel whose socket has closed is still an object and still truthy, and a
 * channel wired to a client the app no longer holds has nothing keeping its
 * socket alive. Both look connected and neither can carry a request.
 */
export function canReuseChannel(chan, sess, c) {
  return !!chan && !!c && sess?.client === c && isJoined(chan)
}

export async function remoteConnect() {
  if (!userId) await restoreSession()
  if (!userId) throw new Error('Sign in first.')
  if (canReuseChannel(channel, session, supabase())) return userId
  connecting = true
  try {
    return await joinChannel()
  } finally {
    connecting = false
  }
}

async function joinChannel() {
  await remoteDisconnect()
  const c = supabase()

  /*
   * Clear out anything left from a previous attempt first.
   *
   * client.channel(topic) returns the EXISTING channel when one is registered
   * for that topic rather than making a new one. So a connect that failed after
   * subscribing leaves a joined channel behind, every retry is handed that same
   * joined channel, and registering presence on it throws — an error that
   * repeats until the app is force-quit.
   */
  for (const existing of c.getChannels()) {
    try {
      await c.removeChannel(existing)
    } catch {
      // Already gone is the outcome we wanted anyway.
    }
  }

  /*
   * Presence has to be declared before subscribe, not after. realtime-js
   * decides whether to enable presence at join time, and the host only bridges
   * live device events while it can see something watching — so getting this
   * wrong means a screen that never updates itself, which is worse than a crash
   * because it looks like it is working.
   */
  const chan = c.channel(`remote:${userId}`, {
    config: { private: true, broadcast: { ack: false }, presence: { key: 'phone', enabled: true } }
  })

  chan.on('broadcast', { event: 'res' }, ({ payload }) => {
    /*
     * A roll call keeps every answer; an ordinary request keeps the first.
     * `waiting.delete` runs before the resolve, so a duplicate finds nothing
     * pending and is dropped without trace — which is exactly how two Macs went
     * unnoticed for as long as they did.
     */
    const census = payload?.id && censuses.get(payload.id)
    if (census) census.push(payload)

    const pending = payload?.id && waiting.get(payload.id)
    if (pending) {
      waiting.delete(payload.id)
      pending.resolve(payload)
    }
  })

  /*
   * Bound, and deliberately says nothing. The Mac never tracks presence, so the
   * only key ever in the state is our own — reading that as "nobody else here"
   * turns a working link red on every sync. The binding stays because presence
   * has to be enabled for the Mac to bridge events to us; the conclusion is
   * gone.
   */
  chan.on('presence', { event: 'sync' }, () => {})

  chan.on('broadcast', { event: 'evt' }, ({ payload }) => {
    for (const fn of listeners) {
      try {
        fn(payload)
      } catch {
        // One bad listener shouldn't stop the others.
      }
    }
  })

  /*
   * The callback stays live for the life of the channel, not just the join.
   * realtime-js calls it again on every state change — which is the only notice
   * we get that a socket died, and the only notice that it came back.
   */
  session = { chan, client: c }
  let settled = false
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Finding your Mac timed out.'))
    }, 12000)

    chan.subscribe((status) => {
      if (session?.chan !== chan) return // a channel we've already replaced

      if (status === 'SUBSCRIBED') {
        channel = chan
        chan.track({ at: Date.now() }).catch(() => {})
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve()
        }
        announce()
        return
      }

      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (channel === chan) {
          channel = null
          seen(false)
          failWaiting('The connection dropped before your Mac answered.')
        }
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`Couldn’t connect (${status.toLowerCase().replace('_', ' ')}).`))
        }
        announce()
      }
    })
  }).catch(async (err) => {
    // Leave nothing registered on the way out, or the next attempt inherits it.
    if (session?.chan === chan) session = null
    await c.removeChannel(chan).catch(() => {})
    throw err
  })

  return userId
}

export async function remoteDisconnect() {
  const going = session
  session = null
  channel = null
  seen(false)
  // Who answered belongs to the channel that is going away. Carrying it over
  // would keep writes refused on a link where the second Mac is long gone.
  hosts = []
  chosen = null
  targeted = false
  censuses.clear()
  failWaiting('Disconnected.')
  announce()

  if (going?.chan) {
    try {
      // Removed, not merely unsubscribed: a channel left registered is handed
      // back by the next `client.channel(topic)`, already joined.
      await going.client.removeChannel(going.chan)
    } catch {
      // Already gone is the outcome we wanted anyway.
    }
  }
}

/* ------------------------------------------------------------------ */
/* How many Macs are listening                                         */
/* ------------------------------------------------------------------ */

/**
 * Count the Macs on the channel, and learn what each is called.
 *
 * A request is a broadcast on one channel per ACCOUNT — `remote:<uid>` — and it
 * carries an id but no address. It is not sent to a Mac; it is shouted, and
 * every Mac signed into that account hears it and answers. With one Mac that is
 * a perfectly good design. With two it is a fault, and the halves fail
 * differently: a read resolves on whichever Mac was quicker, and a write is
 * carried out on both units.
 *
 * Slow on purpose — it waits out the window even when the first answer is
 * instant, because "no second answer yet" and "no second answer at all" are the
 * same thing until the clock runs out. Taken once per connect.
 */
export async function censusHosts({
  windowMs = 1500,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
} = {}) {
  if (!channel || !isJoined(channel)) return hosts
  // A read every host allows and every host answers differently: its own name,
  // written into its store by the launcher on that Mac.
  const answers = await collectAnswers({ path: '/store/config/host.name', windowMs, sleep })
  hosts = await namesFrom(answers, decode)

  // A choice made before is honoured if that Mac is still one of the answers.
  if (!hosts.includes(chosen)) chosen = null
  if (hosts.length > 1 && !chosen) {
    const remembered = await recallHost()
    if (hosts.includes(remembered)) chosen = remembered
  }
  targeted = false
  if (hosts.length > 1 && chosen) await confirmTargeting({ windowMs, sleep })
  return hosts
}

/** Shout one read and keep every answer, rather than the first. */
async function collectAnswers({ path, host = null, windowMs, sleep }) {
  const id = `census-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const answers = []
  censuses.set(id, answers)
  try {
    const payload = { id, method: 'GET', path, body: null }
    if (host) payload.host = host
    await channel.send({ type: 'broadcast', event: 'req', payload })
    await sleep(windowMs)
  } catch {
    // A question that could not be asked tells us nothing, which is what the
    // empty answer list already says.
  } finally {
    censuses.delete(id)
  }
  return answers
}

/**
 * Prove that addressing a request to one Mac actually leaves the others out.
 *
 * The host end of this only exists in a new enough ForgeFX; an older one has
 * never heard of an addressed request and answers it like any other. So the app
 * does not take the feature on trust — it asks the chosen Mac one addressed
 * question and counts the answers. Exactly one means every other Mac stayed out
 * of it, which is the only evidence that a write will land in one place.
 */
async function confirmTargeting({ windowMs, sleep }) {
  if (!chosen) return false
  const answers = await collectAnswers({
    path: '/store/config/host.name',
    host: chosen,
    windowMs,
    sleep
  })
  targeted = answers.length === 1
  return targeted
}

/**
 * Drive this Mac and no other.
 *
 * Remembered, because the answer does not change between one visit and the
 * next: the phone in your pocket belongs to the rig you play, not to whichever
 * Mac happened to answer first.
 */
export async function pickHost(
  name,
  { windowMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  if (!hosts.includes(name)) return false
  chosen = name
  await rememberHost(name)
  targeted = false
  if (hosts.length > 1) await confirmTargeting({ windowMs, sleep })
  return targeted
}

const HOST_KEY = 'fractal.remote.host'
const recallHost = async () => {
  try {
    return await AsyncStorage.getItem(HOST_KEY)
  } catch {
    return null
  }
}
const rememberHost = async (name) => {
  try {
    await AsyncStorage.setItem(HOST_KEY, name)
  } catch {
    // A choice we cannot write down still holds for this session.
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * The socket went, as an error anything upstream can recognise without reading
 * English.
 *
 * Several sentences mean "the relay dropped", and every one of them used to
 * arrive at a caller as an ordinary failure indistinguishable from "the unit
 * refused this". The flag is what lets a caller tell "this never left the
 * phone" from "the unit said no".
 */
function linkDown(message) {
  const err = new Error(message)
  err.linkDown = true
  return err
}

/** Nothing can be answered on a channel that has gone. Fail them now, loudly. */
function failWaiting(message) {
  for (const [, pending] of waiting) pending.reject(linkDown(message))
  waiting.clear()
}

/**
 * Wait for the relay to come back, for a little while.
 *
 * realtime-js rejoins on its own after a socket closes — a phone locked, a hand
 * from wifi to cellular, a tunnel — and it takes a second or two. On a phone
 * that is not an edge case, it is Tuesday. Polled rather than subscribed
 * because the case this exists for is realtime-js flipping its own channel back
 * to joined underneath us.
 */
export async function waitForRelay(
  ms = RELAY_GRACE,
  step = 150,
  sleep = (n) => new Promise((r) => setTimeout(r, n))
) {
  const until = Date.now() + ms
  for (;;) {
    const chan = session?.chan || channel
    if (chan && isJoined(chan)) {
      if (channel !== chan) {
        channel = chan
        announce()
      }
      return true
    }
    if (Date.now() >= until) return false
    await sleep(step)
  }
}

/**
 * Send one request over the relay and wait for its reply.
 *
 * Every message carries an id because replies arrive on a shared broadcast
 * channel with no ordering guarantee — matching on id is the only way to know
 * which answer belongs to which question.
 *
 * A dropped socket is not a failed request. A request that could not travel
 * waits for the relay to come back and goes again, once. Repeating is safe
 * because everything relayed says where something should END UP rather than
 * what should happen next — see `repeatable`, and the one route that isn't.
 */
export async function remoteRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()

  /*
   * Nothing is changed while two Macs are listening. A write is not sent to the
   * wrong unit — it is carried out on both. Reads are left alone deliberately:
   * they are a coin flip rather than a hazard, and the screen that has to
   * explain this is built out of reads.
   */
  if (method !== 'GET') {
    const clash = hostConflict()
    if (clash) {
      const err = new Error(clash)
      err.status = 409
      err.hostConflict = true
      throw err
    }
  }

  const why = forbiddenRemotely(method, path)
  if (why) {
    const err = new Error(`You can't ${why} from your phone — do that at the Mac.`)
    err.status = 403
    err.remoteBlocked = true
    throw err
  }

  /*
   * One budget for the whole request, not one per attempt. A flapping link
   * would otherwise cost double on every request, and the screen deciding
   * whether a unit is really gone asks several in a row.
   */
  const graceUntil = Date.now() + (options.graceMs ?? RELAY_GRACE)
  const attempts = repeatable(path) ? 2 : 1

  let last = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await relayReady(graceUntil - Date.now())
      return await relaySend(method, path, options)
    } catch (err) {
      // Only a relay that went missing is worth repeating. A 403, a 409, a unit
      // that answered "no" — those are answers, and asking again gets the same
      // one a second slower.
      if (!err?.linkDown) throw err
      last = err
    }
  }
  throw last
}

async function relayReady(grace) {
  if (channel && isJoined(channel)) return
  if (channel) {
    channel = null
    seen(false)
    announce()
  }
  // Nothing was ever set up, and nothing is coming: say so now rather than
  // making someone watch a grace period elapse over an empty session.
  if (!session && !connecting) throw linkDown('Not connected to your Mac.')
  if (grace > 0 && (await waitForRelay(grace))) return
  throw linkDown('The connection to your Mac dropped.')
}

/** One trip: shout the question, match the answer by id, unwrap it. */
async function relaySend(method, path, options) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      // Nothing came back: whatever we last believed about the Mac being there,
      // this is better evidence.
      seen(false)
      reject(new Error('Your Mac didn’t answer.'))
    }, options.timeoutMs || timeoutFor(method, path))
    waiting.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
  })

  /*
   * Addressed once there is more than one Mac to address, and never before. A
   * single-host session sends exactly what it always sent, so nothing depends
   * on the host being new until the moment two are listening — and by then
   * confirmTargeting has proved they understand it.
   */
  const ask = { id, method, path, body: options.body ?? null }
  if (hosts.length > 1 && chosen && targeted) ask.host = chosen

  try {
    await channel.send({ type: 'broadcast', event: 'req', payload: ask })
  } catch (err) {
    /*
     * A send that throws never reached the wire, and the promise above is still
     * parked in `waiting` holding a timer. Left there it fires twenty seconds
     * later against a request nobody made.
     */
    waiting.delete(id)
    throw linkDown(
      err?.message ? `Couldn’t reach your Mac — ${err.message}` : 'Couldn’t reach your Mac.'
    )
  }

  const payload = await reply
  // An answer is proof the Mac is on the channel — better proof than any probe,
  // and free. Every request the app makes keeps this current.
  seen(true)
  const text = await decode(payload)

  let parsed = null
  if (typeof text === 'string' && text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  } else if (text) {
    parsed = text
  }

  if (payload.status >= 400) {
    const err = new Error(parsed?.message || parsed?.error || `Host returned ${payload.status}`)
    err.status = payload.status
    if (payload.status === 403) err.remoteBlocked = true
    throw err
  }
  return parsed
}
