import { randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { Express, NextFunction, Request, Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import { RateLimiter, waitText } from './ratelimit.js'
import { stripImage, stripVideo } from './metadata.js'

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
/**
 * Картинки больше — только скачать: картинку показывают у всех, а в памяти телефона она занимает
 * ширина × высота × 4 байта (16,7 Мп — уже 64 МБ). Клиент сам уменьшает фото до 2560 px, так что это только против «бомб»
 */
const MAX_SIDE = 8192
const MAX_PIXELS = 4096 * 4096
/** Аватарку и баннер обрезает клиент (256×256 и 960×320); GIF-аватарку ставит целиком — с запасом */
const PROFILE_PIXELS = { avatar: { w: 1024, h: 1024 }, banner: { w: 1920, h: 640 } } as const

/** Сколько загрузок идёт одновременно — у одного человека и у всех вместе (диск и процессор не резиновые) */
const INFLIGHT_PER_USER = 3
const INFLIGHT_TOTAL = 8
const inflight = new Map<string, number>()
let inflightTotal = 0

const DAY = 24 * 60 * 60_000
const HOUR = 60 * 60_000

/** Не больше 60 файлов за 10 минут от одного человека (альбом из отпуска пролезет, бесконечный поток — нет) */
const UPLOADS_PER_10_MIN = 60
const uploadsPerUser = new RateLimiter(UPLOADS_PER_10_MIN, 10 * 60_000)

/**
 * Сколько байт человек загрузил за последние сутки (в памяти: после перезапуска счёт с нуля).
 * Место под файл занимаем ДО чтения (по Content-Length), после — поправляем на настоящий размер или возвращаем:
 * иначе десяток параллельных загрузок увидели бы «0 из 500 МБ» все разом
 */
interface Spent {
  at: number
  size: number
}
const spent = new Map<string, Spent[]>()

function usedToday(userId: string) {
  const now = Date.now()
  const list = (spent.get(userId) ?? []).filter((x) => now - x.at < DAY)
  if (list.length) spent.set(userId, list)
  else spent.delete(userId)
  return list.reduce((sum, x) => sum + x.size, 0)
}

/** Через сколько освободится место: когда самая старая загрузка выйдет из суточного окна */
function quotaRetry(userId: string) {
  const oldest = spent.get(userId)?.[0]
  return oldest ? Math.max(60_000, oldest.at + DAY - Date.now()) : HOUR
}

function reserve(userId: string, size: number): Spent {
  const entry = { at: Date.now(), size }
  spent.set(userId, [...(spent.get(userId) ?? []), entry])
  return entry
}

function unreserve(userId: string, entry: Spent) {
  const list = (spent.get(userId) ?? []).filter((x) => x !== entry)
  if (list.length) spent.set(userId, list)
  else spent.delete(userId)
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
  // MP3: тег ID3 или сразу настоящий кадр MPEG (а не, например, текст UTF-16 с меткой FF FE)
  if (ascii(b, 0, 'ID3') || mpegFrame(b)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' }
  if (ascii(b, 0, '%PDF-')) return { kind: 'file', mime: 'application/pdf', ext: 'pdf' }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x504b0304) return { kind: 'file', mime: 'application/zip', ext: 'zip' }
  return null
}

/** Скорость (кбит/с) по индексу: MPEG-1 Layer III, MPEG-1 Layer II, MPEG-2/2.5 Layer II и III */
const BITRATES = {
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/**
 * Заголовок кадра MP3/MP2 без «зарезервированных» значений, и следующий кадр — там, где он должен быть
 * (если файл длиннее одного кадра). Layer I не берём: под него попадают FF FE / FF FF — метки UTF-16
 */
function mpegFrame(b: Buffer, at = 0): boolean {
  if (b.length < at + 4 || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return false
  const version = (b[at + 1] >> 3) & 3 // 3 — MPEG-1, 2 — MPEG-2, 0 — MPEG-2.5, 1 — зарезервировано
  const layer = (b[at + 1] >> 1) & 3 // 1 — III, 2 — II, 3 — I, 0 — зарезервировано
  if (version === 1 || (layer !== 1 && layer !== 2)) return false
  const rateIndex = b[at + 2] >> 4
  const freqIndex = (b[at + 2] >> 2) & 3
  if (rateIndex === 0 || rateIndex === 15 || freqIndex === 3) return false
  if (at > 0) return true
  const kbps = (version === 3 ? (layer === 1 ? BITRATES.v1l3 : BITRATES.v1l2) : BITRATES.v2)[rateIndex]
  const freq = RATES[version][freqIndex]
  const padding = (b[at + 2] >> 1) & 1
  const length = Math.floor(((version !== 3 && layer === 1 ? 72_000 : 144_000) * kbps) / freq) + padding
  if (b.length < length + 4) return true // файл из одного кадра (или прислали только начало)
  return mpegFrame(b, length)
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
    // половинки эмодзи без пары (обрезанное имя) — с ними имя файла не отдать в заголовке
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim()
  if (name.length > 120) {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
    // snip не разрезает эмодзи пополам (обрезаем всё имя, а не уже отрезанный кусок)
    name = store.snip(name.slice(0, name.length - ext.length), 120 - ext.length) + ext
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
  if ((inflight.get(user.id) ?? 0) >= INFLIGHT_PER_USER || inflightTotal >= INFLIGHT_TOTAL) {
    return refuse(req, res, 429, 'Слишком много файлов сразу — подожди, пока загрузятся предыдущие', 5_000)
  }
  // Длина неизвестна — занимаем по максимуму, после чтения вернём лишнее
  const need = declared > 0 ? declared : MAX_BYTES
  if (usedToday(user.id) + need > DAILY_BYTES) {
    return refuse(req, res, 429, `На сегодня лимит загрузок (${mb(DAILY_BYTES)}) исчерпан — попробуй завтра`, quotaRetry(user.id))
  }
  uploadsPerUser.hit(user.id)
  const entry = reserve(user.id, need)
  inflight.set(user.id, (inflight.get(user.id) ?? 0) + 1)
  inflightTotal++
  let done = false
  const release = () => {
    if (done) return
    done = true
    inflightTotal--
    const left = (inflight.get(user.id) ?? 1) - 1
    if (left > 0) inflight.set(user.id, left)
    else inflight.delete(user.id)
  }
  res.on('close', release)
  res.locals.quota = entry
  next()
}

/** Сколько первых байт нужно, чтобы узнать тип (и проверить второй кадр MP3) */
const HEAD_BYTES = 8192

/**
 * Тело пишем сразу на диск (во временный файл), а не держим в памяти: 25 МБ × несколько загрузок
 * на сервере с 1 ГБ памяти — уже опасно. Считаем байты по пути и обрываем всё, что длиннее лимита
 */
async function saveBody(req: Request, path: string) {
  let size = 0
  const head: Buffer[] = []
  let headSize = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length
      if (size > MAX_BYTES) return cb(Object.assign(new Error('too large'), { status: 413 }))
      if (headSize < HEAD_BYTES) {
        head.push(chunk.subarray(0, HEAD_BYTES - headSize))
        headSize += Math.min(chunk.length, HEAD_BYTES - headSize)
      }
      cb(null, chunk)
    },
  })
  await pipeline(req, counter, createWriteStream(path, { flags: 'wx' }))
  return { size, head: Buffer.concat(head) }
}

async function receive(req: Request, res: Response) {
  const { user } = req as AuthedRequest
  const quota = res.locals.quota as Spent
  const id = randomBytes(16).toString('hex')
  mkdirSync(UPLOAD_DIR, { recursive: true })
  // недописанный файл GC уберёт через час, если сервер упадёт посреди загрузки
  const tmp = resolve(UPLOAD_DIR, `${id}.part`)
  let saved = false
  try {
    let { size, head } = await saveBody(req, tmp)
    if (size === 0) return fail(res, 400, 'Файл пустой — выбери другой')
    // заняли по Content-Length — теперь знаем настоящий размер
    quota.size = size
    if (usedToday(user.id) > DAILY_BYTES) {
      res.setHeader('Retry-After', String(Math.ceil(quotaRetry(user.id) / 1000)))
      return fail(res, 429, `На сегодня лимит загрузок (${mb(DAILY_BYTES)}) исчерпан — попробуй завтра`)
    }

    let type = sniff(head) ?? GENERIC
    let dim: Size | undefined
    if (type.kind === 'image') {
      // картинку читаем целиком (до 25 МБ, и не больше INFLIGHT_TOTAL сразу): вырезаем EXIF/GPS и узнаём размер
      let body: Buffer = await readFile(tmp)
      const clean = stripImage(body, type.ext)
      if (clean) {
        body = clean
        size = body.length
        quota.size = size
        await writeFile(tmp, body)
      }
      dim = imageSize(body, type.ext)
      // неизмеримая или гигантская картинка — только скачать
      if (!dim || dim.width > MAX_SIDE || dim.height > MAX_SIDE || dim.width * dim.height > MAX_PIXELS) {
        type = { ...type, kind: 'file' }
        dim = undefined
      }
    } else if (type.kind === 'video' || type.ext === 'm4a') {
      // координаты в видео с телефона (©xyz, location) — блоки переименовываем на месте
      const fh = await open(tmp, 'r+')
      try {
        await stripVideo(fh, size)
      } catch (err) {
        console.error('upload: video metadata:', err)
      } finally {
        await fh.close()
      }
      if (type.kind === 'video') dim = mediaSize(req.headers['x-media-size'])
    }

    await rename(tmp, resolve(UPLOAD_DIR, `${id}.${type.ext}`))
    saved = true
    const upload: store.Upload = {
      id,
      ext: type.ext,
      ownerId: user.id,
      name: cleanName(req.headers['x-file-name']),
      size,
      mime: type.mime,
      kind: type.kind,
      ...dim,
      createdAt: Date.now(),
      attachedTo: null,
    }
    store.addUpload(upload)
    res.json({ upload: store.attachmentOf(upload) })
  } finally {
    if (!saved) {
      unreserve(user.id, quota)
      await rm(tmp, { force: true }).catch(() => {})
    }
  }
}

/** Ошибки чтения тела: больше лимита (без Content-Length), оборванная передача */
function uploadErrors(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; code?: string }
  if (res.headersSent) return
  if (e?.status === 413) {
    res.setHeader('Connection', 'close')
    return fail(res, 413, `Файл слишком большой — максимум ${mb(MAX_BYTES)}`)
  }
  if (e?.code === 'ERR_STREAM_PREMATURE_CLOSE' || e?.code === 'ECONNRESET' || (e?.status && e.status < 500)) {
    return fail(res, 400, 'Файл не дошёл целиком — попробуй ещё раз')
  }
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

/** Content-Disposition с русским именем: ASCII-запасное + UTF-8 (RFC 6266 / RFC 5987) */
function disposition(type: 'inline' | 'attachment', name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_') || 'file'
  let encoded: string
  try {
    // ' ( ) * encodeURIComponent оставляет как есть, а в RFC 5987 им нельзя
    encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  } catch {
    // битое имя (старые записи с половинкой эмодзи) — пусть лучше «file», чем ошибка 500
    return `${type}; filename="${fallback}"`
  }
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`
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
      const status = (err as { status?: number }).status ?? 500
      // Range за концом файла (плеер «прощупывает») — 416, а не «файл удалили»
      if (status === 416) {
        res.setHeader('Content-Range', `bytes */${upload.size}`)
        res.status(416).end()
        return
      }
      if (status !== 404 && status >= 400 && status < 500) {
        res.status(status).end()
        return
      }
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
      // её рисуют у всех и везде: огромную по точкам (даже лёгкую) не ставим
      const box = PROFILE_PIXELS[slot]
      if (!upload.width || !upload.height || upload.width > box.w || upload.height > box.h) {
        return fail(res, 413, `Слишком большая картинка по размеру — до ${box.w}×${box.h} точек`)
      }
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
