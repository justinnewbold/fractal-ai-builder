import { useEffect, useState } from 'react'

import { C3, CHAIN, CLOSE, P1, P2, P3, P4, P9 } from '../../shared/onboarding.mjs'
import { WELCOME_NOTICE } from '../../shared/affiliation.mjs'
import { UNITS } from '../lib/demoUnits'
import { setDemo, setDemoUnit } from '../lib/forgefx'
import { markOnboarded } from './Onboarding'
/* His own pictures, the phone's files — one copy of the artwork for both ends. */
import unitShot from '../../mobile/assets/unit-fm3.png'
/* His photograph of an FM3, sent for the first screen: "I included the photo
   of the fractal device separately". */
import welcomeShot from '../../mobile/assets/welcome/fm3.jpg'
/* And the five tile pictures cut from his mockup, the phone's same files. */
import featurePresets from '../../mobile/assets/welcome/presets.png'
import featureScenes from '../../mobile/assets/welcome/scenes.png'
import featureBlocks from '../../mobile/assets/welcome/blocks.png'
import featureTuner from '../../mobile/assets/welcome/tuner.png'
import featureTempo from '../../mobile/assets/welcome/tempo.png'
import pieceUnit from '../../mobile/assets/piece-unit.png'
import pieceComputer from '../../mobile/assets/piece-computer.png'
import piecePhone from '../../mobile/assets/piece-phone.png'
import playIcon from '../../mobile/assets/icons/play.png'
import slidersIcon from '../../mobile/assets/icons/sliders.png'
import saveIcon from '../../mobile/assets/icons/save.png'
import { Cta, FootRow, Steps, TipCard } from './Walk'

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
/*
 * AND FOR THE COMPUTER APP TOO, with `computer`.
 *
 * "It's not showing any unlock options, basically in the beginning… I didn't
 * see any demo options whatsoever… there needs to be a clear way to unlock it
 * from the beginning or try a demo or just use the Mac app without the phone…
 * make sure that the desktop apps have been updated with all of the new
 * features and icons and screens that we created for the phones, but it needs
 * to be desktop related."
 *
 * The same welcome and the same three pieces. At the choice the computer has
 * three cards (C3): use it here — which hands over to the computer's own
 * plug-in steps, `onHere` — the demo, and the phone remote's unlock.
 */
export default function PhoneWalkthrough({ open, replay = false, computer = false, onClose, onAccount, onUnlock, onHere }) {
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
    <div className={`onb pw${at === 'welcome' ? ' pw-at-welcome' : ''}`} role="dialog" aria-modal="true" aria-label={P1.head}>
      <div className="pw-sheet">
        {replay ? (
          <button type="button" className="chip pw-close" onClick={() => leave()}>
            {CLOSE}
          </button>
        ) : null}

        {/*
          THE FIRST SCREEN, FROM HIS MOCKUP. "Redo the initial landing page…
          use the mockup - keep it the same except remove the text 'official
          remote app'." The unit in a card, the heading, the line under it,
          the five things the app does as tiles, then the two ways in.
        */}
        {at === 'welcome' ? (
          <div className="pw-welcome">
            <div className="pw-welcome-shot">
              <img src={welcomeShot} alt="A Fractal Audio FM3" />
            </div>
            <h1 className="pw-welcome-head">{P1.head}</h1>
            <p className="pw-welcome-sub">{computer ? C3.welcomeSub : P1.sub}</p>
            <ul className="pw-features">
              {P1.features.map((label) => (
                <li key={label}>
                  <span className="pw-feature-tile" aria-hidden="true">
                    {/* White on clear, so a mask takes the theme's colour. */}
                    <span
                      className="pw-feature-picture"
                      style={{ WebkitMaskImage: `url(${FEATURE_PICTURES[label]})`, maskImage: `url(${FEATURE_PICTURES[label]})` }}
                    />
                  </span>
                  <span className="pw-feature-label">{label}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="primary pw-go pw-welcome-go" onClick={() => setAt('how')}>
              <span>{P1.go}</span>
              <span className="pw-welcome-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" className="chip pw-go" onClick={() => leave(onAccount)}>
              {P1.haveCode}
            </button>
            <p className="pw-welcome-notice">{WELCOME_NOTICE}</p>
          </div>
        ) : null}

        {at === 'how' ? (
          <>
            <Steps at={0} of={3} label={P2.count} />
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
            <Cta stick label={P2.go} onClick={() => setAt('mode')} />
          </>
        ) : null}

        {at === 'mode' ? (
          <>
            <Steps at={1} of={3} label={P3.count} />
            <h1 className="pw-head">{P3.head}</h1>
            <p className="pw-sub">{computer ? C3.sub : P3.sub}</p>

            {/* The computer's first card: it works on its own, free. */}
            {computer ? (
              <div className="pw-choice lit">
                <div className="pw-choice-top">
                  <div className="pw-choice-words">
                    <p className="pw-choice-eyebrow">{C3.here.eyebrow}</p>
                    <p className="pw-choice-title">{C3.here.title}</p>
                    <p className="pw-choice-body">{C3.here.body}</p>
                  </div>
                  <img className="pw-unit-shot" src={pieceComputer} alt="" />
                </div>
                <Cta label={C3.here.go} onClick={() => onHere?.()} />
              </div>
            ) : null}

            {/* Two cards, and only one lit, as on the phone: the demo costs
                nothing and works this second; the real rig wants a computer
                and a purchase. */}
            <div className={computer ? 'pw-choice' : 'pw-choice lit'}>
              <div className="pw-choice-top">
                <div className="pw-choice-words">
                  <p className="pw-choice-eyebrow">{P3.demo.eyebrow}</p>
                  <p className="pw-choice-title">{P3.demo.title}</p>
                  <p className="pw-choice-body">{computer ? C3.demoBody : P3.demo.body}</p>
                </div>
                <img className="pw-unit-shot" src={unitShot} alt="" />
              </div>
              {computer ? (
                <button type="button" className="chip pw-go" onClick={() => setAt('pick')}>
                  {P3.demo.go}
                </button>
              ) : (
                <Cta label={P3.demo.go} onClick={() => setAt('pick')} />
              )}
            </div>

            <div className="pw-choice">
              <div className="pw-choice-top">
                <div className="pw-choice-words">
                  <p className="pw-choice-eyebrow">{computer ? C3.phone.eyebrow : P3.real.eyebrow}</p>
                  <p className="pw-choice-title">{computer ? C3.phone.title : P3.real.title}</p>
                  <p className="pw-choice-body">{computer ? C3.phone.body : P3.real.body}</p>
                </div>
                <span className="pw-lock" aria-hidden="true" />
              </div>
              <label className="pw-agree">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{P3.real.agree}</span>
              </label>
              <button type="button" className="chip pw-go" disabled={!agreed} onClick={() => agreed && leave(onUnlock)}>
                {computer ? C3.phone.go : P3.real.go}
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
            <Steps at={1} of={3} label={P3.count} />
            <p className="pw-eyebrow">{P4.eyebrow}</p>
            <h1 className="pw-head">{P4.head}</h1>
            <p className="pw-sub">{P4.sub}</p>
            <div className="walk-units">
              {UNITS.map((u) => (
                <button
                  type="button"
                  key={u.key}
                  className={`walk-unit${u.key === unit ? ' on' : ''}`}
                  aria-pressed={u.key === unit}
                  onClick={() => setUnit(u.key)}
                >
                  {u.name}
                </button>
              ))}
            </div>
            <Cta label={P4.go(unitName)} onClick={() => setAt('connected')} />
            <button type="button" className="chip pw-go" onClick={() => setAt('mode')}>
              {P4.back}
            </button>
          </>
        ) : null}

        {at === 'connected' ? (
          <>
            {/* His "Here's the app" mockup, which every page now copies.
                The unit's name came off the top for the one sentence that
                matters: the app needs a computer with the unit on USB. The
                foot row says where the walkthrough lives afterwards; the
                browser reloads into the demo, so it has nowhere to go. */}
            <Steps at={2} of={3} label={P9.count} />
            <h1 className="pw-head">{P9.demo.head}</h1>
            <p className="pw-sub">{P9.demo.sub}</p>
            {P9.tips.map((tip) => (
              <TipCard key={tip.key} icon={TIP_ICONS[tip.key]} label={tip.label} body={tip.body} onClick={intoDemo} />
            ))}
            <Cta stick label={P9.go} onClick={intoDemo} />
            <FootRow text={P9.foot} />
          </>
        ) : null}
      </div>
    </div>
  )
}

/* The three cards' pictures, by tip. */
const TIP_ICONS = { play: playIcon, edit: slidersIcon, save: saveIcon }

const FEATURE_PICTURES = {
  PRESETS: featurePresets,
  SCENES: featureScenes,
  BLOCKS: featureBlocks,
  TUNER: featureTuner,
  'TAP TEMPO': featureTempo
}
