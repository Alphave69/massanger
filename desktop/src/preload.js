// Мостик между страницами приложения и Electron. Сайту на сервере — только отметка «это приложение»;
// управление адресом сервера и выбор экрана доступны лишь локальным страницам (connect.html, picker.html).
const { contextBridge, ipcRenderer } = require('electron')

const local = location.protocol === 'file:'

contextBridge.exposeInMainWorld(
  'nuntiusDesktop',
  local
    ? {
        isDesktop: true,
        getServer: () => ipcRenderer.invoke('connect:get'),
        saveServer: (url) => ipcRenderer.invoke('connect:save', url),
        retry: () => ipcRenderer.send('connect:retry'),
        sources: () => ipcRenderer.invoke('picker:sources'),
        choose: (value) => ipcRenderer.send('picker:choose', value),
      }
    : { isDesktop: true },
)
