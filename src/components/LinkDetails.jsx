import { useState } from 'react'
import { DEFAULT_PROJECT, remoteActive, hostResponds, currentAccount } from '../lib/remote'

/**
 * What the link is doing, for working out why it is not.
 *
 * This is the one place allowed to use the words: the account service by
 * name, the three settings the Mac's device server needs, a step-by-step
 * test of the link. It lives under Technical details, beside the wire log,
 * because that is who it is for — and because for a while these words were
 * the first thing a person saw when they opened Setup on their phone.
 */
export default function LinkDetails() {
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
        lines.push('Not connected to the Mac. Connect from Phone remote, above.')
        return
      }
      lines.push('Connected to the account service.')
      const began = Date.now()
      const answered = await hostResponds()
      lines.push(
        answered
          ? `The Mac answered in ${Date.now() - began} ms.`
          : `No answer from the Mac in ${Math.round((Date.now() - began) / 1000)}s. Is the Fractal app open there, signed in as this same account?`
      )
      if (!answered) return
      const { detect } = await import('../lib/forgefx')
      const info = await detect()
      lines.push(
        info?.connected
          ? `The Mac has a ${info.short || info.name} attached. The link is working.`
          : 'The Mac is answering but has no unit attached to it — check the cable there.'
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

      <p className="hint">
        The Mac&rsquo;s device server is started with these already set by the Fractal app. Only
        if you run it some other way do they need to go in its <span className="mono">.env</span>:
      </p>
      <pre className="mono env-block">
        {`AXIS_CLOUD=1\nSUPABASE_URL=${project.url}\nSUPABASE_ANON_KEY=${project.anonKey}`}
      </pre>
      <p className="hint">
        The key is the publishable one, which is why it can sit in plain sight: a signed-in user
        can only reach their own channel, so it grants a stranger nothing.
      </p>
    </section>
  )
}
