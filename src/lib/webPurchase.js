import { DEFAULT_PROJECT, supabaseClient } from './remote'

/**
 * Buying the unlock from a browser, or from the computer app.
 *
 * "We already decided that we ARE gonna offer the purchases on the desktop apps
 * and the web app." The phone buys through Apple or Google; this buys through
 * RevenueCat Web Billing, which takes the card through his own Stripe account.
 * The Mac, Windows and Linux apps load this same build, so this is their way
 * to pay as well.
 *
 * THE SAME UNLOCK, NOT A SECOND ONE. It is filed under the signed-in account's
 * id — exactly the id the phone gives RevenueCat's logIn — and it grants the
 * same `full` entitlement. So a card taken here unlocks the phone the moment
 * that phone signs in, and the relay's table learns of it from the webhook.
 *
 * WHICH KEY: the live one. Web Billing has two public keys. The sandbox key
 * takes Stripe's test cards and moves no money; the production key takes
 * real ones. It shipped on sandbox until somebody had walked the checkout
 * end to end — he did, a new account made on the website and paid for:
 * "Payment on web working. You can go ahead and set it live instead of the
 * sandbox." Going back is one line: WEB_KEY to SANDBOX_KEY. Both are public
 * by design, like the phone's appl_ and goog_ keys.
 */
const SANDBOX_KEY = 'rcb_sb_KdoKqKIDAheHEcOurZYnqRBHO'
const PRODUCTION_KEY = 'rcb_sRfyHdzVZSYYipRdOgggitGqahKr'
export const WEB_KEY = PRODUCTION_KEY
export const WEB_LIVE = WEB_KEY === PRODUCTION_KEY

/** The product the phones sell too, so the package is picked by name, not by position. */
export const PRODUCT_ID = 'cloud.newbold.fractalremote.full'
export const ENTITLEMENT = 'full'

/*
 * Loaded only when there is a price to show — the demo's bar, Settings'
 * Unlock row, the unlock page — never as part of the main bundle. The library brings
 * Stripe's checkout with it, and the main bundle is already past the size Vite
 * warns about; somebody driving a rig they own should not download a payment
 * form.
 */
let sdk = null
let instance = null
let instanceFor = null
const load = async () => {
  if (!sdk) sdk = await import('@revenuecat/purchases-js')
  return sdk
}

async function purchasesFor(accountId) {
  const { Purchases } = await load()
  /* Configured for one account at a time; a different person signing in on
     the same browser gets a fresh instance rather than the last one's. */
  if (!instance || instanceFor !== accountId) {
    instance = Purchases.configure({ apiKey: WEB_KEY, appUserId: accountId })
    instanceFor = accountId
  }
  return instance
}

/** The package that sells the unlock — by product id, with first-wins only as a fallback, as on the phone. */
function theUnlockIn(offerings) {
  const every = [
    ...(offerings?.current?.availablePackages || []),
    ...Object.values(offerings?.all || {}).flatMap((o) => o?.availablePackages || [])
  ]
  return every.find((p) => p?.webBillingProduct?.identifier === PRODUCT_ID) || every[0] || null
}

/**
 * Has this account paid? Asked of the server, not of this page.
 *
 * The same `entitlement` function the phone calls: it reads who is asking
 * out of the signed-in session, asks RevenueCat, and writes the answer where
 * the relay can read it. A purchase made on a phone therefore shows as paid
 * here without this page knowing anything about Apple or Google.
 *
 * Never throws. `unknown` means the question could not be put, and the page
 * treats that the way the phone does — as not a no.
 */
export async function checkUnlocked() {
  try {
    const { data } = await supabaseClient()?.auth.getSession() || {}
    const token = data?.session?.access_token
    if (!token) return { unlocked: false, unknown: false }
    const res = await fetch(`${DEFAULT_PROJECT.url}/functions/v1/entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: DEFAULT_PROJECT.anonKey, Authorization: `Bearer ${token}` },
      body: '{}'
    })
    const body = await res.json().catch(() => ({}))
    return { unlocked: Boolean(body?.unlocked), unknown: Boolean(body?.unknown) }
  } catch {
    return { unlocked: false, unknown: true }
  }
}

/*
 * Who asks for the price before anybody has signed in.
 *
 * "When someone's on the demo, it should always say unlock, and then the
 * price at the top." Most people in the demo are not signed in — the price is
 * part of what makes them want to — and RevenueCat will not quote a price
 * without somebody to quote it to. So a browser that has no account yet asks
 * as an anonymous visitor, the kind RevenueCat makes for exactly this, kept
 * in this browser so every visit is the same visitor rather than a new one.
 *
 * Only ever used to READ the price. The purchase itself still refuses to run
 * without a signed-in account, so a card is never filed under a visitor.
 */
const VISITOR = 'fractal.webVisitor'
async function visitorId() {
  try {
    const kept = window.localStorage.getItem(VISITOR)
    if (kept) return kept
  } catch {
    /* Private window, blocked storage: a fresh visitor for this page is fine. */
  }
  const { Purchases } = await load()
  const made = Purchases.generateRevenueCatAnonymousAppUserId()
  try {
    window.localStorage.setItem(VISITOR, made)
  } catch {
    /* Same as above. */
  }
  return made
}

/** What it costs here, as Stripe will charge it — or null when there is nothing to sell. */
export async function webPrice(accountId) {
  try {
    const p = await purchasesFor(accountId || (await visitorId()))
    const pkg = theUnlockIn(await p.getOfferings())
    return pkg?.webBillingProduct?.currentPrice?.formattedPrice || null
  } catch {
    return null
  }
}

/**
 * Buy it. Opens RevenueCat's own checkout over the page and resolves when the
 * card has been taken, declined, or the window closed.
 *
 * Resolves, never rejects, with `{ ok, cancelled, message }` — the same shape
 * the phone's buyUnlock returns, so the two screens can say the same things.
 */
export async function buyOnWeb({ accountId, email }) {
  if (!accountId) return { ok: false, cancelled: false, message: 'Sign in first, so the unlock has an account to belong to.' }
  try {
    const p = await purchasesFor(accountId)
    const pkg = theUnlockIn(await p.getOfferings())
    if (!pkg) return { ok: false, cancelled: false, message: 'The store has nothing to sell yet.' }
    const { customerInfo } = await p.purchase({ rcPackage: pkg, customerEmail: email || undefined })
    const yes = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT])
    /* Tell the relay now, rather than waiting for the webhook to land. */
    if (yes) checkUnlocked()
    return yes
      ? { ok: true, cancelled: false, message: null }
      : { ok: false, cancelled: false, message: 'The store did not confirm the purchase.' }
  } catch (err) {
    const { ErrorCode } = await load().catch(() => ({ ErrorCode: {} }))
    if (err?.errorCode === ErrorCode?.UserCancelledError) return { ok: false, cancelled: true, message: null }
    return { ok: false, cancelled: false, message: err?.message || 'The purchase did not go through.' }
  }
}
