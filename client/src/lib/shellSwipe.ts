import type { RefObject } from 'react'
import { hold, settle, useSwipe, type SwipeGesture } from './swipe'
import { ui, useUi } from './ui'

/** Свайп закрывает чат или открывает панель — экранная клавиатура больше не нужна */
function hideKeyboard() {
  const el = document.activeElement
  if (el instanceof HTMLElement && el.matches('textarea, input, [contenteditable=true]')) el.blur()
}

/**
 * Телефон: свайпы по главному экрану (как в Discord).
 * В чате: вправо — к списку каналов и личек, влево — участники или профиль справа.
 * Открыта панель справа: вправо — закрыть её. В списке: влево — обратно в последний открытый чат.
 * overlay() — открыто что-то поверх (окно, шторка, настройки): тогда главный экран не трогаем.
 */
export function useShellSwipe(ref: RefObject<HTMLDivElement | null>, active: boolean, overlay: () => boolean) {
  useSwipe(
    ref,
    {
      start(dir): SwipeGesture | null {
        const root = ref.current
        if (!root || overlay()) return null
        const u = useUi.getState()
        const q = (sel: string) => root.querySelector<HTMLElement>(`:scope > ${sel}`)
        const main = q('.main')
        const list = [q('.dock'), q('.side')]
        const aside = q('.aside-wrap')
        const shade = q('.aside-backdrop')
        const width = (el: HTMLElement) => el.getBoundingClientRect().width

        // панель справа открыта — вправо её закрываем
        if (u.asideOpen) {
          if (dir !== 'right' || !aside) return null
          const size = width(aside)
          return {
            size,
            move(px) {
              const p = px / size
              hold(aside, { translate: `${(p * 104).toFixed(2)}% 0` })
              hold(shade, { opacity: String(1 - p) })
            },
            end: (commit) => settle([aside, shade], commit ? ui.closeAside : undefined),
          }
        }

        if (u.mobileMain) {
          // чат уезжает вправо, из-под него выезжает список
          if (dir === 'right' && main) {
            const size = width(main)
            return {
              size,
              move(px) {
                const p = px / size
                hold(main, { translate: `${(p * 100).toFixed(2)}% 0` })
                for (const el of list) hold(el, { translate: `${(-22 * (1 - p)).toFixed(2)}% 0`, opacity: String(p), visibility: 'visible' })
              },
              end(commit) {
                if (commit) hideKeyboard()
                settle([main, ...list], commit ? ui.showNav : undefined)
              },
            }
          }
          // участники сервера или профиль собеседника выезжают справа (на «Друзьях» их нет)
          if (dir === 'left' && aside) {
            const size = width(aside)
            return {
              size,
              move(px) {
                const p = px / size
                hold(aside, { translate: `${((1 - p) * 104).toFixed(2)}% 0`, visibility: 'visible' })
                hold(shade, { opacity: String(p) })
              },
              end(commit) {
                if (commit) hideKeyboard()
                settle([aside, shade], commit ? ui.openAside : undefined)
              },
            }
          }
          return null
        }

        // список: влево — обратно в чат, который был открыт
        if (dir === 'left' && main) {
          const size = width(main)
          return {
            size,
            move(px) {
              const p = px / size
              hold(main, { translate: `${((1 - p) * 100).toFixed(2)}% 0`, visibility: 'visible' })
              for (const el of list) hold(el, { translate: `${(-22 * p).toFixed(2)}% 0`, opacity: String(1 - p) })
            },
            end: (commit) => settle([main, ...list], commit ? ui.showMain : undefined),
          }
        }
        return null
      },
    },
    active,
  )
}
