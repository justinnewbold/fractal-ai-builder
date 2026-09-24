import { useState } from 'react'
import { Keyboard, Text, TextInput, View } from 'react-native'

import { color, font, radius, space, TAP } from '../lib/theme'
import { DEFAULT_PROJECT } from '../lib/project'
import { supabaseClient } from '../lib/relay'
import { accessAction, lookupRows } from '../lib/admin'
import Facts from './Facts'
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
 *
 * And the Customer lookup under whichever answer comes back: when they signed
 * up, what they paid for and where, which devices they are signed in on, the
 * app version they were last on. "Do number one and five for now."
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
    /* The answer sits under the field, and a keyboard left up covers it. */
    Keyboard.dismiss()
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
      {/*
        The answer, right under the address it is about. It used to sit below
        all three buttons, which on a phone is below the keyboard: "there was no
        confirmation that it added them" -- the server had answered, three
        times, that no account used that address, and none of it was on screen.
        An address with no account is not a success, so it reads as a warning.
      */}
      {said ? (
        <Note tone={said.ok && said.found !== false ? undefined : 'fault'} strong size={font.body}>
          {said.message}
        </Note>
      ) : null}
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
      <Facts rows={lookupRows(said)} />
    </View>
  )
}
