// Мостик для полоски заголовка (titlebar.html): кнопки окна и его состояние. Сайту это не достаётся —
// у него свой preload.js.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('titlebar', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  update: () => ipcRenderer.send('win:update'),
  /** Текущее состояние окна: { maximized, focused, fullscreen, unread, update } */
  getState: () => ipcRenderer.invoke('win:get-state'),
  onState: (callback) => {
    ipcRenderer.on('win:state', (_e, state) => callback(state))
  },
})
