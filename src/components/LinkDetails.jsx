import { useState } from 'react'
import { quitEditor } from '../../shared/editors.mjs'
import { remoteActive, hostResponds, currentAccount } from '../lib/remote'

/**
 * What the link is doing, for working out why it is not.
 *
 * ONE THING, FOR THE PERSON HOLDING THE DEVICE. It used to be two, and the
 * second one should never have survived as long as it did: a block of
 * environment variables — the account service's URL and its publishable key —
 * to paste into a server's .env file.
 *
 * "There is only 3 ways to connect. Mac, Windows or Linux. We removed the
 * terminal. There is no reason a user should be seeing supabase developer
 * jargon."
 *
 * Quite right, and the first attempt at this only moved it: it was hidden
 * from phones and folded away at the computer, on the reasoning that running
 * ForgeFX by hand was one of the ways in and needed it. That route was taken
 * out in 7.352.0 — "I think that we should just drop the helpers completely,
 * nobody wants to deal with that kind of stuff in order for it to work" — and
 * all three that remain are applications that start the device server
 * themselves and set those values without being asked.
 *
 * So the block had no audience at all. Not a phone's, not a computer's. What
 * is left is Test the link, which is about THIS device's own connection, step
 * by step, stopping at the first thing that is wrong — which is what somebody
 * with a dead link actually wants and the only thing here anybody could act
 * on.
 */
export default function LinkDetails() {
  const [report, setReport] = useState(null)
  const [checking, setChecking] = useState(false)

  /**
   * Read-only, step by step, stopping at the first thing that is wrong.
   * Every line names a fact a person can act on.
   */
  const test = async () => {
    setChecking(true)
    const lines = []
    try {
      const account = await currentAccount()
      lines.push(account ? `Signed in here as ${account.email || account.id.slice(0, 8)}.` : 'Not signed in on this device.')
      if (!remoteActive()) {
        lines.push('Not connected to the computer. Connect from Phone remote, above.')
        return
      }
      lines.push('Connected to the account service.')
      const began = Date.now()
      const answered = await hostResponds()
      lines.push(
        answered
          ? `The computer answered in ${Date.now() - began} ms.`
          : `No answer from the computer in ${Math.round((Date.now() - began) / 1000)}s. Is the Fractal app open there, signed in as this same account?`
      )
      if (!answered) return
      const { detect } = await import('../lib/forgefx')
      const info = await detect()
      lines.push(
        info?.connected
          ? `The computer has a ${info.short || info.name} attached. The link is working.`
          : `The computer is answering but has no unit attached to it — check the cable there. ${quitEditor(null)}`
      )
    } catch (err) {
      lines.push(`Stopped at: ${err.message}`)
    } finally {
      setReport(lines)
      setChecking(false)
    }
  }

  return (
    <section className="link-details">
      <p className="silk-label">Phone remote</p>
      <div className="history-actions">
        <button className="chip" onClick={test} disabled={checking}>
          {checking ? 'Testing…' : 'Test the link'}
        </button>
      </div>
      {report ? (
        <div className="problems">
          {report.map((line, i) => (
            <p key={i} className="mono problem repair">
              {line}
            </p>
          ))}
        </div>
      ) : null}

    </section>
  )
}
