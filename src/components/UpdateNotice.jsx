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
const CHECK_EVERY = 10 * 60 * 1000

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

    // Coming back to a backgrounded tab is exactly the moment a stale one is
    // about to be used, so that's when to look.
    const onShow = () => !document.hidden && check()
    document.addEventListener('visibilitychange', onShow)
    const id = setInterval(check, CHECK_EVERY)
    check()

    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [])

  if (!stale) return null

  return (
    <div className="update-notice" role="status">
      <span>A newer version of this app is out — this tab is running an older one.</span>
      <button className="chip" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}
