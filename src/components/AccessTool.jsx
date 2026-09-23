import { useState } from 'react'
import { DEFAULT_PROJECT, supabaseClient } from '../lib/remote'
import { accessAction, lookupRows } from '../../shared/admin.mjs'
import Facts from './Facts'

/**
 * GIVE SOMEONE ACCESS — Justin's page, and nobody else's. The browser's copy
 * of the phone's (mobile/src/components/AccessTool.js), same words, same
 * server: supabase/functions/grant-access, which decides who may ask.
 */
export default function AccessTool() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(null)
  const [said, setSaid] = useState(null)

  const run = async (action) => {
    const address = email.trim()
    if (!address.includes('@')) {
      setSaid({ ok: false, message: 'Type the email address they signed up with.' })
      return
    }
    setBusy(action)
    setSaid(null)
    try {
      const client = supabaseClient()
      const { data } = client ? await client.auth.getSession() : { data: null }
      setSaid(
        await accessAction({
          url: DEFAULT_PROJECT.url,
          anonKey: DEFAULT_PROJECT.anonKey,
          token: data?.session?.access_token,
          action,
          email: address
        })
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="access-tool">
      <p className="hint">
        For a purchase that did not register. Type the email they signed up with, then Check. Give access
        unlocks them for good; Take it back removes an unlock given here and never touches one they paid for.
      </p>
      <input
        type="text"
        inputMode="email"
        className="access-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="their@email.com"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="history-actions">
        <button type="button" className="chip" disabled={!!busy} onClick={() => run('check')}>
          {busy === 'check' ? 'Checking…' : 'Check'}
        </button>
        <button type="button" className="primary" disabled={!!busy} onClick={() => run('grant')}>
          {busy === 'grant' ? 'Giving access…' : 'Give access'}
        </button>
        <button type="button" className="chip" disabled={!!busy} onClick={() => run('revoke')}>
          {busy === 'revoke' ? 'Taking it back…' : 'Take it back'}
        </button>
      </div>
      {said ? <p className={said.ok ? 'hint' : 'save-error'} role="status">{said.message}</p> : null}
      <Facts rows={lookupRows(said)} />
    </div>
  )
}
