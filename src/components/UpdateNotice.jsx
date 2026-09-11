import { useEffect, useState } from 'react'

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

export default function UpdateNotice() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const mine = loadedScript()
    // In dev there is no hashed bundle to compare, so there is nothing to say.
    if (!mine) return
    let stop = false

    const check = async () => {
      if (stop || document.hidden) return
      try {
        const theirs = await deployedScript()
        if (!stop && theirs && theirs !== mine) setStale(true)
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

  if (!stale) return null

  /*
   * A reload that actually fetches the page, which is not what reload() means
   * on an installed app.
   *
   * A home-screen app on iOS holds the document it was launched with, and
   * location.reload() is perfectly entitled to hand back the copy in the HTTP
   * cache — so pressing Reload on a stale app could leave it exactly as stale,
   * which is the worst version of this: a button that looks like it worked.
   *
   * `cache: 'reload'` goes to the network and REPLACES the cached copy, so the
   * reload that follows it loads the new page from the cache it just refilled.
   * If that fetch fails — offline, or the app is served from something that is
   * not the deploy — reloading anyway is still the right move and still what
   * the button promised.
   */
  const refresh = async () => {
    try {
      await fetch(window.location.pathname, { cache: 'reload' })
    } catch {
      // Offline. The reload below will say so in the ordinary way.
    }
    window.location.reload()
  }

  return (
    <div className="update-notice" role="status">
      <span>A newer version of this app is out — this tab is running an older one.</span>
      <button className="chip" onClick={refresh}>
        Reload
      </button>
    </div>
  )
}
