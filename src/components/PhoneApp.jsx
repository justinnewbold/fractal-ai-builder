import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { STORES, anyStoreLive } from '../../shared/stores.mjs'

/**
 * How to get the app on your phone, from the computer that cannot sell it.
 *
 * "Have it say unlock to use on your phone, then give them instructions on
 * how to download it from the App Store or Google Play Store. Maybe even QR
 * codes that they can scan to go directly to the store."
 *
 * A QR CODE EARNS ITS PLACE HERE AND ALMOST NOWHERE ELSE. This page is read
 * on a computer, and the thing it is asking you to do happens on a phone —
 * you cannot tap a link on a Mac with an iPhone. The square is the only
 * bridge between the two, and this app already uses one for pairing, so it is
 * a gesture people meet here twice rather than a novelty.
 *
 * WHAT THIS PAGE CANNOT DO IS TAKE MONEY, and it says so rather than leaving
 * somebody hunting for a Buy button. The unlock is an in-app purchase, which
 * means Apple's and Google's, which means it happens inside the phone app and
 * nowhere else. This computer app is free and always will be: it is the thing
 * holding the cable, and charging for both ends would be charging twice for
 * one rig.
 *
 * AND IT DRAWS NOTHING IT CANNOT DELIVER. Both store addresses exist and both
 * answer 404 until each app is published. A square leading to a 404 is worse
 * than no square, because somebody has to fetch their phone and aim it to
 * find that out. See shared/stores.mjs: `live` is the one thing that changes
 * on the day each store opens.
 */
function StoreCard({ store }) {
  const [qr, setQr] = useState(null)

  useEffect(() => {
    if (!store.live) return undefined
    let alive = true
    QRCode.toDataURL(store.url, {
      margin: 1,
      width: 320,
      color: { dark: '#0d0f12', light: '#ffffff' }
    })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [store.live, store.url])

  return (
    <div className="phone-store">
      <h4>{store.name}</h4>
      {store.live ? (
        <>
          {qr ? (
            <img className="phone-store-qr" src={qr} alt={`Scan to open ${store.store}`} width={160} height={160} />
          ) : (
            <div className="phone-store-qr placeholder" aria-hidden="true" />
          )}
          <p className="hint">Point your phone&rsquo;s camera at the QR code.</p>
          <a className="chip" href={store.url} target="_blank" rel="noreferrer">
            Open {store.store}
          </a>
        </>
      ) : (
        /* Named rather than hidden: somebody on the wrong phone should learn
           that today, not wonder whether the page is broken. */
        <p className="hint">
          Coming soon to the {store.store}.
        </p>
      )}
    </div>
  )
}

export default function PhoneApp() {
  return (
    <>
      <p className="hint">
        This computer holds the cable. The phone app is the remote &mdash; scenes, presets,
        tempo and the tuner, from across a stage, with the screen staying awake.
      </p>

      <div className="phone-stores">
        {STORES.map((s) => (
          <StoreCard key={s.key} store={s} />
        ))}
      </div>

      {!anyStoreLive() ? (
        <p className="hint">
          Neither store is open yet. This page fills in on its own the day they are.
        </p>
      ) : null}

      <h4>What it costs</h4>
      <p className="hint">
        The app is a free download and the demo is free for as long as you want it. Driving a
        real rig from the phone is a one-off purchase, made inside the phone app &mdash; Apple
        and Google handle the payment, so it cannot be bought here.
      </p>
      <p className="hint">
        This computer app stays free. It is the thing holding the cable, and charging for both
        ends would be charging twice for one rig.
      </p>

      <h4>Once it is installed</h4>
      <p className="hint">
        Open <strong>Phone &amp; computer</strong> in Settings here. It shows a QR code the phone&rsquo;s
        camera can read, and that is the pairing done &mdash; no account, nothing to type.
      </p>
    </>
  )
}
