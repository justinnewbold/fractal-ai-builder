import { useEffect, useState } from 'react'
import { listPorts, selectPort, servedLocally, pageIsSecure, getHost } from '../lib/forgefx'

/**
 * Which unit to talk to, and how to reach the server from elsewhere.
 *
 * Two problems that look unrelated and aren't: both are about what is on the
 * other end of the connection.
 */
export default function Ports({ onError, onChanged, busy }) {
  const [ports, setPorts] = useState(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(null)

  const load = async () => {
    try {
      setPorts(await listPorts())
    } catch (err) {
      onError(err.message)
    }
  }

  useEffect(() => {
    if (open && !ports) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const choose = async (port) => {
    setSwitching(port.id)
    try {
      await selectPort({ transport: 'serial', id: port.id })
      onChanged(`Switched to ${port.model || port.id}`)
      await load()
    } catch (err) {
      onError(err.message)
    } finally {
      setSwitching(null)
    }
  }

  const auto = async () => {
    setSwitching('auto')
    try {
      await selectPort({ id: null })
      onChanged('Port set back to auto-detect')
      await load()
    } catch (err) {
      onError(err.message)
    } finally {
      setSwitching(null)
    }
  }

  const fractal = (ports?.serial || []).filter((p) => p.fractal)
  const others = (ports?.serial || []).filter((p) => !p.fractal)
  const chosenId = ports?.chosen?.id

  return (
    <section className="ports">
      <div className="log-head">
        <button className="chip" onClick={() => setOpen(!open)}>
          {open ? 'Hide connection' : 'Connection'}
        </button>
      </div>

      {open ? (
        <>
          <p className="silk-label" style={{ marginTop: 10 }}>
            Devices ForgeFX can see
          </p>

          {!ports ? (
            <p className="hint">Reading…</p>
          ) : (
            <div className="port-list">
              {fractal.length === 0 ? (
                <p className="hint pad">No Fractal units found on a serial port.</p>
              ) : (
                fractal.map((port) => (
                  <button
                    key={port.id}
                    className={`port-row ${port.id === chosenId ? 'current' : ''}`}
                    onClick={() => choose(port)}
                    disabled={busy || !!switching}
                  >
                    <span className="port-model">{port.model || 'Fractal device'}</span>
                    <span className="port-id mono">{port.id}</span>
                    {switching === port.id ? <span className="hint">switching…</span> : null}
                  </button>
                ))
              )}

              {others.length ? (
                <p className="hint pad">
                  {others.length} other serial port{others.length === 1 ? '' : 's'} ignored — no
                  Fractal unit on them.
                </p>
              ) : null}
            </div>
          )}

          <div className="history-actions">
            <button className="chip" onClick={load} disabled={busy || !!switching}>
              Re-scan
            </button>
            <button className="chip" onClick={auto} disabled={busy || !!switching}>
              Auto-detect
            </button>
          </div>

          <p className="silk-label" style={{ marginTop: 20 }}>
            Reaching this from your phone
          </p>
          <RemoteHelp />
        </>
      ) : null}
    </section>
  )
}

/**
 * Why the hosted app can't be used from a phone, and what to do about it.
 *
 * Browsers make an exception that lets an HTTPS page call http://localhost —
 * which is the only reason the hosted app works at all. That exemption does not
 * extend to a LAN address, so a phone loading the hosted app cannot reach the
 * server on the machine with the cable. No amount of app-side work changes
 * that; it's the browser's rule.
 *
 * ForgeFX can serve the app itself over plain HTTP, which makes everything
 * same-origin and sidesteps it entirely.
 */
function RemoteHelp() {
  const local = servedLocally()
  const secure = pageIsSecure()

  if (local) {
    return (
      <p className="hint">
        This page is being served by ForgeFX, so any device on the same network can load it at{' '}
        <code>{window.location.origin}</code> — including a phone. Gig mode works from there.
      </p>
    )
  }

  return (
    <div className="notice">
      <p>
        {secure
          ? 'This page is served over HTTPS, and a secure page may only call localhost — not a LAN address. So a phone loading this URL cannot reach ForgeFX on your Mac.'
          : `This page talks to ${getHost()}, which only resolves on the machine running ForgeFX.`}
      </p>
      <p>To use it from a phone, have ForgeFX serve the app instead:</p>
      <p>
        <code>npm run build</code> in this project, then start ForgeFX with{' '}
        <code>FORGEFX_STATIC=/path/to/dist npm run dev</code>
      </p>
      <p>
        Then browse to <code>http://&lt;your-mac-ip&gt;:5056</code> from the phone. Same origin,
        plain HTTP, no browser restriction.
      </p>
    </div>
  )
}
