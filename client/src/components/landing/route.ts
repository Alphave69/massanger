// Маршруты без библиотек: адрес в строке браузера ↔ какая страница открыта
import { useSyncExternalStore } from 'react'

/** home — лендинг (или приложение после входа), login — вход, download — страница скачивания */
export type Route = 'home' | 'login' | 'download'

const PATHS: Record<Route, string> = {
  home: '/',
  login: '/login',
  download: '/download',
}

const EVENT = 'nuntius:route'
/** Метка в истории браузера: с какой нашей страницы сюда пришли */
const FROM_KEY = 'nuntiusFrom'

export function currentRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === PATHS.download) return 'download'
  if (path === PATHS.login) return 'login'
  return 'home'
}

/** Перейти на страницу. replace — без новой записи в истории (кнопка «Назад» её пропустит) */
export function navigate(route: Route, replace = false) {
  const path = PATHS[route]
  if (window.location.pathname !== path) {
    if (replace) window.history.replaceState(null, '', path)
    else window.history.pushState({ [FROM_KEY]: currentRoute() }, '', path)
  }
  window.dispatchEvent(new Event(EVENT))
}

/**
 * Кнопки «Назад» / «Вернуться в Nuntius»: если пришли сюда со страницы route — это шаг назад по истории,
 * а не новая запись. Иначе кнопка «Назад» браузера (и Android) снова открывала бы страницу, с которой ушли.
 * replace — если шагнуть назад нельзя, заменить текущую запись, а не добавлять новую.
 */
export function goBack(route: Route, replace = false) {
  const state = window.history.state as Record<string, unknown> | null
  // Запись должна быть только нашей: если поверх легла чужая (например, «открыт чат» на телефоне), шаг назад увёл бы не туда
  const ours = !!state && state[FROM_KEY] === route && Object.keys(state).length === 1
  if (ours && window.location.pathname !== PATHS[route]) window.history.back()
  else navigate(route, replace)
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute)
}
