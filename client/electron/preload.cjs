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
  screenAudio: {
    start: (sourceId) => ipcRenderer.invoke('screen:audio-start', sourceId),
    stop: () => ipcRenderer.invoke('screen:audio-stop'),
    onChunk: (callback) => {
      const listener = (_event, buf) => callback(buf);
      ipcRenderer.on('screen:audio-chunk', listener);
      return () => ipcRenderer.removeListener('screen:audio-chunk', listener);
    },
  },
  // Overlay para jogos. Janela principal: setOpen / update / onToggleRequest. Janela do overlay: getState / onState.
  overlay: {
    setOpen: (open) => ipcRenderer.invoke('overlay:set-open', Boolean(open)),
    update: (state) => ipcRenderer.send('overlay:update', state),
    onToggleRequest: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('overlay:toggle-request', listener);
      return () => ipcRenderer.removeListener('overlay:toggle-request', listener);
    },
    getState: () => ipcRenderer.invoke('overlay:get-state'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('overlay:state', listener);
      return () => ipcRenderer.removeListener('overlay:state', listener);
    },
  },
});