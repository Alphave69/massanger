// Nuntius — service worker.
// Нужен, чтобы сайт ставился «как приложение» на телефон, и чтобы без интернета
// открывался сам Nuntius (с плашкой «нет связи»), а не ошибка браузера.
//  - страницы: сначала из сети (всегда свежая версия), без сети — сохранённая главная «/»;
//  - /assets/*: файлы с хешем в имени никогда не меняются — берём из кэша;
//  - /api и /socket.io и всё чужое — не трогаем вообще, только сеть.

const CACHE = 'nuntius-v1'
const SHELL = '/'
const MAX_ASSETS = 80

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch(new Request(SHELL, { cache: 'reload' }))
      .then((res) => (isHtml(res) ? saveShell(res) : undefined))
      .catch(() => {}) // нет сети — сохраним главную при следующем заходе
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('nuntius-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event))
    return
  }
  if (url.pathname.startsWith('/assets/') && !req.headers.has('range')) {
    event.respondWith(cacheFirst(req))
  }
})

async function networkFirst(event) {
  let res
  try {
    res = await fetch(event.request)
  } catch {
    const cached = await caches.match(SHELL)
    return cached || offlinePage()
  }
  if (isHtml(res)) {
    const saving = saveShell(res.clone()).catch(() => {})
    try {
      event.waitUntil(saving)
    } catch {
      // старый браузер не дал продлить событие — сохранение всё равно идёт
    }
  } else if (res.status >= 502 && res.status <= 504) {
    // сервер перезапускается (обновление) — открываем сохранённый Nuntius, он сам подождёт связи
    const cached = await caches.match(SHELL)
    if (cached) return cached
  }
  return res
}

function isHtml(res) {
  return res.status === 200 && (res.headers.get('content-type') || '').includes('text/html')
}

// Главная и всё, что ей нужно для запуска (скрипт и стили сборки), — чтобы без сети Nuntius открылся
// даже тогда, когда его поставили на телефон сразу после первого захода
async function saveShell(res) {
  const cache = await caches.open(CACHE)
  const html = await res.clone().text()
  await cache.put(SHELL, res)
  const files = new Set()
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) files.add(m[1])
  await Promise.all(
    [...files].map(async (file) => {
      if (await cache.match(file)) return
      const got = await fetch(file)
      if (got.status === 200) await cache.put(file, got)
    }).map((p) => p.catch(() => {})),
  )
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.status === 200 && res.type === 'basic') {
    await cache.put(req, res.clone()).catch(() => {})
    trimAssets(cache)
  }
  return res
}

// Старые сборки не копим: держим только последние MAX_ASSETS файлов
async function trimAssets(cache) {
  try {
    const keys = await cache.keys()
    const assets = keys.filter((key) => new URL(key.url).pathname.startsWith('/assets/'))
    const extra = assets.length - MAX_ASSETS
    for (let i = 0; i < extra; i++) await cache.delete(assets[i])
  } catch {
    // не получилось почистить — не страшно
  }
}

// Самый первый заход без сети: главной в кэше ещё нет
function offlinePage() {
  const html =
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="theme-color" content="#000000"><title>Nuntius</title></head>' +
    '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#b0b0b0;font:15px system-ui,sans-serif;text-align:center">' +
    '<div><div style="font:700 22px system-ui,sans-serif;color:#fff;margin-bottom:8px">Nuntius</div>Нет подключения к интернету.<br>Как только связь появится — обнови страницу.</div>' +
    '</body></html>'
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
