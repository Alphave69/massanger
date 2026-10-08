import { create } from 'zustand'
import { api, type FoundEgg, type Me } from './api'
import { blip, pulseSphere } from './fx'
import { guildOfChannel } from './perms'
import { setSetting, useSettings, type Settings } from './settings'
import { chat, useChat } from './store'
import { useVoice } from './voice'

/**
 * Пасхалки: все «триггеры» живут здесь.
 * Правило одно — не мешать: никаких ложных срабатываний при наборе текста, никаких блокирующих окон,
 * слушатели дешёвые. Сервер сам помнит, что уже найдено, — повторная находка ничего не делает.
 */

/** Что сейчас показывает слой пасхалок (EggLayer) */
interface EggState {
  /** Время начала «вечеринки» (0 — нет) */
  party: number
  /** Окно «Горячие клавиши» */
  shortcuts: boolean
}

export const useEggs = create<EggState>(() => ({ party: 0, shortcuts: false }))

export const PARTY_MS = 6000

// ============ находка ============

const inFlight = new Set<string>()
/** После ошибки (например, сервер ещё не знает такую пасхалку) не долбим его каждую секунду */
const failedAt = new Map<string, number>()

const hasEgg = (me: Me, id: string) => Array.isArray(me.eggs) && me.eggs.some((e) => e.id === id)

/** Нашёл пасхалку — сообщаем серверу (повторная находка ничего не делает) */
export function findEgg(id: string): void {
  const me = useChat.getState().me
  if (!me || hasEgg(me, id) || inFlight.has(id)) return
  if (Date.now() - (failedAt.get(id) ?? 0) < 60_000) return
  inFlight.add(id)
  api
    .findEgg(id)
    .then(({ isNew, egg, user }) => {
      if (user) chat.setMe(user)
      if (isNew && egg) announce(egg, user?.eggs?.length ?? 0, user?.eggTotal ?? 0)
    })
    .catch(() => failedAt.set(id, Date.now())) // пасхалки не должны ругаться ошибками
    .finally(() => inFlight.delete(id))
}

/** Сервер сам засчитал пасхалку (например, за команду /roll) */
export function onEggFound(e: { egg: FoundEgg; count: number; total: number }): void {
  if (!e?.egg) return
  announce(e.egg, e.count, e.total)
}

function announce(egg: FoundEgg, count: number, total: number) {
  void blip()
  pulseSphere(1.2)
  chat.toast({
    title: `🥚 Пасхалка найдена: ${egg.name}`,
    text: total && count >= total ? 'Все пасхалки найдены!' : total ? `${count} из ${total} — ищи дальше` : 'Ищи дальше',
  })
}

// ============ мелочи ============

const lastFlavor = new Map<string, number>()

/** «Реакция» пасхалки — не чаще раза в полминуты, чтобы не надоедать */
function flavor(id: string, title: string, text?: string) {
  const now = Date.now()
  if (now - (lastFlavor.get(id) ?? 0) < 30_000) return
  lastFlavor.set(id, now)
  chat.toast({ title, text })
}

/** Сколько раз подряд случилось событие за окно времени; true — набрали нужное (счётчик сбрасывается) */
const bursts = new Map<string, number[]>()
function burst(key: string, need: number, within: number): boolean {
  const now = Date.now()
  const list = (bursts.get(key) ?? []).filter((t) => now - t < within)
  list.push(now)
  if (list.length >= need) {
    bursts.delete(key)
    return true
  }
  bursts.set(key, list)
  return false
}

/** Тост, который заменяет предыдущий с тем же ключом (обратный отсчёт и т.п.) */
const keyedToasts = new Map<string, number>()
function replaceToast(key: string, title: string, text?: string) {
  const prev = keyedToasts.get(key)
  if (prev) chat.dismissToast(prev)
  chat.toast({ title, text })
  const toasts = useChat.getState().toasts
  keyedToasts.set(key, toasts[toasts.length - 1]?.id ?? 0)
}

/** Пишет ли человек сейчас в поле ввода — тогда горячие клавиши пасхалок молчат */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

const reducedMotion = () => useSettings.getState().reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Класс на <html> на время — для анимаций «на весь экран» */
function flash(cls: string, ms: number) {
  const root = document.documentElement
  root.classList.remove(cls)
  void root.offsetWidth // перезапуск анимации, если класс уже был
  root.classList.add(cls)
  window.setTimeout(() => root.classList.remove(cls), ms)
}

// ============ даты ============

export function isAprilFools(d = new Date()) {
  return d.getMonth() === 3 && d.getDate() === 1
}

/** 11:11 и 22:22 — загадай желание */
export function isWishTime(ts: number) {
  const d = new Date(ts)
  const h = d.getHours()
  return (h === 11 || h === 22) && d.getMinutes() === h
}

/** Снег — с 20 декабря по 10 января */
export function isSnowSeason(d = new Date()) {
  const m = d.getMonth()
  const day = d.getDate()
  return (m === 11 && day >= 20) || (m === 0 && day <= 10)
}

// ============ триггеры, которые зовут компоненты ============

/** Вечеринка: конфетти из белых точек и пульс свечения */
export function party() {
  useEggs.setState({ party: Date.now() })
  void blip()
  pulseSphere(2)
}

export function closeShortcuts() {
  useEggs.setState({ shortcuts: false })
}

/** Сообщение успешно отправлено — проверить «секретные слова» */
export function onMessageSent(content: string): void {
  const text = content.trim()
  if (/сделай бочку|do a barrel roll/i.test(text)) {
    if (!reducedMotion()) flash('egg-barrel', 1300)
    findEgg('barrel')
  }
  if (text === '42') {
    flavor('answer', 'Ответ на главный вопрос жизни, вселенной и всего такого', 'Осталось понять, какой был вопрос.')
    findEgg('answer')
  }
  if (/nuntius/i.test(text)) {
    flavor('latin', 'Nuntius — „вестник“ по-латыни', 'Ты и есть вестник ✦')
    pulseSphere(1.5)
    findEgg('latin')
  }
}

/** Клик по версии приложения в настройках (7 раз — режим разработчика) */
const versionClicks: number[] = []
export function versionClick(): void {
  const now = Date.now()
  while (versionClicks.length && now - versionClicks[0] > 4000) versionClicks.shift()
  versionClicks.push(now)
  const n = versionClicks.length

  if (useSettings.getState().devMode) {
    if (n === 1) replaceToast('developer', 'Ты уже разработчик', 'Лаборатория ждёт в настройках ✦')
    findEgg('developer')
    return
  }
  if (n >= 7) {
    versionClicks.length = 0
    setSetting('devMode', true)
    replaceToast('developer', 'Теперь ты разработчик 🧪', 'В настройках открылась «Лаборатория»')
    void blip()
    findEgg('developer')
    return
  }
  // как в Android: после третьего клика — обратный отсчёт
  if (n >= 3) {
    const left = 7 - n
    replaceToast('developer', `Ещё ${left} ${left === 1 ? 'шаг' : left < 5 ? 'шага' : 'шагов'}, и ты разработчик`)
  }
}

/** Плитка со сферой в доке: 7 кликов за 3 секунды. true — сфера «взрывается» */
export function sphereTileClick(): boolean {
  if (!burst('sphere', 7, 3000)) return false
  flavor('sphere', 'Не трогай сферу!', 'Ну вот, раскрутил(а)…')
  pulseSphere(2.5)
  findEgg('sphere')
  return true
}

/** Своя аватарка внизу слева: 5 кликов за 2 секунды. true — аватарка кружится */
export function selfAvatarClick(): boolean {
  if (!burst('dizzy', 5, 2000)) return false
  flavor('dizzy', 'Голова закружилась 😵‍💫', 'Хватит меня крутить')
  findEgg('dizzy')
  return true
}

/** «Это начало…» в начале чата: 3 клика. true — показать спрятанную строку */
export function introClick(channelId: string): boolean {
  if (!burst(`origin:${channelId}`, 3, 1500)) return false
  findEgg('origin')
  return true
}

// ============ лаборатория: классы на <html> ============

const RETRO_FILTER_ID = 'nuntius-retro'

/** SVG-фильтр «зелёный фосфор»: яркость → оттенки зелёного */
function ensureRetroFilter() {
  if (document.getElementById(RETRO_FILTER_ID)) return
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  const filter = document.createElementNS(ns, 'filter')
  filter.id = RETRO_FILTER_ID
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  const matrix = document.createElementNS(ns, 'feColorMatrix')
  matrix.setAttribute('type', 'matrix')
  // R, G, B — доли яркости (0.21R + 0.72G + 0.07B): белое становится #40ff73
  matrix.setAttribute(
    'values',
    ['0.053 0.179 0.018 0 0', '0.2126 0.7152 0.0722 0 0', '0.096 0.322 0.032 0 0', '0 0 0 1 0'].join(' '),
  )
  filter.appendChild(matrix)
  svg.appendChild(filter)
  document.body.appendChild(svg)
}

function applyLab(s: Settings) {
  const root = document.documentElement
  const on = s.devMode
  if (on && s.labRetro) ensureRetroFilter()
  root.classList.toggle('lab-negative', on && s.labNegative)
  root.classList.toggle('lab-mirror', on && s.labMirror)
  root.classList.toggle('lab-retro', on && s.labRetro)
}

applyLab(useSettings.getState())
useSettings.subscribe(applyLab)

// ============ «хакер»: баннер в консоли и window.nuntius ============

declare global {
  interface Window {
    nuntius?: { hack: () => string; help: () => string }
  }
}

const SPHERE_ART = [
  '          . · ˙ ˙ · .          ',
  '      · ˙  ·   ✦   ·  ˙ ·      ',
  '    ·  ˙ · ˙ · ˙ · ˙ · ˙  ·    ',
  '   · ˙ ·  N U N T I U S  · ˙ · ',
  '    ·  ˙ · ˙ · ˙ · ˙ · ˙  ·    ',
  '      · ˙  ·   ˙   ·  ˙ ·      ',
  '          ˙ · . . · ˙          ',
].join('\n')

let hacking = false

function hack(): string {
  if (hacking) return 'Уже взламываем, потерпи…'
  hacking = true
  const steps = [
    'Подключаемся к мейнфрейму Nuntius…',
    'Обходим файрвол… ▓▓▓▓▓▓░░░░ 60%',
    'Обходим файрвол… ▓▓▓▓▓▓▓▓▓▓ 100%',
    'Расшифровываем сферу: 3.14159265358979…',
    'Подбираем пароль: ******** ✓',
    'Доступ получен. Шучу — ты и так здесь свой ✦',
  ]
  steps.forEach((line, i) => {
    window.setTimeout(() => {
      console.log(`%c> ${line}`, 'color:#40ff73;font-family:monospace;font-size:12px')
      if (i === steps.length - 1) {
        hacking = false
        if (useChat.getState().me) findEgg('hacker')
        else console.log('%cВойди в Nuntius, чтобы пасхалка засчиталась', 'color:#888')
      }
    }, 450 * (i + 1))
  })
  return 'Взлом начат…'
}

function help(): string {
  console.log(
    '%cnuntius.hack()%c — взломать Nuntius (честно-честно)\n%cnuntius.help()%c — эта подсказка',
    'font-weight:700;font-family:monospace',
    'color:inherit',
    'font-weight:700;font-family:monospace',
    'color:inherit',
  )
  return 'Пасхалок 19. Ищи ✦'
}

function consoleBanner() {
  try {
    console.log(`%c${SPHERE_ART}`, 'color:#fff;background:#000;font-family:monospace;font-size:12px;line-height:1.25;padding:8px 12px;text-shadow:0 0 6px #fff')
    console.log('%cNuntius — вестник. Любопытно, что внутри? Попробуй %cnuntius.hack()', 'color:#aaa;font-size:12px', 'color:#fff;font-weight:700;font-family:monospace')
  } catch {
    // консоль недоступна — ну и ладно
  }
}

if (typeof window !== 'undefined') {
  window.nuntius = { hack, help }
  consoleBanner()
}

// ============ наблюдатели (пока открыто приложение) ============

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA']
const NIGHT_KEY = 'nuntius.egg.night'
const ECHO_AFTER = 60_000

/** Ночь с 03:00 до 04:59 — спросить «почему не спишь» (раз за ночь) */
function checkNight() {
  const d = new Date()
  const h = d.getHours()
  if (h < 3 || h >= 5) return
  const night = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  try {
    if (localStorage.getItem(NIGHT_KEY) === night) return
    localStorage.setItem(NIGHT_KEY, night)
  } catch {
    // без хранилища спросим ещё раз — не страшно
  }
  chat.toast({ title: 'Почему не спишь? 🌙', text: 'Сфера тоже не спит. Но ей можно.' })
  findEgg('night')
}

/**
 * Запустить слушатели пасхалок. Зовёт EggLayer при входе в приложение; возвращает «стоп».
 */
export function startEggs(): () => void {
  const cleanups: (() => void)[] = []

  // --- клавиатура: Konami и «?» ---
  let konami = 0
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || isTyping(e.target)) {
      konami = 0
      return
    }
    const code = e.key.startsWith('Arrow') ? e.key : e.code
    if (code === KONAMI[konami]) {
      konami++
      if (konami === KONAMI.length) {
        konami = 0
        party()
        findEgg('konami')
      }
    } else {
      konami = code === KONAMI[0] ? 1 : 0
    }

    // «?» — это Shift + «/» (в русской раскладке на той же клавише «,» — ловим по коду клавиши)
    if ((e.key === '?' || (e.code === 'Slash' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      useEggs.setState((s) => ({ shortcuts: !s.shortcuts }))
      findEgg('shortcuts')
    }
  }
  window.addEventListener('keydown', onKey)
  cleanups.push(() => window.removeEventListener('keydown', onKey))

  // --- настройки: микрофон-кликер и «лупа» ---
  cleanups.push(
    useSettings.subscribe((s, prev) => {
      if (s.muted !== prev.muted && burst('clicker', 10, 5000)) {
        flavor('clicker', 'Кнопка работает, честно', 'Микрофон уже устал щёлкать')
        findEgg('clicker')
      }
      if (s.uiScale >= 1.3 - 1e-6 && prev.uiScale < 1.3 - 1e-6) {
        flavor('zoom', 'Лупа 🔍', 'Крупнее уже не бывает')
        findEgg('zoom')
      }
    }),
  )

  // --- статус: «определись уже» ---
  cleanups.push(
    useChat.subscribe((s, prev) => {
      if (!s.me || !prev.me || s.me.id !== prev.me.id || s.me.status === prev.me.status) return
      if (burst('indecisive', 5, 30_000)) {
        flavor('indecisive', 'Определись уже 😅', 'Пять статусов за полминуты — это рекорд')
        findEgg('indecisive')
      }
    }),
  )

  // --- голос: «громче некуда» и «эхо» ---
  let echoTimer = 0
  const alone = () => {
    const v = useVoice.getState()
    if (v.status !== 'connected' || !v.roomId) return false
    if (!guildOfChannel(useChat.getState().guilds, v.roomId)) return false
    const me = useChat.getState().me?.id
    const members = v.rooms[v.roomId] ?? []
    return members.every((m) => m.userId === me)
  }
  const checkEcho = () => {
    if (!alone()) {
      window.clearTimeout(echoTimer)
      echoTimer = 0
      return
    }
    if (echoTimer) return
    echoTimer = window.setTimeout(() => {
      echoTimer = 0
      if (!alone()) return
      flavor('echo', 'Эхо… эхо… эхо…', 'Здесь пока никого. Позови друзей!')
      findEgg('echo')
    }, ECHO_AFTER)
  }
  cleanups.push(
    useVoice.subscribe((s, prev) => {
      if (s.volumes !== prev.volumes && Object.entries(s.volumes).some(([id, v]) => v >= 200 && (prev.volumes[id] ?? 100) < 200)) {
        flavor('loud', 'Громче некуда 📢', 'Соседи уже в курсе')
        findEgg('loud')
      }
      if (s.status !== prev.status || s.roomId !== prev.roomId || s.rooms !== prev.rooms) checkEcho()
    }),
  )
  cleanups.push(() => window.clearTimeout(echoTimer))

  // --- «полуночник»: при входе и потом раз в 10 минут ---
  checkNight()
  const nightTimer = window.setInterval(checkNight, 10 * 60_000)
  cleanups.push(() => window.clearInterval(nightTimer))

  return () => {
    for (const fn of cleanups) fn()
    useEggs.setState({ party: 0, shortcuts: false })
  }
}
