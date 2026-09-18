/**
 * Telling us something is broken, or asking for something.
 *
 * Two taps and a sentence. Nothing here asks for a title, a category, steps to
 * reproduce, or an account — every one of those is a reason not to bother, and
 * the report nobody sends is worth nothing. What the app knows about itself is
 * attached automatically, which is the part a person could not supply anyway.
 *
 * THE LOG IS THE PART TO BE CAREFUL WITH, and the care is all in the shape of
 * this screen rather than in any warning:
 *
 * - It goes with a bug and never with an idea. Somebody asking for a bigger
 *   tuner has not offered a transcript of their evening, and the form does not
 *   quietly take one. The switch is not even drawn on that side.
 * - It is gathered when Send is pressed and at no other moment. Nothing is
 *   collected while somebody types, so a report half-written and abandoned
 *   leaves no copy of anything anywhere.
 * - It can be looked at first, in full, by the same two functions that send
 *   it — so what is shown cannot drift from what goes.
 * - And it can be turned off, on the one screen where it would otherwise be a
 *   thing that happens to you rather than a thing you did.
 */
import { useState } from 'react'
import { KINDS, MAX_MESSAGE, carriesLog, context, logPreview, sendReport } from '../lib/reports'

export default function Feedback({ device, link, platform, macVersion }) {
  const [kind, setKind] = useState('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [withLog, setWithLog] = useState(true)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const logGoes = carriesLog(kind) && withLog

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendReport({
        kind,
        message,
        contact,
        context: context({ device, link, platform, macVersion }),
        withLog
      })
      // The text goes only once it is actually gone.
      setSent(true)
      setMessage('')
      setContact('')
      setPreview(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /* Built on the press rather than kept in step with every keystroke: it is
     the whole log as text, and re-making it on each character typed would be
     work nobody asked for. */
  const look = () => setPreview(preview === null ? logPreview(kind) : null)

  if (sent) {
    return (
      <div className="feedback feedback-sent">
        <p>Sent — thank you. It goes straight to the person who builds this.</p>
        <button className="chip" onClick={() => setSent(false)}>
          Send another
        </button>
      </div>
    )
  }

  return (
    <div className="feedback">
      <div className="feedback-kind" role="group" aria-label="What kind of feedback">
        {KINDS.map((k) => (
          <button
            key={k}
            className={`chip ${kind === k ? 'active' : ''}`}
            onClick={() => {
              setKind(k)
              /* A preview belongs to the kind it was made for. Leaving it up
                 while switching to the side that sends no log would show a log
                 next to a form that is not sending one. */
              setPreview(null)
            }}
            aria-pressed={kind === k}
            disabled={busy}
          >
            {k === 'bug' ? 'Something is broken' : 'I want something'}
          </button>
        ))}
      </div>

      <textarea
        className="feedback-text"
        value={message}
        maxLength={MAX_MESSAGE}
        rows={4}
        onChange={(e) => setMessage(e.target.value)}
        disabled={busy}
        placeholder={
          kind === 'bug'
            ? 'What happened, and what did you expect instead?'
            : 'What would you like it to do?'
        }
        aria-label={kind === 'bug' ? 'What went wrong' : 'What you want'}
      />

      <input
        type="text"
        className="feedback-contact"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        disabled={busy}
        placeholder="Email, if you want an answer (optional)"
        aria-label="Your email, if you want an answer"
        inputMode="email"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />

      {carriesLog(kind) ? (
        <div className="feedback-log">
          <label className="feedback-log-switch">
            <input
              type="checkbox"
              checked={withLog}
              onChange={(e) => setWithLog(e.target.checked)}
              disabled={busy}
            />
            <span>Send the log of what the app just did</span>
          </label>
          <button className="chip" onClick={look} disabled={busy || !withLog} type="button">
            {preview === null ? 'See what that is' : 'Hide it'}
          </button>
          {preview !== null ? (
            <pre className="feedback-log-preview mono" aria-label="What the log contains">
              {preview || '(nothing has been logged yet this session)'}
            </pre>
          ) : null}
        </div>
      ) : (
        <p className="hint">No log goes with this one — just what you wrote.</p>
      )}

      {error ? <p className="hint problem">{error}</p> : null}

      <div className="feedback-actions">
        <button className="primary" onClick={send} disabled={busy || !message.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <p className="hint">
          Your version and which unit you&rsquo;re on are sent too, so it can be looked into.
          {logGoes ? ' The log goes as well — you can read it above first.' : ''} Nothing
          you&rsquo;ve built and no account details go with it.
        </p>
      </div>
    </div>
  )
}
