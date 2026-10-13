import { create } from 'zustand'
import { isDesktopApp } from './platform'

/**
 * Помощник с разрешениями на микрофон, камеру и экран.
 * Не все догадываются, что делать с окошком браузера «разрешить доступ?» или где включить запрещённое:
 *  - пока браузер спрашивает — подсказка «нажми «Разрешить»» с картинкой, где это окошко;
 *  - запретили — окно с пошаговой инструкцией под свой браузер / телефон / Windows и кнопкой «Проверить снова».
 */

export type MediaKind = 'mic' | 'camera' | 'screen'

interface DeniedState {
  kind: MediaKind
  /** Окошко браузера закрыли, не ответив (Chrome: «Permission dismissed») — запрета нет, можно спросить снова */
  dismissed: boolean
  /** Нажали «Проверить снова», а доступа всё ещё нет */
  stillDenied: boolean
  checking: boolean
  seq: number
}

export interface MediaHelpState {
  /** Сейчас открыто окошко браузера с вопросом — показываем подсказку */
  asking: MediaKind | null
  denied: DeniedState | null
}

export const useMediaHelp = create<MediaHelpState>(() => ({ asking: null, denied: null }))

const set = useMediaHelp.setState
const get = useMediaHelp.getState

interface HelpOptions {
  /** Как проверить снова (по умолчанию — спросить устройство и сразу отпустить) */
  retry?: () => Promise<boolean>
  /** Доступ появился — сделать то, ради чего спрашивали (зайти с микрофоном, включить камеру) */
  onGranted?: () => void
}

let options: HelpOptions = {}
let seq = 0

/** Браузер или система запретили доступ (а не устройство занято / не найдено) */
export function mediaDenied(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
}

const PERMISSION_NAME: Record<Exclude<MediaKind, 'screen'>, string> = { mic: 'microphone', camera: 'camera' }

/** Что браузер ответит на запрос: granted / prompt (спросит) / denied. null — браузер не говорит (старый Safari, Firefox без camera) */
export async function permissionState(kind: MediaKind): Promise<PermissionState | null> {
  if (kind === 'screen' || !navigator.permissions?.query) return null
  try {
    return (await navigator.permissions.query({ name: PERMISSION_NAME[kind] as PermissionName })).state
  } catch {
    return null
  }
}

const SEEN_KEY = 'nuntius.mediaHelp'

/** Что уже хоть раз давали (если браузер не говорит, спросит ли он) и какие подсказки уже видели */
function seen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function remember(key: string) {
  try {
    const all = seen()
    if (all[key]) return
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...all, [key]: true }))
  } catch {
    // нет доступа к хранилищу — подсказка покажется ещё раз, не страшно
  }
}

/**
 * Спросить у браузера микрофон / камеру / экран. Если сейчас появится окошко браузера — рядом показываем,
 * куда нажать. Экран спрашиваем сразу, без ожидания: браузер даёт его только в ответ на нажатие кнопки.
 */
export async function askMedia<T>(kind: MediaKind, open: () => Promise<T>): Promise<T> {
  let hint = false
  if (!isDesktopApp()) {
    if (kind === 'screen') {
      // окно выбора экрана браузер показывает всегда — подсказываем про него один раз
      hint = !seen()['hint:screen']
      if (hint) remember('hint:screen')
    } else {
      const state = await permissionState(kind)
      hint = state === 'prompt' || (state === null && !seen()[`granted:${kind}`])
    }
  }
  if (hint) set({ asking: kind })
  try {
    const result = await open()
    remember(`granted:${kind}`)
    // доступ появился (например, разрешили в другой вкладке) — окно с инструкцией больше не нужно
    if (kind !== 'screen' && get().denied?.kind === kind) set({ denied: null })
    return result
  } finally {
    if (hint && get().asking === kind) set({ asking: null })
  }
}

/** Убрать подсказку «нажми «Разрешить»» (крестиком) */
export const hideAsk = () => set({ asking: null })

/** Показать окно «нет доступа» с инструкцией под этот браузер или систему */
export function showMediaHelp(kind: MediaKind, opts: HelpOptions = {}, err?: unknown) {
  options = opts
  const dismissed = err instanceof DOMException && /dismiss/i.test(err.message)
  // «Проверить снова» само наткнулось на запрет — то же окно, но с пометкой «всё ещё нет»
  const prev = get().denied
  const stillDenied = Boolean(prev && prev.kind === kind && prev.checking)
  set({ asking: null, denied: { kind, dismissed, stillDenied, checking: false, seq: ++seq } })
}

export const closeMediaHelp = () => set({ denied: null })

/** Спросить устройство и сразу отпустить — есть ли доступ */
async function probe(kind: MediaKind): Promise<boolean> {
  if (kind === 'screen') return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'mic' ? { audio: true } : { video: true })
    stream.getTracks().forEach((t) => t.stop())
    remember(`granted:${kind}`)
    return true
  } catch {
    return false
  }
}

/** «Проверить снова»: получилось — закрываем окно и делаем то, ради чего спрашивали */
export async function retryMediaHelp() {
  const cur = get().denied
  if (!cur || cur.checking) return
  set({ denied: { ...cur, checking: true, stillDenied: false } })
  const { retry, onGranted } = options
  const ok = await (retry ? retry() : probe(cur.kind)).catch(() => false)
  const now = get().denied
  // пока проверяли, окно закрыли или открыли заново для другого — не трогаем
  if (!now || now.seq !== cur.seq) return
  if (ok) {
    set({ denied: null })
    onGranted?.()
  } else {
    set({ denied: { ...now, checking: false, stillDenied: true } })
  }
}
