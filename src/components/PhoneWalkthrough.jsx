import { useEffect, useState } from 'react'

import { CHAIN, CLOSE, P1, P2, P3, P4, P9 } from '../../shared/onboarding.mjs'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/forgefx'
import { markOnboarded } from './Onboarding'
/* His own pictures, the phone's files — one copy of the artwork for both ends. */
import unitShot from '../../mobile/assets/unit-fm3.png'
import pieceUnit from '../../mobile/assets/piece-unit.png'
import pieceComputer from '../../mobile/assets/piece-computer.png'
import piecePhone from '../../mobile/assets/piece-phone.png'

const PIECES = { unit: pieceUnit, computer: pieceComputer, phone: piecePhone }

/**
 * THE PHONE APP'S WALKTHROUGH, for the browser on a phone.
 *
 * "We need to make sure we're on the same page as far as what the app does
 * and what the web app does… Go through all of the screens… make sure… that
 * the whole on boarding flow is set up properly. Everything's chaos."
 *
 * The browser has one walkthrough, and it is the computer's: "YOU ARE HERE ·
 * This computer", then "Plug your unit into this computer." Opened on a
 * phone, which is where fractal.newbold.cloud mostly is opened, that is the
 * wrong app's first screen. The phone app has its own — welcome, the three
 * pieces, the choice between the demo and the unlock — and this is that one,
 * step for step, from the same words (shared/onboarding.mjs, the file the
 * phone's copy is generated from) and the same pictures.
 *
 * WHAT DIFFERS, and only because a browser is not a phone app:
 *  - No "Restore purchase". Restoring asks Apple or Google, and there is
 *    neither here: a purchase follows the account, so signing in is the
 *    restore. The footnote keeps its other link, "Sign in".
 *  - Unlock opens the browser's unlock, which asks for the account first —
 *    a card taken here has to belong to one.
 *  - The demo starts with a reload, because which end this is was decided
 *    when the page loaded; the phone flips a switch.
 */
export default function PhoneWalkthrough({ open, replay = false, onClose, onAccount, onUnlock }) {
  const [at, setAt] = useState('welcome')
  const [unit, setUnit] = useState(UNITS[0].key)
  /* The box under Connect my real rig. Unlock stays grey until it is ticked. */
  const [agreed, setAgreed] = useState(false)

  /* Back to the start when it is asked for again from Settings. */
  useEffect(() => {
    if (open) setAt('welcome')
  }, [open])

  if (!open) return null

  const unitName = UNITS.find((u) => u.key === unit)?.name || UNITS[0].name
  const leave = (then) => {
    markOnboarded()
    onClose?.()
    then?.()
  }
  const intoDemo = () =>
    leave(() => {
      setDemoUnit(unit)
      setDemo(true)
      window.location.reload()
    })

  return (
    <div className="onb pw" role="dialog" aria-modal="true" aria-label={P1.head}>
      <div className="pw-sheet">
        {replay ? (
          <button type="button" className="chip pw-close" onClick={() => leave()}>
            {CLOSE}
          </button>
        ) : null}

        {at === 'welcome' ? (
          <>
            <h1 className="pw-head pw-hero">{P1.head}</h1>
            <p className="pw-sub">{P1.sub}</p>
            <button type="button" className="primary pw-go" onClick={() => setAt('how')}>
              {P1.go}
            </button>
            <button type="button" className="chip pw-go" onClick={() => leave(onAccount)}>
              {P1.haveCode}
            </button>
          </>
        ) : null}

        {at === 'how' ? (
          <>
            <Progress count={P2.count} at={0} of={2} />
            <h1 className="pw-head">{P2.head}</h1>
            <div className="pw-chain">
              {CHAIN.map((box, i) => (
                <div key={box.key}>
                  <div className="pw-box">
                    <span className="pw-n">{i + 1}</span>
                    <span className="pw-box-words">
                      <span className="pw-box-title">{box.phoneTitle}</span>
                      <span className="pw-box-body">{box.phoneBody}</span>
                    </span>
                    <img className="pw-art" src={PIECES[box.key] || PIECES.unit} alt="" />
                  </div>
                  {box.phoneWire ? (
                    <div className="pw-wire" aria-hidden="true">
                      <span className="pw-wire-line" />
                      <span className="pw-wire-label">{box.phoneWire}</span>
                      <span className="pw-wire-line" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="pw-note">{P2.foot}</p>
            {/* Held at the bottom of the screen while the boxes scroll under
                it, so a phone too short for the whole page still shows the
                way on. */}
            <button type="button" className="primary pw-go pw-stick" onClick={() => setAt('mode')}>
              {`${P2.go}  ›`}
            </button>
          </>
        ) : null}

        {at === 'mode' ? (
          <>
            <Progress count={P3.count} at={1} of={2} title={P3.title} />
            <h1 className="pw-head">{P3.head}</h1>
            <p className="pw-sub">{P3.sub}</p>

            {/* Two cards, and only one lit, as on the phone: the demo costs
                nothing and works this second; the real rig wants a computer
                and a purchase. */}
            <div className="pw-choice lit">
              <div className="pw-choice-top">
                <div className="pw-choice-words">
                  <p className="pw-choice-eyebrow">{P3.demo.eyebrow}</p>
                  <p className="pw-choice-title">{P3.demo.title}</p>
                  <p className="pw-choice-body">{P3.demo.body}</p>
                </div>
                <img className="pw-unit-shot" src={unitShot} alt="" />
              </div>
              <button type="button" className="primary pw-go" onClick={() => setAt('pick')}>
                {P3.demo.go}
              </button>
            </div>

            <div className="pw-choice">
              <div className="pw-choice-top">
                <div className="pw-choice-words">
                  <p className="pw-choice-eyebrow">{P3.real.eyebrow}</p>
                  <p className="pw-choice-title">{P3.real.title}</p>
                  <p className="pw-choice-body">{P3.real.body}</p>
                </div>
                <span className="pw-lock" aria-hidden="true" />
              </div>
              <label className="pw-agree">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{P3.real.agree}</span>
              </label>
              <button type="button" className="chip pw-go" disabled={!agreed} onClick={() => agreed && leave(onUnlock)}>
                {P3.real.go}
              </button>
            </div>

            <div className="pw-foot">
              <div className="pw-foot-q">
                <span className="pw-rule" />
                <span>{P3.already}</span>
                <span className="pw-rule" />
              </div>
              <button type="button" className="signin-link pw-link" onClick={() => leave(onAccount)}>
                {P3.signIn}
              </button>
            </div>
          </>
        ) : null}

        {at === 'pick' ? (
          <>
            <p className="pw-eyebrow">{P4.tag}</p>
            <p className="pw-eyebrow">{P4.eyebrow}</p>
            <h1 className="pw-head">{P4.head}</h1>
            <p className="pw-sub">{P4.sub}</p>
            <div className="pw-units">
              {UNITS.map((u) => (
                <button
                  type="button"
                  key={u.key}
                  className={`chip${u.key === unit ? ' active' : ''}`}
                  aria-pressed={u.key === unit}
                  onClick={() => setUnit(u.key)}
                >
                  {u.name}
                </button>
              ))}
            </div>
            <button type="button" className="primary pw-go" onClick={() => setAt('connected')}>
              {P4.go(unitName)}
            </button>
            <button type="button" className="chip pw-go" onClick={() => setAt('mode')}>
              {P4.back}
            </button>
          </>
        ) : null}

        {at === 'connected' ? (
          <>
            <p className="pw-eyebrow">{P9.tag(unitName)}</p>
            <h1 className="pw-head">{P9.demo.head}</h1>
            <p className="pw-sub">{P9.demo.status(unitName)}</p>
            {P9.tips.map((tip) => (
              <div className="pw-card" key={tip.key}>
                <p className="pw-card-label">{tip.label}</p>
                <p className="pw-card-body">{tip.body}</p>
              </div>
            ))}
            <button type="button" className="primary pw-go pw-stick" onClick={intoDemo}>
              {P9.go}
            </button>
            <p className="pw-note">{P9.foot}</p>
          </>
        ) : null}
      </div>
    </div>
  )
}

/* Bars rather than dots, as on the phone: a bar reads as ground covered. */
function Progress({ count, at, of, title }) {
  return (
    <div className="pw-progress">
      <div className="pw-progress-top">
        <span />
        {title ? <span className="pw-progress-title">{title}</span> : <span />}
        <span className="pw-count">{count}</span>
      </div>
      <div className="pw-bars">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={`pw-bar${i <= at ? ' on' : ''}`} />
        ))}
      </div>
    </div>
  )
}
