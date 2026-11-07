'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima: só estas funções chegam ao React; o ipcRenderer nunca é exposto.
contextBridge.exposeInMainWorld('radioEsgoto', {
  platform: process.platform,
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  selectScreenSource: (id) => ipcRenderer.invoke('screen:select-source', id),
  setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  onFullScreenChange: (callback) => {
    const listener = (_event, isFull) => callback(isFull);
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },
});