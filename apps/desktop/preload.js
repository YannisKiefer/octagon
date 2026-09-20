'use strict';
// Bridge exposed to the dashboard as window.octagonDesktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('octagonDesktop', {
  isDesktop: true,
  // fired by the app menu "Settings…" (Cmd+,)
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
});
