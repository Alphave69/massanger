// Мелкие эффекты, общие для разных частей интерфейса
import { uiZoom, useSettings } from './settings'

/** Импульс по фоновой сфере (новое сообщение и т.п.) */
export function pulseSphere(strength = 1) {
  window.dispatchEvent(new CustomEvent('sphere:pulse', { detail: strength }))
}

let audio: AudioContext | null = null
let audioSink = ''

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

/** Общий AudioContext для звуков интерфейса — с выбранным в настройках устройством вывода */
async function soundContext() {
  audio ??= new AudioContext()
  const sink = useSettings.getState().outputDeviceId
  const ctx = audio as SinkContext
  if (sink !== audioSink && ctx.setSinkId) {
    try {
      await ctx.setSinkId(sink)
      audioSink = sink
    } catch {
      // устройство пропало — играем в устройство по умолчанию
    }
  }
  return audio
}

/** Короткий мягкий «блип» — синтезируем, без файлов. force — сыграть даже при выключенных звуках (проверка) */
export async function blip(force = false) {
  const s = useSettings.getState()
  if ((!s.sounds || s.deafened) && !force) return
  try {
    const ctx = await soundContext()
    // Пока пользователь ни разу не кликнул, браузер держит звук на паузе — такие сигналы не копим, а пропускаем
    const running = () => ctx.state === 'running' // функция: состояние меняется после resume()
    if (!running()) {
      if (force) await ctx.resume().catch(() => {})
      else void ctx.resume().catch(() => {})
      if (!running()) return
    }
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const volume = 0.08 * (s.outputVolume / 100)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.26)
  } catch {
    // звук недоступен — не страшно
  }
}

/** Уведомление Windows/macOS, когда вкладка свёрнута */
export function desktopNotify(title: string, body: string, onClick?: () => void) {
  if (!useSettings.getState().desktop || !document.hidden) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', silent: true })
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
  } catch {
    // некоторые браузеры не дают создавать уведомления напрямую — пропускаем
  }
}

/**
 * Подсветка рамок, которая «следует» за курсором.
 * Каждому элементу с классом .glow выставляем координаты курсора относительно него.
 * Внутри увеличенного интерфейса (.zoomed) координаты делим на масштаб.
 */
export function startGlowTracking() {
  let raf = 0
  let x = -1000
  let y = -1000
  const root = document.documentElement
  const apply = () => {
    raf = 0
    root.style.setProperty('--gx', `${x}px`)
    root.style.setProperty('--gy', `${y}px`)
    if (!useSettings.getState().cursorGlow) return
    const zoom = uiZoom()
    for (const el of document.querySelectorAll<HTMLElement>('.glow')) {
      const r = el.getBoundingClientRect()
      const k = el.closest('.zoomed') ? zoom : 1
      el.style.setProperty('--mx', `${(x - r.left) / k}px`)
      el.style.setProperty('--my', `${(y - r.top) / k}px`)
    }
  }
  const onMove = (e: PointerEvent) => {
    x = e.clientX
    y = e.clientY
    if (!raf) raf = requestAnimationFrame(apply)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    cancelAnimationFrame(raf)
  }
}

// ============ звуки голоса и звонков ============

export type ToneKind = 'join' | 'leave' | 'join-other' | 'leave-other' | 'mute' | 'unmute' | 'ring' | 'ringback'

/** Ноты: [частота, начало (с), длительность (с)] — короткие мягкие синусы, без файлов */
const TONES: Record<ToneKind, [number, number, number][]> = {
  join: [
    [523, 0, 0.12],
    [784, 0.09, 0.18],
  ],
  leave: [
    [784, 0, 0.12],
    [523, 0.09, 0.2],
  ],
  'join-other': [[880, 0, 0.12]],
  'leave-other': [[440, 0, 0.14]],
  mute: [[330, 0, 0.07]],
  unmute: [[660, 0, 0.07]],
  ring: [
    [740, 0, 0.18],
    [988, 0.2, 0.18],
    [740, 0.45, 0.18],
    [988, 0.65, 0.22],
  ],
  ringback: [[440, 0, 0.9]],
}

/** Сыграть звук голоса/звонка (при «выключенном звуке» молчим) */
export async function tone(kind: ToneKind) {
  const s = useSettings.getState()
  if (s.deafened) return
  try {
    const ctx = await soundContext()
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    const volume = (kind === 'ring' || kind === 'ringback' ? 0.07 : 0.05) * (s.outputVolume / 100)
    const start = ctx.currentTime + 0.01
    for (const [freq, at, dur] of TONES[kind]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start + at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + at)
      osc.stop(start + at + dur + 0.02)
    }
  } catch {
    // звук недоступен — не страшно
  }
}

/** Повторять звук, пока не остановят (рингтон, гудки). Возвращает «стоп» */
export function toneLoop(kind: ToneKind, every: number) {
  void tone(kind)
  const timer = window.setInterval(() => void tone(kind), every)
  return () => window.clearInterval(timer)
}
