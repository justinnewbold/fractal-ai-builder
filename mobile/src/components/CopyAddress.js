import { useState } from 'react'
import { Image, Platform, Pressable, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { color, font, mono, radius, space } from '../lib/theme'
import { P6 } from '../lib/onboarding'
import { tick } from '../lib/feedback'
import { DOWNLOADS_URL } from '../lib/downloadLink'
import copyIcon from '../../assets/icons/copy.png'
import checkIcon from '../../assets/icons/check.png'

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
/*
 * `row` is the Connect a computer page's version, from his mockup: the
 * address in a box, one line, with a square copy button at its right end
 * that turns into a tick once it has copied. The card version stays for the
 * walkthrough, where the whole card is the button.
 */
export default function CopyAddress({ size = font.body, row = false }) {
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
  if (row) {
    return (
      <View style={{ gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${DOWNLOADS_URL}. ${P6.copyHint}`}
          onPress={copy}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingLeft: space.md,
            paddingRight: space.sm,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: copied ? color.signal : color.rule,
            backgroundColor: pressed ? color.panelHi : color.chassis
          })}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={{ flex: 1, color: color.silk, fontSize: size, fontFamily: face }}
          >
            {DOWNLOADS_URL}
          </Text>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: copied ? color.signal : color.panelHi
            }}
          >
            <Image
              source={copied ? checkIcon : copyIcon}
              style={{ width: 22, height: 22, tintColor: copied ? color.onSignal : color.signal }}
            />
          </View>
        </Pressable>
        {copied ? (
          <Text style={{ color: color.signal, fontSize: font.small, fontWeight: '700' }}>{P6.copied}</Text>
        ) : null}
      </View>
    )
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
