/* Generated from src/lib/editPages.js by scripts/sync-relay-rules.mjs.
 * Do not edit. Change the source and run `npm run sync:rules`; the test suite
 * fails on any difference between the two. */

/**
 * EDIT'S PAGES, the way Fractal's own editor splits a block.
 *
 * "Splitting EDIT's long list of controls into pages, like Fractal's own
 * editor." The unit already says what those pages are: a block's params read
 * carries `layout` — the editor's pages, each a set of rows of controls, each
 * control naming the parameter it turns — on the four units that ship one
 * (FM3, FM9, Axe-Fx III, AM4). A Drive reads Basic, Tone, Graphic EQ,
 * Advanced; an Amp reads Authentic, Ideal, Preamp, Power Amp and on.
 *
 * Before this the list was cut after six controls into Main and More, which
 * put an amp's Presence three pages of scrolling away from its Bass.
 *
 * WHAT GOES ON A PAGE: the controls in its `parameters` rows that this app
 * draws as knobs — `editable` is already the list with levels taken out, and
 * a control the list does not have (a switch, a dropdown, a spacer) is left
 * out rather than drawn as something it is not. A control the editor shows on
 * two pages is on both here too, which is what somebody who knows the editor
 * expects to find.
 *
 * WHAT DOES NOT: the `mixer` rows. The editor repeats Mix and Balance under
 * every page; here they, and anything the layout never places, go on one
 * last page, More, so nothing the unit sent is unreachable.
 *
 * AND WITHOUT A LAYOUT — the older units, or a block the editor has none for
 * — it is the old split, six and the rest.
 */
export const FIRST_PAGE = 6

export function editPages(editable, layout) {
  const byId = new Map((editable || []).map((p) => [p.id, p]))
  const placed = new Set()
  const pages = []
  for (const page of layout?.pages || []) {
    const params = []
    for (const row of page?.rows || []) {
      if (row?.section !== 'parameters') continue
      for (const control of row.controls || []) {
        const p = byId.get(control?.paramId)
        if (!p || params.includes(p)) continue
        params.push(p)
        placed.add(p.id)
      }
    }
    if (params.length) pages.push({ key: `page-${pages.length}`, name: page.name || `Page ${pages.length + 1}`, params })
  }

  if (!pages.length) {
    const main = (editable || []).slice(0, FIRST_PAGE)
    const more = (editable || []).slice(FIRST_PAGE)
    return more.length
      ? [
          { key: 'main', name: 'Main', params: main },
          { key: 'more', name: 'More', params: more }
        ]
      : [{ key: 'main', name: 'Main', params: main }]
  }

  const left = editable.filter((p) => !placed.has(p.id))
  if (left.length) pages.push({ key: 'more', name: 'More', params: left })
  return pages
}

/** The page a tab key names, or the first one when the pages have changed under it. */
export const pageFor = (pages, key) => pages.find((p) => p.key === key) || pages[0]

/** The first page holding a control, for a search that lands on it. */
export const pageHolding = (pages, paramId) => pages.find((p) => p.params.some((q) => q.id === paramId))
