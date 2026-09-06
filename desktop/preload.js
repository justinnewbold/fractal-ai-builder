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
 * Deliberately tiny: what is happening, ask for a check, be told when it
 * changes, and install what has already been downloaded. Nothing else in the
 * app is reachable from here.
 *
 * Installing was left out at first, on the grounds that an update installing
 * because a web page said so is exactly the interruption the whole design
 * avoids. That reasoning was right about the app deciding and wrong about a
 * person deciding — and the difference turned out to matter, because installing
 * on quit is only a good default while quitting works. When it did not, the
 * update went down with it: Force Quit is a hard kill, so nothing installed,
 * the same version was offered at every launch, and the fix for the quit was
 * inside the version that could not be installed. `install` is the second way
 * out of that, and it never fires on its own.
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
     * Install what is already downloaded, and reopen on it.
     *
     * Refused unless an update is actually ready, so this cannot be used to
     * restart the app for any other reason.
     */
    install: () => ipcRenderer.invoke('updates:install'),

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
