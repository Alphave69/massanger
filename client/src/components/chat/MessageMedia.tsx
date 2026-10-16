import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Download, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, ImageOff, Music, Play } from 'lucide-react'
import type { Attachment, Message } from '../../lib/api'
import { lightbox } from '../../lib/lightbox'
import { extOf, formatSize } from '../../lib/uploads'

/**
 * Вложения в сообщении: фото — сеткой (1 крупно, 2–4 плиткой, больше — «+N»), видео — плеером,
 * аудио — плеером с названием, остальное — карточкой файла «скачать».
 * Размеры фото известны заранее — место под них оставляем сразу, лента не прыгает при загрузке.
 */

/** Самая длинная сторона одиночного фото/видео в ленте (на телефоне — не шире пузыря) */
const BOX = 400

/** Сообщение — только фото без подписи: показываем без «пузыря», время — поверх фото (у видео там его кнопки) */
export const isBareMedia = (m: Message) => !m.content && !m.forwarded && Boolean(m.attachments?.length) && m.attachments!.every((a) => a.kind === 'image')

export function MessageMedia({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => a.kind === 'image')
  const videos = attachments.filter((a) => a.kind === 'video')
  const audios = attachments.filter((a) => a.kind === 'audio')
  const files = attachments.filter((a) => a.kind === 'file')
  return (
    <div className="media">
      {images.length > 0 && <ImageGrid images={images} />}
      {videos.map((v) => (
        <VideoPlayer key={v.id} video={v} />
      ))}
      {audios.map((a) => (
        <AudioCard key={a.id} audio={a} />
      ))}
      {files.map((f) => (
        <FileCard key={f.id} file={f} />
      ))}
    </div>
  )
}

/** Ширина одиночного фото/видео: целиком влезает в квадрат BOX, мелкое — в натуральную величину */
function boxWidth(w: number, h: number, min = 80) {
  return Math.round(Math.max(min, Math.min(w, BOX, (BOX * w) / h)))
}

function ImageGrid({ images }: { images: Attachment[] }) {
  if (images.length === 1) {
    const a = images[0]
    const w = a.width ?? 320
    const h = a.height ?? 240
    return (
      <div className="media-grid media-grid--1" style={{ width: boxWidth(w, h), aspectRatio: `${w} / ${h}` }}>
        <Tile item={a} index={0} all={images} />
      </div>
    )
  }
  const shown = images.slice(0, 4)
  const more = images.length - shown.length
  return (
    <div className={`media-grid media-grid--${shown.length}`}>
      {shown.map((a, i) => (
        <Tile key={a.id} item={a} index={i} all={images} more={i === shown.length - 1 ? more : 0} />
      ))}
    </div>
  )
}

function Tile({ item, index, all, more = 0 }: { item: Attachment; index: number; all: Attachment[]; more?: number }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <button
      type="button"
      className={`media-tile is-${state}`}
      onClick={() => lightbox.open(all, index)}
      aria-label={more ? `Ещё ${more} фото` : `Открыть фото ${item.name}`}
    >
      {state !== 'error' && (
        <img
          src={item.url}
          alt={item.name}
          loading="lazy"
          decoding="async"
          width={item.width}
          height={item.height}
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
      {state === 'error' && (
        <span className="media-tile__broken">
          <ImageOff size={20} />
          Фото недоступно
        </span>
      )}
      {more > 0 && <span className="media-tile__more">+{more}</span>}
    </button>
  )
}

/** Элемент уже близко к экрану (с запасом) — тогда и грузим тяжёлое (видео); один раз и навсегда */
function useNearViewport(ref: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') return setNear(true)
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, near])
  return near
}

function VideoPlayer({ video: v }: { video: Attachment }) {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearViewport(ref)
  const [size, setSize] = useState(v.width && v.height ? { w: v.width, h: v.height } : null)
  const w = size?.w ?? 16
  const h = size?.h ?? 9
  const style: CSSProperties = { width: size ? boxWidth(w, h, 160) : BOX, aspectRatio: `${w} / ${h}` }
  return (
    <div ref={ref} className="media-video" style={style}>
      {near ? (
        // #t=0.1 — iPhone без этого не рисует первый кадр до нажатия «play»
        <video
          src={`${v.url}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          aria-label={v.name}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            if (!size && el.videoWidth && el.videoHeight) setSize({ w: el.videoWidth, h: el.videoHeight })
          }}
        />
      ) : (
        <span className="media-video__wait" aria-hidden="true">
          <Play size={26} />
        </span>
      )}
    </div>
  )
}

function AudioCard({ audio: a }: { audio: Attachment }) {
  return (
    <div className="media-audio">
      <div className="media-file media-file--audio">
        <span className="media-file__icon">
          <Music size={19} />
        </span>
        <span className="media-file__text">
          <span className="media-file__name">{a.name}</span>
          <span className="media-file__meta">{formatSize(a.size)}</span>
        </span>
        <a className="media-file__dl" href={`${a.url}?dl=1`} download={a.name} aria-label={`Скачать ${a.name}`} data-tip="Скачать">
          <Download size={17} />
        </a>
      </div>
      <audio src={a.url} controls preload="none" aria-label={a.name} />
    </div>
  )
}

const ICONS: [RegExp, typeof File][] = [
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/, FileArchive],
  [/^(pdf|docx?|odt|rtf|txt|md|epub|pages)$/, FileText],
  [/^(xlsx?|ods|csv|tsv|numbers)$/, FileSpreadsheet],
  [/^(js|mjs|ts|tsx|jsx|json|html?|css|py|java|kt|c|cc|cpp|h|cs|go|rs|rb|php|sh|bat|ps1|xml|ya?ml|toml|ini|sql|lua)$/, FileCode],
  [/^(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|svg|psd|ico|raw|dng)$/, FileImage],
  [/^(mp4|mov|mkv|avi|wmv|flv|m4v|webm|3gp)$/, FileVideo],
  [/^(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|mid|midi)$/, FileAudio],
]

function FileCard({ file: f }: { file: Attachment }) {
  const ext = extOf(f.name) || (f.mime === 'application/pdf' ? 'pdf' : f.mime === 'application/zip' ? 'zip' : '')
  const Icon = ICONS.find(([re]) => re.test(ext))?.[1] ?? File
  return (
    <a className="media-file" href={f.url} download={f.name} title={`Скачать «${f.name}»`}>
      <span className="media-file__icon">
        <Icon size={20} />
      </span>
      <span className="media-file__text">
        <span className="media-file__name">{f.name}</span>
        <span className="media-file__meta">
          {ext && `${ext.toUpperCase()} · `}
          {formatSize(f.size)}
        </span>
      </span>
      <span className="media-file__dl" aria-hidden="true">
        <Download size={17} />
      </span>
    </a>
  )
}
