// Nuntius для Windows — тонкая оболочка над сайтом: открывает твой сервер в своём чёрном окне
// (рамка нарисована нами, как в Discord), живёт в трее, умеет демонстрацию экрана со звуком,
// уведомления и сама обновляется.
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  WebContentsView,
  clipboard,
  desktopCapturer,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  session,
  shell,
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ICON = path.join(__dirname, 'icon.png')
const CONNECT_PAGE = path.join(__dirname, 'connect.html')
const PICKER_PAGE = path.join(__dirname, 'picker.html')
const TITLEBAR_PAGE = path.join(__dirname, 'titlebar.html')
const BAR_HEIGHT = 32 // высота нашей полоски заголовка, сайт — сразу под ней
const UPDATE_EVERY = 6 * 60 * 60 * 1000 // проверка обновлений раз в 6 часов

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

let win = null // окно: само рисует полоску заголовка (titlebar.html)
let view = null // сайт (или страница подключения) — под полоской
let tray = null
let quitting = false
let htmlFullscreen = false // сайт развернул видео или демонстрацию на весь экран
let unread = 0
let updateReady = false // новая версия скачана и ждёт перезапуска

const site = () => view.webContents
const isFullscreen = () => htmlFullscreen || win.isFullScreen()

function createWindow() {
  const b = config.bounds || {}
  win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    minWidth: 940,
    minHeight: 600,
    frame: false, // без белой рамки Windows — свою рисует titlebar.html
    backgroundColor: '#000000', // без белой вспышки при запуске
    title: 'Nuntius',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'titlebar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  // Сайт живёт в отдельном «слое» под полоской заголовка
  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  view.setBackgroundColor('#000000')
  win.contentView.addChildView(view)
  layout()
  // размер окна поменялся любым способом (растянули, двойной клик по полоске, Win+↑) — подгоняем сайт
  win.contentView.on('bounds-changed', layout)

  if (config.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // Полоска заголовка — только наша локальная страница: никуда не уходит и ничего не открывает
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Заголовок окна на панели задач берём у сайта, а не у полоски
  win.on('page-title-updated', (e) => e.preventDefault())
  void win.loadFile(TITLEBAR_PAGE)

  for (const event of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, () => {
      layout()
      sendState()
    })
  }
  win.on('leave-full-screen', () => {
    // окно вышло из полного экрана не через сайт — пусть и сайт выйдет
    if (!htmlFullscreen) return
    htmlFullscreen = false
    layout()
    sendState()
    site()
      .executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true)
      .catch(() => {})
  })

  // Окно получило фокус — сразу в сайт, чтобы можно было печатать без лишнего клика
  win.on('focus', () => {
    win.flashFrame(false)
    if (!site().isDestroyed()) site().focus()
    sendState()
  })
  win.on('blur', sendState)

  // Закрыть = свернуть в трей (как Discord); выйти — через меню трея
  win.on('close', (e) => {
    saveBounds()
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)

  setupSite()
  openApp()
}

/** Раскладка: полоска сверху, сайт под ней; в полном экране сайт на всё окно */
function layout() {
  if (!win || win.isDestroyed()) return
  const { width, height } = win.contentView.getBounds()
  const top = isFullscreen() ? 0 : BAR_HEIGHT
  view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
}

/** Состояние для полоски заголовка: какие кнопки рисовать, тусклая ли она, есть ли непрочитанное */
function windowState() {
  return {
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    fullscreen: isFullscreen(),
    unread,
    update: updateReady ? 'ready' : null,
  }
}

function sendState() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('win:state', windowState())
}

function setupSite() {
  const wc = site()

  // Ссылки на другие сайты — в обычный браузер
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Уходить можно только по своему серверу; файлы, брошенные в окно, страницу не подменяют
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })

  // Сервер недоступен — показываем страницу подключения с ошибкой и кнопкой «Повторить»
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* отменено */ || url.startsWith('file:')) return
    let host = url
    try {
      host = new URL(url).host
    } catch {
      // оставим как есть
    }
    showConnect(`Не удалось открыть ${host}: ${description}`)
  })
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    showConnect('Страница неожиданно закрылась — нажми «Повторить»')
  })

  // «(3) Nuntius» в заголовке — непрочитанные: в полоску, в подсказку трея и мигание на панели задач
  wc.on('page-title-updated', (_e, title) => {
    unread = Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0)
    win.setTitle(title || 'Nuntius')
    tray?.setToolTip(unread ? `Nuntius — непрочитанных: ${unread}` : 'Nuntius')
    if (unread && !win.isFocused()) win.flashFrame(true)
    sendState()
  })

  // Видео или демонстрация на весь экран: окно — в полный экран, полоска прячется
  wc.on('enter-html-full-screen', () => {
    htmlFullscreen = true
    win.setFullScreen(true)
    layout()
    sendState()
  })
  wc.on('leave-html-full-screen', () => {
    htmlFullscreen = false
    win.setFullScreen(false)
    layout()
    sendState()
  })

  // F5 / Ctrl+R — обновить, Ctrl+Shift+I — инструменты разработчика (по коду клавиши, чтобы работало и в русской раскладке)
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    // AltGr в Windows приходит как Ctrl+Alt — такие сочетания не трогаем, это ввод символов
    const ctrl = (input.control || input.meta) && !input.alt
    if (input.code === 'F5' || (ctrl && !input.shift && input.code === 'KeyR')) {
      e.preventDefault()
      reloadSite()
    } else if (ctrl && input.shift && input.code === 'KeyI') {
      e.preventDefault()
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
    }
  })

  // Правый клик там, где сайт не показал своё меню: копировать, вставить, ссылки, орфография
  wc.on('context-menu', (_e, params) => {
    const items = contextMenuItems(wc, params)
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

function contextMenuItems(wc, params) {
  const groups = []
  const flags = params.editFlags || {}

  if (params.isEditable) {
    const spelling = []
    if (params.misspelledWord) {
      for (const word of (params.dictionarySuggestions || []).slice(0, 5)) {
        spelling.push({ label: word, click: () => wc.replaceMisspelling(word) })
      }
      if (!spelling.length) spelling.push({ label: 'Нет вариантов', enabled: false })
      spelling.push({
        label: 'Добавить в словарь',
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      })
      groups.push(spelling)
    }
    groups.push([
      { label: 'Вырезать', role: 'cut', enabled: Boolean(flags.canCut) },
      { label: 'Копировать', role: 'copy', enabled: Boolean(flags.canCopy) },
      { label: 'Вставить', role: 'paste', enabled: Boolean(flags.canPaste) },
    ])
    groups.push([{ label: 'Выделить всё', role: 'selectAll', enabled: flags.canSelectAll !== false }])
  } else if (params.selectionText && params.selectionText.trim()) {
    groups.push([{ label: 'Копировать', role: 'copy' }])
  }

  const link = params.linkURL
  if (link && /^(https?|mailto):/i.test(link)) {
    groups.push([
      { label: 'Открыть ссылку в браузере', click: () => void shell.openExternal(link) },
      { label: 'Копировать ссылку', click: () => clipboard.writeText(link) },
    ])
  }

  if (params.mediaType === 'image' && params.hasImageContents !== false) {
    groups.push([
      { label: 'Копировать картинку', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Сохранить картинку как…', click: () => wc.downloadURL(params.srcURL) },
    ])
  }

  // группы через разделители
  return groups.flatMap((group, i) => (i ? [{ type: 'separator' }, ...group] : group))
}

function reloadSite() {
  // на странице подключения «обновить» = попробовать сервер ещё раз
  if (site().getURL().startsWith('file:')) openApp()
  else site().reload()
}

let boundsTimer = null
function rememberBounds() {
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(saveBounds, 400)
}

function saveBounds() {
  clearTimeout(boundsTimer)
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  const maximized = win.isMaximized()
  saveConfig({ maximized, bounds: maximized ? config.bounds : win.getBounds() })
}

function openApp() {
  const url = serverUrl()
  if (url) void site().loadURL(url)
  else showConnect()
}

function showConnect(error) {
  void site().loadFile(CONNECT_PAGE, { query: { url: serverUrl(), error: error || '' } })
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ============ полоска заголовка: свернуть, развернуть, закрыть, обновить ============

/** Кнопки окна принимаем только от нашей полоски заголовка */
const fromBar = (e) => Boolean(win) && !win.isDestroyed() && e.sender.id === win.webContents.id

ipcMain.handle('win:get-state', (e) => (fromBar(e) ? windowState() : null))
ipcMain.on('win:minimize', (e) => fromBar(e) && win.minimize())
ipcMain.on('win:toggle-maximize', (e) => {
  if (!fromBar(e)) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  site().focus()
})
ipcMain.on('win:close', (e) => fromBar(e) && win.close()) // close → прячем в трей
ipcMain.on('win:update', (e) => fromBar(e) && installUpdate())

// ============ трей ============

function buildTray() {
  const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('Nuntius')
  refreshTrayMenu()
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()))
}

function refreshTrayMenu() {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Nuntius', click: showWindow },
      { label: 'Сменить сервер…', click: () => (showWindow(), showConnect()) },
      ...(updateReady ? [{ label: 'Перезапустить и обновить', click: installUpdate }] : []),
      { type: 'separator' },
      {
        label: 'Запускать вместе с Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked })
          refreshTrayMenu()
        },
      },
      { type: 'separator' },
      { label: `Версия ${app.getVersion()}`, enabled: false },
      {
        label: 'Выйти',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

// ============ обновления: сами качаются с GitHub, ставятся по кнопке «Обновить» ============

let updater = null

function setupUpdates() {
  // только установленная версия для Windows; портативная и сборка «из папки» не обновляются
  if (!app.isPackaged || process.platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_DIR) return
  try {
    updater = require('electron-updater').autoUpdater
  } catch (err) {
    console.warn('[обновления] модуль не загрузился:', err?.message || err)
    return
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  // установщик уже запущен и приложение вот-вот закроется — окно больше не прячем в трей
  require('electron').autoUpdater.on('before-quit-for-update', () => {
    quitting = true
  })
  // ошибки (нет интернета, GitHub недоступен) — только в лог, без окошек
  updater.on('error', (err) => console.warn('[обновления]', err?.message || err))
  updater.on('update-downloaded', (info) => {
    console.log('[обновления] скачана версия', info?.version)
    updateReady = true
    sendState()
    refreshTrayMenu()
  })
  const check = () => {
    try {
      updater.checkForUpdates()?.catch((err) => console.warn('[обновления]', err?.message || err))
    } catch (err) {
      console.warn('[обновления]', err?.message || err)
    }
  }
  setTimeout(check, 15_000) // не мешаем запуску
  setInterval(check, UPDATE_EVERY)
}

function installUpdate() {
  if (!updater || !updateReady) return
  // quitting здесь не ставим: если установщик не запустится, app.quit() не будет, и крестик должен
  // по-прежнему прятать окно в трей. Когда выход настоящий, quitting выставит before-quit.
  try {
    updater.quitAndInstall(true, true) // тихо поставить и сразу запустить новую версию
  } catch (err) {
    console.warn('[обновления] не получилось установить:', err?.message || err)
  }
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
  void site().loadURL(url)
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
    nativeTheme.themeSource = 'dark' // тёмные системные меню и рамка окна выбора экрана
    Menu.setApplicationMenu(null)
    setupPermissions()
    createWindow()
    buildTray()
    setupUpdates()
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    // живём в трее
  })
}
