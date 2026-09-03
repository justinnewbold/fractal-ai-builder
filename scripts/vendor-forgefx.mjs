#!/usr/bin/env node
/**
 * Put the device server inside the app.
 *
 * ForgeFX is a separate project, and until now the Mac app only knew how to
 * *find* it — `~/src/forgefx`, or FORGEFX_PATH. That is right for a developer
 * and useless for everyone else: the .dmg it produced said "ForgeFX is not
 * installed" on any machine that was not already set up to build it. Carrying
 * a copy is the difference between a demo and something a person installs.
 *
 * What is copied is pinned rather than current, and it comes from our own
 * private mirrors rather than from upstream — what goes inside something we sign
 * should not depend on someone else's repository still being there, still being
 * public, and still having the history it had last week.
 *
 * `desktop/forgefx.lock.json` names a tag for people and a commit for the
 * machine, and the commit is what is asked for. A tag can be moved by whoever
 * owns the repo; a commit cannot, and asking for it by name means there is no
 * window in which the wrong code is on disk waiting to be checked. Where a
 * remote does carry the tag, it is still verified to point at what we pinned.
 *
 * The codec's version is not ours to pick. ForgeFX pins its own sibling in
 * stack.lock.json for exactly the tag builds we are copying, so we read that
 * and refuse to build a pair upstream never released together.
 *
 * The two are cloned as siblings because ForgeFX's server depends on the codec
 * by relative path — `"forgefx-midi": "file:../../forgefx-midi"` — which npm
 * resolves with a symlink. Flatten the layout and that link dangles inside the
 * app bundle, which would fail on a stranger's Mac and nowhere else.
 *
 *   npm run vendor:forgefx
 *
 * FORGEFX_TOKEN is required, because the mirrors are private. It is passed
 * through a credential helper rather than embedded in the URL, so it cannot end
 * up in an error message or a CI log.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'desktop', 'vendor')
const lock = JSON.parse(readFileSync(join(root, 'desktop', 'forgefx.lock.json'), 'utf8'))
const fetchOnly = process.argv.includes('--fetch-only')

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
const capture = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim()

/*
 * Credentials without putting them in argv. git spawns the helper in a shell,
 * so the token is expanded there from the environment this process already
 * has — it is never a command-line argument and never part of a URL.
 */
const auth = process.env.FORGEFX_TOKEN
  ? ['-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$FORGEFX_TOKEN"; }; f']
  : []

function fetchPinned(name, spec) {
  const dir = join(vendor, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  console.log(`\n· ${spec.repo} @ ${spec.tag}`)

  /*
   * Asked for by commit rather than cloned at a tag.
   *
   * The mirrors carry every branch and the whole history but no tags, so there
   * is no tag to clone — and that turns out to be the better shape anyway.
   * Cloning a tag and comparing afterwards puts whatever the tag points at on
   * disk first and asks questions second; naming the commit means the only
   * thing that can arrive is the thing we pinned.
   */
  run('git', ['init', '--quiet'], dir)
  run('git', ['remote', 'add', 'origin', `https://github.com/${spec.repo}`], dir)
  try {
    run('git', [...auth, 'fetch', '--quiet', '--depth', '1', 'origin', spec.commit], dir)
  } catch {
    /*
     * Said plainly, because the git error underneath is "could not read
     * Username for 'https://github.com'", which sends people to look at
     * everything except the one missing secret.
     */
    throw new Error(
      `Could not fetch ${spec.commit.slice(0, 12)} from ${spec.repo}.\n` +
        (process.env.FORGEFX_TOKEN
          ? 'FORGEFX_TOKEN is set, so either that commit is no longer in the mirror or the\n' +
            'token cannot read that repository.'
          : 'FORGEFX_TOKEN is not set and these mirrors are private, which is almost always\n' +
            'the reason. In CI it is a repository secret of that name; locally, export a token\n' +
            'that can read them.')
    )
  }
  run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD'], dir)

  const head = capture('git', ['rev-parse', 'HEAD'], dir)
  // Belt and braces: git resolving a name to something other than that name
  // would be a bug in git, but this costs one process and the failure it would
  // otherwise catch is code inside a signed installer.
  if (head !== spec.commit) {
    throw new Error(`asked ${spec.repo} for ${spec.commit} and got ${head}`)
  }

  /*
   * And the label, wherever there is one to check. Upstream has tags and the
   * mirrors do not, so this is a check that finds nothing here and would find a
   * moved tag anywhere it can be run at all — rather than a check deleted
   * because one remote happened not to support it.
   */
  const refs = capture('git', [...auth, 'ls-remote', '--tags', 'origin', `refs/tags/${spec.tag}`], dir)
  const rows = refs.split('\n').filter(Boolean).map((line) => line.split(/\s+/))
  // An annotated tag lists the tag object and then the commit it peels to.
  const points = (rows.find(([, ref]) => ref.endsWith('^{}')) || rows[0])?.[0]
  if (points && points !== spec.commit) {
    throw new Error(
      `${spec.repo} tag ${spec.tag} is ${points}, but the lock file pins ${spec.commit}.\n` +
        'A tag that moved is the one thing pinning by tag alone cannot catch. Confirm what\n' +
        'changed upstream, then update desktop/forgefx.lock.json deliberately.'
    )
  }
  // Nothing downstream should read the vendored copy's history, and it would
  // otherwise be copied into the app bundle.
  rmSync(join(dir, '.git'), { recursive: true, force: true })
  console.log(`  ${head}`)
  return dir
}

mkdirSync(vendor, { recursive: true })
const forgefx = fetchPinned('forgefx', lock.forgefx)

/*
 * ForgeFX's own pin, checked against ours. If a future ForgeFX tag expects a
 * different codec, this says so instead of quietly building a combination that
 * was never released or tested together.
 */
const theirs = JSON.parse(readFileSync(join(forgefx, 'stack.lock.json'), 'utf8'))['forgefx-midi']
if (theirs?.ref && theirs.ref !== lock['forgefx-midi'].tag) {
  throw new Error(
    `${lock.forgefx.repo} ${lock.forgefx.tag} pins the codec at ${theirs.ref}, but our lock file says ` +
      `${lock['forgefx-midi'].tag}. Upstream decides this one — update desktop/forgefx.lock.json to match.`
  )
}
/*
 * Compared against the upstream name, not ours. We vendor from a mirror on
 * purpose, so `justinnewbold/forgefx-midi` differing from what ForgeFX names is
 * the expected state and printing a note about it every build would train
 * everyone to ignore the one that matters.
 */
const oursUpstream = lock['forgefx-midi'].upstream || lock['forgefx-midi'].repo
if (theirs?.repo && theirs.repo !== oursUpstream) {
  console.warn(`  note: upstream names the codec ${theirs.repo}; we mirror ${oursUpstream}`)
}
fetchPinned('forgefx-midi', lock['forgefx-midi'])

if (fetchOnly) {
  console.log('\nFetched only, as asked. Nothing built.')
  process.exit(0)
}

/*
 * Built, then stripped back to what it needs to run.
 *
 * Both projects are TypeScript, so their build tools are dependencies —
 * typescript and esbuild alone are 34 MB — and none of it is reachable once
 * `dist` exists. Pruning takes the vendored tree from 176 MB to 91 MB, and
 * every one of those megabytes would otherwise be in the installer, twice,
 * for both architectures.
 */
const build = (dir, what) => {
  console.log(`\n· building ${what}`)
  run('npm', ['ci'], dir)
  run('npm', ['run', 'build'], dir)
  run('npm', ['prune', '--omit=dev'], dir)
}

// The codec first: the server's build reads its types.
build(join(vendor, 'forgefx-midi'), 'the codec')
const server = join(forgefx, 'server')
build(server, 'the device server')

const entry = join(server, 'dist', 'index.js')
if (!existsSync(entry)) throw new Error(`the server built without producing ${entry}`)
console.log(`\nVendored into desktop/vendor — ${entry.slice(root.length + 1)}`)
