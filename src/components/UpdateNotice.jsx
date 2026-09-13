import { useEffect, useState } from 'react'
import { VERSION } from '../lib/version'

/**
 * When the tab is running a build that no longer exists.
 *
 * A phone keeps a tab alive for days. iOS doesn't re-fetch a page you return
 * to — it restores it from memory — so a browser that was opened last week is
 * still running last week's bundle, and no amount of deploying changes that.
 * This cost a round of bug reports against code that had already been fixed:
 * the diagnostics said one version, the deploy was five ahead, and both of us
 * were looking at different apps.
 *
 * The check is the cheapest honest one available: ask the server for the page
 * we were loaded from and compare the hashed script it names against the one
 * this document actually loaded. No build step, no version endpoint to keep in
 * sync — the filename IS the version, and it changes exactly when the code
 * does.
 */
/*
 * Ten minutes was too long to be believed.
 *
 * "Doesn't look like the push went through somehow, the PWA has not updated
 * yet, still on version 7.160.0" — said about a deploy that was live and
 * correct. From the outside a ten-minute gap between deploying and being told
 * is indistinguishable from a deploy that never happened, and what it costs is
 * a bug report against code that is already fixed. A minute is still one small
 * no-store request for a page of about a kilobyte, and only while the app is
 * in front of somebody.
 */
const CHECK_EVERY = 60 * 1000

/*
 * The reload, remembered across itself.
 *
 * Pressing Reload writes the script the deploy named into session storage;
 * the page that comes up reads it back and compares it with the script it
 * actually loaded. That is the only way to know whether Reload worked — the
 * button cannot see the page it produces — and it is what turns "Reload did
 * nothing" from a report into something the app says itself.
 */
const EXPECT_KEY = 'fab.update.expected'

/*
 * The query that makes the reload a page nobody has cached.
 *
 * Seen on v7.196 with v7.198 live: Reload, and still 7.196 — until the
 * address was typed into the bar by hand. location.reload() asks for the same
 * URL, and the same URL is exactly what a home-screen app's document cache and
 * an edge cache both hold an answer for. A URL with a number on the end that
 * has never been requested has no cached answer anywhere; it has to come from
 * the deploy. Stripped again on arrival, so it never shows in the bar and
 * never lands in a link somebody copies.
 */
const FRESH_PARAM = 'fresh'

/** How long "up to date" stays before it gets out of the way. */
const LANDED_FOR_MS = 6000

function loadedScript() {
  const el = document.querySelector('script[type="module"][src*="/assets/"]')
  const src = el?.getAttribute('src') || ''
  return src.split('/').pop() || null
}

async function deployedScript() {
  // no-store, or the check inherits the very cache it exists to defeat.
  const res = await fetch(window.location.pathname, { cache: 'no-store' })
  if (!res.ok) return null
  const html = await res.text()
  return html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null
}

function expectAfterReload(script) {
  try {
    sessionStorage.setItem(EXPECT_KEY, script)
  } catch {
    // Private windows and blocked site data throw. The reload still happens;
    // it just cannot be checked afterwards.
  }
}

/** What the last Reload was reaching for, read once and then forgotten. */
function expectedScript() {
  try {
    const wanted = sessionStorage.getItem(EXPECT_KEY)
    if (wanted) sessionStorage.removeItem(EXPECT_KEY)
    return wanted || null
  } catch {
    return null
  }
}

/** Take the cache-buster back off the address once it has done its job. */
function tidyAddress() {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(FRESH_PARAM)) return
    url.searchParams.delete(FRESH_PARAM)
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // A URL the browser will not let us touch is still the right page.
  }
}

/** The address this page is at, plus a number nobody has asked for before. */
export function freshAddress(href, now = Date.now()) {
  const url = new URL(href)
  url.searchParams.set(FRESH_PARAM, String(now))
  return url.toString()
}

export default function UpdateNotice() {
  // The script the deploy names, when it is not the one this tab loaded.
  const [stale, setStale] = useState(null)
  // What the last Reload did: 'landed', 'missed', or nothing to say.
  const [after, setAfter] = useState(null)

  useEffect(() => {
    const mine = loadedScript()
    const wanted = expectedScript()
    tidyAddress()
    // In dev there is no hashed bundle to compare, so there is nothing to say.
    if (!mine) return
    /*
     * The check that Reload worked. The version in the bar is the one built
     * into this bundle, so if the bundle is the one the deploy named, the
     * version on screen is the deployed one — and if it is not, saying so
     * beats a Reload button that looked like it worked.
     */
    if (wanted) setAfter(wanted === mine ? 'landed' : 'missed')
    let stop = false

    const check = async () => {
      if (stop || document.hidden) return
      try {
        const theirs = await deployedScript()
        if (!stop && theirs && theirs !== mine) setStale(theirs)
      } catch {
        // Offline, or the app is being served from something that isn't the
        // deploy. Either way this is a nicety, not a thing to raise an error
        // over.
      }
    }

    /*
     * Coming back to a backgrounded app is exactly the moment a stale one is
     * about to be used, so that is when to look — and on iOS that moment
     * arrives under three different names. An app reopened from the home
     * screen fires visibilitychange; one restored from the back/forward cache
     * fires pageshow and sometimes nothing else; a window brought forward on a
     * Mac fires focus. Listening for one of the three is how a phone that has
     * been in a pocket since last week comes back, looks like it is checking,
     * and says nothing.
     */
    const onShow = () => !document.hidden && check()
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('focus', onShow)
    const id = setInterval(check, CHECK_EVERY)
    check()

    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [])

  // "Up to date" is news for a moment, then it is clutter.
  useEffect(() => {
    if (after !== 'landed') return undefined
    const t = setTimeout(() => setAfter(null), LANDED_FOR_MS)
    return () => clearTimeout(t)
  }, [after])

  /*
   * A reload that actually fetches the page, which is not what reload() means
   * on an installed app.
   *
   * A home-screen app on iOS holds the document it was launched with, and
   * location.reload() is perfectly entitled to hand back the copy in the HTTP
   * cache — so pressing Reload on a stale app could leave it exactly as stale,
   * which is the worst version of this: a button that looks like it worked.
   *
   * Two things, in order. `cache: 'reload'` goes to the network and REPLACES
   * the cached copy of this address. Then the page is left for the same
   * address with a fresh query on it — one no cache has an answer for, so it
   * comes from the deploy whatever the first step managed. If the fetch fails
   * (offline, or served from something that is not the deploy) the move is
   * still the right one and still what the button promised.
   */
  const refresh = async () => {
    if (stale) expectAfterReload(stale)
    try {
      await fetch(window.location.pathname, { cache: 'reload' })
    } catch {
      // Offline. The page that follows will say so in the ordinary way.
    }
    window.location.replace(freshAddress(window.location.href))
  }

  if (after === 'missed') {
    return (
      <div className="update-notice" data-kind="missed" role="status">
        <span>
          Reload didn’t bring the new version in — this tab is still on v{VERSION}. Close the tab
          and open the app again.
        </span>
        <button className="chip" onClick={refresh}>
          Try again
        </button>
      </div>
    )
  }

  if (stale) {
    return (
      <div className="update-notice" role="status">
        <span>A newer version of this app is out — this tab is running an older one.</span>
        <button className="chip" onClick={refresh}>
          Reload
        </button>
      </div>
    )
  }

  if (after === 'landed') {
    return (
      <div className="update-notice" data-kind="landed" role="status">
        <span>✓ Up to date — v{VERSION}</span>
      </div>
    )
  }

  return null
}
