// Где запущен Nuntius: в приложении для Windows, установленным на телефон или просто во вкладке браузера

type DesktopBridge = { isDesktop?: boolean }

/** Приложение для Windows (Electron): оно само выставляет window.nuntiusDesktop */
export function isDesktopApp(): boolean {
  return !!(window as { nuntiusDesktop?: DesktopBridge }).nuntiusDesktop?.isDesktop
}

/** Открыт со значка на главном экране (PWA) — без строки адреса браузера */
export function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  } catch {
    // старый браузер без matchMedia — считаем, что это обычная вкладка
  }
  // iPhone/iPad отмечают «на экране Домой» по-своему
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Внутри «настоящего» приложения: там не нужны ни лендинг, ни кнопки «Скачать» */
export function isInstalledApp(): boolean {
  return isDesktopApp() || isStandalone()
}

/** Браузер умеет показывать экран (на iPhone и Android getDisplayMedia нет) */
export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

export type Os = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other'

export function detectOs(): Os {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  // iPad с iPadOS 13+ притворяется Mac'ом — выдаёт его сенсорный экран
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/windows/i.test(ua)) return 'windows'
  if (/mac os x|macintosh/i.test(ua)) return 'mac'
  if (/linux|cros/i.test(ua)) return 'linux'
  return 'other'
}

/** iPad: там кнопка «Поделиться» сверху, а не снизу */
export function isIpad(): boolean {
  return detectOs() === 'ios' && !/iphone|ipod/i.test(navigator.userAgent)
}

export function isPhoneOs(os: Os): boolean {
  return os === 'android' || os === 'ios'
}

/** Safari на iPhone/iPad (не Chrome, не Яндекс и т.п. — у них свои меню) */
export function isIosSafari(): boolean {
  return detectOs() === 'ios' && !/crios|fxios|edgios|opios|yabrowser|gsa\//i.test(navigator.userAgent)
}

export type Browser = 'yandex' | 'edge' | 'opera' | 'samsung' | 'firefox' | 'chrome' | 'safari' | 'other'

/** Какой браузер: от него зависит, где искать разрешения (порядок важен — почти все притворяются Chrome и Safari) */
export function detectBrowser(): Browser {
  const ua = navigator.userAgent
  if (/yabrowser/i.test(ua)) return 'yandex'
  if (/edg(e|a|ios)?\//i.test(ua)) return 'edge'
  if (/opr\/|opera|opios/i.test(ua)) return 'opera'
  if (/samsungbrowser/i.test(ua)) return 'samsung'
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome'
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

export const BROWSER_NAME: Record<Browser, string> = {
  yandex: 'Яндекс Браузер',
  edge: 'Edge',
  opera: 'Opera',
  samsung: 'Samsung Internet',
  firefox: 'Firefox',
  chrome: 'Chrome',
  safari: 'Safari',
  other: 'браузер',
}

/**
 * Где спрашивают доступ к микрофону и камере — от этого зависит инструкция:
 * app — приложение для Windows (разрешает само, запретить может только Windows),
 * chromium — Chrome, Edge, Яндекс, Opera на компьютере; firefox; safari — на Mac; android; ios — любой браузер на iPhone/iPad
 */
export type MediaEnv = 'app' | 'chromium' | 'firefox' | 'safari' | 'android' | 'ios' | 'other'

export function detectMediaEnv(): MediaEnv {
  if (isDesktopApp()) return 'app'
  const os = detectOs()
  if (os === 'ios') return 'ios'
  if (os === 'android') return 'android'
  const browser = detectBrowser()
  if (browser === 'firefox') return 'firefox'
  if (browser === 'safari') return os === 'mac' ? 'safari' : 'other'
  if (browser === 'other') return 'other'
  return 'chromium'
}
