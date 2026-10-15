import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import { RateLimiter, waitText } from './ratelimit.js'

/**
 * Файлы: фото, видео, аудио и всё остальное.
 *  - POST /api/uploads — сырое тело файла (имя — в заголовке X-File-Name). Тип определяем по первым байтам,
 *    а не по имени и не по Content-Type: «картинка.png», внутри которой html, станет просто файлом для скачивания.
 *  - GET /files/<id>.<ext> — раздача. Адрес и есть пропуск (128 случайных бит), без входа — чтобы <img> и <video>
 *    работали как обычно. Встраиваются только картинки, видео и аудио; остальное — всегда «скачать».
 *  - Неприкреплённые загрузки (выбрали файл и передумали) живут сутки, потом удаляются.
 *  - Аватарки и баннеры — тоже загрузки: POST /api/me/avatar { uploadId } и т. п.
 */

export const UPLOAD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/uploads')

const MB = 1024 * 1024
const positive = (v: string | undefined, def: number) => (Number(v) > 0 ? Number(v) : def)
/** Самый большой файл (UPLOAD_MAX_MB в server/.env) */
export const MAX_BYTES = Math.round(positive(process.env.UPLOAD_MAX_MB, 25) * MB)
/** Сколько один человек может загрузить за сутки */
const DAILY_BYTES = Math.round(positive(process.env.UPLOAD_DAILY_MB, 500) * MB)
/** Аватарка (в том числе анимированная GIF) и баннер */
const AVATAR_MAX = 2 * MB
const BANNER_MAX = 5 * MB
/** Картинки больше — только скачать: такую «бомбу» браузер может и не переварить */
const MAX_SIDE = 12_000
const MAX_PIXELS = 60_000_000

const DAY = 24 * 60 * 60_000
const HOUR = 60 * 60_000

/** Не больше 60 файлов за 10 минут от одного человека (альбом из отпуска пролезет, бесконечный поток — нет) */
const UPLOADS_PER_10_MIN = 60
const uploadsPerUser = new RateLimiter(UPLOADS_PER_10_MIN, 10 * 60_000)

/** Сколько байт человек загрузил за последние сутки (в памяти: после перезапуска счёт с нуля) */
const spent = new Map<string, { at: number; size: number }[]>()

function usedToday(userId: string) {
  const now = Date.now()
  const list = (spent.get(userId) ?? []).filter((x) => now - x.at < DAY)
  if (list.length) spent.set(userId, list)
  else spent.delete(userId)
  return list.reduce((sum, x) => sum + x.size, 0)
}

function spend(userId: string, size: number) {
  spent.set(userId, [...(spent.get(userId) ?? []), { at: Date.now(), size }])
}

export const uploadLimits = () => ({ maxBytes: MAX_BYTES, avatarMaxBytes: AVATAR_MAX, bannerMaxBytes: BANNER_MAX })

const fail = (res: Response, code: number, error: string) => void res.status(code).json({ error })

const mb = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} МБ`.replace('.', ',')

// ============ что за файл — по первым байтам ============

interface FileType {
  kind: store.UploadKind
  mime: string
  ext: string
}

const GENERIC: FileType = { kind: 'file', mime: 'application/octet-stream', ext: 'bin' }

const ascii = (b: Buffer, at: number, s: string) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s

/** Настоящий тип файла по сигнатуре; null — неизвестный (будет просто файлом) */
export function sniff(b: Buffer): FileType | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return { kind: 'image', mime: 'image/gif', ext: 'gif' }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp', ext: 'webp' }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav', ext: 'wav' }
  if (ascii(b, 4, 'ftyp')) {
    // MP4 / MOV / M4A: семейство ISO — различаем по «бренду»
    const brand = b.toString('latin1', 8, 12)
    if (/^M4[ABP] $/.test(brand)) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', ext: 'mov' }
    // HEIC/AVIF — картинки, которые показывают не все браузеры: пусть будут файлом
    if (/^(hei[cmsx]|hev[cmsx]|mif1|msf1|avif|avis|crx )$/.test(brand)) return null
    return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) {
    // Matroska: WebM — видео для браузера, остальное (mkv) — файл
    return b.toString('latin1', 0, Math.min(b.length, 64)).includes('webm') ? { kind: 'video', mime: 'video/webm', ext: 'webm' } : null
  }
  if (ascii(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' }
  // MP3: тег ID3 или сразу кадр (11 единичных бит синхронизации, слой и версия не «зарезервированные»)
  if (ascii(b, 0, 'ID3') || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0 && (b[1] & 0x18) !== 0x08)) {
    return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' }
  }
  if (ascii(b, 0, '%PDF-')) return { kind: 'file', mime: 'application/pdf', ext: 'pdf' }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x504b0304) return { kind: 'file', mime: 'application/zip', ext: 'zip' }
  return null
}

// ============ размеры картинки — из заголовка, без декодирования ============

interface Size {
  width: number
  height: number
}

const dims = (width: number, height: number): Size | undefined =>
  width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : undefined

export function imageSize(b: Buffer, ext: string): Size | undefined {
  try {
    if (ext === 'png') return b.length >= 24 ? dims(b.readUInt32BE(16), b.readUInt32BE(20)) : undefined
    if (ext === 'gif') return b.length >= 10 ? dims(b.readUInt16LE(6), b.readUInt16LE(8)) : undefined
    if (ext === 'webp') return webpSize(b)
    if (ext === 'jpg') return jpegSize(b)
  } catch {
    // битый заголовок — обойдёмся без размеров
  }
  return undefined
}

function webpSize(b: Buffer): Size | undefined {
  const chunk = b.toString('latin1', 12, 16)
  if (chunk === 'VP8 ' && b.length >= 30) return dims(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21)
    return dims((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X' && b.length >= 30) return dims(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1)
  return undefined
}

/** JPEG: размер — в маркере SOF; повёрнутые в EXIF фото (5–8) браузер показывает «боком» — меняем стороны */
function jpegSize(b: Buffer): Size | undefined {
  let i = 2
  let orientation = 1
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    if (marker === 0xe1 && ascii(b, i + 4, 'Exif\0\0')) orientation = exifOrientation(b, i + 10, i + 2 + len) ?? orientation
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(i + 5)
      const width = b.readUInt16BE(i + 7)
      return orientation >= 5 && orientation <= 8 ? dims(height, width) : dims(width, height)
    }
    i += 2 + len
  }
  return undefined
}

function exifOrientation(b: Buffer, tiff: number, end: number): number | undefined {
  const le = ascii(b, tiff, 'II')
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  const ifd = tiff + u32(tiff + 4)
  const count = u16(ifd)
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12
    if (entry + 12 > end) break
    if (u16(entry) === 0x0112) return u16(entry + 8)
  }
  return undefined
}

/** Размер видео присылает клиент (он его уже знает): «1920x1080» */
function mediaSize(header: unknown): Size | undefined {
  const m = typeof header === 'string' ? /^(\d{1,5})x(\d{1,5})$/.exec(header) : null
  if (!m) return undefined
  const size = dims(Number(m[1]), Number(m[2]))
  return size && size.width <= 10_000 && size.height <= 10_000 ? size : undefined
}

/** Имя файла: без путей, управляющих символов и «переворачивающих» текст (U+202E делает из exe.txt — txt.exe) */
export function cleanName(raw: unknown): string {
  let name = typeof raw === 'string' ? raw : ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // не URI — берём как есть
  }
  name = name
    .replace(/[\\/]/g, '_')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
    name = store.snip(name.slice(0, 120 - ext.length), 120 - ext.length) + ext
  }
  return name || 'файл'
}

// ============ загрузка ============

/**
 * Отказ до чтения файла (большой, слишком часто, сверх суточного лимита): тело дочитываем впустую и только потом
 * отвечаем — иначе браузер увидит обрыв соединения, а не понятную ошибку
 */
function refuse(req: Request, res: Response, code: number, error: string, retryAfterMs?: number) {
  if (retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
  const declared = Number(req.headers['content-length'])
  if (!(declared <= MAX_BYTES * 4)) {
    // совсем огромное (или неизвестной длины) дочитывать не будем — закрываем соединение
    res.setHeader('Connection', 'close')
    return fail(res, code, error)
  }
  req.resume()
  req.on('end', () => fail(res, code, error))
  req.on('error', () => res.destroy())
}

function admit(req: Request, res: Response, next: NextFunction) {
  const { user } = req as AuthedRequest
  const declared = Number(req.headers['content-length'])
  if (declared > MAX_BYTES) return refuse(req, res, 413, `Файл слишком большой — максимум ${mb(MAX_BYTES)}`)
  const wait = uploadsPerUser.retryAfter(user.id)
  if (wait) return refuse(req, res, 429, `Слишком много файлов подряд — попробуй ${waitText(wait)}`, wait)
  if (usedToday(user.id) + (declared || 0) > DAILY_BYTES) return refuse(req, res, 429, `На сегодня лимит загрузок (${mb(DAILY_BYTES)}) исчерпан — попробуй завтра`)
  uploadsPerUser.hit(user.id)
  next()
}

async function receive(req: Request, res: Response) {
  const { user } = req as AuthedRequest
  const body: unknown = req.body
  if (!Buffer.isBuffer(body) || body.length === 0) return fail(res, 400, 'Файл пустой — выбери другой')
  if (usedToday(user.id) + body.length > DAILY_BYTES) return fail(res, 429, `На сегодня лимит загрузок (${mb(DAILY_BYTES)}) исчерпан — попробуй завтра`)

  let type = sniff(body) ?? GENERIC
  let size: Size | undefined
  if (type.kind === 'image') {
    size = imageSize(body, type.ext)
    // неизмеримая или гигантская картинка — только скачать
    if (!size || size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
      type = { ...type, kind: 'file' }
      size = undefined
    }
  } else if (type.kind === 'video') {
    size = mediaSize(req.headers['x-media-size'])
  }

  const id = randomBytes(16).toString('hex')
  mkdirSync(UPLOAD_DIR, { recursive: true })
  await writeFile(resolve(UPLOAD_DIR, `${id}.${type.ext}`), body, { flag: 'wx' })
  const upload: store.Upload = {
    id,
    ext: type.ext,
    ownerId: user.id,
    name: cleanName(req.headers['x-file-name']),
    size: body.length,
    mime: type.mime,
    kind: type.kind,
    ...size,
    createdAt: Date.now(),
    attachedTo: null,
  }
  store.addUpload(upload)
  spend(user.id, body.length)
  res.json({ upload: store.attachmentOf(upload) })
}

/** Ошибки чтения тела: больше лимита (без Content-Length), оборванная передача */
function uploadErrors(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; type?: string }
  if (res.headersSent) return
  if (e?.type === 'entity.too.large' || e?.status === 413) return fail(res, 413, `Файл слишком большой — максимум ${mb(MAX_BYTES)}`)
  if (e?.status && e.status < 500) return fail(res, e.status, 'Файл не дошёл целиком — попробуй ещё раз')
  console.error('upload:', err)
  fail(res, 500, 'Не получилось сохранить файл')
}

/**
 * POST /api/uploads. Регистрировать ДО express.json(): иначе файл с Content-Type application/json
 * разобрал бы JSON-парсер. Тело читаем только у вошедших и после проверки лимитов.
 */
export function registerUploadRoute(app: Express) {
  app.post(
    '/api/uploads',
    requireAuth,
    admit,
    express.raw({ type: () => true, limit: MAX_BYTES }),
    (req: Request, res: Response, next: NextFunction) => void receive(req, res).catch(next),
    uploadErrors,
  )
}

// ============ раздача ============

/** Что браузеру можно показывать прямо на странице; всё остальное — только скачать */
const INLINE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
])

/** Content-Disposition с русским именем: ASCII-запасное + UTF-8 (RFC 6266) */
function disposition(type: 'inline' | 'attachment', name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_') || 'file'
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function registerFileRoutes(app: Express) {
  app.get(/^\/files\/([0-9a-f]{32})\.([a-z0-9]{1,8})$/, (req: Request, res: Response) => {
    const params = req.params as unknown as Record<string, string>
    const upload = store.findUpload(params[0])
    if (!upload || upload.ext !== params[1]) {
      res.status(404).type('text/plain').send('Файл не найден — возможно, его удалили')
      return
    }
    // ?dl — кнопка «Скачать»: даже картинку отдаём файлом
    const inline = upload.kind !== 'file' && INLINE.has(upload.mime) && req.query.dl === undefined
    res.set({
      'Content-Type': inline ? upload.mime : 'application/octet-stream',
      'Content-Disposition': disposition(inline ? 'inline' : 'attachment', upload.name),
      'X-Content-Type-Options': 'nosniff',
      // открыли файл отдельной вкладкой — ни скриптов, ни форм, даже если браузер вдруг решит, что это страница
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      // имя файла случайное и содержимое под ним никогда не меняется
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    // send понимает Range — видео можно мотать, не скачивая целиком
    res.sendFile(`${upload.id}.${upload.ext}`, { root: UPLOAD_DIR, dotfiles: 'deny' }, (err) => {
      if (!err || res.headersSent) return
      res.removeHeader('Content-Disposition')
      res.status(404).type('text/plain').send('Файл не найден — возможно, его удалили')
    })
  })
}

// ============ уборка ============

function removeFile(u: store.Upload) {
  store.removeUpload(u)
  try {
    unlinkSync(resolve(UPLOAD_DIR, `${u.id}.${u.ext}`))
  } catch {
    // файла уже нет — и ладно
  }
}

/** Удалить файлы, на которые больше никто не ссылается (удалили сообщение, сменили аватарку) */
export function releaseUploads(ids: string[]) {
  if (!ids.length) return
  const used = store.referencedUploads()
  for (const id of new Set(ids)) {
    const u = store.findUpload(id)
    if (u && !used.has(id)) removeFile(u)
  }
}

/**
 * Раз в час: загрузки, которые так ни к чему и не прикрепили (старше суток), и файлы на диске без записи в базе
 * (сервер упал между записью файла и базы) — старше часа.
 */
export function collectGarbage() {
  const used = store.referencedUploads()
  const now = Date.now()
  let removed = 0
  for (const u of [...store.allUploads()]) {
    if (used.has(u.id) || now - u.createdAt < DAY) continue
    removeFile(u)
    removed++
  }
  let names: string[] = []
  try {
    names = readdirSync(UPLOAD_DIR)
  } catch {
    return removed
  }
  for (const name of names) {
    const id = /^([0-9a-f]{32})\./.exec(name)?.[1]
    if (id && store.findUpload(id)) continue
    try {
      const path = resolve(UPLOAD_DIR, name)
      if (now - statSync(path).mtimeMs > HOUR) {
        unlinkSync(path)
        removed++
      }
    } catch {
      // уже удалили
    }
  }
  return removed
}

export function startUploads() {
  mkdirSync(UPLOAD_DIR, { recursive: true })
  store.setFilesReleased(releaseUploads)
  const run = () => {
    try {
      const n = collectGarbage()
      if (n) console.log(`  🧹 Убрал ${n} неприкреплённых файлов`)
    } catch (err) {
      console.error('uploads gc:', err)
    }
  }
  setTimeout(run, 5_000).unref()
  setInterval(run, HOUR).unref()
}

// ============ аватарка и баннер ============

interface ProfileDeps {
  fail: (res: Response, code: number, error: string) => void
  /** Разослать изменения профиля (всем — публичную часть, ему — целиком) */
  changed: (u: store.User) => void
  selfUser: (u: store.User) => unknown
}

/** POST /api/me/avatar|banner { uploadId } — поставить загруженную картинку; DELETE — убрать */
export function registerProfileMediaRoutes(app: Express, { fail, changed, selfUser }: ProfileDeps) {
  for (const slot of ['avatar', 'banner'] as const) {
    const max = slot === 'avatar' ? AVATAR_MAX : BANNER_MAX
    app.post(`/api/me/${slot}`, requireAuth, (req, res) => {
      const { user } = req as AuthedRequest
      const upload = typeof req.body?.uploadId === 'string' ? store.findUpload(req.body.uploadId) : undefined
      if (!upload || upload.ownerId !== user.id || upload.attachedTo) return fail(res, 404, 'Картинка не найдена — загрузи её ещё раз')
      if (upload.kind !== 'image') return fail(res, 400, 'Нужна картинка: PNG, JPEG, GIF или WebP')
      if (upload.size > max) return fail(res, 413, `Слишком большая картинка — максимум ${mb(max)}`)
      const old = user[slot]
      store.markUpload(upload, `${slot}:${user.id}`)
      store.updateUser(user, { [slot]: store.fileUrl(upload) })
      const oldId = store.uploadIdOf(old)
      if (oldId) releaseUploads([oldId])
      changed(user)
      res.json({ user: selfUser(user) })
    })
    app.delete(`/api/me/${slot}`, requireAuth, (req, res) => {
      const { user } = req as AuthedRequest
      const oldId = store.uploadIdOf(user[slot])
      store.updateUser(user, { [slot]: null })
      if (oldId) releaseUploads([oldId])
      changed(user)
      res.json({ user: selfUser(user) })
    })
  }
}
