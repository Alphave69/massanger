import { create } from 'zustand'
import { rgbToHex, type RGB } from './color'
import { cssBlock, lookVars, THEMES, themeInfo, type LookColors, type ThemeId } from './themes'

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
  // тонкая настройка вида: тема, акцент, шрифт, скругления…
  theme: ThemeId
  accent: string // '' — цвет темы, иначе '#rrggbb'
  font: 'theme' | 'inter' | 'system' | 'mono'
  radius: 'sharp' | 'normal' | 'round'
  avatarShape: 'circle' | 'squircle'
  msgSpacing: number // 0.5 … 2 — расстояние между сообщениями
  glowLevel: number // 0 … 1.5 — сила свечения
  panelOpacity: number // 0.2 … 1 — плотность панелей
  panelBlur: number // 0 … 24 px — размытие сферы и фона под панелями
  clock24: boolean // 21:04, а не 9:04 PM
  clockSeconds: boolean
  surfaceTint: number // 0 … 1 — панели и фон в оттенок акцента
  ownBubble: 'accent' | 'neutral' // свои сообщения: в цвет акцента или нейтральные
  bgEffects: number // 0 … 2 — узор из точек и «фонарик» за курсором на фоне

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
  /** Демонстрация экрана: smooth — держим кадры (игры, видео), sharp — держим резкость (текст, код) */
  screenMode: 'smooth' | 'sharp'
  /** Голос и видео — только через наш сервер (TURN): когда прямой канал между людьми режут или он узкий */
  forceRelay: boolean
  /** Камера для звонков: '' — системная по умолчанию */
  cameraDeviceId: string

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
  theme: 'black',
  accent: '',
  font: 'theme',
  radius: 'normal',
  avatarShape: 'circle',
  msgSpacing: 1,
  glowLevel: 1,
  panelOpacity: 0.6,
  panelBlur: 0,
  clock24: true,
  clockSeconds: false,
  surfaceTint: 0,
  ownBubble: 'accent',
  bgEffects: 1,

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
  screenMode: 'smooth',
  forceRelay: false,
  cameraDeviceId: '',

  devMode: false,
  labNegative: false,
  labMirror: false,
  labRetro: false,
}

const KEY = 'nuntius.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const s: Settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
    // «Ретро-терминал» из лаборатории теперь настоящая тема
    if (s.labRetro) return { ...s, labRetro: false, theme: 'retro' }
    return s
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
  applyLook(s)
}

/** Тема и тонкие настройки вида: data-атрибуты и CSS-переменные на <html> */
function applyLook(s: Settings) {
  const root = document.documentElement
  const theme = themeInfo(s.theme)
  root.dataset.theme = theme.id
  root.dataset.tone = theme.tone
  root.dataset.own = s.ownBubble
  const colors: LookColors = { accent: s.accent, tint: s.surfaceTint }
  const vars: Record<string, string> = {
    ...lookVars(theme, colors),
    '--rk': String(RADIUS[s.radius] ?? 1),
    '--avatar-r': s.avatarShape === 'squircle' ? '30%' : '50%',
    '--msg-gap': String(s.msgSpacing),
    '--glow-user': String(s.glowLevel),
    '--bg-fx': String(s.bgEffects),
    '--panel-a': String(s.panelOpacity),
    '--panel-backdrop': s.panelBlur > 0 ? `blur(${s.panelBlur}px)` : 'none',
  }
  if (s.font !== 'theme') vars['--font'] = FONTS[s.font]
  // Только внутри приложения (data-themed) и сильнее любых правил — поэтому такой длинный селектор
  const css = cssBlock('html[data-themed][data-theme]:root', vars)
  if (lookStyle('nuntius-look').textContent !== css) lookStyle('nuntius-look').textContent = css
  // Превью тем в настройках — каждая в своих цветах, но с твоим акцентом и оттенком
  const key = `${s.accent}|${s.surfaceTint}`
  if (key !== previewsKey) {
    previewsKey = key
    lookStyle('nuntius-look-previews').textContent = THEMES.map((t) =>
      cssBlock(`.theme-scope[data-theme='${t.id}']`, lookVars(t, colors)),
    ).join('\n')
  }
  bgColor = `rgb(${vars['--bg-rgb'].replace(/ /g, ',')})`
  const hex = (k: string) => rgbToHex(vars[k].split(' ').map(Number) as RGB)
  deskTheme = { bg: hex('--bg-rgb'), fg: hex('--fg-rgb'), accent: hex('--accent-rgb'), onAccent: hex('--on-accent-rgb'), dark: theme.tone === 'dark' }
  updateThemeColor()
}

/** Цвета для полоски заголовка в приложении для Windows */
interface DesktopTheme {
  bg: string
  fg: string
  accent: string
  onAccent: string
  dark: boolean
}
const DESK_BLACK: DesktopTheme = { bg: '#000000', fg: '#ffffff', accent: '#ffffff', onAccent: '#000000', dark: true }
let deskTheme = DESK_BLACK
let deskSent = ''

const RADIUS: Record<Settings['radius'], number> = { sharp: 0.35, normal: 1, round: 1.5 }

const FONTS: Record<Exclude<Settings['font'], 'theme'>, string> = {
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: 'var(--mono)',
}

let previewsKey = ''
let bgColor = '#000000'

function lookStyle(id: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  return el
}

/**
 * Тема действует только внутри приложения: лендинг, вход и страница скачивания — всегда в фирменном чёрном.
 * Включает App, когда показывает приложение.
 */
let themed = false
export function setThemed(on: boolean) {
  themed = on
  document.documentElement.toggleAttribute('data-themed', on)
  updateThemeColor()
}

/** Цвет системной полосы (телефон, PWA) и полоски заголовка приложения для Windows — под фон темы */
function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', themed ? bgColor : '#000000')
  const desk = themed ? deskTheme : DESK_BLACK
  const key = JSON.stringify(desk)
  if (key === deskSent) return
  deskSent = key
  try {
    // старые версии приложения этого не умеют — тогда полоска просто остаётся чёрной
    ;(window as { nuntiusDesktop?: { setTheme?: (t: DesktopTheme) => void } }).nuntiusDesktop?.setTheme?.(desk)
  } catch {
    // мостик недоступен — не страшно
  }
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
