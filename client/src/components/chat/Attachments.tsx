import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { CircleAlert, File as FileIcon, Music, Paperclip, RotateCcw, Upload, X } from 'lucide-react'
import type { Attachment, AttachmentKind } from '../../lib/api'
import { chat } from '../../lib/store'
import { formatSize, guessKind, MAX_FILES, prepareImage, uploadFile, UploadError, uploadLimits, videoSize } from '../../lib/uploads'

/**
 * Файлы в поле ввода: скрепка (выбор файлов), перетаскивание на чат, вставка картинки из буфера.
 * Каждый файл начинает грузиться сразу; над полем — полоска с превью, размером, прогрессом и крестиком.
 * Отправка ждёт, пока догрузится всё, что грузится, и уходит вместе с текстом.
 */

export interface PendingFile {
  key: string
  name: string
  size: number
  kind: AttachmentKind
  /** Превью (blob:) для фото и видео */
  preview?: string
  /** 0…1 */
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
  attachment?: Attachment
  /** Можно попробовать ещё раз (ошибка связи, а не «слишком большой») */
  retry?: boolean
}

let seq = 0

const KIND_NAME: Record<AttachmentKind, string> = { image: 'фото', video: 'видео', audio: 'аудио', file: 'файл' }

/** Вставленный скриншот приходит как «image.png» — дадим имя понятнее */
function pastedName(file: File) {
  if (file.name && file.name !== 'image.png') return file
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `Скриншот ${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`
  return new File([file], name, { type: file.type || 'image/png' })
}

export function useComposerFiles(canAttach: boolean) {
  const list = useRef<PendingFile[]>([])
  const sources = useRef(new Map<string, File>())
  const jobs = useRef(new Map<string, { promise: Promise<void>; abort: AbortController }>())
  const [, render] = useState(0)

  // источник правды — в ref: после await отправка видит свежий список, не дожидаясь перерисовки
  const commit = (next: PendingFile[]) => {
    list.current = next
    render((n) => n + 1)
  }
  const patch = (key: string, p: Partial<PendingFile>) => commit(list.current.map((f) => (f.key === key ? { ...f, ...p } : f)))

  // ушли из канала — загрузки отменяем, превью освобождаем (неотправленное сервер сам уберёт через сутки)
  useEffect(
    () => () => {
      for (const j of jobs.current.values()) j.abort.abort()
      for (const f of list.current) if (f.preview) URL.revokeObjectURL(f.preview)
    },
    [],
  )

  const start = (item: PendingFile, file: File) => {
    const abort = new AbortController()
    const tooBig = () => `Больше ${formatSize(uploadLimits().maxBytes)} — не влезет`
    let shown = 0
    const promise = (async () => {
      let blob: Blob = file
      let name = item.name
      let mediaSize: { width: number; height: number } | null = null
      if (item.kind === 'image') {
        const prepared = await prepareImage(file)
        blob = prepared.blob
        name = prepared.name
      } else if (item.kind === 'video') {
        mediaSize = await videoSize(file)
      }
      if (abort.signal.aborted) return
      if (blob.size > uploadLimits().maxBytes) throw new UploadError(tooBig())
      if (blob !== file) patch(item.key, { size: blob.size, name })
      const attachment = await uploadFile(blob, name, {
        signal: abort.signal,
        mediaSize,
        onProgress: (p) => {
          // перерисовываем не чаще, чем на каждые 2%
          if (p - shown < 0.02 && p < 1) return
          shown = p
          patch(item.key, { progress: p })
        },
      })
      patch(item.key, { status: 'done', progress: 1, attachment })
    })()
      .catch((err) => {
        if (abort.signal.aborted) return
        const text = err instanceof UploadError ? err.message : 'Не получилось загрузить'
        patch(item.key, { status: 'error', error: text, retry: !/не влезет|слишком большой|пуст/i.test(text) })
      })
      .finally(() => {
        if (jobs.current.get(item.key)?.abort === abort) jobs.current.delete(item.key)
      })
    jobs.current.set(item.key, { promise, abort })
  }

  const add = (files: File[]) => {
    if (!files.length) return
    if (!canAttach) {
      chat.toast({ title: 'Файлы сюда нельзя', text: 'В этом канале нет права прикреплять файлы' })
      return
    }
    const room = MAX_FILES - list.current.length
    if (room <= 0) {
      chat.toast({ title: `Не больше ${MAX_FILES} файлов в сообщении`, text: 'Отправь эти — и прикрепи следующие' })
      return
    }
    if (files.length > room) chat.toast({ title: `Не больше ${MAX_FILES} файлов в сообщении`, text: `Прикрепили первые ${room}` })
    const max = uploadLimits().maxBytes
    const added = files.slice(0, room).map((file) => {
      const kind = guessKind(file)
      const item: PendingFile = {
        key: `f${++seq}`,
        name: file.name || KIND_NAME[kind],
        size: file.size,
        kind,
        preview: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined,
        progress: 0,
        status: 'uploading',
      }
      // фото ещё пережмём — их размер проверим после
      if (!file.size) Object.assign(item, { status: 'error', error: 'Пустой файл' })
      else if (kind !== 'image' && file.size > max) Object.assign(item, { status: 'error', error: `Больше ${formatSize(max)} — не влезет` })
      sources.current.set(item.key, file)
      return item
    })
    commit([...list.current, ...added])
    for (const item of added) if (item.status === 'uploading') start(item, sources.current.get(item.key)!)
  }

  const forget = (keys: string[]) => {
    for (const key of keys) {
      jobs.current.get(key)?.abort.abort()
      jobs.current.delete(key)
      sources.current.delete(key)
      const f = list.current.find((x) => x.key === key)
      if (f?.preview) URL.revokeObjectURL(f.preview)
    }
    commit(list.current.filter((f) => !keys.includes(f.key)))
  }

  const retry = (key: string) => {
    const item = list.current.find((f) => f.key === key)
    const file = sources.current.get(key)
    if (!item || !file) return
    const fresh = { ...item, status: 'uploading' as const, progress: 0, error: undefined, retry: undefined }
    commit(list.current.map((f) => (f.key === key ? fresh : f)))
    start(fresh, file)
  }

  // стабильная ссылка для перетаскивания на чат (в ней — свежее canAttach)
  const addRef = useRef(add)
  addRef.current = add
  const addFiles = useCallback((files: File[]) => addRef.current(files), [])

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? [])
    // есть текст (например, ячейки из Excel вместе с их картинкой) — вставляем текст, как обычно
    if (!files.length || e.clipboardData.getData('text/plain').trim()) return
    e.preventDefault()
    addFiles(files.map(pastedName))
  }

  const items = list.current
  return {
    items,
    addFiles,
    onPaste,
    remove: (key: string) => forget([key]),
    retry,
    /** Отправленные — убрать из полоски */
    clear: forget,
    /** Подождать, пока догрузится всё, что грузится */
    waitAll: () => Promise.all([...jobs.current.values()].map((j) => j.promise)).then(() => undefined),
    /** Готовые к отправке (свежий список, даже сразу после await) */
    done: () => list.current.filter((f) => f.status === 'done' && f.attachment),
    busy: items.some((f) => f.status === 'uploading'),
    /** Есть что отправить (не считая ошибок) */
    sendable: items.some((f) => f.status !== 'error'),
  }
}

export type ComposerFiles = ReturnType<typeof useComposerFiles>

/** Скрепка: выбрать файлы (на телефоне — ещё и камера/галерея) */
export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="composer__attach" onClick={() => input.current?.click()} aria-label="Прикрепить фото, видео или файл" data-tip="Фото, видео, файлы">
        <Paperclip size={19} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Полоска файлов над полем ввода */
export function AttachmentStrip({ files }: { files: ComposerFiles }) {
  if (!files.items.length) return null
  return (
    <div className="att-strip" role="list" aria-label="Прикреплённые файлы">
      {files.items.map((f) => (
        <div key={f.key} role="listitem" className={`att is-${f.status}`} title={f.error ? `${f.name}: ${f.error}` : f.name}>
          <span className="att__thumb">
            {f.kind === 'image' && f.preview ? (
              <img src={f.preview} alt="" draggable={false} />
            ) : f.kind === 'video' && f.preview ? (
              <video src={`${f.preview}#t=0.1`} muted playsInline preload="metadata" />
            ) : f.kind === 'audio' ? (
              <Music size={19} />
            ) : (
              <FileIcon size={19} />
            )}
            {f.status === 'error' && (
              <span className="att__alert">
                <CircleAlert size={18} />
              </span>
            )}
          </span>
          <span className="att__text">
            <span className="att__name truncate">{f.name}</span>
            <span className="att__meta truncate">
              {f.status === 'error' ? f.error : f.status === 'uploading' ? `${Math.round(f.progress * 100)}% · ${formatSize(f.size)}` : formatSize(f.size)}
            </span>
          </span>
          {f.status === 'error' && f.retry && (
            <button type="button" className="att__btn" onClick={() => files.retry(f.key)} aria-label={`Загрузить ещё раз ${f.name}`} data-tip="Ещё раз">
              <RotateCcw size={14} />
            </button>
          )}
          <button type="button" className="att__btn att__remove" onClick={() => files.remove(f.key)} aria-label={`Убрать ${f.name}`} data-tip="Убрать">
            <X size={15} />
          </button>
          {f.status === 'uploading' && <span className="att__bar" style={{ transform: `scaleX(${Math.max(0.03, f.progress)})` }} />}
        </div>
      ))}
    </div>
  )
}

// ============ перетаскивание файлов на чат ============

/** Куда отдавать брошенные файлы: поле ввода открытого чата (одно на экране) */
let dropTarget: ((files: File[]) => void) | null = null

export function useDropTarget(fn: (files: File[]) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    dropTarget = fn
    return () => {
      if (dropTarget === fn) dropTarget = null
    }
  }, [fn, enabled])
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** Обработчики для области чата + «над ней сейчас несут файлы» */
export function useFileDrop() {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  // Бросили мимо чата — браузер не должен открыть файл вместо Nuntius
  useEffect(() => {
    const guard = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  const handlers = {
    onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = dropTarget ? 'copy' : 'none'
    },
    onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (!files.length) return
      if (dropTarget) dropTarget(files)
      else chat.toast({ title: 'Файлы сюда нельзя', text: 'В этом канале нет прав прикреплять файлы' })
    },
  }
  return { over, handlers }
}

/** Подсказка поверх чата, пока над ним несут файлы */
export function DropOverlay({ on, allowed }: { on: boolean; allowed: boolean }) {
  return (
    <div className={`drop-zone${on ? ' is-on' : ''}${allowed ? '' : ' is-denied'}`} aria-hidden="true">
      <div className="drop-zone__card">
        <Upload size={30} />
        <b>{allowed ? 'Отпусти — прикрепим' : 'Сюда файлы нельзя'}</b>
        <span>{allowed ? `Фото, видео и файлы до ${formatSize(uploadLimits().maxBytes)}` : 'В этом канале нет права прикреплять файлы'}</span>
      </div>
    </div>
  )
}
