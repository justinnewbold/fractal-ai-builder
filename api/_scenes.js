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
 * exist only wastes a generation. A set of one is not a set; that answer is the
 * other button.
 */
export function sceneBudgetFor(wanted, sceneCount = 8) {
  const n = Number(wanted)
  const top = Number.isFinite(Number(sceneCount)) ? Math.max(1, Math.floor(Number(sceneCount))) : 8
  if (!Number.isInteger(n) || n < 2) return null
  return Math.min(n, top)
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
 */
export function sceneInstruction({ wantScenes, sceneBudget, sceneCount = 8 } = {}) {
  if (wantScenes === false) {
    return '\n\nThe player has asked for ONE SOUND, not a set. Return an empty scenes array.'
  }
  if (wantScenes !== true) return ''

  const n = sceneBudgetFor(sceneBudget, sceneCount)
  if (!n) {
    return (
      '\n\nThe player has asked for a SET OF SCENES across this preset. Return three or four ' +
      'scenes, each named, covering the sounds this description implies. Do not return an ' +
      'empty scenes array.'
    )
  }

  return (
    `\n\nThe player has asked for EXACTLY ${n} SCENES across this preset. They chose that ` +
    `number themselves, so rule 11 does not apply — return ${n}, numbered 0 to ${n - 1}, each ` +
    `named, and do not return fewer. Every one of them must be a sound somebody would actually ` +
    `reach for: if the description does not obviously carry ${n} sounds, fill the rest with the ` +
    `ones that belong beside it — a clean, a rhythm, a lead, a solo boost, an ambient or a ` +
    `verse-and-chorus pair — rather than ${n} near-copies of the same tone under different names.`
  )
}
