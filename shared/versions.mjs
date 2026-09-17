/**
 * Which of two versions is older, for the one question it is asked.
 *
 * "Does the Mac app need to be updated to the latest version? Or would that
 * affect how the app performs?"
 *
 * Both ends of this project carry the same version number by construction —
 * `desktop/package.json` moves with the root one and a test holds them to each
 * other — so "the computer is on 7.191.0 and the phone is on 7.265.0" is a
 * real, actionable fact rather than a coincidence of release cadences.
 *
 * Deliberately strict about what it will answer. Anything that is not three
 * plain numbers comes back null: a version this code cannot parse is a version
 * it has no business having an opinion about, and telling somebody to update a
 * perfectly current app is worse than saying nothing.
 */
const parts = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** true when `a` is behind `b`, false when it is not, null when unknowable. */
export function isOlder(a, b) {
  const left = parts(a)
  const right = parts(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i]
  }
  return false
}
