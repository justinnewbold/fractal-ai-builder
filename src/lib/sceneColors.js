/**
 * A colour per scene, so a scene is recognised rather than read.
 *
 * The blocks below have had this since blockColors — on a dark stage a player
 * finds the drive by its red long before the three letters resolve. Scenes had
 * nothing: eight identical panels distinguished by a numeral and, if you named
 * them, some small type. Between two bars of a song that is a reading task.
 *
 * Eight hues, evenly spread and deliberately muted to sit beside the block
 * palette rather than shout over it. None of them is the amber --signal: that
 * colour means the audio path in this app and a scene tile is not allowed to
 * borrow it. Which scene is LIVE is carried by fill against edge — the same
 * grammar the block tiles use for on against off — so colour stays identity
 * and brightness stays state.
 *
 * Fixed to the index, not to the name. A scene keeps its colour when it is
 * renamed, and scene 3 is the same colour in every preset on the unit, which
 * is what makes it learnable at all.
 */
const SCENES = [
  { fill: '#b5502f', ink: '#ffffff' }, // 1 terracotta
  { fill: '#8f6a24', ink: '#ffffff' }, // 2 ochre
  { fill: '#4f7a35', ink: '#ffffff' }, // 3 moss
  { fill: '#2f7a6b', ink: '#ffffff' }, // 4 teal
  { fill: '#2f5f9c', ink: '#ffffff' }, // 5 blue
  { fill: '#56409c', ink: '#ffffff' }, // 6 violet
  { fill: '#94357a', ink: '#ffffff' }, // 7 magenta
  { fill: '#5d626b', ink: '#ffffff' } // 8 slate
]

/** The colour for a 0-based scene index. Wraps, for a unit with more than eight. */
export const sceneColor = (i) => SCENES[((i % SCENES.length) + SCENES.length) % SCENES.length]

export const SCENE_COLOR_COUNT = SCENES.length
