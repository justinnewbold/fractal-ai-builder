/**
 * Telling us something is broken, or asking for something.
 *
 * Two taps and a sentence. Nothing here asks for a title, a category, steps to
 * reproduce, or an account — every one of those is a reason not to bother, and
 * the report nobody sends is worth nothing. What the app knows about itself is
 * attached automatically, which is the part a person could not supply anyway.
 */
import { useState } from 'react'
import { KINDS, MAX_MESSAGE, context, sendReport } from '../lib/reports'

export default function Feedback({ device, link, platform }) {
  const [kind, setKind] = useState('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendReport({ kind, message, contact, context: context({ device, link, platform }) })
      // The text goes only once it is actually gone.
      setSent(true)
      setMessage('')
      setContact('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

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
            onClick={() => setKind(k)}
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

      {error ? <p className="hint problem">{error}</p> : null}

      <div className="feedback-actions">
        <button className="primary" onClick={send} disabled={busy || !message.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <p className="hint">
          Your version and which unit you&rsquo;re on are sent too, so it can be looked into. Nothing
          you&rsquo;ve built and no account details go with it.
        </p>
      </div>
    </div>
  )
}
