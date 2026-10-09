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
