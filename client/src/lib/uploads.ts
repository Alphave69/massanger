import { getToken, type Attachment, type AttachmentKind, type Message, type UploadLimits } from './api'

/**
 * Загрузка файлов: XHR (ради прогресса), подготовка фото (большие — уменьшаем, JPEG — пережимаем,
 * чтобы не утекали EXIF с геолокацией), размеры видео, подписи «📷 Фото» вместо текста.
 */

const MB = 1024 * 1024

let limits: UploadLimits = { maxBytes: 100 * MB, avatarMaxBytes: 2 * MB, bannerMaxBytes: 5 * MB }

/** Лимиты с сервера (приходят вместе с /api/state) */
export function setUploadLimits(next: Partial<UploadLimits> | undefined) {
  if (next) limits = { ...limits, ...next }
}

export const uploadLimits = () => limits

/** Больше файлов в одном сообщении сервер не примет */
export const MAX_FILES = 10

/** «820 Б», «14 КБ», «3,2 МБ» */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < MB) return `${Math.round(bytes / 1024)} КБ`
  const mb = bytes / MB
  return `${(mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)).toString().replace('.', ',')} МБ`
}

/** Что это за файл — на глаз, по типу из браузера (настоящий тип определит сервер) */
export function guessKind(file: Blob): AttachmentKind {
  const t = file.type
  if (/^image\/(png|jpeg|gif|webp)$/.test(t)) return 'image'
  if (/^video\//.test(t)) return 'video'
  if (/^audio\//.test(t)) return 'audio'
  return 'file'
}

/** Расширение из имени: «отчёт.final.PDF» → «pdf» */
export const extOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? ''

/** Подпись вместо текста: «📷 Фото», «🎬 Видео», «📎 Файл» (так же считает сервер) */
export function attachmentsLabel(list: Attachment[] | undefined): string {
  if (!list?.length) return ''
  const n = list.length
  const all = (kind: AttachmentKind) => list.every((a) => a.kind === kind)
  if (all('image')) return n > 1 ? `📷 ${n} фото` : '📷 Фото'
  if (all('video')) return n > 1 ? `🎬 ${n} видео` : '🎬 Видео'
  if (all('audio')) return n > 1 ? `🎵 Аудио ×${n}` : '🎵 Аудио'
  return n > 1 ? `📎 Файлы ×${n}` : '📎 Файл'
}

/** Текст сообщения для уведомлений и цитат: сам текст, а если его нет — что прикреплено */
export const messagePreview = (m: Pick<Message, 'content' | 'attachments'>) => m.content || attachmentsLabel(m.attachments)

export class UploadError extends Error {}

interface UploadOptions {
  onProgress?: (part: number) => void
  signal?: AbortSignal
  /** Ширина и высота видео — сервер сам их не узнаёт */
  mediaSize?: { width: number; height: number } | null
}

/** Одновременно грузим не больше двух файлов: сервер принимает от человека до трёх сразу, остальные ждут очереди */
const PARALLEL = 2
let running = 0
const waiting: (() => void)[] = []

/** Сервер занят (много загрузок сразу, например из второй вкладки) — подождать и повторить */
class BusyError extends Error {
  constructor(readonly waitMs: number) {
    super('busy')
  }
}

/** Загрузить файл на сервер; ответ — готовое вложение (его id передают с сообщением) */
export async function uploadFile(blob: Blob, name: string, options: UploadOptions = {}): Promise<Attachment> {
  while (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new UploadError('Отменено')
      try {
        return await sendFile(blob, name, options)
      } catch (err) {
        if (!(err instanceof BusyError) || attempt >= 6) throw err instanceof BusyError ? new UploadError('Сервер занят — попробуй ещё раз') : err
        await new Promise((r) => window.setTimeout(r, err.waitMs))
      }
    }
  } finally {
    running--
    waiting.shift()?.()
  }
}

function sendFile(blob: Blob, name: string, { onProgress, signal, mediaSize }: UploadOptions): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadError('Отменено'))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads')
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name))
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream')
    if (mediaSize) xhr.setRequestHeader('X-Media-Size', `${Math.round(mediaSize.width)}x${Math.round(mediaSize.height)}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: { upload?: Attachment; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // не JSON — значит, ответил не наш сервер (прокси и т. п.)
      }
      // короткое «подожди» (а не суточный лимит) — повторим сами
      const wait = Number(xhr.getResponseHeader('Retry-After'))
      if (xhr.status === 429 && wait > 0 && wait <= 10) return reject(new BusyError(wait * 1000))
      if (xhr.status >= 200 && xhr.status < 300 && data.upload) resolve(data.upload)
      else reject(new UploadError(data.error ?? (xhr.status === 413 ? 'Файл слишком большой' : 'Не получилось загрузить')))
    }
    xhr.onerror = () => reject(new UploadError('Нет связи с сервером'))
    xhr.onabort = () => reject(new UploadError('Отменено'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(blob)
  })
}

/** Фото больше этого по длинной стороне уменьшаем перед отправкой */
export const MAX_PHOTO_SIDE = 2560

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode'))
    }
    img.src = url
  })
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

const renameExt = (name: string, ext: string) => (name.replace(/\.[a-z0-9]{1,8}$/i, '') || 'фото') + '.' + ext

export interface PreparedImage {
  blob: Blob
  name: string
  width?: number
  height?: number
}

/**
 * Подготовить фото: больше 2560 px — уменьшаем; JPEG — пережимаем всегда (~0.85), заодно уходят EXIF
 * с геолокацией, а поворот «впечатывается» в картинку. GIF не трогаем (анимация), PNG и WebP — только если огромные.
 * <img> сам учитывает поворот из EXIF — поэтому рисуем через него, а не через createImageBitmap.
 */
export async function prepareImage(file: File, maxSide = MAX_PHOTO_SIDE): Promise<PreparedImage> {
  const original: PreparedImage = { blob: file, name: file.name || 'фото' }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return original
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    return original
  }
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height) return original
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const jpeg = file.type === 'image/jpeg'
  if (scale === 1 && !jpeg) return { ...original, width, height }

  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return original
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  // фото — JPEG (быстро и понимают все); PNG/WebP (бывают прозрачные) — WebP, а где браузер его не пишет — PNG
  let blob = await toBlob(canvas, jpeg ? 'image/jpeg' : 'image/webp', 0.85)
  if (!jpeg && blob && blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/png')
  // освобождаем память сразу: на iPhone у холстов жёсткий общий лимит
  canvas.width = canvas.height = 0
  if (!blob) return original
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  return { blob, name: renameExt(original.name, ext), width: w, height: h }
}

/** Ширина и высота видео (чтобы под плеер заранее оставить место); null — не вышло */
export function videoSize(file: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let done = false
    const finish = (size: { width: number; height: number } | null) => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      resolve(size)
    }
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => finish(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null)
    video.onerror = () => finish(null)
    window.setTimeout(() => finish(null), 4000)
    video.src = url
  })
}

/** Квадрат (аватарка) или полоса (баннер) из картинки: обрезка по центру со сдвигом и масштабом */
export interface Crop {
  /** Увеличение: 1 — картинка целиком закрывает рамку */
  zoom: number
  /** Сдвиг центра от -1 до 1 по каждой оси (доля свободного места) */
  x: number
  y: number
}

/** Нарисовать обрезанную картинку размером outW×outH и сжать в WebP (или PNG, если WebP не умеет браузер) */
export async function cropImage(img: HTMLImageElement, outW: number, outH: number, crop: Crop): Promise<Blob | null> {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // какая часть исходника попадает в рамку
  const cover = Math.max(outW / iw, outH / ih) * crop.zoom
  const sw = outW / cover
  const sh = outH / cover
  const sx = ((iw - sw) / 2) * (1 + crop.x)
  const sy = ((ih - sh) / 2) * (1 + crop.y)
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
  let blob = await toBlob(canvas, 'image/webp', 0.9)
  if (blob && blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/png')
  canvas.width = canvas.height = 0
  return blob
}

export { loadImage }
