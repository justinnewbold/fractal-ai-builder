/**
 * Driving the unit from somewhere that isn't the machine holding the cable.
 *
 * ForgeFX can act as a host agent: signed in to Supabase, it subscribes to the
 * private channel `remote:<uid>` and executes allowlisted requests against its
 * own local server, replying on the same channel. This is the other end of that
 * — the phone in your hand at the far side of a stage.
 *
 * The channel is private and RLS-scoped to one user, so both ends must be signed
 * in as the same person. That is the whole of the security model, and it is a
 * good one: nobody else can join, by construction rather than by convention.
 *
 * Credentials live in this browser rather than in the deployed build. The app is
 * hosted, the Supabase project is the player's own, and baking one person's
 * project into a public bundle would be wrong even when that person is the only
 * user.
 */

const STORE_KEY = 'fractal.remote.config'

/**
 * The project this app relays through.
 *
 * Baked in rather than typed each time. The anon key is designed to be public —
 * it identifies the project, it authorises nothing on its own, and every table
 * and channel behind it is governed by RLS.
 *
 * Specifically: the realtime policy on this project allows a signed-in user to
 * read and write only the channel `remote:<their own uid>`. So a stranger who
 * takes this key and signs up gets a channel of their own with no host on it.
 * They cannot see this one, and no amount of knowing the key changes that.
 * Safety comes from the policy, not from the key being secret.
 *
 * Both can still be overridden, for a second project or a rotated key.
 */
export const DEFAULT_PROJECT = {
  url: 'https://biznwrqeckviawjuhvyg.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpem53cnFlY2t2aWF3anVodnlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjIyNDksImV4cCI6MjEwMzQ5ODI0OX0.WT2K6kxqy5cMc1tL-Lr3JgTwwhFYY2t-NJsOXNJXgVU'
}

/**
 * What the host will and won't do from a distance.
 *
 * ForgeFX refuses these with a 403 and it is right to: a phone on a dark stage
 * should not be able to overwrite slot 67 or move firmware around. Naming them
 * here lets the app say so plainly instead of surfacing a bare status code
 * halfway through a song.
 */
/**
 * A verbatim port of the host's own rule — ForgeFX server/src/remote.ts,
 * remoteAllowed(). Keep the two in lockstep, character for character where the
 * shapes allow.
 *
 * This used to be a hand-written list of notable blocks, and it drifted in both
 * directions. It blocked GETs the host happily serves (the backup list, the
 * port list — needlessly dead panels on the phone), and it allowed writes the
 * host refuses (renames, version restores, cache deletes — which then failed as
 * raw relay errors instead of the friendly refusal this list exists to give).
 * Eight routes disagreed with the server by the time anyone compared them. A
 * port of the real function cannot disagree about anything.
 */
function hostAllows(method, p) {
  if (method === 'GET') return !p.startsWith('/cloud') && !p.startsWith('/remote') && p !== '/debug/raw'
  if (method === 'PUT')
    return (
      /^\/preset\/blocks\/\d+\/params(\/\d+)?$/.test(p) ||
      /^\/preset\/grid\/cell$/.test(p) ||
      /^\/am4\/param$/.test(p) ||
      /^\/device\/param$/.test(p) ||
      p === '/telemetry/config' ||
      /^\/store\/config\/[^/]+$/.test(p)
    )
  if (method === 'POST')
    return (
      /^\/preset\/blocks\/\d+\/(bypass|channel|type|read|readrange)$/.test(p) ||
      p === '/preset/meters' ||
      p === '/preset/select' ||
      p === '/preset/grid/cable' ||
      p === '/preset/grid/select' ||
      p === '/scene' ||
      p === '/tempo' ||
      p === '/tempo/tap' ||
      p === '/tuner' ||
      p === '/mod/bind' ||
      /^\/am4\/(bypass|scene|preset)$/.test(p)
    )
  return false
}

/** Friendly phrasings for the refusals people will actually hit. */
export const REMOTE_FORBIDDEN = [
  { match: (m, p) => m === 'POST' && p === '/preset/store', why: 'save to a slot' },
  { match: (m, p) => p.startsWith('/preset/backup'), why: 'back up a preset' },
  { match: (m, p) => p.startsWith('/preset/restore'), why: 'restore a preset' },
  { match: (m, p) => p.startsWith('/backup'), why: 'back up the device' },
  { match: (m, p) => p.startsWith('/version'), why: 'load or restore a version' },
  { match: (m, p) => p === '/preset/name' || p === '/scene/name', why: 'rename anything' },
  { match: (m, p) => p.startsWith('/local'), why: 'reach the library on your Mac' },
  { match: (m, p) => m !== 'GET' && p.startsWith('/ports'), why: 'change which port is used' },
  { match: (m, p) => p.startsWith('/firmware'), why: 'touch firmware' },
  { match: (m, p) => p.startsWith('/debug/raw'), why: 'send raw SysEx' }
]

/**
 * How long to wait for the host, by what was asked of it.
 *
 * Fifteen seconds was fine for the requests that motivated it — a scene change,
 * a parameter write, a preset select. It is not fine for a read that makes the
 * unit dump its whole preset over serial before answering. On an AM4 the block
 * list is exactly that read, and the relay was giving up on it mid-answer, which
 * the gig screen then showed as a preset with no blocks in it.
 *
 * The cost of waiting longer is only ever waiting longer. The cost of giving up
 * early is being told something false about the unit.
 */
const SLOW_READS = [
  /^\/preset\/blocks$/,
  /^\/preset\/blocks\/\d+\/(params|raw|cab)$/,
  /^\/preset\/grid$/,
  /^\/presets\/\d+(\/|$)/,
  /^\/preset\/locations$/,
  /^\/device\/cache/
]

export function timeoutFor(method, path) {
  const clean = (path.split('?')[0] || '').replace(/\/+$/, '') || '/'
  return SLOW_READS.some((re) => re.test(clean)) ? 45000 : 20000
}

/** Why this request can't travel, or null if it can. */
export function forbiddenRemotely(method, path) {
  const clean = (path.split('?')[0] || '').replace(/\/+$/, '') || '/'
  const m = method.toUpperCase()
  if (hostAllows(m, clean)) return null
  // The host will refuse it; say why in words if we have them.
  return (
    REMOTE_FORBIDDEN.find((r) => r.match(m, clean))?.why ||
    'do that from a distance — it only works at the Mac'
  )
}

export const loadRemoteConfig = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
  } catch {
    return null
  }
}

export const saveRemoteConfig = (config) => {
  if (config) localStorage.setItem(STORE_KEY, JSON.stringify(config))
  else localStorage.removeItem(STORE_KEY)
}

/**
 * Whether to rejoin the host automatically on load.
 *
 * Having signed in once isn't the same as wanting to be remote. Someone sitting
 * at the Mac with the cable in it should stay local, so this records the last
 * thing chosen rather than inferring it from a session that happens to exist.
 */
export const setAutoConnect = (on) => {
  const config = loadRemoteConfig() || {}
  saveRemoteConfig({ ...config, autoConnect: !!on })
}

export const wantsAutoConnect = () => !!loadRemoteConfig()?.autoConnect

let client = null
let channel = null // the joined channel, and null the moment it stops being joined
let session = null // what we built: the channel object and the client it belongs to
let userId = null
let hostSeen = false
const waiting = new Map()
const listeners = new Set()
const watchers = new Set()

export const remoteActive = () => !!channel

/**
 * Which account this browser joined as.
 *
 * The channel is named after the user id, so the two ends meeting at all
 * depends on this matching what the Mac signed in as — and a browser holds a
 * Supabase session of its own, which survives everything and is not necessarily
 * the address anyone remembers typing. Printed at both ends, a mismatch is a
 * thing you can see; unprinted, it is a connection that simply never happens.
 */
export const remoteUserId = () => userId

/** A session that exists, joined or not — the difference between "dropped" and "never set up". */
export const remoteLinked = () => !!session

/**
 * Whether the Mac answered the last time we asked it something.
 *
 * This used to count presence — "is anything else on the channel?" — and the
 * answer was always no, on a working session as much as a broken one. The host
 * joins the channel but never tracks presence, so it is not in the state we
 * were reading, and there is nothing it could do about it from here. What that
 * check produced was a line saying "nothing else is on this channel, turn the
 * host on at the Mac" every single time someone connected, including with the
 * host on and answering.
 *
 * A relayed request is the only honest test of a relay, so that is the test:
 * ask the host for its health and see whether an answer comes back.
 *
 * Our own presence still matters and is still tracked — the host bridges live
 * device events only while it can see a browser watching.
 *
 * Kept current by ordinary traffic rather than by asking: every answered
 * request is proof, and every request that times out is proof of the opposite.
 */
export const remoteHostSeen = () => hostSeen

/**
 * Ask the Mac whether it's there, and remember the answer.
 *
 * Short-fused on purpose: this is asked at moments someone is waiting through
 * — just after connecting, and on a screen that is already saying something is
 * wrong. A host that is there answers /healthz in well under a second.
 */
export async function hostResponds() {
  if (!channel) {
    hostSeen = false
    return false
  }
  try {
    await remoteRequest('/healthz', { timeoutMs: 6000 })
    hostSeen = true
  } catch {
    hostSeen = false
  }
  return hostSeen
}

/**
 * Whether the relay is up, as it changes.
 *
 * A socket can close under a phone that's locked, carried out of range, or
 * handed from wifi to cellular, and nothing here noticed: `channel` stayed set,
 * so the app went on believing it was connected and every request went into a
 * dead socket and waited for its timeout. Worse, a manual reconnect saw that
 * same channel and returned it unchanged, which is why only a page reload ever
 * fixed it — a reload is the one thing that clears this module's state.
 *
 * So the join status is watched rather than sampled once, and anyone who cares
 * is told. realtime-js rejoins on its own when the network comes back; this is
 * what turns that rejoin into the app catching up rather than a stale screen.
 */
export function subscribeRemoteState(fn) {
  watchers.add(fn)
  return () => watchers.delete(fn)
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

/** Nothing can be answered on a channel that has gone. Fail them now, loudly. */
function failWaiting(message) {
  for (const [, pending] of waiting) pending.reject(new Error(message))
  waiting.clear()
}

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
 * Two ways it isn't, and connect used to fall for both. A channel whose socket
 * has closed is still an object and still truthy. And signing in again builds a
 * new client, which leaves the channel wired to the old one — a client the app
 * no longer holds and whose socket nothing is keeping alive.
 */
export function canReuseChannel(channel, session, client) {
  return !!channel && !!client && session?.client === client && isJoined(channel)
}

/** Sign in to the player's own Supabase project. */
/**
 * Supabase's auth errors are terse and one of them is actively misleading.
 *
 * An unconfirmed account fails with wording that sounds like a wrong password,
 * which sends you off changing credentials that were right all along.
 */
export function explainAuth(message) {
  const m = (message || '').toLowerCase()
  if (m.includes('not confirmed') || m.includes('email not confirmed')) {
    return 'That account exists but its email was never confirmed. Check for a confirmation mail from Supabase, or tell me and I can confirm it directly.'
  }
  if (m.includes('invalid login')) {
    return 'Email or password not accepted. If the account is new, its email may still need confirming.'
  }
  return message
}

/** Create the account, when there isn't one yet. Same project, same policies. */
export async function remoteSignUp({ url, anonKey, email, password }) {
  const { createClient } = await import('@supabase/supabase-js')
  const c = createClient(url || DEFAULT_PROJECT.url, anonKey || DEFAULT_PROJECT.anonKey)
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw new Error(explainAuth(error.message))
  // Confirmation may be required, in which case there is no session yet.
  return { needsConfirmation: !data?.session, userId: data?.user?.id || null }
}

/**
 * Pick up a session left over from last time.
 *
 * Supabase already persists the session — signing in writes it to localStorage
 * and it stays there. What was missing is this: nothing ever asked for it, so a
 * refresh looked like a sign-out and the password got typed again.
 *
 * Returns the user id when a session is still good, null otherwise. Never
 * throws and never prompts: a stale or expired session is a normal thing to
 * find, and the answer is to show the sign-in form, not an error.
 */
export async function restoreSession({ url, anonKey } = {}) {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const c = createClient(url || DEFAULT_PROJECT.url, anonKey || DEFAULT_PROJECT.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
    const { data } = await c.auth.getSession()
    if (!data?.session?.user?.id) return null
    client = c
    userId = data.session.user.id
    return userId
  } catch {
    return null
  }
}

export async function remoteSignIn({ url, anonKey, email, password }) {
  // Loaded on demand: a realtime client is a couple of hundred KB and most
  // sessions are local, sitting at the machine with the cable in it.
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(url || DEFAULT_PROJECT.url, anonKey || DEFAULT_PROJECT.anonKey, {
    // autoRefreshToken keeps a long session alive rather than expiring it
    // mid-set, which is the worst possible moment to be handed a login form.
    auth: { persistSession: true, autoRefreshToken: true }
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(explainAuth(error.message))
  userId = data?.user?.id
  if (!userId) throw new Error('Signed in but Supabase returned no user id.')
  return userId
}

/**
 * Join the host's channel and start relaying.
 *
 * Presence matters: the host only bridges device events while at least one
 * remote is watching, so joining with a presence track is what makes live
 * updates arrive rather than an optional nicety.
 */
export async function remoteConnect() {
  if (!client || !userId) throw new Error('Sign in first.')

  /*
   * Only a channel that is joined AND belongs to the client we're holding can
   * be reused. This used to be `if (channel) return userId`, which handed back
   * whatever was left over: a socket that had dropped, or — after signing in
   * again, which builds a new client — a channel wired to the old one. Connect
   * returned instantly, the app said it was connected, and every request sat
   * there until it timed out. Anything else gets torn down and rebuilt.
   */
  if (canReuseChannel(channel, session, client)) return userId
  await remoteDisconnect()

  /*
   * Clear out anything left from a previous attempt first.
   *
   * client.channel(topic) returns the EXISTING channel when one is already
   * registered for that topic rather than making a new one. So a connect that
   * failed after subscribing leaves a joined channel behind, and every retry is
   * handed that same joined channel — where registering presence throws. The
   * symptom is an error that repeats forever until the page is reloaded, which
   * is a miserable thing to hand someone mid-setup.
   */
  for (const existing of client.getChannels()) {
    try {
      await client.removeChannel(existing)
    } catch {
      // Already gone is the outcome we wanted anyway.
    }
  }

  /*
   * Presence has to be declared before subscribe, not after.
   *
   * realtime-js decides whether to enable presence at join time, from the
   * bindings registered so far plus `presence.enabled`. Calling track() on an
   * already-joined channel throws, and — worse than the crash — presence would
   * have been off on the server side, so the host would never have seen anyone
   * watching and would never have bridged a single device event.
   */
  const chan = client.channel(`remote:${userId}`, {
    config: { private: true, broadcast: { ack: false }, presence: { key: 'browser', enabled: true } }
  })

  chan.on('broadcast', { event: 'res' }, ({ payload }) => {
    const pending = payload?.id && waiting.get(payload.id)
    if (pending) {
      waiting.delete(payload.id)
      pending.resolve(payload)
    }
  })

  // Registered before subscribe, which is both required and useful: it tells us
  // whether the host agent is actually on the channel.
  chan.on('presence', { event: 'sync' }, () => {
    try {
      hostSeen = Object.keys(chan.presenceState()).length > 1
    } catch {
      hostSeen = false
    }
  })

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
   * realtime-js calls it again every time the channel's state changes — which
   * is the only notice we get that a socket died, and the only notice that it
   * came back. Settling the join promise is a one-off; keeping `channel`
   * truthful is the ongoing job.
   */
  session = { chan, client }
  let settled = false
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Joining the channel timed out.'))
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
          hostSeen = false
          failWaiting('The remote session dropped before the host answered.')
        }
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error(`Realtime ${status}. Is the host signed in and enabled?`))
        }
        announce()
      }
    })
  }).catch(async (err) => {
    // Leave nothing registered on the way out, or the next attempt inherits it.
    if (session?.chan === chan) session = null
    await client.removeChannel(chan).catch(() => {})
    throw err
  })

  return userId
}

export async function remoteDisconnect() {
  const going = session
  session = null
  channel = null
  hostSeen = false
  failWaiting('Remote disconnected.')
  announce()

  if (going?.chan) {
    try {
      // Removed, not merely unsubscribed: a channel left registered on the
      // client is handed back by the next `client.channel(topic)`, already
      // joined, and registering presence on it throws.
      await going.client.removeChannel(going.chan)
    } catch {
      // Already gone is the outcome we wanted anyway.
    }
  }
}

/** Device events bridged from the host, same shape as the local SSE stream. */
export function subscribeRemoteEvents(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Decode whatever framing the host used. */
async function decode(payload) {
  const { body, encoding } = payload
  if (encoding === 'utf8') return body

  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  if (encoding === 'base64') return bytes

  // gzip: the host compresses anything over a couple of KB, which is most of
  // the interesting payloads — catalogs, grids, block lists.
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/**
 * Send one request over the relay and wait for its reply.
 *
 * Every message carries an id because replies arrive on a shared broadcast
 * channel with no ordering guarantee — matching on id is the only way to know
 * which answer belongs to which question.
 */
export async function remoteRequest(path, options = {}) {
  if (!channel) throw new Error('Not connected to the host.')
  // A channel can stop being joined between one request and the next, and
  // sending into it waits out the whole timeout for an answer nobody heard the
  // question. Catching it here costs nothing and says what actually happened.
  if (!isJoined(channel)) {
    channel = null
    hostSeen = false
    announce()
    throw new Error('The remote session dropped. Reconnect to the Mac to carry on.')
  }
  const method = (options.method || 'GET').toUpperCase()

  const why = forbiddenRemotely(method, path)
  if (why) {
    const err = new Error(`You can't ${why} from a remote session — do that at the Mac.`)
    err.status = 403
    err.remoteBlocked = true
    throw err
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      // Nothing came back: whatever we last believed about the Mac being there,
      // this is better evidence.
      hostSeen = false
      reject(new Error('The host did not answer. Is ForgeFX still running?'))
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

  await channel.send({
    type: 'broadcast',
    event: 'req',
    payload: { id, method, path, body: options.body ?? null }
  })

  const payload = await reply
  // An answer is proof the Mac is on the channel — better proof than any probe,
  // and free. Every request the app makes keeps this current.
  hostSeen = true
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
