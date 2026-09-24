import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PROJECT, supabaseClient } from '../lib/remote'
import { accessAction, accountSections } from '../../shared/admin.mjs'
import Facts from './Facts'

/**
 * EVERYONE WITH AN ACCOUNT — Justin's page, and nobody else's. The browser's
 * copy of the phone's (mobile/src/components/AccountsTool.js), same words,
 * same server.
 */
export default function AccountsTool() {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)
  const [find, setFind] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const client = supabaseClient()
      const { data } = client ? await client.auth.getSession() : { data: null }
      setSaid(
        await accessAction({
          url: DEFAULT_PROJECT.url,
          anonKey: DEFAULT_PROJECT.anonKey,
          token: data?.session?.access_token,
          action: 'accounts'
        })
      )
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="access-tool">
      <input
        type="text"
        inputMode="email"
        className="access-email"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        placeholder="Find an email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {said && !said.ok ? (
        <p className="save-error" role="status">
          {said.message}
        </p>
      ) : null}
      {said?.ok ? accountSections(said, find).map((s) => <Facts key={s.title} title={s.title} rows={s.rows} />) : null}
      <div className="history-actions">
        <button type="button" className="chip" disabled={busy} onClick={load}>
          {busy ? 'Loading…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
