import { useState } from 'react'
import { Modal, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'

import { color, font, radius, space } from '../lib/theme'
import Note from './Note'
import Press from './Press'
import { normalizePairCode, pairCodeFromUrl, PAIR_LENGTH } from '../lib/pairing'
import { logDebug } from '../lib/debugLog'

/**
 * Reading the pairing code off the computer's screen instead of typing it.
 *
 * "Add a camera button on the initial opening screen where a user can scan the
 * QR code instead of manually entering a number."
 *
 * The Mac has shown a QR since the day pairing was written — it was made for
 * the hosted app on a laptop, and nothing on the phone could read it. So the
 * phone's own camera was the one thing in the room that could not use it.
 *
 * WHAT THE QR ACTUALLY CARRIES is the hosted app's address with the code in
 * the fragment: https://fractal.newbold.cloud/#pair=ABCD2345. So the scan is
 * read with the same pairCodeFromUrl the browser uses when somebody opens that
 * link — one rule for what a pairing link means, not a second one here that
 * could drift. A QR holding nothing but the bare code is taken too, because a
 * code is a code and refusing it would be arbitrary.
 */
export default function ScanCode({ open, onClose, onCode }) {
  const [permission, ask] = useCameraPermissions()
  /* The reader fires many times a second on the same square. Without this the
     screen would take one code and then go on taking it while it closed. */
  const [taken, setTaken] = useState(false)

  const close = () => {
    setTaken(false)
    onClose?.()
  }

  const read = ({ data }) => {
    if (taken) return
    const code = pairCodeFromUrl({ hash: String(data || ''), search: '' }) || normalizePairCode(data)
    if (!code) {
      /* Not said on screen. A camera pointed at a room sees barcodes on
         everything, and a sheet that complains about each one is a sheet you
         cannot hold still. The log keeps it for a scan that should have worked. */
      logDebug('pair', 'scanned something that is not a pairing code')
      return
    }
    setTaken(true)
    logDebug('pair', `scanned a ${code.length}-character code`)
    onCode?.(code)
    close()
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: color.ink }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: space.lg,
            gap: space.md
          }}
        >
          <Text style={{ color: color.silk, fontSize: font.title, fontWeight: '600' }}>Scan a code</Text>
          <Press label="Close" height={40} onPress={close} />
        </View>

        {/*
          Three states, and the middle one is the one that gets forgotten: a
          person who said no to the camera once is not asked again by the
          system, and a black rectangle with no explanation is what they would
          otherwise get for ever.
        */}
        {!permission ? (
          <View style={{ padding: space.lg }}>
            <Note>Starting the camera…</Note>
          </View>
        ) : !permission.granted ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Note>
              {permission.canAskAgain
                ? 'Fractal Remote needs the camera to read the code off your computer’s screen. Nothing is recorded or sent anywhere.'
                : 'The camera is turned off for Fractal Remote. Turn it on in Settings, or close this and type the code instead.'}
            </Note>
            {permission.canAskAgain ? <Press label="Allow the camera" tone="signal" onPress={ask} /> : null}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={taken ? undefined : read}
            />
            <View style={{ padding: space.lg, gap: space.sm }}>
              <Note>
                On the computer, open Fractal Remote and choose Set up phone remote. Point this at the
                square it shows.
              </Note>
              <Text style={{ color: color.silkFaint, fontSize: font.small, borderRadius: radius.sm }}>
                Or close this and type the {PAIR_LENGTH} characters underneath it.
              </Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  )
}
