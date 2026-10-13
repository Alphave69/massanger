/**
 * Темы оформления. Сами цвета живут в styles/themes.css (токены на <html data-theme>),
 * здесь — то, что нужно коду: названия для настроек, светлая/тёмная и цвет системной полосы.
 */
export type ThemeId = 'black' | 'graphite' | 'midnight' | 'light' | 'paper' | 'neon' | 'retro'

export interface ThemeInfo {
  id: ThemeId
  name: string
  hint: string
  tone: 'dark' | 'light'
  /** meta theme-color — полоса браузера и системы на телефоне, под фон темы */
  meta: string
}

export const THEMES: ThemeInfo[] = [
  { id: 'black', name: 'Чёрная', hint: 'Чистый чёрный и белое свечение', tone: 'dark', meta: '#000000' },
  { id: 'graphite', name: 'Графит', hint: 'Мягкий тёмно-серый, глазам спокойнее', tone: 'dark', meta: '#17181b' },
  { id: 'midnight', name: 'Полночь', hint: 'Глубокий синий и холодный акцент', tone: 'dark', meta: '#050916' },
  { id: 'neon', name: 'Неон', hint: 'Чёрный и бирюзовое свечение', tone: 'dark', meta: '#020208' },
  { id: 'retro', name: 'Ретро-терминал', hint: 'Зелёный фосфор и строки развёртки', tone: 'dark', meta: '#010703' },
  { id: 'light', name: 'Светлая', hint: 'Светлый фон и тёмный текст — для дня', tone: 'light', meta: '#e9ebef' },
  { id: 'paper', name: 'Бумага', hint: 'Тёплая сепия, как страница книги', tone: 'light', meta: '#eae0cd' },
]

export const themeInfo = (id: string): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** Готовые акценты — поверх любой темы ('' — свой акцент темы) */
export const ACCENTS: { value: string; name: string }[] = [
  { value: '#22d3ee', name: 'Бирюза' },
  { value: '#60a5fa', name: 'Небо' },
  { value: '#a78bfa', name: 'Лаванда' },
  { value: '#f472b6', name: 'Фуксия' },
  { value: '#f87171', name: 'Коралл' },
  { value: '#fbbf24', name: 'Янтарь' },
  { value: '#4ade80', name: 'Мята' },
]
