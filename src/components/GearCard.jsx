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
export default function GearCard({ entry, onBack }) {
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

  return (
    <div className="gear-card">
      <button type="button" className="setup-back" onClick={onBack}>
        &lsaquo; All models
      </button>
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
  )
}
