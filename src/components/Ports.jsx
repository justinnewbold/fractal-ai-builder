import { useEffect, useRef, useState } from 'react'
import { listPorts, selectPort, servedLocally } from '../lib/forgefx'

/**
 * Which unit to talk to, and how to reach the server from elsewhere.
 *
 * Two problems that look unrelated and aren't: both are about what is on the
 * other end of the connection.
 */
export default function Ports({ onError, onChanged, busy }) {
  const box = useRef(null)
  const [ports, setPorts] = useState(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(null)

  /*
   * ONE FOLD, NOT TWO.
   *
   * "On the Phone and computer drop-down where it says Connection, there's a
   * redundant Connection button that then takes you to the connection — let's
   * get rid of that extra step."
   *
   * This panel had a fold of its own: a chip reading "Connection", then "Hide
   * connection", sitting inside a section already titled CONNECTION, with its
   * own chevron and the note "Which unit this app is talking to". Two presses
   * to reach one list, the second one labelled the same as the first.
   *
   * The chip was never really a fold, which is why it is not simply deleted.
   * It was where the READ happened: nothing asks the computer what is plugged
   * into it until somebody wants to know, because the answer is a scan of
   * every port on the machine and, from a phone, a question relayed across the
   * internet. So the panel now takes that cue from the fold it already lives
   * in rather than from a second one of its own.
   *
   * It has to be asked for rather than assumed: `<details>` keeps its contents
   * mounted while it is shut, so a panel that read on mount would scan the
   * ports of every computer that opened Setup, folded or not.
   */
  useEffect(() => {
    const fold = box.current?.closest('details')
    /* Nothing folded above it means it is simply on screen, and what is on
       screen should say something. */
    if (!fold) {
      setOpen(true)
      return undefined
    }
    const sync = () => setOpen(fold.open)
    sync()
    fold.addEventListener('toggle', sync)
    return () => fold.removeEventListener('toggle', sync)
  }, [])

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
  const others = all.filter((p) => !p.fractal)
  const chosenId = ports?.chosen?.id

  /*
   * MIDI names itself twice.
   *
   * A USB-MIDI unit exposes its input and its output as separate endpoints,
   * usually under the same name — so listing them straight gave "Also
   * reachable over MIDI: AM4, AM4", which reads as two units or as a bug.
   * ForgeFX pairs the two halves itself; there is one unit there.
   */
  const overMidi = [
    ...new Map(
      all
        .filter((p) => p.fractal && p.transport === 'midi')
        .map((p) => [p.model || p.label || p.id, p])
    ).values()
  ]

  /*
   * What the app is talking to, said first.
   *
   * This panel led with "No Fractal units found on a serial port" — true, and
   * the wrong fact to open with on a Mac driving an AM4 over MIDI, where the
   * bar two inches above says "AM4 connected". It reported the absence of the
   * transport it was not using instead of the presence of the one it was.
   */
  const chosen = ports?.chosen || null
  const chosenEntry = chosen
    ? all.find((p) => p.id === chosen.id || p.id === chosen.inId || p.id === chosen.outId)
    : null
  const chosenName =
    chosenEntry?.model || chosenEntry?.label || ports?.profile?.name || chosen?.id || null
  const overMidiNow = chosen?.transport === 'midi'

  return (
    <section className="ports" ref={box}>
      <p className="silk-label">Units plugged into your computer</p>

      {!ports ? (
        <p className="hint">Reading…</p>
      ) : (
        <div className="port-list">
          {chosen && chosenName ? (
            <p className="port-live">
              Talking to <strong>{chosenName}</strong> over{' '}
              {overMidiNow ? 'MIDI' : 'a serial port'}.
            </p>
          ) : null}

          {fractal.length === 0 ? (
            <p className="hint pad">
              {overMidiNow
                ? 'Nothing on a serial port — MIDI is carrying it.'
                : 'No Fractal units found on a serial port.'}
            </p>
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

          {/* Only when MIDI is not already the answer: when it is, the line
              above has said so, and saying it twice invites the reading
              that these are two different things. */}
          {overMidi.length && !overMidiNow ? (
            <p className="hint pad">
              Also reachable over MIDI: {overMidi.map((p) => p.model || p.label || p.id).join(', ')} —
              used automatically when nothing is on a serial port.
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
        This page is being served from your computer, so any device on the same network can open{' '}
        <code>{window.location.origin}</code> — including a phone.
      </p>
    )
  }

  return (
    <p className="hint">
      To play from a phone, use <strong>Phone remote</strong> above. Your computer stays plugged into
      the unit and the phone drives it from anywhere.
    </p>
  )
}
