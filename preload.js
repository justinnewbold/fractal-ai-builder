const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fractalAI', {
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  executeAction: (action) => ipcRenderer.invoke('execute-action', action),
  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  openPrivacySettings: () => ipcRenderer.invoke('open-privacy-settings')
})
