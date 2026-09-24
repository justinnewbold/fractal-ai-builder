import { useCallback, useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { DEFAULT_PROJECT } from '../lib/project'
import { supabaseClient } from '../lib/relay'
import { accessAction, accountSections } from '../lib/admin'
import Facts from './Facts'
import Note from './Note'
import Press from './Press'

/**
 * EVERYONE WITH AN ACCOUNT — Justin's page, and nobody else's.
 *
 * "How do I see a list of who has set up an account? Need to check
 * L4adaptive@gmail.com." Every account, newest first, with a box to find one
 * address, and the waiting list under it. The same server as Give someone
 * access (supabase/functions/grant-access), which decides who may ask.
 */
export default function AccountsTool() {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null)
  const [find, setFind] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { data } = await supabaseClient().auth.getSession()
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
    <View style={{ gap: space.lg }}>
      <TextInput
        value={find}
        onChangeText={setFind}
        placeholder="Find an email"
        placeholderTextColor={color.silkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={{
          minHeight: TAP,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.rule,
          backgroundColor: color.panel,
          color: color.silk,
          fontSize: font.body
        }}
      />
      {said && !said.ok ? <Note tone="fault">{said.message}</Note> : null}
      {said?.ok ? accountSections(said, find).map((s) => <Facts key={s.title} title={s.title} rows={s.rows} />) : null}
      <Press label={busy ? 'Loading…' : 'Refresh'} height={TAP} disabled={busy} onPress={load} />
    </View>
  )
}
