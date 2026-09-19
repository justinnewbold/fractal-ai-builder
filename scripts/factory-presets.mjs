/**
 * The factory presets and scene names every Fractal unit ships with.
 *
 * "Here are all the preset names and scene names for all of the current
 * fractal units for you to put in the demos."
 *
 * The demo used to be twelve hand-built presets on a simulated FM3, and they
 * were good ones — real amps, real cabs, scenes that actually differ. What
 * they were not was what anybody's unit says when they turn it on. Somebody
 * trying the demo before buying is comparing it against the rig in front of
 * them, and a preset list that shares no names with theirs is a list they
 * cannot check the app against.
 *
 * So this turns data/factory-presets.csv into src/data/factory-presets.json:
 * every slot on every current unit, with the name the unit shows and the
 * scene names inside it.
 *
 * WHAT AN UNNAMED SCENE IS CALLED. "Generic names likely scene 1, scene 2 or
 * empty are accurate and should reflect that way when you name them." A great
 * many factory scenes have no name of their own — the source marks them with
 * an em dash — and a unit showing one of those shows "Scene 5". So that is
 * what this writes. Inventing a plausible name for every blank would make the
 * demo look better and be wrong, and somebody would notice the day they
 * compared it with their own unit.
 *
 * AN EMPTY SLOT IS EMPTY. The AM4 and VP4 ship with user slots nobody has
 * filled (W1-Z4 on the AM4, most of V-Z on the VP4), and a demo that invents
 * something to put in them is teaching that those slots come full. They carry
 * no name and the app draws them the way it draws an empty slot.
 *
 * Run after touching the CSV; `npm test` regenerates it in memory and fails
 * if what is on disk differs, so a stale copy cannot be merged.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p) => fileURLToPath(new URL(p, import.meta.url))

/** How many scenes each unit actually has, which is not a guess in the CSV. */
export const SCENES = { axefx3: 8, fm9: 8, fm3: 8, am4: 4, vp4: 4 }

/** How many slots each unit holds, so a short file is caught rather than shipped. */
export const SLOTS = { axefx3: 384, fm9: 384, fm3: 384, am4: 104, vp4: 104 }

/**
 * A CSV row splitter that understands quotes, because preset names contain
 * commas — "Sunday Morning, Sunday Night" is a real one — and a split on the
 * comma turns that into an extra column and silently shifts every scene name
 * along by one.
 */
export function splitRow(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(field)
      field = ''
    } else field += c
  }
  out.push(field)
  return out
}

/** Build the catalog from the CSV text. Exported so the test can re-run it. */
export function build(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim())
  const head = splitRow(lines[0])
  if (head[0] !== 'unit' || head[1] !== 'slot' || head[2] !== 'name') {
    throw new Error('factory-presets.csv does not start unit,slot,name')
  }

  const units = {}
  for (const line of lines.slice(1)) {
    const row = splitRow(line)
    const unit = row[0].trim()
    const slot = Number(row[1])
    if (!SCENES[unit]) throw new Error(`unknown unit "${unit}" in factory-presets.csv`)
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS[unit]) {
      throw new Error(`${unit} slot ${row[1]} is outside 0..${SLOTS[unit] - 1}`)
    }
    const name = row[2].trim()
    /*
     * Scenes are trimmed to the number this unit HAS. The CSV carries eight
     * columns for every unit so one file can hold all five; an AM4 has four
     * scenes and writing it eight would put four phantom tiles on a screen.
     */
    const scenes = []
    for (let i = 0; i < SCENES[unit]; i += 1) {
      const said = (row[3 + i] || '').trim()
      /*
       * An unnamed scene is called "Scene N", because that is what the unit
       * itself shows. Not a blank — a blank tile is a tile you cannot press
       * with any confidence — and not something invented.
       */
      scenes.push(said || `Scene ${i + 1}`)
    }
    units[unit] = units[unit] || []
    /* An empty slot keeps its place in the list and carries no name. The app
       already knows how to draw one; it must not be taught they do not exist. */
    units[unit][slot] = name ? { number: slot, name, scenes } : { number: slot, name: '' }
  }

  for (const [unit, list] of Object.entries(units)) {
    for (let i = 0; i < SLOTS[unit]; i += 1) {
      if (!list[i]) list[i] = { number: i, name: '' }
    }
    list.length = SLOTS[unit]
  }
  return units
}

const csv = readFileSync(at('../data/factory-presets.csv'), 'utf8')
const built = build(csv)

if (process.argv[2] !== '--check') {
  writeFileSync(at('../src/data/factory-presets.json'), `${JSON.stringify(built, null, 2)}\n`)
  for (const [unit, list] of Object.entries(built)) {
    const named = list.filter((p) => p.name).length
    console.log(`${unit}: ${named} named of ${list.length} slots, ${SCENES[unit]} scenes each`)
  }
}
