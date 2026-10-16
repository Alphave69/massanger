import { api } from './api'
import { chat } from './store'
import { cropImage, formatSize, uploadFile, UploadError, uploadLimits, type Crop } from './uploads'

/**
 * Аватарка, баннер и цвет профиля.
 * Картинку обрезаем прямо в браузере (квадрат 256×256 и полоса 960×320, WebP) — на сервер уходит уже готовая.
 * Анимированная GIF-аватарка до 2 МБ остаётся как есть (холст убил бы анимацию).
 */

export type ProfileSlot = 'avatar' | 'banner'

/** Размер готовой картинки */
export const SLOT_SIZE: Record<ProfileSlot, { w: number; h: number }> = {
  avatar: { w: 256, h: 256 },
  banner: { w: 960, h: 320 },
}

/** Какие картинки можно выбрать (остальное браузер не обрежет) */
export const PROFILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

export const isProfileImage = (file: File) => /^image\/(png|jpeg|gif|webp)$/.test(file.type)

/** GIF-аватарку не обрезаем: ставим целиком, если влезает в лимит */
export const keepsAnimation = (slot: ProfileSlot, file: File) => slot === 'avatar' && file.type === 'image/gif' && file.size <= uploadLimits().avatarMaxBytes

/** Приглушённые цвета профиля: лёгкий оттенок карточки, не кричащий */
export const ACCENT_PRESETS = ['#7a9cc6', '#8e7cc3', '#b07aa1', '#c27c7c', '#c49a6c', '#a8a86a', '#6fa58a', '#6aa3a8']

export const isAccent = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** '#7a9cc6' → '122 156 198' — для rgb(var(--pf-accent-rgb) / 0.4) */
export function accentRgb(hex: string | null | undefined): string | null {
  if (!isAccent(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** Обрезать (если надо), загрузить и поставить; бросает UploadError с понятным текстом */
export async function setProfileImage(slot: ProfileSlot, file: File, img: HTMLImageElement | null, crop: Crop) {
  const limits = uploadLimits()
  const max = slot === 'avatar' ? limits.avatarMaxBytes : limits.bannerMaxBytes
  let blob: Blob = file
  let name = file.name || slot
  if (!keepsAnimation(slot, file)) {
    if (!img) throw new UploadError('Не получилось открыть картинку')
    const out = await cropImage(img, SLOT_SIZE[slot].w, SLOT_SIZE[slot].h, crop)
    if (!out) throw new UploadError('Не получилось обрезать картинку')
    blob = out
    name = `${slot}.${out.type === 'image/webp' ? 'webp' : 'png'}`
  }
  if (blob.size > max) throw new UploadError(`Слишком большая картинка — максимум ${formatSize(max)}`)
  const upload = await uploadFile(blob, name)
  const { user } = await api.setProfileImage(slot, upload.id)
  chat.setMe(user)
  return user
}

export async function removeProfileImage(slot: ProfileSlot) {
  const { user } = await api.removeProfileImage(slot)
  chat.setMe(user)
  return user
}
