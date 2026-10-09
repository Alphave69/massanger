// Установка сайта «как приложение» на телефон (PWA) и service worker
import { create } from 'zustand'
import { isDesktopApp, isStandalone } from './platform'

/** Событие Chrome/Android: «сайт можно установить» — кнопку «Установить» показываем сами */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallState {
  /** Браузер готов показать своё окно установки (Chrome, Edge, Samsung Internet…) */
  canPrompt: boolean
  /** Уже установлено на это устройство (насколько браузер позволяет это узнать) */
  installed: boolean
}

const FLAG = 'nuntius.installed'

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1')
    else localStorage.removeItem(FLAG)
  } catch {
    // приватный режим — просто не запомним
  }
}

// Запустили со значка на главном экране — запомним: на Android вкладка браузера потом это увидит
if (isStandalone()) writeFlag(true)

export const useInstall = create<InstallState>(() => ({
  canPrompt: false,
  installed: isStandalone() || readFlag(),
}))

let deferred: BeforeInstallPromptEvent | null = null

// Слушаем с самого старта: событие приходит один раз и может прийти раньше, чем откроют страницу скачивания
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // вместо полоски браузера — наша кнопка «Установить»
  deferred = e as BeforeInstallPromptEvent
  // раз браузер предлагает установку — значит, сейчас не установлено (могли и удалить)
  writeFlag(false)
  useInstall.setState({ canPrompt: true, installed: false })
})

window.addEventListener('appinstalled', () => {
  deferred = null
  writeFlag(true)
  useInstall.setState({ canPrompt: false, installed: true })
})

/** Показать окно установки браузера. true — человек согласился */
export async function promptInstall(): Promise<boolean> {
  const event = deferred
  if (!event) return false
  deferred = null // одно событие можно показать только один раз
  useInstall.setState({ canPrompt: false })
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') {
      writeFlag(true)
      useInstall.setState({ installed: true })
      return true
    }
  } catch {
    // браузер передумал показывать окно — ничего страшного
  }
  return false
}

/**
 * Service worker: без него сайт не ставится «как приложение», а без сети показывал бы ошибку браузера.
 * Только в собранной версии (в разработке он мешал бы Vite) и никогда — внутри приложения для Windows.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (isDesktopApp()) {
    // на всякий случай убираем, если когда-то успел встать
    void navigator.serviceWorker
      .getRegistrations()
      .then((list) => list.forEach((r) => void r.unregister()))
      .catch(() => {})
    return
  }
  if (!import.meta.env.PROD) return
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
    // не вышло — сайт работает и без него
  })
}
