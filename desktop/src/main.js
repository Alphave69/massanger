// Nuntius для Windows — тонкая оболочка над сайтом: открывает твой сервер в отдельном окне,
// живёт в трее как Discord, умеет демонстрацию экрана со звуком и уведомления.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, net, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ICON = path.join(__dirname, 'icon.png')
const CONNECT_PAGE = path.join(__dirname, 'connect.html')
const PICKER_PAGE = path.join(__dirname, 'picker.html')

// ============ настройки ============

/** Адрес, «зашитый» при сборке (nuntius.config.json) */
function bakedUrl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nuntius.config.json'), 'utf8')).url || ''
  } catch {
    return ''
  }
}

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(patch) {
  config = { ...config, ...patch }
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  } catch {
    // не получилось сохранить — в следующий раз спросим ещё раз
  }
}

let config = {}
const serverUrl = () => config.url || bakedUrl()

/** Нормализуем адрес: https обязателен (голос и камера без него не работают), http — только для localhost */
function normalizeUrl(raw) {
  let text = String(raw || '').trim()
  if (!text) return { error: 'Впиши адрес сервера' }
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: 'Похоже, в адресе опечатка' }
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) return { error: 'Нужен адрес с https://' }
  return { url: url.origin }
}

const sameOrigin = (a, b) => {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

const isAppUrl = (u) => Boolean(serverUrl()) && sameOrigin(u, serverUrl())

// ============ окно ============

let win = null
let tray = null
let quitting = false

function createWindow() {
  const b = config.bounds || {}
  win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#000000', // без белой вспышки при запуске
    title: 'Nuntius',
    icon: ICON,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  if (config.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // Ссылки на другие сайты — в обычный браузер
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // Сервер недоступен — показываем страницу подключения с ошибкой и кнопкой «Повторить»
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* отменено */ || url.startsWith('file:')) return
    showConnect(`Не удалось открыть ${new URL(url).host}: ${description}`)
  })

  // «(3) Nuntius» в заголовке — непрочитанные: в подсказку трея и мигание на панели задач
  win.on('page-title-updated', (_e, title) => {
    const unread = Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0)
    tray?.setToolTip(unread ? `Nuntius — непрочитанных: ${unread}` : 'Nuntius')
    if (unread && !win.isFocused()) win.flashFrame(true)
  })
  win.on('focus', () => win.flashFrame(false))

  // Закрыть = свернуть в трей (как Discord); выйти — через меню трея
  win.on('close', (e) => {
    rememberBounds()
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)

  openApp()
}

let boundsTimer = null
function rememberBounds() {
  if (!win || win.isDestroyed()) return
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const maximized = win.isMaximized()
    saveConfig({ maximized, bounds: maximized ? config.bounds : win.getBounds() })
  }, 400)
}

function openApp() {
  const url = serverUrl()
  if (url) void win.loadURL(url)
  else showConnect()
}

function showConnect(error) {
  void win.loadFile(CONNECT_PAGE, { query: { url: serverUrl(), error: error || '' } })
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ============ трей ============

function buildTray() {
  const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('Nuntius')
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Открыть Nuntius', click: showWindow },
      { label: 'Сменить сервер…', click: () => (showWindow(), showConnect()) },
      { type: 'separator' },
      {
        label: 'Запускать вместе с Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked })
          tray.setContextMenu(menu())
        },
      },
      { type: 'separator' },
      {
        label: 'Выйти',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
  tray.setContextMenu(menu())
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()))
}

// ============ права: микрофон, камера, уведомления, экран ============

const ALLOWED = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])

function setupPermissions() {
  const s = session.defaultSession
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED.has(permission) && isAppUrl(details.requestingUrl || wc.getURL()))
  })
  s.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED.has(permission) && isAppUrl(origin))

  // Демонстрация экрана: своё окно выбора экрана или окна (со звуком системы на Windows)
  s.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isAppUrl(request.securityOrigin || request.frame?.url || '')) return callback({})
    try {
      const choice = await pickSource()
      if (!choice) return callback({})
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const source = sources.find((x) => x.id === choice.id)
      if (!source) return callback({})
      callback(choice.audio && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source })
    } catch {
      callback({})
    }
  })
}

let picker = null
function pickSource() {
  return new Promise((resolve) => {
    if (picker) picker.close()
    picker = new BrowserWindow({
      parent: win,
      modal: true,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#000000',
      title: 'Что показать?',
      icon: ICON,
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      ipcMain.removeListener('picker:choose', onChoose)
      if (picker && !picker.isDestroyed()) picker.close()
      picker = null
      resolve(value)
    }
    const onChoose = (e, value) => fromLocal(e) && finish(value || null)
    ipcMain.on('picker:choose', onChoose)
    picker.on('closed', () => finish(null))
    picker.once('ready-to-show', () => picker.show())
    void picker.loadFile(PICKER_PAGE)
  })
}

/** Команды принимаем только от своих локальных страниц, не от сайта */
const fromLocal = (e) => (e.senderFrame?.url || '').startsWith('file:')

ipcMain.handle('picker:sources', async (e) => {
  if (!fromLocal(e)) return { audio: false, sources: [] }
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
  return {
    audio: process.platform === 'win32',
    sources: sources
      .filter((s) => s.name !== 'Что показать?')
      .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumbnail: s.thumbnail.toDataURL() })),
  }
})

// ============ страница подключения ============

ipcMain.handle('connect:get', () => ({ url: serverUrl() }))

ipcMain.handle('connect:save', async (e, raw) => {
  if (!fromLocal(e)) return { error: 'Нельзя' }
  const { url, error } = normalizeUrl(raw)
  if (error) return { error }
  try {
    const res = await net.fetch(`${url}/api/me`, { signal: AbortSignal.timeout(8000) })
    // 401 — нормально: сервер ответил, просто мы ещё не вошли
    if (res.status >= 500) return { error: `Сервер ответил ошибкой ${res.status}` }
  } catch {
    return { error: 'Сервер не отвечает — проверь адрес и интернет' }
  }
  saveConfig({ url })
  void win.loadURL(url)
  return { ok: true }
})

ipcMain.on('connect:retry', (e) => fromLocal(e) && openApp())

// ============ запуск ============

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.setAppUserModelId('ru.nuntius.app')
  app.whenReady().then(() => {
    config = loadConfig()
    Menu.setApplicationMenu(null)
    setupPermissions()
    createWindow()
    buildTray()
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    // живём в трее
  })
}
