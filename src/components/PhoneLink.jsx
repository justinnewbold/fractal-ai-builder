import { useEffect, useRef, useState } from 'react'
import {
  loadRemoteConfig,
  remoteActive,
  remoteConnect,
  remoteDisconnect,
  remoteHostSeen,
  hostResponds,
  restoreSession,
  setAutoConnect,
  wantsAutoConnect
} from '../lib/remote'

/**
 * Whether this browser is driving the unit from a distance, on every screen.
 *
 * The fact lived in two places that were both wrong for it: a "· remote" suffix
 * on the status line, which said it so quietly it read as decoration, and a
 * panel three folds deep in Presets, which is where you go to set the link up
 * and not where you think about it afterwards. Mid-set the question is "is the
 * phone still talking to the Mac", and the answer should be one glance and the
 * fix one tap.
 *
 * So: a lit chip that says it in words, and opens what you'd want next — the
 * way out when connected, the way back when not.
 */
export default function PhoneLink({ onChanged, onError, compact }) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [hostSeen, setHostSeen] = useState(remoteHostSeen())
  const wrap = useRef(null)

  const active = remoteActive()
  // Somewhere to come back to: a session was saved, so reconnecting is a tap
  // rather than a sign-in. Never linked at all means nothing to show here —
  // setting it up for the first time belongs in its panel, with the fields.
  const known = !!loadRemoteConfig()?.email

  /*
   * "Connected" and "connected to something that is actually there" are
   * different questions, and this chip asks the second one.
   *
   * It used to read presence, which the host does not take part in — so the
   * answer was always no and this chip sat there in red saying "no host" over
   * a session that was working perfectly, next to a preset it had just loaded.
   * The answer now comes from traffic: every answered request is proof, every
   * one that times out is proof of the opposite.
   */
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setHostSeen(remoteHostSeen()), 2000)
    return () => clearInterval(id)
  }, [active])

  /*
   * An idle screen makes no traffic, so a chip that has gone red has nothing to
   * turn it green again. This asks directly, but only while it looks broken —
   * a working link is kept current by the requests the app is already making.
   */
  useEffect(() => {
    if (!active || hostSeen) return
    let stop = false
    const ask = () => hostResponds().then((up) => !stop && setHostSeen(up))
    ask()
    const id = setInterval(ask, 15000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [active, hostSeen])

  // A tap outside is the ordinary way to dismiss a small menu on a phone.
  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  if (!active && !known) return null

  const disconnect = async () => {
    setWorking(true)
    try {
      // Disconnecting is a decision; don't undo it on the next load.
      setAutoConnect(false)
      await remoteDisconnect()
      setOpen(false)
      onChanged?.(false)
    } catch (err) {
      onError?.(err.message)
    } finally {
      setWorking(false)
    }
  }

  const reconnect = async () => {
    setWorking(true)
    try {
      const config = loadRemoteConfig()
      const uid = await restoreSession({ url: config?.url, anonKey: config?.anonKey })
      if (!uid) {
        // The saved session expired. That needs a password, which belongs on
        // the panel that has the fields rather than in a chip.
        throw new Error(
          'That sign-in has expired — reconnect from Play from your phone, under Presets.'
        )
      }
      await remoteConnect()
      setAutoConnect(true)
      setOpen(false)
      onChanged?.(true)
    } catch (err) {
      onError?.(err.message)
    } finally {
      setWorking(false)
    }
  }

  const label = active
    ? hostSeen
      ? 'Connected to phone'
      : 'Phone link · no answer'
    : 'Phone link off'

  /*
   * In the top bar it is a state, not a sentence.
   *
   * "Connected to phone" is a hundred pixels of a three-hundred-and-ninety
   * pixel row, and it pushed the preset name — the one fact anyone reads there
   * — down to nothing. The word still says which of the three states it is;
   * the colour says whether that's good; the popover keeps the sentence.
   *
   * Shortened again after seeing it on a real phone: "phone off" is two words,
   * and at the width the bar could spare it wrapped to two lines and made the
   * chip twice the height of everything beside it. The lamp is right there and
   * the chip is next to a gear, so the noun was doing no work that its
   * neighbours weren't. "no host" keeps both of its words — that one is a
   * fault, and the one state here worth reading twice.
   */
  const short = active ? (hostSeen ? 'linked' : 'no host') : 'off'

  return (
    <span className="phone-link" ref={wrap}>
      <button
        className={`phone-chip ${compact ? 'compact' : ''} ${
          active ? (hostSeen ? 'on' : 'lonely') : 'off'
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label} — connection options`}
      >
        {compact ? null : <span className="lamp" data-state={active ? 'live' : 'idle'} />}
        {compact ? short : label}
      </button>

      {open ? (
        <div className="phone-pop">
          <p className="hint">
            {active ? (
              hostSeen ? (
                <>
                  Relaying through your Supabase project — changes, scenes, tempo and preset
                  selection all work from here. Saving to a slot stays at the Mac.
                </>
              ) : (
                <>
                  On the channel, but the Mac isn&rsquo;t answering on it. Turn the host on there
                  &mdash; the helper forgets that switch every time it restarts, and until it
                  answers nothing here reaches the unit.
                </>
              )
            ) : (
              <>Not relaying. This browser is talking to whatever ForgeFX it can reach directly.</>
            )}
          </p>
          <div className="phone-pop-actions">
            {active ? (
              <button className="chip" onClick={disconnect} disabled={working}>
                {working ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button className="chip" onClick={reconnect} disabled={working}>
                {working ? 'Reconnecting…' : 'Reconnect'}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </span>
  )
}
