import type { FileHandle } from 'node:fs/promises'

/**
 * Убираем из фото и видео метаданные — прежде всего координаты (GPS), а заодно модель телефона, время съёмки и т. п.
 * Без сторонних библиотек и без перекодирования: просто выкидываем лишние блоки из файла.
 *  - JPEG: APP1 (EXIF, XMP), APP13 (IPTC), комментарии. Поворот из EXIF сохраняем — иначе фото «ляжет на бок».
 *  - PNG: чанки eXIf, tEXt, iTXt, zTXt, tIME.
 *  - WebP: чанки EXIF и «XMP », флаги о них в VP8X.
 *  - MP4/MOV: блоки udta и meta внутри moov и дорожек (там ©xyz у Android и location у iPhone) переименовываем
 *    в free и забиваем нулями — размер файла не меняется, поэтому смещения кадров остаются верными.
 * Любая неожиданность в структуре — возвращаем null (файл оставляем как есть, его всё равно покажут).
 */

const ascii = (b: Buffer, at: number, s: string) => b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s

// ============ JPEG ============

/** Минимальный EXIF только с поворотом (тег 0x0112) */
function orientationExif(orientation: number) {
  const b = Buffer.alloc(2 + 2 + 6 + 8 + 2 + 12 + 4)
  b.writeUInt16BE(0xffe1, 0)
  b.writeUInt16BE(b.length - 2, 2)
  b.write('Exif\0\0', 4, 'latin1')
  b.write('MM', 10, 'latin1')
  b.writeUInt16BE(42, 12)
  b.writeUInt32BE(8, 14) // IFD0 сразу за заголовком
  b.writeUInt16BE(1, 18) // одна запись
  b.writeUInt16BE(0x0112, 20)
  b.writeUInt16BE(3, 22) // SHORT
  b.writeUInt32BE(1, 24)
  b.writeUInt16BE(orientation, 28)
  b.writeUInt32BE(0, 32) // следующего IFD нет
  return b
}

function exifOrientation(b: Buffer, tiff: number, end: number): number | undefined {
  if (tiff + 8 > end) return undefined
  const le = ascii(b, tiff, 'II')
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return undefined
  const count = u16(ifd)
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12
    if (entry + 12 > end) break
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8)
      return v >= 1 && v <= 8 ? v : undefined
    }
  }
  return undefined
}

const EOI = Buffer.from([0xff, 0xd9])

export function stripJpeg(b: Buffer): Buffer | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  const parts: Buffer[] = [b.subarray(0, 2)]
  let orientation: number | undefined
  let i = 2
  let changed = false
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) {
      // заполняющий байт
      i++
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2))
      i += 2
      continue
    }
    if (marker === 0xd9) break
    const len = b.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > b.length) return null
    const end = i + 2 + len
    if (marker === 0xda) {
      // дальше — сами данные картинки: копируем как есть до конца (EOI). Всё, что дописано после него
      // (вторые картинки MPF со своим EXIF, «живые фото» с видео), отрезаем
      const eoi = b.indexOf(EOI, end)
      if (eoi < 0) {
        parts.push(b.subarray(i))
      } else {
        parts.push(b.subarray(i, eoi + 2))
        if (eoi + 2 < b.length) changed = true
      }
      i = b.length
      break
    }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker === 0xe2 && ascii(b, i + 4, 'MPF\0'))
    if (marker === 0xe1 && ascii(b, i + 4, 'Exif\0\0')) orientation ??= exifOrientation(b, i + 10, end)
    if (drop) changed = true
    else parts.push(b.subarray(i, end))
    i = end
  }
  if (i < b.length) parts.push(b.subarray(i))
  if (!changed) return null
  // поворот возвращаем сразу за SOI/APP0, чтобы браузеры показали фото как сняли
  if (orientation && orientation !== 1) {
    const at = parts.length > 1 && parts[1][1] === 0xe0 ? 2 : 1
    parts.splice(at, 0, orientationExif(orientation))
  }
  return Buffer.concat(parts)
}

// ============ PNG ============

const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])

export function stripPng(b: Buffer): Buffer | null {
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) return null
  const parts: Buffer[] = [b.subarray(0, 8)]
  let i = 8
  let changed = false
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i)
    const end = i + 12 + len
    if (end > b.length) return null
    const type = b.toString('latin1', i + 4, i + 8)
    if (PNG_DROP.has(type)) changed = true
    else parts.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  if (!changed) return null
  return Buffer.concat(parts)
}

// ============ WebP ============

export function stripWebp(b: Buffer): Buffer | null {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  const parts: Buffer[] = [Buffer.from(b.subarray(0, 12))]
  let i = 12
  let changed = false
  let vp8x: Buffer | null = null
  while (i + 8 <= b.length) {
    const type = b.toString('latin1', i, i + 4)
    const len = b.readUInt32LE(i + 4)
    const end = Math.min(b.length, i + 8 + len + (len & 1))
    if (i + 8 + len > b.length) return null
    if (type === 'EXIF' || type === 'XMP ') {
      changed = true
    } else {
      const chunk = Buffer.from(b.subarray(i, end))
      if (type === 'VP8X') vp8x = chunk
      parts.push(chunk)
    }
    i = end
  }
  if (!changed) return null
  // в VP8X флаги «есть EXIF» и «есть XMP» — снимаем
  if (vp8x && vp8x.length > 8) vp8x[8] &= ~0x0c
  const out = Buffer.concat(parts)
  out.writeUInt32LE(out.length - 8, 4)
  return out
}

export function stripImage(b: Buffer, ext: string): Buffer | null {
  try {
    if (ext === 'jpg') return stripJpeg(b)
    if (ext === 'png') return stripPng(b)
    if (ext === 'webp') return stripWebp(b)
  } catch {
    // битая структура — оставляем как есть
  }
  return null
}

// ============ MP4 / MOV ============

/** XMP от Adobe лежит в uuid-блоке верхнего уровня с этим идентификатором */
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac'
/** Внутри чего искать udta / meta */
const CONTAINERS = new Set(['moov', 'trak'])
/** moov больше этого не читаем (файлы у нас до десятков мегабайт, moov обычно сотни килобайт) */
const MOOV_MAX = 64 * 1024 * 1024

async function readAt(fh: FileHandle, at: number, len: number) {
  const buf = Buffer.alloc(len)
  const { bytesRead } = await fh.read(buf, 0, len, at)
  return buf.subarray(0, bytesRead)
}

/** Пройти блоки ISO BMFF в буфере: [start, end) — абсолютные смещения в файле считаются через base */
function boxesIn(b: Buffer, from: number, to: number, onBox: (type: string, at: number, header: number, end: number) => void) {
  let i = from
  while (i + 8 <= to) {
    let size = b.readUInt32BE(i)
    const type = b.toString('latin1', i + 4, i + 8)
    let header = 8
    if (size === 1) {
      if (i + 16 > to) return
      size = Number(b.readBigUInt64BE(i + 8))
      header = 16
    } else if (size === 0) {
      size = to - i
    }
    if (size < header || i + size > to) return
    onBox(type, i, header, i + size)
    i += size
  }
}

/** Переименовать блоки с метаданными в free и стереть их содержимое прямо в файле. Возвращает, сколько блоков стёрто */
export async function stripVideo(fh: FileHandle, fileSize: number): Promise<number> {
  /** [где тип блока, начало содержимого, конец] — в файле */
  const renames: [number, number, number][] = []
  let at = 0
  while (at + 8 <= fileSize) {
    const head = await readAt(fh, at, 32)
    if (head.length < 8) break
    let size = head.readUInt32BE(0)
    const type = head.toString('latin1', 4, 8)
    let header = 8
    if (size === 1) {
      if (head.length < 16) break
      size = Number(head.readBigUInt64BE(8))
      header = 16
    } else if (size === 0) {
      size = fileSize - at
    }
    if (size < header || at + size > fileSize) break
    if (type === 'uuid' && head.length >= header + 16 && head.toString('hex', header, header + 16) === XMP_UUID) renames.push([at + 4, at + header, at + size])
    if (type === 'moov' && size <= MOOV_MAX) {
      const moov = await readAt(fh, at, size)
      const walk = (from: number, to: number) =>
        boxesIn(moov, from, to, (t, boxAt, boxHeader, end) => {
          if (t === 'udta' || t === 'meta') renames.push([at + boxAt + 4, at + boxAt + boxHeader, at + end])
          else if (CONTAINERS.has(t)) walk(boxAt + boxHeader, end)
        })
      walk(header, moov.length)
    }
    at += size
  }
  const free = Buffer.from('free', 'latin1')
  for (const [pos, from, to] of renames) {
    await fh.write(free, 0, 4, pos)
    if (to > from) await fh.write(Buffer.alloc(to - from), 0, to - from, from)
  }
  return renames.length
}
