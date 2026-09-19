import { useMemo, useState } from 'react'
import { GEAR_GROUPS, GEAR_TOTAL, searchAll } from '../lib/gearCatalog'
import GearCard from './GearCard'

/**
 * What every model on the unit really is.
 *
 * "Add an info page like this to settings listing the real life equivalents of
 * each amp and effects pedals."
 *
 * Fractal cannot print "Marshall JCM800" on a menu, so the unit says "Brit 800
 * 2204 High". Everybody who has played one for a year knows the translation and
 * nobody who unboxed one on Saturday does, and until now the app would only
 * tell you about the one model you already had open in the editor.
 *
 * The search reads BOTH columns, which is the difference between a sheet that
 * works and a list you scroll. The word somebody actually types is "tube
 * screamer" — the real name, which appears nowhere in the unit's own "T808 OD".
 * A search over the left-hand column alone would answer nothing for every query
 * a person really has.
 *
 * THE ROWS ARE BUTTONS, and they did not used to be. "There is nothing to
 * choose here, and a row that depresses under a thumb promises an action it
 * does not have" was the reasoning, and it was half right: there is nothing to
 * choose, but there is something to READ. The photographs and the descriptions
 * existed the whole time and were reachable from exactly one place — the panel
 * inside the block editor, for the model already chosen, which is the one
 * model nobody is wondering about.
 *
 * "Still not seeing any amp cab and pedal photos or descriptions. Should be
 * able to tap on the card and open a detailed page like this." So a row opens
 * the model's own page. Picking a model is still the editor's job; this is the
 * reference, and a reference you can open is worth more than one you can only
 * scan.
 */
export default function GearNames() {
  const [group, setGroup] = useState(GEAR_GROUPS[0]?.key || 'amp')
  const [query, setQuery] = useState('')
  /*
   * Which model is open, held as the whole entry rather than a name.
   *
   * A name alone cannot be looked up: the description and the photograph are
   * per block kind, and "Brit JVM" means nothing without knowing it came from
   * the amp list. The row already has both, so it hands over both.
   */
  const [open, setOpen] = useState(null)

  /*
   * Every group is searched, not just the open one. The counts on the tabs are
   * what a search is steered by: typing "tube screamer" with Amps open finds
   * nothing here, and the five answers are one tap away in Drives — which the
   * tabs can only say if they are counting hits rather than contents.
   */
  const groups = useMemo(() => searchAll(query), [query])
  const current = groups.find((g) => g.key === group) || groups[0]
  const searching = query.trim().length > 0
  const elsewhere = searching ? groups.filter((g) => g.key !== current?.key && g.hits.length) : []

  if (!current) return null

  /*
   * The page replaces the list rather than sitting under it. Setup's own rows
   * work this way — "when you go deeper into the settings menu have swiping
   * down or clicking the X take you back to the settings menu" — and the
   * search, the tabs and the scroll position are all still here underneath,
   * so coming back lands where you left.
   */
  if (open) return <GearCard entry={open} onBack={() => setOpen(null)} />

  return (
    <div className="gear-names">
      <p className="hint">
        The unit&rsquo;s name for a model, and the real amp or pedal it was modelled on &mdash;{' '}
        {GEAR_TOTAL} of them. From Yek&rsquo;s guide to the amp models and Fractal&rsquo;s own
        blocks guide. Models Fractal designed themselves say so rather than borrowing a name.
      </p>

      <input
        type="search"
        className="gear-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="JCM800, Tube Screamer, Recto&hellip;"
        aria-label="Search the model names and the gear behind them"
      />

      {/*
        The counts are on the chips on purpose, and they follow the search.
        Three of these lists are small, so a tab that turns out to hold three
        rows is better said before it is tapped than after — and mid-search the
        count is the only thing that says which tab the answers are in.
      */}
      <div className="gear-tabs" role="group" aria-label="Which models to show">
        {groups.map((g) => (
          <button
            key={g.key}
            className={`chip${g.key === current.key ? ' active' : ''}`}
            aria-pressed={g.key === current.key}
            onClick={() => setGroup(g.key)}
          >
            {g.label} <span className="gear-count">{searching ? g.hits.length : g.entries.length}</span>
          </button>
        ))}
      </div>

      {current.hits.length ? (
        <ul className="gear-list">
          {current.hits.map((e) => (
            <li key={e.name}>
              <button type="button" className="gear-row" onClick={() => setOpen(e)}>
                <span className="type-row-name">{e.name}</span>
                {/*
                  A model with nothing recorded says nothing. Four drives are
                  in that position and a plausible guess about any of them
                  would be read by somebody who owns the pedal.
                */}
                {e.gear ? <span className="type-row-gear">{e.gear}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        /*
          Name the tab that has them. "Nothing here, try another one" makes
          somebody tap all four; the counts above already say where the answers
          are, and this says it in words for whoever did not read them.
        */
        <p className="hint">
          Nothing in {current.label.toLowerCase()} matches &ldquo;{query.trim()}&rdquo;.
          {elsewhere.length
            ? ` Try ${elsewhere.map((g) => g.label + ' (' + g.hits.length + ')').join(' or ')}.`
            : ' Nothing in the other lists either.'}
        </p>
      )}
    </div>
  )
}
