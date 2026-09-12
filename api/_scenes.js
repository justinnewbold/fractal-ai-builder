/**
 * How many scenes a generation comes back with, and who decides.
 *
 * The count itself is the unit's — an AM4 has four, an FM3 has eight, and the
 * app reads it rather than assuming. What was missing is the other half: the
 * player never got to say how many of them to fill.
 *
 * The app asked one binary question — "one sound, or a set?" — and a set always
 * meant three or four, on both units. That is a good default and a bad ceiling:
 * three is right for "a song", and somebody laying out a whole set on an FM3
 * wants all eight and had no way to ask for them. So the question now carries a
 * number, and the number reaches the model as an instruction rather than as a
 * hope.
 *
 * Shared between the app that asks and the function that prompts, because the
 * two must not disagree about what "all of them" means. Kept beside the route
 * rather than in `src/lib` so the serverless bundle needs nothing outside its
 * own directory; the app reaches sideways for it, the way `remote.js` already
 * reaches into `desktop/lib` for the project constants.
 */

/**
 * The most a set may be worth, when the player asked for a set but not for a
 * number.
 *
 * Rule 11 of the system prompt is the reasoning: three or four well-judged
 * scenes beat eight, and filling every slot for the sake of it is how a preset
 * ends up with four sounds nobody asked for. It stays the default. It stops
 * being a ceiling the moment somebody names a number.
 */
export const A_FEW = 4

/**
 * Whether offering "all of them" is offering anything.
 *
 * On a unit with four scenes, "a few" and "all four" are the same answer with
 * two different labels, and a third button that changes nothing is worse than
 * no button. Above that the difference is real and worth a tap.
 */
export const offersAll = (sceneCount) => Number(sceneCount) > A_FEW

/**
 * What a number asked for turns into, or null for "use your judgement".
 *
 * Clamped rather than trusted: the unit's count is the hard ceiling — writing
 * past it is refused by the validator anyway, and asking for scenes that cannot
 * exist only wastes a generation.
 *
 * One is a number too. "Make a single scene modeled after Master of Puppets"
 * came back with four, because one was refused here as "not a set" and the
 * request fell through to the model's own judgement. A single NAMED scene is
 * not the same thing as the "One sound" button — that dials the tone into
 * whatever scene is live and names nothing — so it is its own instruction,
 * see sceneInstruction. Zero and below are still nothing asked for.
 */
export function sceneBudgetFor(wanted, sceneCount = 8) {
  const n = Number(wanted)
  const top = Number.isFinite(Number(sceneCount)) ? Math.max(1, Math.floor(Number(sceneCount))) : 8
  if (!Number.isInteger(n) || n < 1) return null
  return Math.min(n, top)
}

/**
 * The exact counts the question offers beside its three buttons.
 *
 * "If it doesn't understand how many scenes to create, it can pull up a
 * question box and ask how many scenes would you like to create." The three
 * buttons answer one, a few and all; this is every number in between, so a
 * player who wants five taps five rather than typing it. One is the first
 * button and the unit's own count is the third, so neither is repeated here.
 */
export function sceneNumbers(sceneCount = 8) {
  const top = Math.max(1, Math.floor(Number(sceneCount) || 8))
  const out = []
  for (let n = 2; n <= top; n += 1) if (!(offersAll(top) && n === top)) out.push(n)
  return out
}

/**
 * The buttons on the question, for this unit.
 *
 * `budget` is what the answer means: 0 is one sound, null is a set of the
 * model's own judging, a number is that many.
 */
export function sceneChoices(sceneCount = 8) {
  const all = Math.max(1, Math.floor(Number(sceneCount) || 8))
  const choices = [
    {
      key: 'one',
      budget: 0,
      label: 'One sound',
      hint: 'Goes into the scene you are in. The rest stay empty.'
    },
    {
      key: 'few',
      budget: null,
      label: 'A few',
      hint: 'Three or four named sounds off one rig, switched by footswitch.'
    }
  ]
  if (offersAll(all)) {
    choices.push({
      key: 'all',
      budget: all,
      label: `All ${all}`,
      hint: `Every scene on the unit filled — a whole set under one preset.`
    })
  }
  return choices
}

/**
 * What the model is told about scenes, in the player's own words.
 *
 * An answer is a decision and overrides the prompt's own judgement in both
 * directions: "just the one sound" must not come back with four scenes the
 * player then has to switch off, and "a set" must not come back with none.
 *
 * A number overrides rule 11 as well, and says so — otherwise the two fight,
 * and the rule wins, and somebody who asked for eight gets four with no
 * explanation. It also says what to do when the description does not obviously
 * carry that many sounds, because that is the real failure mode of asking for a
 * full set: eight scenes named Lead 1 through Lead 8.
 *
 * It also carries rule 13 into the count, because the two decide the same
 * thing from different ends. "Make me a Three Days Grace preset" with a set
 * asked for came back as Verse, Rhythm and Lead — the band's name reached the
 * model and none of it reached the footswitch. A number of scenes asked for
 * against a band's name is a number of that band's SONGS.
 */
export function sceneInstruction({ wantScenes, sceneBudget, sceneCount = 8, activeScene = null } = {}) {
  if (wantScenes === false) {
    return '\n\nThe player has asked for ONE SOUND, not a set. Return an empty scenes array.'
  }
  if (wantScenes !== true) return ''

  const n = sceneBudgetFor(sceneBudget, sceneCount)
  /*
   * One scene, named. "Make a single scene modeled after Master of Puppets"
   * is one song on the footswitch they are standing on, with its name on it —
   * not four scenes and not an unnamed tone. It goes into the scene they are
   * in, because that is the one they will hear when they hit play.
   */
  if (n === 1) {
    const at = Number.isInteger(Number(activeScene)) && Number(activeScene) >= 0 ? Number(activeScene) : 0
    return (
      `\n\nThe player has asked for EXACTLY ONE SCENE. Return exactly one entry in scenes, at index ` +
      `${at} — the scene they are in now — named for the song, part or sound the description ` +
      `names, and voiced for it. Do not return more, and do not return an empty scenes array: ` +
      `the name on the footswitch is the point.`
    )
  }
  if (!n) {
    return (
      '\n\nThe player has asked for a SET OF SCENES across this preset. Return three or four ' +
      'scenes, each named, covering the sounds this description implies. Do not return an ' +
      'empty scenes array. Rule 13 decides the names: a band or a record named in the ' +
      'description means one of THEIR songs per scene, voiced for that song, not Clean, ' +
      'Rhythm and Lead under their name.'
    )
  }

  return (
    `\n\nThe player has asked for EXACTLY ${n} SCENES across this preset. They chose that ` +
    `number themselves, so rule 11 does not apply — return ${n}, numbered 0 to ${n - 1}, each ` +
    `named, and do not return fewer. Every one of them must be a sound somebody would actually ` +
    `reach for. Where the description names a band or a record, that is ${n} of THEIR songs, ` +
    `one per scene, each named and voiced for its own song — rule 13. Where it names one song, ` +
    `that is ${n} parts of it. Only where it names neither does the rest get filled by job — a ` +
    `clean, a rhythm, a lead, a solo boost, an ambient or a verse-and-chorus pair — and never ` +
    `${n} near-copies of the same tone under different names.`
  )
}

/**
 * How many songs to look up, which is how many scenes are coming.
 *
 * The same question sceneInstruction answers, asked by the step that runs
 * BEFORE it — the rig lookup has to know how many songs to research, and the
 * two numbers must be the same one or the chain breaks at the join: four songs
 * looked up, eight scenes built, and half of them voiced from memory again.
 * Which is what happened, and what "so that way we're getting accurate tones on
 * every scene" is asking to stop.
 *
 * Zero for one sound, because that request needs the rig and no songs at all.
 * The default matches rule 11's "three or four" where nobody has named a
 * number, so the lookup and the designer agree about what "a set" means
 * without either of them being told twice.
 */
export function songsWanted({ wantScenes, sceneBudget, sceneCount = 8 } = {}) {
  if (wantScenes === false) return 0
  const n = sceneBudgetFor(sceneBudget, sceneCount)
  if (n) return n
  // No number named: a set is three or four, and the unit may hold fewer.
  const top = Number.isFinite(Number(sceneCount)) ? Math.max(1, Math.floor(Number(sceneCount))) : 8
  return Math.min(A_FEW, top)
}

/**
 * How many scenes the player asked for IN THEIR OWN WORDS, when they did.
 *
 * The buttons above only appear on a preset with no scene named yet. On one
 * that already has names — which is every preset after the first design, and
 * every preset that came with the unit — nobody is asked, the answer stays
 * undefined, and rule 11 fills three or four. So "Full Tool preset" on an FM3
 * came back with four scenes, and "It should be eight scenes not four" was
 * handed to the designer as an adjustment with no scene count attached at all,
 * next to an instruction to change as little as possible. Four scenes, three
 * times, and the number was in the request every time.
 *
 * So the words are read for a number before anything is asked or assumed.
 * "8 scenes", "eight scenes", "all 8", "every scene", "all scenes", and a
 * "full" or "whole" preset all mean the same thing on a unit with eight: all
 * of them. "One scene" or "one sound" is the other button. A number the unit
 * cannot hold is clamped the way a tapped one is.
 *
 * Returns the same shape the buttons produce — `{ wantScenes, sceneBudget }`
 * — so the two paths cannot disagree, or null when the words name no count
 * and the model's judgement is still the right answer. A number that is being
 * REJECTED ("not four", "instead of 4 scenes", "from 4 scenes to 8") is
 * dropped before the count is read, because the one being asked for is the
 * other one.
 */
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
}
const NUMBER = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
const toCount = (word) => NUMBER_WORDS[word] ?? Number(word)

export function scenesAskedFor(text, sceneCount = 8) {
  const words = String(text || '')
    .toLowerCase()
    // A count being turned down is not a count being asked for.
    .replace(new RegExp(`\\b(?:not|instead of|rather than|from|only(?: made| did| built| gave me)?)\\s+${NUMBER}(?:\\s*-?\\s*scenes?)?\\b`, 'g'), ' ')
  if (!words.trim()) return null

  const top = Number.isFinite(Number(sceneCount)) ? Math.max(1, Math.floor(Number(sceneCount))) : 8
  const all = { wantScenes: true, sceneBudget: top }

  // "8 scenes", "eight scenes", "an 8-scene preset", "all 8 scenes", "all eight".
  const numbered =
    words.match(new RegExp(`\\b${NUMBER}\\s*-?\\s*scenes?\\b`)) ||
    words.match(new RegExp(`\\b(?:all|every one of the)\\s+${NUMBER}\\b`))
  if (numbered) {
    const n = toCount(numbered[1])
    // "1 scene", "one scene": one, named, where they are standing.
    if (n === 1) return { wantScenes: true, sceneBudget: 1 }
    const budget = sceneBudgetFor(n, top)
    return budget ? { wantScenes: true, sceneBudget: budget } : null
  }

  // "all scenes", "every scene", "each scene", "all of the scenes".
  if (/\b(?:all|every|each)\s+(?:of\s+)?(?:the\s+|its\s+|my\s+)?scenes?\b/.test(words)) return all
  // "a full Tool preset", "the whole preset", "a full rig", "a complete set
  // of scenes". "Full rig means max: if it's an FM3 that's 8, if it's an AM4
  // that's four."
  if (/\b(?:full|whole|entire|complete|max(?:ed)?(?: out)?)\b[^.!?]{0,40}\b(?:preset|rig|set of scenes|scenes)\b/.test(words)) return all
  if (/\bas many scenes as\b/.test(words)) return all

  // "a single scene", "one scene" — one, named, where they are standing.
  if (/\b(?:a\s+)?single\s+scene\b|\b(?:just\s+|only\s+)?(?:one|1)\s+scene\b/.test(words)) {
    return { wantScenes: true, sceneBudget: 1 }
  }
  // "one sound", "a single sound" — the tone into the live scene, no naming.
  if (/\b(?:just\s+|only\s+)?(?:one|a\s+single|single|1)\s+sound\b/.test(words)) {
    return { wantScenes: false, sceneBudget: undefined }
  }
  return null
}

/**
 * Whether the player said to leave the preset's name alone.
 *
 * "Do not create a preset name." The design came back with "Master of
 * Puppets 86" and the rename box ticked, because nothing read that sentence:
 * the designer always proposes a name and the app always offers it. The
 * words are plain and there are only a few ways to say them, so they are
 * read here and the box starts unticked. Deciding the other way is one tap.
 */
export function keepsName(text) {
  const words = String(text || '').toLowerCase()
  if (!words.trim()) return false
  return (
    /\b(?:do not|don'?t|dont|never|no need to|without)\b[^.!?]{0,24}\b(?:preset name|name (?:the|this|my) preset|rename|renaming|naming|new name|name it)\b/.test(words) ||
    /\b(?:keep|leave|retain)\b[^.!?]{0,12}\b(?:preset'?s? )?name\b/.test(words) ||
    /\bno (?:new )?preset name\b|\bno rename\b/.test(words)
  )
}
