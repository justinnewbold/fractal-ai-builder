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

/** Every preset file in the folder, newest first. */
export async function listPresetFiles(handle) {
  const out = []
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.syx')) continue
    try {
      const file = await entry.getFile()
      out.push({ name: entry.name.replace(/\.syx$/i, ''), file: entry.name, size: file.size, at: file.lastModified })
    } catch {
      // A file that vanished between listing and reading isn't worth an error.
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Write a preset into the folder. Returns the filename used. */
export async function writePresetFile(handle, name, bytes) {
  // Trim first, then fall back. A name of spaces is truthy, so `name || 'preset'`
  // would have kept it and written a hidden file called ".syx".
  const cleaned = (name || '').trim().replace(/[/\\:*?"<>|]+/g, '-').replace(/^\.+/, '').slice(0, 60)
  const file = `${cleaned.trim() || 'preset'}.syx`
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
