const { app, BrowserWindow, ipcMain, desktopCapturer, screen, systemPreferences, clipboard } = require('electron')
const path = require('path')
const { exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises

const execAsync = promisify(exec)

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d1a',
    title: 'Fractal AI Builder',
    trafficLightPosition: { x: 16, y: 16 }
  })

  mainWindow.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Screen Capture ──────────────────────────────────────────────────────────

ipcMain.handle('capture-screen', async () => {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    const scaleFactor = primaryDisplay.scaleFactor

    const physW = Math.round(width * scaleFactor)
    const physH = Math.round(height * scaleFactor)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physW, height: physH }
    })

    if (!sources || sources.length === 0) {
      return { success: false, error: 'No screen sources found. Please grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording.' }
    }

    const source = sources[0]
    const jpegBuffer = source.thumbnail.toJPEG(90)
    const base64 = jpegBuffer.toString('base64')

    return {
      success: true,
      image: base64,
      width: physW,
      height: physH,
      scaleFactor
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── Execute Computer Use Actions ─────────────────────────────────────────────

ipcMain.handle('execute-action', async (event, action) => {
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const scaleFactor = primaryDisplay.scaleFactor

    // Claude gives coordinates in the physical pixel space we told it.
    // osascript uses logical (point) coordinates. Divide by scaleFactor.
    const toLogical = (px) => Math.round(px / scaleFactor)

    switch (action.type) {

      case 'screenshot': {
        // Claude is requesting a fresh screenshot — handled by caller
        return { success: true, type: 'screenshot' }
      }

      case 'left_click': {
        const x = toLogical(action.coordinate[0])
        const y = toLogical(action.coordinate[1])
        await execAsync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`)
        break
      }

      case 'double_click': {
        const x = toLogical(action.coordinate[0])
        const y = toLogical(action.coordinate[1])
        await execAsync(`osascript -e 'tell application "System Events" to double click at {${x}, ${y}}'`)
        break
      }

      case 'right_click': {
        const x = toLogical(action.coordinate[0])
        const y = toLogical(action.coordinate[1])
        // Control+click = right-click equivalent in AppleScript
        await execAsync(`osascript <<'EOF'
tell application "System Events"
  set position of (first process whose frontmost is true) to {0, 0}
  click at {${x}, ${y}} with {control down}
end tell
EOF`)
        break
      }

      case 'mouse_move': {
        const x = toLogical(action.coordinate[0])
        const y = toLogical(action.coordinate[1])
        // Move mouse by clicking softly (no visible action, just moves cursor)
        await execAsync(`osascript -e 'tell application "System Events" to set the position of cursor to {${x}, ${y}}'`).catch(() => {
          // Fallback: cliclick if available, or just no-op
        })
        break
      }

      case 'type': {
        // Use clipboard paste for reliable text input (handles all characters)
        const prevClipboard = clipboard.readText()
        clipboard.writeText(action.text)
        await sleep(100)
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`)
        await sleep(200)
        // Restore clipboard after a delay
        setTimeout(() => clipboard.writeText(prevClipboard), 1000)
        break
      }

      case 'key': {
        const keyString = action.text
        const script = buildKeyScript(keyString)
        await execAsync(`osascript -e '${script}'`)
        break
      }

      case 'scroll': {
        const x = toLogical(action.coordinate[0])
        const y = toLogical(action.coordinate[1])
        const amount = action.amount || 3
        const dir = action.direction === 'down' ? -amount : amount
        // Use CGEvent-based scroll (no UI element needed)
        await execAsync(`osascript <<'EOF'
tell application "System Events"
  scroll (every UI element of (first window of (first process whose frontmost is true))) by ${dir}
end tell
EOF`).catch(async () => {
          // Fallback: send wheel event via cliclick or keyboard
          const key = action.direction === 'down' ? 'page down' : 'page up'
          await execAsync(`osascript -e 'tell application "System Events" to key code ${action.direction === 'down' ? 121 : 116}'`)
        })
        break
      }

      default:
        console.warn('Unknown action type:', action.type)
    }

    await sleep(400) // Give the UI time to update
    return { success: true }

  } catch (err) {
    console.error('Action error:', err.message)
    return { success: false, error: err.message }
  }
})

// ── Permission Check ─────────────────────────────────────────────────────────

ipcMain.handle('check-permissions', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen')
    return { screen: status }
  }
  return { screen: 'granted' }
})

ipcMain.handle('request-screen-permission', async () => {
  // Triggers the macOS permission prompt
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {})
  return true
})

ipcMain.handle('open-privacy-settings', async () => {
  await execAsync('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"').catch(() => {
    execAsync('open /System/Library/PreferencePanes/Security.prefPane')
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildKeyScript(keyString) {
  // Map common key names to AppleScript key codes
  const keyCodes = {
    'Return': 36, 'Enter': 36,
    'Tab': 48,
    'Escape': 53,
    'Delete': 51, 'BackSpace': 51,
    'ForwardDelete': 117,
    'Up': 126, 'Down': 125, 'Left': 123, 'Right': 124,
    'Page_Up': 116, 'Page_Down': 121,
    'Home': 115, 'End': 119,
    'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118,
    'F5': 96, 'F6': 97, 'F7': 98, 'F8': 100,
    'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111
  }

  // Handle combinations like ctrl+a, cmd+z, etc.
  const parts = keyString.split('+')
  const mods = []
  let mainKey = parts[parts.length - 1]

  if (parts.includes('ctrl') || parts.includes('control')) mods.push('command down')
  if (parts.includes('shift')) mods.push('shift down')
  if (parts.includes('alt') || parts.includes('option')) mods.push('option down')
  if (parts.includes('cmd') || parts.includes('command')) mods.push('command down')

  const usingClause = mods.length > 0 ? ` using {${mods.join(', ')}}` : ''

  if (keyCodes[mainKey] !== undefined) {
    return `tell application "System Events" to key code ${keyCodes[mainKey]}${usingClause}`
  } else {
    // Single character
    const safeChar = mainKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    return `tell application "System Events" to keystroke "${safeChar}"${usingClause}`
  }
}
