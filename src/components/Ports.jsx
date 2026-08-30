import { useEffect, useState } from 'react'
import { listPorts, selectPort, servedLocally } from '../lib/forgefx'

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

  /*
   * ForgeFX answers /ports with one `ports` list carrying both transports, each
   * entry flagged `fractal`. This read `ports.serial` — a field the server has
   * never sent — so the list was always empty and the panel always said no unit
   * was found, on a Mac with the unit plugged in and answering every other call
   * the app made.
   *
   * MIDI endpoints are shown but not offered as a choice: a MIDI connection is
   * an input and an output together, and ForgeFX pairs them itself when there's
   * no Fractal unit on a serial port. Picking one half here would record a
   * connection that doesn't work.
   */
  const all = Array.isArray(ports?.ports) ? ports.ports : []
  const fractal = all.filter((p) => p.fractal && p.transport !== 'midi')
  const overMidi = all.filter((p) => p.fractal && p.transport === 'midi')
  const others = all.filter((p) => !p.fractal)
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
            Units plugged into your Mac
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

              {overMidi.length ? (
                <p className="hint pad">
                  Also reachable over MIDI: {overMidi.map((p) => p.label || p.id).join(', ')} — used
                  automatically when nothing is on a serial port.
                </p>
              ) : null}

              {others.length ? (
                <p className="hint pad">
                  {others.length} other connection{others.length === 1 ? '' : 's'} ignored — no
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
 * How to use this from a phone.
 *
 * This used to explain same-origin rules and tell people to rebuild the app and
 * relaunch the helper with an environment variable pointing at a dist folder.
 * That was a workaround for a problem the remote session now solves properly,
 * so it was not merely jargon — it was worse advice than the thing that works.
 */
function RemoteHelp() {
  if (servedLocally()) {
    return (
      <p className="hint">
        This page is being served from your Mac, so any device on the same network can open{' '}
        <code>{window.location.origin}</code> — including a phone.
      </p>
    )
  }

  return (
    <p className="hint">
      To play from a phone, use <strong>Play from your phone</strong> above. Your Mac stays plugged
      into the unit and the phone drives it from anywhere.
    </p>
  )
}
