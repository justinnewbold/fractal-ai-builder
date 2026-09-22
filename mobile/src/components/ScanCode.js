import { useEffect, useState } from 'react'
import { Modal, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { color, font, radius, space } from '../lib/theme'
import Note from './Note'
import Press from './Press'
import { looksLikeTheAccountSquare, normalizePairCode, pairCodeFromUrl, PAIR_LENGTH } from '../lib/pairing'
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
 *
 * THE COMPUTER SHOWS TWO SQUARES AND ONLY ONE OF THEM IS FOR THIS APP, which
 * is the thing that made this screen look broken. "Android phone scanner
 * doesn't work. It pulls up the camera and everything fine, but nothing scans
 * the QR code when it's in the viewfinder. It does nothing."
 *
 * The computer's page shows a "same wifi" square carrying its own address —
 * http://192.168.x.x:5056 — under the words "point your phone's camera at
 * this". That one is meant for the phone's BROWSER, which then loads the app
 * from the computer directly. This app cannot use it: every call it makes goes
 * through the relay, and it has no idea what to do with an address on a local
 * network. So it read that square perfectly, found no pairing code in it, and
 * said nothing at all — which is indistinguishable from a camera that is not
 * scanning.
 *
 * Silence was deliberate and was wrong. The reasoning was that a camera
 * pointed at a room sees barcodes on everything and a sheet that complains
 * about each one cannot be held still. True — but this reader is restricted to
 * QR codes, rooms are not full of those, and somebody deliberately aiming at a
 * square has earned an answer. So an unreadable square now says so, and the
 * one square people actually aim at by mistake is named specifically.
 */
/*
 * MY WORDING, NOT HIS — both of these lines are new and nobody has approved
 * them. They are here beside the other two the scanner says rather than in
 * the copy file, because they are answers to a square rather than steps in
 * the walkthrough. Easy to change.
 */
const ACCOUNT_SQUARE =
  'That QR code is for signing in, not for pairing. This computer uses an account, so there is no pairing code to scan — sign in with the same email it is signed in with.'
const ACCOUNT_GO = 'Sign in with an account instead'

export default function ScanCode({ open, onClose, onCode, onAccount }) {
  /*
   * A MODAL IS OUTSIDE THE APP'S SAFE AREA, which is the whole of "the close
   * button at the top right is overlaying with the iPhone screen".
   *
   * App.js wraps the app in a SafeAreaView, so every ordinary screen already
   * starts below the notch. A Modal is its own window and hangs off the root
   * rather than off that view, so this sheet alone began at pixel zero — with
   * Close under the battery icon and "Scan a code" behind the camera cutout.
   *
   * The insets are read here rather than wrapping this in another SafeAreaView
   * so the camera can still fill the screen edge to edge: only the chrome
   * moves, and the preview stays as big as the glass.
   */
  const inset = useSafeAreaInsets()
  const [permission, ask] = useCameraPermissions()
  /* The reader fires many times a second on the same square. Without this the
     screen would take one code and then go on taking it while it closed. */
  const [taken, setTaken] = useState(false)
  /* What to say about a square that was read and cannot be used. Null until
     something is actually wrong, so the sheet opens quiet. */
  const [trouble, setTrouble] = useState(null)

  /* Cleared on open rather than on close, so a complaint from last time is not
     the first thing the next scan shows. */
  useEffect(() => {
    if (open) {
      setTaken(false)
      setTrouble(null)
    }
  }, [open])

  const close = () => {
    setTaken(false)
    setTrouble(null)
    onClose?.()
  }

  const read = ({ data }) => {
    if (taken) return
    const code = pairCodeFromUrl({ hash: String(data || ''), search: '' }) || normalizePairCode(data)
    if (!code) {
      logDebug('pair', 'scanned something that is not a pairing code')
      /*
       * THE ACCOUNT SQUARE IS NOT A MISTAKE, which is why it is answered
       * first and answered differently.
       *
       * "So scanning a code doesn't even work." It read the square fine. What
       * it then said was "use the square with letters and numbers under it" —
       * and a computer signed into an account HAS NO SUCH SQUARE, because the
       * account is what joins the two. So the app sent him looking for a
       * thing it had itself decided not to draw.
       *
       * Nothing was aimed at wrongly here: that square is the right one for
       * that computer, and this is the wrong door for it. So this one gets a
       * way through rather than a correction.
       */
      if (looksLikeTheAccountSquare(data)) {
        setTrouble({ text: ACCOUNT_SQUARE, account: true })
        return
      }
      setTrouble({
        text: looksLikeTheWifiSquare(data)
          ? 'That is the “same wifi” QR code, which is for a web browser. This app needs the pairing code — on the computer it is the QR code with letters and numbers written under it.'
          : 'That QR code does not hold a pairing code. On the computer, choose Set up phone remote and use the QR code with letters and numbers under it.'
      })
      return
    }
    setTaken(true)
    setTrouble(null)
    logDebug('pair', `scanned a ${code.length}-character code`)
    onCode?.(code)
    close()
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
      {/*
        THE CHASSIS COLOUR, NOT `color.ink` — there is no such colour in the
        palette and there never was, so this read `undefined` and the sheet
        fell back to the system's own background. White, behind cream
        lettering, which is why the heading on this screen could barely be
        read at all while every other screen was black.
      */}
      <View style={{ flex: 1, backgroundColor: color.chassis }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: space.lg,
            paddingTop: inset.top + space.lg,
            gap: space.md,
            /* Opaque and ruled off: the camera preview is a native view and
               will happily draw under anything that is not. */
            backgroundColor: color.chassis,
            borderBottomWidth: 1,
            borderBottomColor: color.rule
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
            {/*
              Mounted only while the sheet is up.
              
              A Modal on Android is its own window, and a camera left mounted
              behind a hidden one is a camera attached to nothing — it comes
              back showing a preview and never delivering a scan. Rendering it
              on `open` means every visit gets a camera that was started while
              something was actually on screen.
            */}
            {open ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={taken ? undefined : read}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <View
              style={{
                padding: space.lg,
                /* Clear of the home indicator, which sat across this line. */
                paddingBottom: inset.bottom + space.lg,
                gap: space.sm,
                backgroundColor: color.chassis
              }}
            >
              {trouble ? (
                <Note tone="warn" onDismiss={() => setTrouble(null)}>
                  {trouble.text}
                </Note>
              ) : null}
              {/*
                A door, not just an explanation. The computer told this person
                to scan, they scanned, and the answer is that their computer
                uses the other route — so the other route is one press away
                rather than something to go and find.
              */}
              {trouble?.account && onAccount ? (
                <Press
                  label={ACCOUNT_GO}
                  tone="signal"
                  onPress={() => {
                    close()
                    onAccount()
                  }}
                />
              ) : null}
              <Note>
                On the computer, open Fractal Remote and choose Set up phone remote. Point this at the
                QR code it shows.
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

/**
 * The computer's OTHER square: its own address on the local network.
 *
 * Recognised by shape rather than by a list of addresses — anything that is a
 * plain http(s) URL with no pairing code in it, pointing at a private address
 * or a .local name, is that square or something very like it. Worth naming
 * precisely because it is the one somebody holds the phone up to first: it is
 * the one the computer captions "point your phone's camera at this".
 */
export function looksLikeTheWifiSquare(text) {
  const s = String(text || '').trim()
  if (!/^https?:\/\//i.test(s)) return false
  if (/pair=/i.test(s)) return false
  return /(^https?:\/\/)(localhost|[\w-]+\.local|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s)
}
