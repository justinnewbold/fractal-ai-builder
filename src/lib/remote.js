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
export const REMOTE_FORBIDDEN = [
  { match: (m, p) => m === 'POST' && p === '/preset/store', why: 'save to a slot' },
  { match: (m, p) => p.startsWith('/preset/backup'), why: 'back up a preset' },
  { match: (m, p) => p.startsWith('/preset/restore'), why: 'restore a preset' },
  { match: (m, p) => p.startsWith('/backup'), why: 'back up the device' },
  { match: (m, p) => p.startsWith('/local'), why: 'reach the library on your Mac' },
  { match: (m, p) => p.startsWith('/ports'), why: 'change which port is used' },
  { match: (m, p) => p.startsWith('/firmware'), why: 'touch firmware' },
  { match: (m, p) => p.startsWith('/debug/raw'), why: 'send raw SysEx' }
]

/** Why this request can't travel, or null if it can. */
export function forbiddenRemotely(method, path) {
  const clean = (path.split('?')[0] || '').replace(/\/+$/, '') || '/'
  return REMOTE_FORBIDDEN.find((r) => r.match(method.toUpperCase(), clean))?.why || null
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
let channel = null
let userId = null
let hostSeen = false
const waiting = new Map()
const listeners = new Set()

export const remoteActive = () => !!channel

/** Whether anything besides this browser is on the channel. */
export const remoteHostSeen = () => hostSeen

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
  if (channel) return userId

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

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Joining the channel timed out.')), 12000)
    chan.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer)
        reject(new Error(`Realtime ${status}. Is the host signed in and enabled?`))
      }
    })
  }).catch(async (err) => {
    // Leave nothing registered on the way out, or the next attempt inherits it.
    await client.removeChannel(chan).catch(() => {})
    throw err
  })

  await chan.track({ at: Date.now() }).catch(() => {})
  channel = chan
  return userId
}

export async function remoteDisconnect() {
  if (channel) {
    try {
      await channel.unsubscribe()
    } catch {
      // Leaving a channel that's already gone is not a failure.
    }
  }
  channel = null
  hostSeen = false
  for (const [, pending] of waiting) pending.reject(new Error('Remote disconnected.'))
  waiting.clear()
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
      reject(new Error('The host did not answer. Is ForgeFX still running?'))
    }, 15000)
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
