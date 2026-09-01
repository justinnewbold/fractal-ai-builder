import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { servedLocally, getHost } from '../lib/forgefx'

/**
 * How the phone gets here — the short way.
 *
 * There are two routes and they are not equal. On the same wifi, the phone
 * opens the address this page is already being served from and it simply
 * works: no account, no sign-in, nothing to install. The relay is for the
 * other case, reaching the rig from a different network, and it costs an
 * account on both ends.
 *
 * For a long time only the second one existed, because of a browser rule: an
 * HTTPS page may call http://localhost but not http://10.0.0.x. So the hosted
 * app on a phone could never reach the unit, and a relay was the way round it.
 * Serving the page from ForgeFX removes the rule from the picture entirely.
 *
 * Which of the two is offered here depends on where this page came from, since
 * that is exactly what decides whether the short way is available at all.
 */
export default function PhoneSetup() {
  const local = servedLocally()
  const url = local ? window.location.origin : null
  const [qr, setQr] = useState(null)

  useEffect(() => {
    if (!url) return undefined
    let alive = true
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#0d0f12', light: '#ffffff' } })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [url])

  if (!local) {
    /*
     * Served from the web. The phone cannot reach the unit from here at all —
     * so rather than a QR code that would not work, say what does, and what it
     * would take.
     */
    return (
      <section className="phone-setup">
        <p className="hint">
          This page came from the web, so your phone can&rsquo;t reach the unit directly from it —
          browsers don&rsquo;t allow a secure page to call a machine on your own network.
        </p>
        <p className="hint">
          For the simplest route, run <span className="mono">npm run serve</span> on the computer
          with the cable. It serves this app from there, and any phone on the same wifi opens it
          with nothing to sign into. Otherwise, use the relay below to reach your rig from
          anywhere.
        </p>
      </section>
    )
  }

  return (
    <section className="phone-setup">
      <p className="hint">
        Same wifi, nothing to sign into &mdash; open this on your phone:
      </p>
      {qr ? <img className="phone-qr" src={qr} alt={`QR code for ${url}`} width={160} height={160} /> : null}
      <p className="phone-url mono">{url}</p>
      <p className="hint">
        Add it to your home screen and it opens like an app. The device is at{' '}
        <span className="mono">{getHost()}</span>.
      </p>
    </section>
  )
}
