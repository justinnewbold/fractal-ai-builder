/**
 * The one thing the page is allowed to ask the app about: updates.
 *
 * "I quit the app and restarted, I'm on 7.50.0, no update notification. In
 * addition to a notification that pops up can we add a check for update button
 * in settings?"
 *
 * There was no way to answer that. The window loads the web app over http from
 * the device server, with context isolation on and no preload at all — so the
 * page and the updater have never had a channel between them. Everything the
 * updater knows was written into the menu-bar menu and nowhere else, which
 * meant an update could be downloaded and waiting and the only way to find out
 * was to click an icon nobody had a reason to click.
 *
 * Deliberately one-way and tiny. The page can ask what is happening, ask for a
 * check, and be told when that changes. It cannot install, quit, restart, or
 * reach anything else in the app — an update that installs because a web page
 * said so is exactly the interruption the whole design avoids.
 *
 * The wording comes from the main process rather than being rebuilt here,
 * because the menu and the window saying different things about the same
 * download is the kind of drift nobody notices until it is confusing.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fractalDesktop', {
  /** Present at all: how a page knows it is inside the Mac app. */
  isDesktop: true,

  updates: {
    /** What is happening now, as {kind, line, version}. Null before anything has. */
    state: () => ipcRenderer.invoke('updates:state'),

    /** Ask now. Resolves when the check has been started, not when it finishes. */
    check: () => ipcRenderer.invoke('updates:check'),

    /**
     * Told when it changes. Returns the unsubscribe, because a page that
     * navigates without one leaks a listener per visit.
     */
    onState: (fn) => {
      if (typeof fn !== 'function') return () => {}
      const handler = (_event, state) => fn(state)
      ipcRenderer.on('updates:state', handler)
      return () => ipcRenderer.removeListener('updates:state', handler)
    }
  }
})
