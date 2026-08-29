/**
 * A preset folder you pick, rather than a path you type.
 *
 * Typing an absolute path is a thing you can get wrong in silence, and nobody
 * knows their own home directory spelling by heart. Chrome's directory picker
 * hands back a live handle to a real folder, which is both easier and safer.
 *
 * It also removes a dependency. ForgeFX's own library routes need an absolute
 * path string, and the picker deliberately never reveals one — a handle grants
 * access to a folder without telling the page where on disk it sits. So rather
 * than fight that, files are read and written straight from the browser. The
 * folder is the player's, the files are ordinary .syx, and nothing has to agree
 * on a path.
 *
 * The handle is kept in IndexedDB, because unlike a string it survives a reload
 * and unlike localStorage it can hold a structured-cloneable object.
 */

const DB = 'fractal-library'
const STORE = 'handles'
const KEY = 'presetFolder'

export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function put(value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function get() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

/** Ask the OS for a folder. Returns null if the person cancels the dialog. */
export async function pickFolder() {
  if (!canPickFolder()) throw new Error('This browser has no folder picker. Chrome does.')
  let handle
  try {
    handle = await window.showDirectoryPicker({ id: 'fractal-presets', mode: 'readwrite' })
  } catch (err) {
    // Cancelling is a choice, not a failure.
    if (err?.name === 'AbortError') return null
    throw err
  }
  await put(handle)
  return handle
}

/**
 * The folder chosen last time, if it's still ours to use.
 *
 * Permission doesn't automatically survive a reload, so this asks — but only
 * ever silently. Prompting on page load would be a dialog nobody asked for, so
 * a folder that needs re-granting simply reports as not ready and the person
 * picks it again when they want it.
 */
export async function savedFolder({ prompt = false } = {}) {
  const handle = await get().catch(() => null)
  if (!handle) return null
  const opts = { mode: 'readwrite' }
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return handle
    if (!prompt) return { handle, needsPermission: true }
    if ((await handle.requestPermission(opts)) === 'granted') return handle
  } catch {
    // An older handle, or a folder that has been moved or deleted.
  }
  return null
}

export async function forgetFolder() {
  await put(null).catch(() => {})
}

/**
 * Everything saved in the folder, newest first.
 *
 * Two kinds live side by side and the distinction matters when loading. A .syx
 * is an exact capture of a preset — bytes that go back to the unit verbatim. A
 * .design.json is a tone as designed — it re-validates against whatever is on
 * the unit now and lands as a preview, exactly like a fresh generation. One is
 * a photograph, the other is the recipe.
 */
export async function listPresetFiles(handle) {
  const out = []
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue
    const lower = entry.name.toLowerCase()
    const kind = lower.endsWith('.design.json') ? 'design' : lower.endsWith('.syx') ? 'capture' : null
    if (!kind) continue
    try {
      const file = await entry.getFile()
      out.push({
        name: entry.name.replace(/\.design\.json$/i, '').replace(/\.syx$/i, ''),
        file: entry.name,
        kind,
        size: file.size,
        at: file.lastModified
      })
    } catch {
      // A file that vanished between listing and reading isn't worth an error.
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Write a preset into the folder. Returns the filename used. */
export async function writePresetFile(handle, name, bytes) {
  const file = `${safeFileName(name)}.syx`
  const fh = await handle.getFileHandle(file, { create: true })
  const w = await fh.createWritable()
  await w.write(new Uint8Array(bytes))
  await w.close()
  return file
}

/** Read one preset file back as plain bytes. */
export async function readPresetFile(handle, file) {
  const fh = await handle.getFileHandle(file)
  const buf = await (await fh.getFile()).arrayBuffer()
  return [...new Uint8Array(buf)]
}

export async function deletePresetFile(handle, file) {
  await handle.removeEntry(file)
}

/** The filename a name becomes — shared by both kinds so the rules can't split. */
export function safeFileName(name) {
  return (
    (name || '')
      .trim()
      .replace(/[/\\:*?"<>|]+/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 60)
      .trim() || 'preset'
  )
}

/** Write a design (a saved tone spec) into the folder. */
export async function writeDesignFile(handle, entry) {
  const file = `${safeFileName(entry.name)}.design.json`
  const fh = await handle.getFileHandle(file, { create: true })
  const w = await fh.createWritable()
  await w.write(JSON.stringify(entry, null, 2))
  await w.close()
  return file
}

export async function readDesignFile(handle, file) {
  const fh = await handle.getFileHandle(file)
  const text = await (await fh.getFile()).text()
  return JSON.parse(text)
}

/**
 * A subfolder for whole-unit version history.
 *
 * Kept apart from the presets so a sync of forty versions doesn't bury the
 * dozen tones someone actually reaches for.
 */
export async function versionsFolder(handle) {
  return handle.getDirectoryHandle('versions', { create: true })
}

/** Which version ids are already on disk, read from the filenames. */
export async function syncedVersionIds(dir) {
  const ids = new Set()
  for await (const entry of dir.values()) {
    const m = entry.name.match(/\.(bk-[a-z0-9]+|v-[a-z0-9]+|[a-z0-9]{6,})\.syx$/i)
    if (entry.kind === 'file' && m) ids.add(m[1])
  }
  return ids
}

export async function writeVersionFile(dir, version, bytes) {
  const stamp = new Date(version.capturedAt || Date.now()).toISOString().slice(0, 10)
  const label = safeFileName(`${stamp} slot ${version.location ?? '--'} ${version.name || ''}`)
  const file = `${label}.${version.id}.syx`
  const fh = await dir.getFileHandle(file, { create: true })
  const w = await fh.createWritable()
  await w.write(bytes)
  await w.close()
  return file
}
