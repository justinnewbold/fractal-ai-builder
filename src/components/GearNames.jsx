import { useMemo, useState } from 'react'
import { GEAR_GROUPS, GEAR_TOTAL, searchAll } from '../lib/gearCatalog'

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
 * The rows are not buttons. There is nothing to choose here: it is a reference
 * sheet, and a row that highlights and depresses under a thumb promises an
 * action it does not have. Picking a model is the editor's job, where the same
 * two lines appear on a row that IS a button.
 */
export default function GearNames() {
  const [group, setGroup] = useState(GEAR_GROUPS[0]?.key || 'amp')
  const [query, setQuery] = useState('')

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
            <li className="gear-row" key={e.name}>
              <span className="type-row-name">{e.name}</span>
              {/*
                A model with nothing recorded says nothing. Four drives are in
                that position and a plausible guess about any of them would be
                read by somebody who owns the pedal.
              */}
              {e.gear ? <span className="type-row-gear">{e.gear}</span> : null}
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
