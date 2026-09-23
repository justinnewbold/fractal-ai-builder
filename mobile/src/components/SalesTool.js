import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'

import { TAP, space } from '../lib/theme'
import { DEFAULT_PROJECT } from '../lib/project'
import { supabaseClient } from '../lib/relay'
import { accessAction, salesSections } from '../lib/admin'
import Facts from './Facts'
import Note from './Note'
import Press from './Press'

/**
 * SALES AT A GLANCE — Justin's page, and nobody else's.
 *
 * "Purchases today, this week and all time, with a count per platform." Asked
 * for as the page opens and again on Refresh; the same server as Give someone
 * access (supabase/functions/grant-access), which decides who may ask.
 */
export default function SalesTool() {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { data } = await supabaseClient().auth.getSession()
      setSaid(
        await accessAction({
          url: DEFAULT_PROJECT.url,
          anonKey: DEFAULT_PROJECT.anonKey,
          token: data?.session?.access_token,
          action: 'sales'
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
    <View style={{ gap: space.lg }}>
      {said && !said.ok ? <Note tone="fault">{said.message}</Note> : null}
      {said?.ok ? salesSections(said).map((s) => <Facts key={s.title} title={s.title} rows={s.rows} />) : null}
      <Press label={busy ? 'Counting…' : 'Refresh'} height={TAP} disabled={busy} onPress={load} />
    </View>
  )
}
