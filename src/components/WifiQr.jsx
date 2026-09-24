import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { inDesktopApp, wifiAddress } from '../lib/desktop'

/**
 * PLAYING WITH NO INTERNET, from the computer's end: its address as a QR code.
 *
 * "Would it be helpful to have a QR code in there for them to scan with their
 * phone to connect to their computer without Wi-Fi?" — and then "yes add the
 * QR code to the computer".
 *
 * The no-internet route is the phone's web browser on this computer's own
 * page, and the phone app's Setup already says so in words — including that
 * the address has to be typed. A phone's built-in camera reads a QR code and
 * opens it in the browser, so the code IS the route: no typing, and nothing
 * in the phone app has to touch a camera.
 *
 * Only in the computer app's own window. In a browser this page does not know
 * the computer's wifi address, and a code for the wrong address opens nothing.
 */
export default function WifiQr() {
  const [where, setWhere] = useState(null)
  const [qr, setQr] = useState(null)
  const here = inDesktopApp()

  useEffect(() => {
    if (!here) return undefined
    let alive = true
    wifiAddress().then((w) => alive && setWhere(w))
    return () => {
      alive = false
    }
  }, [here])

  useEffect(() => {
    if (!where?.lan) return undefined
    let alive = true
    QRCode.toDataURL(where.lan, {
      margin: 1,
      width: 320,
      color: { dark: '#0d0f12', light: '#ffffff' }
    })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [where?.lan])

  if (!here || !where) return null
  if (!where.lan) {
    return (
      <p className="hint">
        This computer is not on a wifi network right now. Join one, and the code for your phone
        appears here.
      </p>
    )
  }
  return (
    <div className="wifi-qr">
      <p className="hint">
        No internet in the room? Put your phone on the same wifi as this computer and point your
        phone&rsquo;s camera at this code. It opens in your phone&rsquo;s web browser, not the
        Fractal Remote app, and nothing goes near the internet.
      </p>
      {qr ? (
        <img className="phone-store-qr" src={qr} alt="Scan to open this computer on your phone" width={160} height={160} />
      ) : (
        <div className="phone-store-qr placeholder" aria-hidden="true" />
      )}
      <p className="hint">
        Or type <strong className="mono">{where.lan}</strong> into the phone&rsquo;s browser.
      </p>
      <p className="hint">
        What you change there is kept by that browser rather than in your account.
      </p>
    </div>
  )
}
