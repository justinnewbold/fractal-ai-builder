import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { DEFAULT_PROJECT } from '../lib/project'
import { supabaseClient } from '../lib/relay'
import { accessAction } from '../lib/admin'
import Note from './Note'
import Press from './Press'

/**
 * GIVE SOMEONE ACCESS — Justin's page, and nobody else's.
 *
 * "If for some reason there's something weird where somebody makes a purchase
 * but it's not registering, do I have an ability to manually activate an
 * account for somebody?" Type their email; Check says whether they have the
 * unlock; Give access gives it to them for good; Take it back removes one given
 * here. The server does the work and decides who may ask — see
 * supabase/functions/grant-access.
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
      const { data } = await supabaseClient().auth.getSession()
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
    <View style={{ gap: space.md }}>
      <Text style={{ color: color.silkDim, fontSize: font.small, lineHeight: font.small * 1.5 }}>
        For a purchase that did not register. Type the email they signed up with, then Check. Give access
        unlocks them for good; Take it back removes an unlock given here and never touches one they paid for.
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="their@email.com"
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
      <Press label={busy === 'check' ? 'Checking…' : 'Check'} height={TAP} disabled={!!busy} onPress={() => run('check')} />
      <Press
        label={busy === 'grant' ? 'Giving access…' : 'Give access'}
        tone="signal"
        on
        height={TAP}
        disabled={!!busy}
        onPress={() => run('grant')}
      />
      <Press label={busy === 'revoke' ? 'Taking it back…' : 'Take it back'} height={TAP} disabled={!!busy} onPress={() => run('revoke')} />
      {said ? <Note tone={said.ok ? undefined : 'fault'}>{said.message}</Note> : null}
    </View>
  )
}
