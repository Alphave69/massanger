import { create } from 'zustand'

/**
 * Настройки приложения «под себя». Живут на устройстве (localStorage):
 * масштаб на ноутбуке и на большом мониторе обычно хочется разный.
 */
export interface Settings {
  // внешний вид
  uiScale: number // 0.8 … 1.3
  chatFontSize: number // 12 … 20 px
  compact: boolean
  sphere: boolean
  sphereBrightness: number // 0.1 … 1 — яркость фоновой сферы в приложении
  cursorGlow: boolean
  reduceMotion: boolean

  // уведомления
  sounds: boolean
  toasts: boolean
  desktop: boolean

  // голос (готовим заранее — пригодится для голосовых каналов)
  inputDeviceId: string // '' — устройство по умолчанию
  outputDeviceId: string
  inputVolume: number // 0 … 200 %
  outputVolume: number // 0 … 200 %
  inputMode: 'voice' | 'ptt'
  pttKey: string // KeyboardEvent.code
  sensitivity: number // 0 … 100 — порог голосовой активации
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGain: boolean
  muted: boolean
  deafened: boolean

  // секретное: открывается пасхалкой (7 кликов по версии в настройках)
  devMode: boolean
  labNegative: boolean // «Негатив» — светлая тема наоборот
  labMirror: boolean // «Зазеркалье» — интерфейс зеркально
  labRetro: boolean // «Ретро-терминал» — зелёный фосфор
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  chatFontSize: 15,
  compact: false,
  sphere: true,
  sphereBrightness: 0.5,
  cursorGlow: true,
  reduceMotion: false,

  sounds: true,
  toasts: true,
  desktop: false,

  inputDeviceId: '',
  outputDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  inputMode: 'voice',
  pttKey: 'KeyV',
  sensitivity: 35,
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  muted: false,
  deafened: false,

  devMode: false,
  labNegative: false,
  labMirror: false,
  labRetro: false,
}

const KEY = 'nuntius.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const useSettings = create<Settings>(load)

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useSettings.setState({ [key]: value } as Pick<Settings, K>)
}

export function resetSettings(keys: (keyof Settings)[]) {
  const patch: Partial<Settings> = {}
  for (const k of keys) (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k]
  useSettings.setState(patch)
}

/** Текущий масштаб интерфейса (нужен там, где координаты курсора переводятся в CSS-пиксели) */
export const uiZoom = () => useSettings.getState().uiScale

/** Сохраняем и сразу применяем к странице: CSS-переменные и классы на <html> */
function apply(s: Settings) {
  try {
    const json = JSON.stringify(s)
    if (localStorage.getItem(KEY) !== json) localStorage.setItem(KEY, json)
  } catch {
    // нет доступа к хранилищу — настройки проживут до перезагрузки
  }
  const root = document.documentElement
  root.style.setProperty('--ui-zoom', String(s.uiScale))
  root.style.setProperty('--chat-font', `${s.chatFontSize}px`)
  root.classList.toggle('compact', s.compact)
  root.classList.toggle('reduce-motion', s.reduceMotion)
  root.classList.toggle('no-glow', !s.cursorGlow)
}

apply(useSettings.getState())
useSettings.subscribe(apply)

// Настройки, изменённые в другой вкладке, подхватываем здесь — чтобы вкладки не затирали друг друга
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return
  try {
    useSettings.setState({ ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) })
  } catch {
    // битое значение — игнорируем
  }
})

/** Красивое имя клавиши для «нажми и говори» */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const names: Record<string, string> = {
    Space: 'Пробел',
    ShiftLeft: 'Левый Shift',
    ShiftRight: 'Правый Shift',
    ControlLeft: 'Левый Ctrl',
    ControlRight: 'Правый Ctrl',
    AltLeft: 'Левый Alt',
    AltRight: 'Правый Alt',
    CapsLock: 'Caps Lock',
    Backquote: '`',
    Tab: 'Tab',
  }
  return names[code] ?? code
}
