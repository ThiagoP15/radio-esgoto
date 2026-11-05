'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima: só estas funções chegam ao React; o ipcRenderer nunca é exposto.
contextBridge.exposeInMainWorld('radioEsgoto', {
  platform: process.platform,
  getScreenSources: () => ipcRenderer.invoke('screen:get-sources'),
  selectScreenSource: (id) => ipcRenderer.invoke('screen:select-source', id),
});
