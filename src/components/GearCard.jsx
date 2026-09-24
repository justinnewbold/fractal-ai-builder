import { useEffect, useRef, useState } from 'react'
import { photoFor } from '../lib/gearPhotos'
import { descriptionFor, paragraphsOf, specsFor } from '../lib/lineage'

/**
 * One model, on a page of its own.
 *
 * "Still not seeing any amp cab and pedal photos or descriptions. Should be
 * able to tap on the card and open a detailed page like this."
 *
 * The photographs and the descriptions were written and then wired into
 * exactly one place: the panel inside the block editor, for the model already
 * chosen. Which is the one model nobody is wondering about. The reference
 * sheet in Setup — the whole point of which is "what have I got" — was a flat
 * two-column list whose rows were deliberately not buttons, on the reasoning
 * that there was nothing to choose. True, and beside the point: there was
 * something to READ, and no way to ask for it.
 *
 * So the rows are buttons now and this is what they open. Reading order, which
 * is also the order the questions come in: what does the unit call it, what is
 * it really, what is it like, what does it look like.
 *
 * THE CREDIT IS DRAWN IN THE SAME ELEMENT AS THE PHOTOGRAPH. Every one of
 * these is Creative Commons and naming the photographer is a condition of
 * showing it at all, so there is no arrangement of this component that draws
 * one without the other. photoFor hands back both together for that reason.
 */
/*
 * ONE MODEL AT A TIME, AND THE NEXT ONE A SWIPE OR AN ARROW AWAY.
 *
 * "Make it so swiping left or right on the screen takes you forward or
 * backwards to the next amp model. Also have little arrow buttons on each
 * side of the screen." The phone's gear page does it with the same words
 * (mobile/src/components/GearCard.js): the page follows the finger and
 * slides off as the next one comes in, the arrows do the same, and so do
 * the keyboard's left and right arrows. The list wraps round at both ends.
 */
const OUT_MS = 170
const IN_MS = 220

export default function GearCard({ entry, entries = [], onGo, onBack }) {
  const list = entries.length ? entries : entry ? [entry] : []
  const at = Math.max(0, list.findIndex((e) => e === entry || (e.name === entry?.name && e.slug === entry?.slug)))
  const many = list.length > 1
  const [dx, setDx] = useState(0)
  const [slide, setSlide] = useState(null)
  const touch = useRef(null)
  const box = useRef(null)
  const live = useRef({})
  live.current = { list, at, many, onGo, slide }

  const turn = (dir) => {
    const { list: l, at: i, many: m, onGo: go, slide: busy } = live.current
    if (!m || busy) return
    setSlide({ to: -dir * 100, ms: OUT_MS })
    setTimeout(() => {
      go?.(l[(i + dir + l.length) % l.length])
      setDx(0)
      setSlide({ to: dir * 100, ms: 0 })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSlide({ to: 0, ms: IN_MS })
          setTimeout(() => setSlide(null), IN_MS)
        })
      )
    }, OUT_MS)
  }

  useEffect(() => {
    const key = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowRight') turn(1)
      else if (e.key === 'ArrowLeft') turn(-1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!entry) return null
  const photo = photoFor(entry.name)
  const about = paragraphsOf(descriptionFor(entry.slug, entry.name))
  const specs = specsFor(entry.slug, entry.name)

  /*
   * Two verbs, because one sentence will not carry both. "Based on Mesa" is
   * not English — "based on" wants a thing — and an article does not rescue
   * it. "Modelled on Mesa" reads correctly for every maker in the catalog.
   */
  const lineage = entry.basedOn
    ? `Based on ${entry.basedOn}`
    : entry.manufacturer
      ? `Modelled on ${entry.manufacturer}`
      : entry.gear
        ? `Based on ${entry.gear}`
        : null

  const onTouchStart = (e) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, side: null }
  }
  const onTouchMove = (e) => {
    const t0 = touch.current
    if (!t0 || !many || slide) return
    const t = e.touches[0]
    const mx = t.clientX - t0.x
    const my = t.clientY - t0.y
    if (!t0.side && Math.abs(mx) > 12) t0.side = Math.abs(mx) > Math.abs(my) * 1.5 ? 'x' : 'y'
    if (t0.side === 'x') setDx(mx)
  }
  const onTouchEnd = () => {
    const t0 = touch.current
    touch.current = null
    if (!t0 || t0.side !== 'x') return
    const w = box.current?.offsetWidth || 360
    if (dx < -w * 0.22) turn(1)
    else if (dx > w * 0.22) turn(-1)
    else setDx(0)
  }
  const style = slide
    ? { transform: `translateX(${slide.to}%)`, transition: slide.ms ? `transform ${slide.ms}ms ease` : 'none' }
    : dx
      ? { transform: `translateX(${dx}px)`, transition: 'none' }
      : { transform: 'translateX(0)', transition: 'transform 200ms ease' }

  return (
    <div className="gear-card" ref={box} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="gear-card-top">
        <button type="button" className="setup-back" onClick={onBack}>
          &lsaquo; All models
        </button>
        {many ? <span className="hint">{`${at + 1} of ${list.length}`}</span> : null}
      </div>
      {many ? (
        <>
          <button
            type="button"
            className="gear-arrow left"
            aria-label={`Previous: ${list[(at - 1 + list.length) % list.length]?.name}`}
            onClick={() => turn(-1)}
          >
            &lsaquo;
          </button>
          <button
            type="button"
            className="gear-arrow right"
            aria-label={`Next: ${list[(at + 1) % list.length]?.name}`}
            onClick={() => turn(1)}
          >
            &rsaquo;
          </button>
        </>
      ) : null}
      <div className="gear-card-slide" style={style}>
      <p className="gear-card-name">{entry.name}</p>
      {lineage ? <p className="gear-card-gear">{lineage}</p> : null}

      {/*
        THE PICTURE FIRST, then the numbers, then the writing.

        The order is the order the questions arrive in, and it changed once it
        had a photograph to put in it: what it looks like is answered by a
        glance, and a paragraph above the photograph is a paragraph read
        before you know what you are reading about.
      */}
      {photo ? (
        <figure className="gear-photo">
          <img src={photo.src} alt={photo.alt} loading="lazy" />
          <figcaption className="hint">
            <a href={photo.rights} target="_blank" rel="noreferrer noopener">
              {photo.credit}
            </a>
          </figcaption>
        </figure>
      ) : null}

      {specs ? <p className="gear-specs">{specs}</p> : null}

      {/* As many paragraphs as were written. One sentence is an array of one,
          so everything already in the catalog draws exactly as it did. */}
      {about.map((para, i) => (
        <p className="hint gear-about" key={i}>
          {para}
        </p>
      ))}

      {/*
        Said rather than left as a blank space. About a quarter of the roster
        has a photograph and rather less has a description, and somebody who
        taps three models in a row and gets three different amounts of page
        needs to know that is the state of the catalog and not a fault. The
        rule it is obeying is the one lineage.js is built on: nothing
        invented, because a wrong attribution in a guitar app is worse than a
        blank one.
      */}
      {!about.length && !photo ? (
        <p className="hint">
          Nothing written down about this one yet. The catalog only
          holds what can be said for certain — a plausible guess would be read as fact by somebody
          who owns the real thing.
        </p>
      ) : null}
      </div>
    </div>
  )
}
