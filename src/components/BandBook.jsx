import { useCallback, useEffect, useState } from 'react'
import { forgetDesign, forgetDesigns, knownDesigns } from '../lib/bandBook'

/**
 * The band book, on a page.
 *
 * "How do I view the band book of saved artist and songs?" — there was no way.
 * The book filed every band-named design and answered for it silently on the
 * next request, and the only trace of it was "(from the band book)" in the
 * chat. This is the list: one row per note, the band, how many scenes it holds
 * and their names (which is where the songs live), which unit it was built on,
 * and when. Forget on a row throws that note away so the band is designed
 * fresh next time; Forget all empties the book.
 *
 * Read when the panel opens rather than kept live: the account half is one
 * request over the network, and the book changes once a design, not once a
 * second.
 */
export default function BandBook() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    setRows(await knownDesigns().catch(() => []))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const forget = async (row) => {
    setBusy(`${row.artist}:${row.songs}`)
    try {
      await forgetDesign(row.artist, row.songs)
      await load()
    } finally {
      setBusy(null)
    }
  }

  const forgetAll = async () => {
    setBusy('all')
    try {
      await forgetDesigns()
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (rows === null) return <p className="hint">Reading the book…</p>
  if (!rows.length) {
    return (
      <p className="hint">
        Nothing yet. Ask for a band by name — &ldquo;make a Metallica rig&rdquo; — and once the
        tone is designed it is written down here. The next time you name that band the tone is
        rebuilt from the book, with nothing sent to the model.
      </p>
    )
  }

  return (
    <section className="band-book">
      <p className="hint">
        Each band here is rebuilt from the book the next time you name it, at no cost. Forget one to
        have it designed fresh instead. Say &ldquo;fresh&rdquo; or &ldquo;different&rdquo; in the
        request to get past the book for one go.
      </p>
      <div className="log-body band-book-list">
        {rows.map((row) => {
          const scenes = (row.design?.scenes || []).map((s) => s.name).filter(Boolean)
          const key = `${row.artist}:${row.songs}`
          return (
            <div className="log-entry band-book-row" key={key}>
              <div className="log-line">
                <span className="log-summary band-book-name">{row.artist}</span>
                <span className="hint mono">
                  {row.songs} scene{row.songs === 1 ? '' : 's'}
                  {row.device ? ` · ${row.device}` : ''}
                  {row.at ? ` · ${new Date(row.at).toLocaleDateString()}` : ''}
                </span>
                <button className="chip" onClick={() => forget(row)} disabled={!!busy}>
                  {busy === key ? 'Forgetting…' : 'Forget'}
                </button>
              </div>
              {scenes.length ? <p className="hint band-book-scenes">{scenes.join(' · ')}</p> : null}
              {row.design?.summary ? <p className="hint band-book-why">{row.design.summary}</p> : null}
            </div>
          )
        })}
      </div>
      <div className="diag-actions">
        <button className="chip" onClick={forgetAll} disabled={!!busy}>
          {busy === 'all' ? 'Forgetting…' : 'Forget all'}
        </button>
        <span className="hint mono">
          {rows.length} band{rows.length === 1 ? '' : 's'}
        </span>
      </div>
    </section>
  )
}
