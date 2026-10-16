import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Ban, ImagePlus, LoaderCircle, Pipette, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { ApiError } from '../../lib/api'
import {
  ACCENT_PRESETS,
  isProfileImage,
  keepsAnimation,
  PROFILE_ACCEPT,
  removeProfileImage,
  setProfileImage,
  SLOT_SIZE,
  type ProfileSlot,
} from '../../lib/profileMedia'
import { chat, useChat } from '../../lib/store'
import { loadImage, UploadError, uploadLimits, formatSize, type Crop } from '../../lib/uploads'
import { Avatar } from '../Avatar'
import { accentStyle, ProfileBanner } from '../ProfileView'

/**
 * «Профиль» в настройках: аватарка и баннер (выбрать → подвинуть и приблизить в рамке → сохранить) и цвет профиля.
 * Картинки сохраняются сразу, цвет — вместе с остальными полями профиля (кнопка «Сохранить»).
 */

const TEXT: Record<ProfileSlot, { title: string; hint: string; done: string; removed: string }> = {
  avatar: {
    title: 'Аватар',
    hint: 'PNG, JPEG, WebP или GIF. Анимированная GIF до 2 МБ остаётся живой.',
    done: 'Аватар обновлён',
    removed: 'Аватар убран — снова инициалы',
  },
  banner: {
    title: 'Баннер',
    hint: 'Широкая картинка сверху карточки профиля — обрежем до 3 : 1.',
    done: 'Баннер обновлён',
    removed: 'Баннер убран',
  },
}

const errorText = (err: unknown) => (err instanceof UploadError || err instanceof ApiError ? err.message : 'Не получилось сохранить картинку')

/** Строка «Аватар» / «Баннер»: что сейчас стоит, «Загрузить», «Убрать»; после выбора файла — рамка обрезки */
export function ProfileImageField({ slot }: { slot: ProfileSlot }) {
  const me = useChat((s) => s.me!)
  const current = me[slot] ?? null
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = TEXT[slot]

  const pick = (f: File | undefined) => {
    if (!f) return
    setError(null)
    if (!isProfileImage(f)) return setError('Нужна картинка: PNG, JPEG, GIF или WebP')
    setFile(f)
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await removeProfileImage(slot)
      chat.toast({ title: t.removed })
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  return (
    <div className="field-block">
      <span className="set-group__title">{t.title}</span>
      {file ? (
        <ImageCropper
          slot={slot}
          file={file}
          onCancel={() => setFile(null)}
          onSaved={() => {
            setFile(null)
            chat.toast({ title: t.done, text: 'Друзья уже видят' })
          }}
        />
      ) : (
        <div className={`pf-pick pf-pick--${slot}`}>
          <span className="pf-pick__now">
            {slot === 'avatar' ? (
              <Avatar user={me} size={64} />
            ) : (
              <span className={`pf-pick__banner${me.accent ? ' profile--accent' : ''}`} style={accentStyle(me.accent)}>
                <ProfileBanner banner={current} />
              </span>
            )}
          </span>
          <span className="pf-pick__side">
            <span className="pf-pick__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => input.current?.click()} disabled={busy}>
                <ImagePlus size={15} /> {current ? 'Сменить' : 'Загрузить'}
              </button>
              {current && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove()} disabled={busy}>
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />} Убрать
                </button>
              )}
            </span>
            <span className="pf-pick__hint">{error ? <span className="pf-pick__error">{error}</span> : t.hint}</span>
          </span>
          <input
            ref={input}
            type="file"
            accept={PROFILE_ACCEPT}
            hidden
            tabIndex={-1}
            onChange={(e) => {
              pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))
const MAX_ZOOM = 4

/** Рамка обрезки: тащить — двигать, колесо или ползунок — приблизить. Что видно в рамке — то и сохранится */
function ImageCropper({ slot, file, onCancel, onSaved }: { slot: ProfileSlot; file: File; onCancel: () => void; onSaved: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file))
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const drag = useRef<{ px: number; py: number; base: Crop } | null>(null)
  const gif = keepsAnimation(slot, file)
  const bigGif = slot === 'avatar' && file.type === 'image/gif' && !gif

  useEffect(() => {
    let alive = true
    loadImage(file)
      .then((i) => alive && setImg(i))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file, url])

  // размер рамки на экране (на телефоне баннер уже)
  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc — отменить обрезку, а не закрыть настройки целиком
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onCancel])

  const iw = img?.naturalWidth ?? 1
  const ih = img?.naturalHeight ?? 1
  // так же считает cropImage: картинка закрывает рамку, zoom — сверх того
  const cover = box.w && box.h ? Math.max(box.w / iw, box.h / ih) * (gif ? 1 : crop.zoom) : 0
  const dw = iw * cover
  const dh = ih * cover
  const freeX = Math.max(0, dw - box.w)
  const freeY = Math.max(0, dh - box.h)
  const shown = gif ? { x: 0, y: 0 } : crop
  const imgStyle: CSSProperties = {
    width: dw,
    height: dh,
    transform: `translate(${(-freeX / 2) * (1 + shown.x)}px, ${(-freeY / 2) * (1 + shown.y)}px)`,
  }

  const zoomBy = (k: number) => setCrop((c) => ({ ...c, zoom: clamp(c.zoom * k, 1, MAX_ZOOM) }))

  // колесо — масштаб (не пассивный обработчик: иначе прокрутится страница настроек)
  useEffect(() => {
    const el = frame.current
    if (!el || gif) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(Math.exp(-e.deltaY * 0.0015))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gif])

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (gif || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, base: crop }
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // сдвиг пальцем на всё свободное место — это путь от -1 до 1
    const x = freeX ? clamp(d.base.x - (2 * (e.clientX - d.px)) / freeX, -1, 1) : 0
    const y = freeY ? clamp(d.base.y - (2 * (e.clientY - d.py)) / freeY, -1, 1) : 0
    setCrop({ ...d.base, x, y })
  }
  const onUp = () => {
    drag.current = null
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await setProfileImage(slot, file, img, crop)
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const max = slot === 'avatar' ? uploadLimits().avatarMaxBytes : uploadLimits().bannerMaxBytes
  const note = failed
    ? 'Браузер не смог открыть эту картинку — попробуй другую'
    : gif
      ? 'GIF остаётся анимированной — целиком, без обрезки'
      : bigGif
        ? `GIF больше ${formatSize(max)} — станет обычной картинкой`
        : 'Потяни, чтобы подвинуть; колесо или ползунок — приблизить'

  return (
    <div className={`pf-crop pf-crop--${slot}`}>
      <div
        ref={frame}
        className={`pf-crop__frame${gif ? ' is-static' : ''}`}
        // тянут картинку пальцем — это не свайп «назад» у настроек
        data-no-swipe
        style={{ aspectRatio: `${SLOT_SIZE[slot].w} / ${SLOT_SIZE[slot].h}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {img && cover > 0 && <img className="pf-crop__img" src={url} alt="" draggable={false} style={imgStyle} />}
        {!img && !failed && <LoaderCircle size={22} className="spin pf-crop__wait" />}
        {slot === 'avatar' && <span className="pf-crop__mask" aria-hidden="true" />}
      </div>
      {!gif && img && (
        <div className="pf-crop__zoom">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Отдалить" disabled={crop.zoom <= 1}>
            <ZoomOut size={17} />
          </button>
          <input
            type="range"
            className="slider"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            style={{ '--pct': `${((crop.zoom - 1) / (MAX_ZOOM - 1)) * 100}%` } as CSSProperties}
            aria-label="Масштаб"
            onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
          />
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Приблизить" disabled={crop.zoom >= MAX_ZOOM}>
            <ZoomIn size={17} />
          </button>
        </div>
      )}
      <div className={`pf-crop__note${error ? ' is-error' : ''}`}>{error ?? note}</div>
      <div className="pf-crop__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={busy || failed || (!img && !gif)}>
          {busy && <LoaderCircle size={15} className="spin" />} Сохранить
        </button>
      </div>
    </div>
  )
}

/** Цвет профиля: «без цвета», 8 приглушённых и свой */
export function AccentPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const custom = value && !ACCENT_PRESETS.includes(value) ? value : null
  return (
    <div className="field-block">
      <span className="set-group__title">Цвет профиля</span>
      <div className="pf-accents" role="radiogroup" aria-label="Цвет профиля">
        <button type="button" role="radio" aria-checked={!value} className={`pf-swatch pf-swatch--none${!value ? ' is-on' : ''}`} onClick={() => onChange(null)} data-tip="Без цвета">
          <Ban size={16} />
        </button>
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            className={`pf-swatch${value === c ? ' is-on' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <label className={`pf-swatch pf-swatch--custom${custom ? ' is-on' : ''}`} style={custom ? { background: custom } : undefined} data-tip="Свой цвет">
          <Pipette size={15} />
          <input type="color" value={value ?? '#7a9cc6'} aria-label="Свой цвет профиля" onChange={(e) => onChange(e.target.value.toLowerCase())} />
        </label>
      </div>
      <span className="pf-pick__hint">Лёгкий оттенок твоей карточки: полоска сверху, баннер без картинки и свечение аватарки.</span>
    </div>
  )
}
