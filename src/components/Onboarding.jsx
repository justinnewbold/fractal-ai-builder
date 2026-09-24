import { useEffect, useState } from 'react'

import { CHAIN, D1, D2, D2B, D3, D4, D5 } from '../../shared/onboarding.mjs'
import { firmwareOf } from '../../shared/firmware.mjs'
import { slotCount } from '../lib/slots'
import { Cta, Steps, TipCard } from './Walk'
import playIcon from '../../mobile/assets/icons/play.png'
import slidersIcon from '../../mobile/assets/icons/sliders.png'
import saveIcon from '../../mobile/assets/icons/save.png'
import tunerIcon from '../../mobile/assets/icons/tuner.png'
import laptopIcon from '../../mobile/assets/icons/laptop.png'

/* The cards' pictures, in the phone's walkthrough style (see Walk.jsx). */
const ICONS = { stage: playIcon, rack: tunerIcon, anywhere: laptopIcon, play: playIcon, edit: slidersIcon, save: saveIcon }

/**
 * The first minute, on the machine that holds the cable.
 *
 * This replaces the old tour outright, and the difference is not the words —
 * it is what the screen is FOR. The tour explained the app to somebody who
 * had not touched it: what a scene is, where a change goes, four cards of
 * concepts before anything was plugged in. This walks through the three
 * things that have to be TRUE before the app can do anything at all, and then
 * gets out of the way.
 *
 * IT REPORTS, IT DOES NOT PRETEND. Every line that claims something is wired
 * to the thing it claims. The unit step names what actually answered on the
 * USB port and counts the slots that unit really has; the pairing step shows
 * the real code and moves itself on when a phone actually arrives. The one
 * moment this screen exists for is the moment somebody is deciding whether
 * this app works, and a walkthrough that says "FM3 found" with nothing
 * plugged in has answered that question for them.
 *
 * NOT ONE WORD OF IT IS TYPED HERE. Every string comes from
 * shared/onboarding.mjs — "do not change any wording without asking me
 * first", and copy living in a component is copy that gets tidied by
 * accident.
 */
const KEY = 'fab.onboarded.v1'

export const onboarded = () => {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    /* A browser refusing storage would otherwise meet this every load.
       Assuming it has been seen is the kinder of the two failures. */
    return true
  }
}

export const markOnboarded = () => {
  try {
    localStorage.setItem(KEY, 'done')
  } catch {
    /* Costs the next load, and nothing else. */
  }
}

export default function Onboarding({
  open,
  onClose,
  /** What the USB port actually answered, or null. */
  device,
  /** 'live' when the unit is talking. */
  status,
  /** Why a read failed: 'no-unit' | 'no-answer' | 'unreadable' | null. */
  faultReason,
  /** The relay's view — role, link, account. */
  link,
  /** Ask the computer to look for the unit again. */
  onLookAgain,
  /** Open this computer's sign-in — what step 3 asks for. */
  onSignIn,
  /**
   * Where to open. The computer's welcome is the phone-style one now
   * (PhoneWalkthrough, `computer`), and "Use it here" there hands over to
   * these steps at the unit — so they open at 'unit', not at their own
   * welcome.
   */
  start = 'welcome',
  /** Whether the account signed in here has the unlock, once known: true, false or null. */
  paid = null,
  /** Open the unlock — offered on step 3 to an account signed in without it. */
  onUnlock
}) {
  const [at, setAt] = useState(start)

  /* Back to the start when it is asked for again from Settings. Reopening on
     the last screen is a small thing that makes it feel broken. */
  useEffect(() => {
    if (open) setAt(start)
  }, [open, start])

  const paired = link?.link === 'connected'

  /*
   * The pairing step finishes itself.
   *
   * Nobody should have to press Next after the phone has already connected:
   * they are holding the phone, looking at the phone, and this screen has
   * already told them it worked.
   */
  useEffect(() => {
    if (open && at === 'pair' && paired) setAt('done')
  }, [open, at, paired])

  if (!open) return null

  const finish = () => {
    markOnboarded()
    onClose()
  }

  const found = status === 'live' && !!device
  const unitName = device?.short || device?.name || null
  /*
   * "Something else has the USB port" is a different screen from "nothing is
   * plugged in", and telling them apart is most of the value here. A computer
   * that can see something but gets no answer out of it is almost always
   * FM3-Edit holding the port — which is a thing to go and fix, where "plug it
   * in" is not.
   */
  const stuck = !found && (faultReason === 'no-answer' || faultReason === 'unreadable')

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label={D1.eyebrow}>
      <div className="onb-sheet">
        {at === 'welcome' ? (
          <>
            <p className="onb-eyebrow mono">{D1.eyebrow}</p>
            <h1 className="onb-head">{D1.head}</h1>
            <p className="onb-sub">{D1.sub}</p>
            <div className="onb-chain">
              {CHAIN.map((box) => (
                <div key={box.key} className="onb-link">
                  <div className={box.note === 'YOU ARE HERE' ? 'onb-box here' : 'onb-box'}>
                    <span className="onb-badge" aria-hidden="true">
                      {box.badge}
                    </span>
                    <p className="onb-n mono">
                      {box.n}
                      {box.note ? ` · ${box.note}` : ''}
                    </p>
                    <p className="onb-box-title">{box.title}</p>
                    <p className="hint">{box.body}</p>
                  </div>
                  {box.wire ? <span className="onb-wire mono">{box.wire}</span> : null}
                </div>
              ))}
            </div>
            <p className="onb-note">{D1.foot}</p>
            <div className="onb-acts">
              <Cta label={D1.go} onClick={() => setAt('unit')} />
              <button className="chip" onClick={finish}>
                {D1.skip}
              </button>
            </div>
          </>
        ) : null}

        {at === 'unit' ? (
          <>
            <Steps at={0} of={3} label={stuck ? D2B.step : D2.step} />
            <h1 className="onb-head">{stuck ? D2B.head : D2.head}</h1>
            <p className="onb-sub">{stuck ? D2B.sub : D2.sub}</p>

            {/*
              The real answer from the real port, or nothing at all. `device`
              is what came back from the unit, so this cannot name an FM3 when
              nothing is connected — the one lie that would matter here.
            */}
            {found ? (
              <div className="onb-found">
                <p className="onb-found-name">{D2.found(unitName)}</p>
                <p className="hint mono">
                  {D2.detail({
                    firmware: firmwareOf(device),
                    presets: slotCount(device?.capabilities)
                  })}
                </p>
              </div>
            ) : null}

            {stuck ? (
              <div className="onb-help">
                <p className="onb-box-title">{D2B.title}</p>
                <ol className="onb-list">
                  {D2B.steps
                    .map((line) => (typeof line === 'function' ? line(unitName) : line))
                    .map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                </ol>
              </div>
            ) : found ? null : (
              <div className="onb-help">
                <p className="onb-box-title">{D2.helpTitle}</p>
                <p className="hint">{D2.helpBody}</p>
              </div>
            )}

            <div className="onb-acts">
              {found ? (
                <Cta label={D2.next} onClick={() => setAt('phone')} />
              ) : (
                <Cta label={D2B.again} onClick={() => onLookAgain?.()} />
              )}
              <button className="chip" onClick={() => setAt('phone')}>
                {stuck ? D2B.without : D2.later}
              </button>
            </div>
          </>
        ) : null}

        {at === 'phone' ? (
          <>
            <Steps at={1} of={3} label={D3.step} />
            <h1 className="onb-head">{D3.head}</h1>
            <p className="onb-sub">{D3.sub}</p>
            <div className="onb-cards">
              {D3.why.map((why) => (
                <TipCard key={why.key} icon={ICONS[why.key]} label={why.label} body={why.body} />
              ))}
            </div>
            <p className="onb-note">{D3.note}</p>
            <div className="onb-acts">
              <Cta label={D3.pair} onClick={() => setAt('pair')} />
              <button className="chip" onClick={finish}>
                {D3.not}
              </button>
            </div>
            <p className="hint onb-foot">{D3.foot}</p>
          </>
        ) : null}

        {at === 'pair' ? (
          <>
            <Steps at={2} of={3} label={D4.step} />
            <h1 className="onb-head">{D4.head}</h1>
            <p className="onb-sub">{D4.sub}</p>
            {/*
              NO QR CODE HERE ANY MORE.

              "I want the QR code gone and the scanner gone. It has never
              worked once. Every time I've ever tried it, you tell me
              something different."

              This step drew the real one, off the same component Settings
              used, so there was one thing that knew how a phone got paired
              rather than two that could disagree. What it drew is gone: there
              is no pairing code to carry, and no camera at the other end to
              read it. Signing in on both ends is the whole of it.

              The line below still says what to expect of the phone, because
              this computer cannot check whether the app on it was bought —
              that lives on the phone's App Store account and nothing here can
              see it.
            */}
            <p className="onb-note">{D4.owned}</p>
            {link?.account?.email && paid === false ? (
              <p className="onb-note">{D4.notUnlocked(link.account.email)}</p>
            ) : (
              <p className="onb-waiting mono">{D4.waiting}</p>
            )}
            <p className="onb-note">{D4.note}</p>
            <div className="onb-acts">
              {/*
                The step says "Sign in on this computer." and, until now, gave
                nothing to sign in with — only Skip. The sign-in it means is
                the one Settings opens for the phone remote, so it is that one.
              */}
              {onSignIn && link?.link === 'signed-out' ? (
                <Cta label="Sign in" onClick={onSignIn} />
              ) : null}
              {/*
                SIGNED IN WITHOUT THE UNLOCK: say so, and offer it. The relay
                refuses an account that has not bought the phone remote, so
                "Waiting for your phone…" would wait for ever.
              */}
              {onUnlock && link?.account?.email && paid === false ? (
                <Cta label={D4.unlock} onClick={() => { finish(); onUnlock() }} />
              ) : null}
              <button className="chip" onClick={finish}>
                {D4.skip}
              </button>
            </div>
          </>
        ) : null}

        {at === 'done' ? (
          <>
            <Steps at={2} of={3} />
            <h1 className="onb-head">{D5.head}</h1>
            {/* Only what is actually true: no unit means the line says less
                rather than claiming one. */}
            <p className="onb-sub mono">{D5.status({ unit: unitName, phone: paired })}</p>
            <div className="onb-cards">
              {D5.tips.map((tip) => (
                <TipCard key={tip.key} icon={ICONS[tip.key]} label={tip.label} body={tip.body} />
              ))}
            </div>
            <div className="onb-acts">
              <Cta label={D5.go} onClick={finish} />
            </div>
            <p className="hint onb-foot">{D5.foot}</p>
          </>
        ) : null}

      </div>
    </div>
  )
}
