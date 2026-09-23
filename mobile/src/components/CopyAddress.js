import { useState } from 'react'
import { Platform, Pressable, Text } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { color, font, mono, radius, space } from '../lib/theme'
import { P6 } from '../lib/onboarding'
import { tick } from '../lib/feedback'
import { DOWNLOADS_URL } from '../lib/downloadLink'

const face = Platform.select(mono)

/**
 * THE DOWNLOADS ADDRESS, AND A TAP COPIES IT.
 *
 * "Is it possible to make the computer link able to just be copied if they
 * tap it? And then a confirmation that it was copied." A Mac on the same
 * Apple account pastes what the iPhone copied, and anybody can paste it into
 * an email to themselves.
 *
 * Copied, never opened: the page at the far end holds installers for a
 * computer, and a tap that opened it would start fetching one onto the phone
 * — which is why this was printed rather than pressable in the first place.
 * The copy carries https:// so it pastes as a link.
 *
 * On the walkthrough's "installed?" step and the phone's Connect screen.
 */
export default function CopyAddress({ size = font.body }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(`https://${DOWNLOADS_URL}`)
      tick()
      setCopied(true)
    } catch {
      /* Nothing to say: the address is on screen to read either way. */
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${DOWNLOADS_URL}. ${P6.copyHint}`}
      onPress={copy}
      style={({ pressed }) => ({
        gap: space.sm,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: copied ? color.signal : color.rule,
        backgroundColor: pressed ? color.panelHi : color.panel
      })}
    >
      {/* One line, shrunk to fit: it used to break as "download / s". */}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ color: color.silk, fontSize: size, fontFamily: face }}>
        {DOWNLOADS_URL}
      </Text>
      <Text style={{ color: copied ? color.signal : color.silkDim, fontSize: font.small, fontWeight: copied ? '700' : undefined }}>
        {copied ? P6.copied : P6.copyHint}
      </Text>
    </Pressable>
  )
}
