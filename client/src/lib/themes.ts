import { channels, chroma, contrast, ensureContrast, fromLab, inkFor, mix, rgb, rgbToHex, tintToward, toLab, type RGB } from './color'

/**
 * Темы оформления. Палитры живут здесь, а не в CSS: из них же считаются подгонка своего акцента,
 * оттенок поверхностей, превью в настройках и цвет системной полосы. На страницу они попадают
 * CSS-переменными (см. lookVars и applyLook в settings.ts). «Чёрная» — это ровно значения
 * по умолчанию из global.css :root (лендинг и вход всегда в ней).
 * Особые эффекты тем (строки развёртки «Ретро», правки для светлых) — в styles/themes.css.
 */
export type ThemeId =
  | 'black'
  | 'graphite'
  | 'midnight'
  | 'ocean'
  | 'neon'
  | 'forest'
  | 'retro'
  | 'amethyst'
  | 'cherry'
  | 'sunset'
  | 'coffee'
  | 'light'
  | 'sky'
  | 'lavender'
  | 'mint'
  | 'paper'

/** Все цвета темы. Имена — как у CSS-переменных: fg → --fg-rgb, surface2 → --surface-2 … */
export interface Palette {
  fg: string // текст, линии, подсветки (полупрозрачными оттенками)
  bg: string // фон приложения
  accent: string // активное, главные кнопки, бейджи, фокус
  onAccent: string // текст на акценте
  glow: string // свечение
  shade: string // тени и затемнения
  glass: string // стеклянные панели
  solid: string // сплошная панель
  pop: string // меню и всплывашки
  sphere: string // точки фоновой сферы
  surface: string // окна и карточки
  surface2: string
  surface3: string
  raise: string
  raise2: string
  bubble: string
  bubbleText: string
  medalHi: string // диск значка
  medalHi2: string
  medalLo: string
  text: string
  text1: string
  text2: string
  text3: string
  danger: string
  glowK: number // сила свечения темы (в светлых — мягкая тень)
  shadeK: number
}

export interface ThemeInfo {
  id: ThemeId
  name: string
  hint: string
  tone: 'dark' | 'light'
  p: Palette
  /** моноширинный шрифт во всём интерфейсе («Ретро-терминал») */
  mono?: boolean
}

const BLACK: Palette = {
  fg: '#ffffff',
  bg: '#000000',
  accent: '#ffffff',
  onAccent: '#000000',
  glow: '#ffffff',
  shade: '#000000',
  glass: '#050505',
  solid: '#060606',
  pop: '#040404',
  sphere: '#ffffff',
  surface: '#050505',
  surface2: '#070707',
  surface3: '#0b0b0b',
  raise: '#101010',
  raise2: '#1a1a1a',
  bubble: '#121212',
  bubbleText: '#f2f2f2',
  medalHi: '#1d1d1d',
  medalHi2: '#232323',
  medalLo: '#050505',
  text: '#ffffff',
  text1: '#e6e6e6',
  text2: '#b0b0b0',
  text3: '#6e6e6e',
  danger: '#ff6b6b',
  glowK: 1,
  shadeK: 1,
}

export const THEMES: ThemeInfo[] = [
  // ---------- тёмные ----------
  { id: 'black', name: 'Чёрная', hint: 'Чистый чёрный и белое свечение', tone: 'dark', p: BLACK },
  {
    id: 'graphite',
    name: 'Графит',
    hint: 'Мягкий тёмно-серый, глазам спокойнее',
    tone: 'dark',
    p: {
      ...BLACK,
      bg: '#17181b',
      glass: '#202125',
      solid: '#212226',
      pop: '#26272c',
      sphere: '#cdcfd7',
      surface: '#26272c',
      surface2: '#2a2b31',
      surface3: '#303137',
      raise: '#2d2e33',
      raise2: '#393a40',
      bubble: '#303136',
      bubbleText: '#ececef',
      medalHi: '#3a3b41',
      medalHi2: '#404147',
      medalLo: '#26272c',
      text1: '#e4e4e7',
      text2: '#a9aab2',
      text3: '#7a7b83',
      glowK: 0.6,
      shadeK: 0.9,
    },
  },
  {
    id: 'midnight',
    name: 'Полночь',
    hint: 'Глубокий синий и холодный акцент',
    tone: 'dark',
    p: {
      ...BLACK,
      fg: '#d6e2ff',
      bg: '#050916',
      accent: '#8ab0ff',
      onAccent: '#050a1a',
      glow: '#78a0ff',
      glass: '#090f22',
      solid: '#0a1024',
      pop: '#090e20',
      sphere: '#96b6ff',
      surface: '#0c1329',
      surface2: '#0f172f',
      surface3: '#141e3b',
      raise: '#131c37',
      raise2: '#1c2747',
      bubble: '#121a34',
      bubbleText: '#e6ecff',
      medalHi: '#1e2a4d',
      medalHi2: '#24315a',
      medalLo: '#0a1126',
      text: '#f0f4ff',
      text1: '#d6def5',
      text2: '#9aa8cf',
      text3: '#6672a0',
      glowK: 0.85,
    },
  },
  {
    id: 'ocean',
    name: 'Океан',
    hint: 'Морская глубина и бирюзовая волна',
    tone: 'dark',
    p: {
      fg: '#cee7f6',
      bg: '#000c14',
      accent: '#46d6d1',
      onAccent: '#001615',
      glow: '#46d6d1',
      shade: '#000000',
      glass: '#00131e',
      solid: '#00141f',
      pop: '#00121d',
      sphere: '#66cfe1',
      surface: '#001824',
      surface2: '#001c29',
      surface3: '#002433',
      raise: '#002130',
      raise2: '#002d40',
      bubble: '#001f2e',
      bubbleText: '#e1eff7',
      medalHi: '#003145',
      medalHi2: '#003950',
      medalLo: '#001520',
      text: '#edf6fb',
      text1: '#d0e3ed',
      text2: '#92b2c3',
      text3: '#5c8296',
      danger: '#ff7b7b',
      glowK: 0.9,
      shadeK: 1,
    },
  },
  {
    id: 'neon',
    name: 'Неон',
    hint: 'Чёрный и бирюзовое свечение',
    tone: 'dark',
    p: {
      ...BLACK,
      fg: '#bef0ff',
      bg: '#020208',
      accent: '#00f0ff',
      onAccent: '#00161c',
      glow: '#00f0ff',
      glass: '#06060e',
      solid: '#070710',
      pop: '#05050c',
      sphere: '#00e1ff',
      surface: '#08081a',
      surface2: '#0b0b1f',
      surface3: '#101028',
      raise: '#11112a',
      raise2: '#1a1a38',
      bubble: '#0e0e24',
      bubbleText: '#eafcff',
      medalHi: '#141433',
      medalHi2: '#1a1a40',
      medalLo: '#07071a',
      text: '#f4feff',
      text1: '#dff6fb',
      text2: '#9fbac6',
      text3: '#62808e',
      glowK: 1.15,
    },
  },
  {
    id: 'forest',
    name: 'Лес',
    hint: 'Глубокий зелёный и свежая листва',
    tone: 'dark',
    p: {
      fg: '#d5e9dd',
      bg: '#030d07',
      accent: '#71d790',
      onAccent: '#031608',
      glow: '#71d790',
      shade: '#000000',
      glass: '#04140c',
      solid: '#05160d',
      pop: '#04140b',
      sphere: '#95d7a2',
      surface: '#061a10',
      surface2: '#081e13',
      surface3: '#0b2619',
      raise: '#0a2417',
      raise2: '#123021',
      bubble: '#092116',
      bubbleText: '#e4f0e9',
      medalHi: '#143424',
      medalHi2: '#173c2a',
      medalLo: '#04170d',
      text: '#eff6f2',
      text1: '#d5e4db',
      text2: '#9bb3a5',
      text3: '#678473',
      danger: '#ff7b7b',
      glowK: 0.9,
      shadeK: 1,
    },
  },
  {
    id: 'retro',
    name: 'Ретро-терминал',
    hint: 'Зелёный фосфор и строки развёртки',
    tone: 'dark',
    mono: true,
    p: {
      ...BLACK,
      fg: '#40ff73',
      bg: '#010703',
      accent: '#40ff73',
      onAccent: '#001608',
      glow: '#40ff73',
      glass: '#020b05',
      solid: '#030d06',
      pop: '#020a04',
      sphere: '#40ff73',
      surface: '#031208',
      surface2: '#04160a',
      surface3: '#071d0e',
      raise: '#082311',
      raise2: '#0d2f18',
      bubble: '#061a0c',
      bubbleText: '#8dffae',
      medalHi: '#0d2f18',
      medalHi2: '#113a1e',
      medalLo: '#031208',
      text: '#8dffae',
      text1: '#63f08a',
      text2: '#3fbe63',
      text3: '#2a8a45',
      glowK: 0.9,
    },
  },
  {
    id: 'amethyst',
    name: 'Аметист',
    hint: 'Фиолетовый камень и мягкое сияние',
    tone: 'dark',
    p: {
      fg: '#e6def7',
      bg: '#0c0715',
      accent: '#be90fe',
      onAccent: '#150d20',
      glow: '#be90fe',
      shade: '#000000',
      glass: '#130c1f',
      solid: '#150d21',
      pop: '#120c1e',
      sphere: '#c7aff5',
      surface: '#181026',
      surface2: '#1c132b',
      surface3: '#241936',
      raise: '#221733',
      raise2: '#2e2142',
      bubble: '#201630',
      bubbleText: '#eeeaf8',
      medalHi: '#312447',
      medalHi2: '#3a2a53',
      medalLo: '#160d23',
      text: '#f5f2fb',
      text1: '#e2dcef',
      text2: '#b0a6c5',
      text3: '#817598',
      danger: '#ff7b8b',
      glowK: 0.9,
      shadeK: 1,
    },
  },
  {
    id: 'cherry',
    name: 'Вишня',
    hint: 'Тёмное вино и розовый акцент',
    tone: 'dark',
    p: {
      fg: '#f7dbe0',
      bg: '#130609',
      accent: '#fc829c',
      onAccent: '#20090e',
      glow: '#fc829c',
      shade: '#000000',
      glass: '#1d090e',
      solid: '#1f0a10',
      pop: '#1c090e',
      sphere: '#f0a6b6',
      surface: '#240d13',
      surface2: '#290f16',
      surface3: '#33151d',
      raise: '#30131b',
      raise2: '#3f1d25',
      bubble: '#2d1219',
      bubbleText: '#f8e8eb',
      medalHi: '#441f28',
      medalHi2: '#4f242f',
      medalLo: '#200a10',
      text: '#fbf1f3',
      text1: '#eedadd',
      text2: '#c4a2a9',
      text3: '#967078',
      danger: '#ffa07a',
      glowK: 0.9,
      shadeK: 1,
    },
  },
  {
    id: 'sunset',
    name: 'Закат',
    hint: 'Сливовые сумерки и тёплый персик',
    tone: 'dark',
    p: {
      fg: '#eddded',
      bg: '#0f0710',
      accent: '#ff9a64',
      onAccent: '#1f0b03',
      glow: '#ff9a64',
      shade: '#000000',
      glass: '#170b18',
      solid: '#190c1a',
      pop: '#160b17',
      sphere: '#f9aea2',
      surface: '#1d0f1e',
      surface2: '#221222',
      surface3: '#2a182b',
      raise: '#281629',
      raise2: '#352036',
      bubble: '#261526',
      bubbleText: '#f2e9f2',
      medalHi: '#39233a',
      medalHi2: '#432944',
      medalLo: '#1a0d1b',
      text: '#f8f2f8',
      text1: '#e7dbe7',
      text2: '#b9a5b9',
      text3: '#8a738a',
      danger: '#ff7b8b',
      glowK: 0.9,
      shadeK: 1,
    },
  },
  {
    id: 'coffee',
    name: 'Кофе',
    hint: 'Тёплый шоколад и карамель',
    tone: 'dark',
    p: {
      fg: '#ede0d6',
      bg: '#18110b',
      accent: '#dfa86c',
      onAccent: '#1d0e00',
      glow: '#dfa86c',
      shade: '#000000',
      glass: '#21170f',
      solid: '#231810',
      pop: '#20170f',
      sphere: '#e2b487',
      surface: '#271c12',
      surface2: '#2c1f15',
      surface3: '#35261a',
      raise: '#322419',
      raise2: '#402f22',
      bubble: '#302217',
      bubbleText: '#f2ebe5',
      medalHi: '#443224',
      medalHi2: '#4e3929',
      medalLo: '#241910',
      text: '#f8f3f0',
      text1: '#e7ded6',
      text2: '#b9a99d',
      text3: '#8a786a',
      danger: '#ff7b6b',
      glowK: 0.75,
      shadeK: 1,
    },
  },

  // ---------- светлые ----------
  {
    id: 'light',
    name: 'Светлая',
    hint: 'Светлый фон и тёмный текст — для дня',
    tone: 'light',
    p: {
      fg: '#16171c',
      bg: '#e9ebef',
      accent: '#16171c',
      onAccent: '#ffffff',
      glow: '#1e2232',
      shade: '#282c3c',
      glass: '#fcfcfd',
      solid: '#fafafc',
      pop: '#ffffff',
      sphere: '#282c3c',
      surface: '#ffffff',
      surface2: '#f1f2f5',
      surface3: '#e3e5ea',
      raise: '#eceef2',
      raise2: '#dfe2e8',
      bubble: '#ffffff',
      bubbleText: '#1a1b20',
      medalHi: '#ffffff',
      medalHi2: '#ffffff',
      medalLo: '#d9dce3',
      text: '#0f1014',
      text1: '#25262c',
      text2: '#565862',
      text3: '#7b7e88',
      danger: '#d43d3d',
      glowK: 0.3,
      shadeK: 0.28,
    },
  },
  {
    id: 'sky',
    name: 'Небо',
    hint: 'Светлая голубая, как ясный день',
    tone: 'light',
    p: {
      fg: '#172837',
      bg: '#d8e9f8',
      accent: '#2973d0',
      onAccent: '#fafcff',
      glow: '#193d6b',
      shade: '#1f303e',
      glass: '#f4faff',
      solid: '#f0f8ff',
      pop: '#fafdff',
      sphere: '#305880',
      surface: '#f8fcff',
      surface2: '#e5f1fc',
      surface3: '#d0e2f2',
      raise: '#dfedfa',
      raise2: '#ccdff0',
      bubble: '#fcfeff',
      bubbleText: '#13212c',
      medalHi: '#fcfeff',
      medalHi2: '#fcfeff',
      medalLo: '#c6daec',
      text: '#0d1a24',
      text1: '#1d2c39',
      text2: '#445c71',
      text3: '#60798f',
      danger: '#d43d3d',
      glowK: 0.32,
      shadeK: 0.26,
    },
  },
  {
    id: 'lavender',
    name: 'Лаванда',
    hint: 'Светлая, с нежным сиреневым',
    tone: 'light',
    p: {
      fg: '#282238',
      bg: '#e7e3f9',
      accent: '#6744c5',
      onAccent: '#fcfbff',
      glow: '#3d3368',
      shade: '#2f2a3e',
      glass: '#f9f8ff',
      solid: '#f7f5ff',
      pop: '#fcfcff',
      sphere: '#594c7d',
      surface: '#fbfaff',
      surface2: '#f0edfd',
      surface3: '#e1dcf3',
      raise: '#ece8fb',
      raise2: '#ddd8f1',
      bubble: '#fdfdff',
      bubbleText: '#201c2d',
      medalHi: '#fdfdff',
      medalHi2: '#fdfdff',
      medalLo: '#d9d3ed',
      text: '#191525',
      text1: '#2b273a',
      text2: '#5b5473',
      text3: '#787091',
      danger: '#cc3d5c',
      glowK: 0.32,
      shadeK: 0.26,
    },
  },
  {
    id: 'mint',
    name: 'Мята',
    hint: 'Светлая и свежая, мятный акцент',
    tone: 'light',
    p: {
      fg: '#122c24',
      bg: '#d6ece3',
      accent: '#007b62',
      onAccent: '#f7fefb',
      glow: '#004939',
      shade: '#1b342b',
      glass: '#f2fcf8',
      solid: '#effaf5',
      pop: '#f8fefc',
      sphere: '#246251',
      surface: '#f6fdfa',
      surface2: '#e3f4ed',
      surface3: '#cee6dd',
      raise: '#ddf1e9',
      raise2: '#cae3d9',
      bubble: '#fafffd',
      bubbleText: '#10241d',
      medalHi: '#f9fffd',
      medalHi2: '#f9fffd',
      medalLo: '#c4dfd4',
      text: '#0a1c16',
      text1: '#192f28',
      text2: '#3f6256',
      text3: '#5b7f72',
      danger: '#c8433a',
      glowK: 0.32,
      shadeK: 0.26,
    },
  },
  {
    id: 'paper',
    name: 'Бумага',
    hint: 'Тёплая сепия, как страница книги',
    tone: 'light',
    p: {
      fg: '#3a2c1e',
      bg: '#eae0cd',
      accent: '#964b1e',
      onAccent: '#fff8ec',
      glow: '#78461e',
      shade: '#50371e',
      glass: '#faf4e8',
      solid: '#f8f2e5',
      pop: '#fcf8ef',
      sphere: '#6e4b28',
      surface: '#fbf6ec',
      surface2: '#f2eadb',
      surface3: '#e6dbc6',
      raise: '#efe6d5',
      raise2: '#e4d8c2',
      bubble: '#fdf9f1',
      bubbleText: '#34281b',
      medalHi: '#fffaf0',
      medalHi2: '#fffaf0',
      medalLo: '#e2d5bd',
      text: '#2b2016',
      text1: '#3a2d20',
      text2: '#6b5944',
      text3: '#8a7660',
      danger: '#b8442f',
      glowK: 0.3,
      shadeK: 0.25,
    },
  },
]

export const themeInfo = (id: string): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** Готовые акценты — поверх любой темы ('' — свой акцент темы). На светлых темах их сами чуть затемним. */
export const ACCENTS: { value: string; name: string }[] = [
  { value: '#f87171', name: 'Коралл' },
  { value: '#fb923c', name: 'Мандарин' },
  { value: '#fbbf24', name: 'Янтарь' },
  { value: '#a3e635', name: 'Лайм' },
  { value: '#4ade80', name: 'Мята' },
  { value: '#2dd4bf', name: 'Бирюза' },
  { value: '#38bdf8', name: 'Небо' },
  { value: '#818cf8', name: 'Индиго' },
  { value: '#a78bfa', name: 'Лаванда' },
  { value: '#e879f9', name: 'Орхидея' },
  { value: '#f472b6', name: 'Фуксия' },
]

/** Что из «Внешнего вида» влияет на цвета */
export interface LookColors {
  accent: string // '' — акцент темы, иначе '#rrggbb'
  tint: number // 0…1 — оттенок поверхностей в цвет акцента
}

/**
 * Свой акцент под тему: светлоту подгоняем так, чтобы он читался на фоне и панелях темы
 * (контраст ≥ 3:1, как у значимых элементов интерфейса). Оттенок сохраняем.
 */
export function fitAccent(hex: string, t: ThemeInfo): RGB | null {
  const c = /^#[0-9a-f]{6}$/i.test(hex) ? rgb(hex) : null
  if (!c) return null
  // с небольшим запасом: оттенок поверхностей чуть сдвигает их яркость
  return ensureContrast(c, [rgb(t.p.bg), rgb(t.p.surface), rgb(t.p.raise)], 3.1, t.tone)
}

/** Текст на заливке акцентом: почти чёрный или почти белый в оттенок акцента — что контрастнее */
function inkOn(accent: RGB): RGB {
  const ink = inkFor(accent)
  const [, a, b] = toLab(accent)
  const soft = fromLab(ink[0] === 0 ? [0.17, a * 0.15, b * 0.15] : [0.985, a * 0.04, b * 0.04])
  return contrast(soft, accent) >= 4.5 ? soft : ink
}

/** Все цвета темы с учётом своего акцента и оттенка поверхностей — CSS-переменные «имя → значение» */
export function lookVars(t: ThemeInfo, look: LookColors): Record<string, string> {
  const p = t.p
  const dark = t.tone === 'dark'
  const custom = fitAccent(look.accent, t)
  const accent = custom ?? rgb(p.accent)
  // у белого, чёрного и серого акцента нет оттенка — подкрашивать нечем
  const tint = chroma(toLab(accent)) < 0.02 ? 0 : Math.min(1, Math.max(0, look.tint || 0))

  // Оттенок поверхностей: светлота та же (текст читается как раньше), меняется только цвет.
  // Чистый чёрный при этом чуть светлеет — иначе на нём оттенку негде проявиться.
  const cap = dark ? 0.042 : 0.032
  const surf = (hex: string, floor = 0) => {
    let c = rgb(hex)
    if (!tint) return c
    if (dark && floor) {
      const lab = toLab(c)
      const L = Math.max(lab[0], floor * tint)
      if (L > lab[0]) c = fromLab([L, lab[1], lab[2]])
    }
    return tintToward(c, accent, tint, cap)
  }
  const soft = (hex: string, k: number, capK: number) => (tint ? tintToward(rgb(hex), accent, tint * k, capK) : rgb(hex))

  const bg = surf(p.bg, 0.12)
  const surface = surf(p.surface, 0.15)
  const raise = surf(p.raise, 0.17)
  const bubble = surf(p.bubble, 0.17)
  const fg = soft(p.fg, 0.6, dark ? 0.05 : 0.06)
  const bubbleText = rgb(p.bubbleText)
  const text2 = soft(p.text2, 0.5, 0.04)
  const text3 = soft(p.text3, 0.5, 0.04)
  // сфера следует за акцентом вместе с оттенком поверхностей
  const sphere = tint ? mix(rgb(p.sphere), accent, tint * (dark ? 0.6 : 0.4)) : rgb(p.sphere)
  // акцент как цвет текста (ссылки, @упоминания): на фоне и в пузырях — контраст ≥ 4.5:1
  const ink = ensureContrast(accent, [bg, surface, bubble], 4.6, t.tone)
  // красный «опасного» — тоже текст (ошибки, «Удалить»): на фоне, окнах и меню ≥ 4.5:1
  const danger = ensureContrast(rgb(p.danger), [bg, surface, rgb(p.pop)], 4.6, t.tone)
  // «свои сообщения нейтральным»: пузырь чуть заметнее чужих, текст — как в пузырях
  const ownN = mix(bubble, fg, dark ? 0.07 : 0.045)

  const v: Record<string, string> = {
    '--fg-rgb': channels(fg),
    '--bg-rgb': channels(bg),
    '--accent-rgb': channels(accent),
    '--on-accent-rgb': channels(custom ? inkOn(accent) : rgb(p.onAccent)),
    '--glow-rgb': channels(custom ?? rgb(p.glow)),
    '--theme-glow': String(p.glowK),
    '--shade-rgb': channels(rgb(p.shade)),
    '--shade-k': String(p.shadeK),
    '--glass-rgb': channels(surf(p.glass, 0.14)),
    '--solid-rgb': channels(surf(p.solid, 0.15)),
    '--pop-rgb': channels(surf(p.pop, 0.15)),
    '--sphere-rgb': channels(sphere),
    '--surface': rgbToHex(surface),
    '--surface-2': rgbToHex(surf(p.surface2, 0.16)),
    '--surface-3': rgbToHex(surf(p.surface3, 0.18)),
    '--raise': rgbToHex(raise),
    '--raise-2': rgbToHex(surf(p.raise2, 0.21)),
    '--bubble': rgbToHex(bubble),
    '--bubble-text': rgbToHex(bubbleText),
    '--medal-hi': rgbToHex(surf(p.medalHi, 0.22)),
    '--medal-hi-2': rgbToHex(surf(p.medalHi2, 0.24)),
    '--medal-lo': rgbToHex(surf(p.medalLo, 0.15)),
    '--text': p.text,
    '--text-1': p.text1,
    '--text-2': rgbToHex(text2),
    '--text-3': rgbToHex(text3),
    '--danger': rgbToHex(danger),
    '--accent-ink-rgb': channels(ink),
    '--own-n-rgb': channels(ownN),
    '--own-n-ink-rgb': channels(bubbleText),
  }
  if (t.mono) {
    v['--font'] = 'var(--mono)'
    v['--display'] = 'var(--mono)'
  }
  return v
}

export const cssBlock = (sel: string, vars: Record<string, string>) =>
  `${sel}{${Object.entries(vars)
    .map(([k, val]) => `${k}:${val}`)
    .join(';')}}`

/** Цвет фона темы (с оттенком) — для системной полосы телефона и превью */
export function themeBg(t: ThemeInfo, look: LookColors) {
  return `rgb(${lookVars(t, look)['--bg-rgb'].replace(/ /g, ',')})`
}
