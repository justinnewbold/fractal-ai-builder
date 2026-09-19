import { useState } from 'react'
import { DEFAULT_PROJECT, remoteActive, hostResponds, currentAccount } from '../lib/remote'

/**
 * What the link is doing, for working out why it is not.
 *
 * This is the one place allowed to use the words: the account service by
 * name, the three settings the device server needs, a step-by-step test of
 * the link.
 *
 * TWO THINGS FOR TWO DIFFERENT PEOPLE, which is why `role` is now a prop.
 *
 * "Is all this weird information still needed with supabase links and
 * stuff?" — asked over a screenshot of a PHONE showing a block of
 * environment variables to paste into a server's .env file.
 *
 * Still needed, and never on that screen. One of the four ways to connect a
 * computer is running ForgeFX by hand, and somebody doing that has to tell
 * it where the account service is. But the machine that needs those three
 * lines is the one with the cable in it, and a phone is never that machine —
 * there is no .env on a handset to put them in and no server there to read
 * one. It was three lines of configuration shown to the one person who can
 * do nothing at all with them.
 *
 * So the block is shown at the computer, and folded away even there, because
 * three of the four ways in never need it either. Test the link stays
 * everywhere: that one is about THIS device's own connection, which is
 * exactly what somebody on a phone is trying to work out.
 */
export default function LinkDetails({ role }) {
  /* 'mac' means this page is served from localhost — the machine running the
     device server, whether the Fractal app started it or somebody ran it by
     hand. A phone is 'wifi' or 'remote' and never this. */
  const atTheComputer = role === 'mac'
  const [report, setReport] = useState(null)
  const [checking, setChecking] = useState(false)
  // Everyone uses the one project. The fields for typing in another one were
  // removed: they were a place to break the link by accident, in Setup.
  const project = DEFAULT_PROJECT

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
          : 'The computer is answering but has no unit attached to it — check the cable there.'
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

      {atTheComputer ? (
        <details className="env-fold">
          <summary>Running the device server yourself?</summary>
          <p className="hint">
            The Fractal app starts it with these already set, so there is nothing to do here. They
            are only needed if you run ForgeFX by hand, in its{' '}
            <span className="mono">.env</span>:
          </p>
          <pre className="mono env-block">
            {`AXIS_CLOUD=1\nSUPABASE_URL=${project.url}\nSUPABASE_ANON_KEY=${project.anonKey}`}
          </pre>
          <p className="hint">
            The key is the publishable one, which is why it can sit in plain sight: a signed-in user
            can only reach their own channel, so it grants a stranger nothing.
          </p>
        </details>
      ) : null}
    </section>
  )
}
