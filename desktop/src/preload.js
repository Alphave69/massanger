// Мостик между страницами приложения и Electron. Сайту на сервере — только отметка «это приложение»;
// управление адресом сервера — лишь странице подключения (connect.html), выбор экрана — лишь карточке
// выбора (picker.html, слой поверх сайта). main.js вдобавок проверяет, от кого пришла команда.
// Сайт может только сообщить цвета своей темы — под них перекрашивается полоска заголовка.
const { contextBridge, ipcRenderer } = require('electron')

const local = location.protocol === 'file:'
const page = local ? decodeURIComponent(location.pathname).split('/').pop() : ''

contextBridge.exposeInMainWorld(
  'nuntiusDesktop',
  page === 'connect.html'
    ? {
        isDesktop: true,
        getServer: () => ipcRenderer.invoke('connect:get'),
        saveServer: (url) => ipcRenderer.invoke('connect:save', url),
        retry: () => ipcRenderer.send('connect:retry'),
      }
    : page === 'picker.html'
      ? {
          isDesktop: true,
          sources: () => ipcRenderer.invoke('picker:sources'),
          choose: (value) => ipcRenderer.send('picker:choose', value),
        }
      : { isDesktop: true, setTheme: (theme) => ipcRenderer.send('site:theme', theme) },
)
