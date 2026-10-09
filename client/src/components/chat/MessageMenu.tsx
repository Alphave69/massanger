import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Check, Copy, Forward, IdCard, Pencil, Plus, Reply, Trash2 } from 'lucide-react'
import type { Message } from '../../lib/api'
import { copyText, deleteMessage, findLoaded, messageRights, msgUi, QUICK_REACTIONS, rememberEmoji, useMsgUi, type MenuState } from '../../lib/msgActions'
import { reactToMessage } from '../../lib/realtime'
import { uiZoom, useSettings } from '../../lib/settings'
import { activeChannelId, useChat } from '../../lib/store'
import { useUi } from '../../lib/ui'
import { EmojiPicker } from './EmojiPicker'

/**
 * Меню сообщения — по правому клику или кнопке «ещё»: быстрые реакции, ответить, переслать,
 * скопировать, изменить, удалить. Рисуется поверх всего (порталом), с учётом масштаба интерфейса.
 * Закрывается по Esc, клику мимо, прокрутке и смене канала. Стрелки ходят по пунктам.
 */
export function MessageMenu() {
  const menu = useMsgUi((s) => s.menu)
  const message = useChat((s) => (menu ? findLoaded(s, menu.channelId, menu.messageId) : undefined))
  const activeId = useChat((s) => activeChannelId(s))
  const overlay = useUi((s) => s.settings !== null || s.serverSettings !== null)

  // Сообщение удалили, ушли в другой канал или открыли настройки — меню больше не к чему
  const stale = menu !== null && (!message || menu.channelId !== activeId || overlay)
  useEffect(() => {
    if (stale) msgUi.closeMenu()
  }, [stale])

  if (!menu || !message || stale) return null
  return createPortal(
    <div className="zoomed msg-menu-layer">
      <MenuPop key={menu.seq} menu={menu} message={message} />
    </div>,
    document.body,
  )
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

function MenuPop({ menu, message }: { menu: MenuState; message: Message }) {
  const popRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState(menu.mode)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'text' | 'id' | null>(null)
  const rights = useChat(useShallow((s) => messageRights(s, message)))
  const meId = useChat((s) => s.me?.id ?? '')
  const devMode = useSettings((s) => s.devMode)

  const isMine = (emoji: string) => Boolean(message.reactions?.[emoji]?.includes(meId))

  // У курсора (или у кнопки), но целиком в окне. Координаты окна → CSS-пиксели масштабированного слоя
  useLayoutEffect(() => {
    const el = popRef.current
    if (!el) return
    const k = uiZoom()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const a = menu.anchor
    let left: number
    let top: number
    if (a.kind === 'point') {
      left = a.x / k
      top = a.y / k
      if (left + w > vw - 8) left -= w
      if (top + h > vh - 8) top -= h
    } else {
      left = a.right / k - w
      const below = a.bottom / k + 6
      top = below + h > vh - 8 ? a.top / k - h - 6 : below
    }
    const fx = clamp(left, 8, vw - w - 8)
    const fy = clamp(top, 8, vh - h - 8)
    const ax = a.kind === 'point' ? a.x / k : a.right / k
    const ay = a.kind === 'point' ? a.y / k : a.top / k
    setPos({ left: fx, top: fy, origin: `${ax > fx + w / 2 ? 'right' : 'left'} ${ay > fy + h / 2 ? 'bottom' : 'top'}` })
  }, [mode, menu.anchor])

  // Фокус — на первый пункт (выбор эмодзи фокусируется сам)
  const placed = pos !== null
  useEffect(() => {
    if (placed && mode === 'menu') popRef.current?.querySelector<HTMLElement>('[data-mi]')?.focus({ preventScroll: true })
  }, [placed, mode])

  // Закрыть: клик мимо, прокрутка, Esc, смена размера окна, уход из окна
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && Boolean(popRef.current?.contains(t))
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return
      // кнопки «ещё» и «реакция» у сообщения сами открывают и закрывают меню
      if (e.target instanceof Element && e.target.closest(`[data-menu-for="${CSS.escape(menu.messageId)}"]`)) return
      msgUi.closeMenu()
    }
    // Лента под меню действительно уехала — закрываем. Пустые события прокрутки (размер не менялся) не в счёт
    const feed = document.querySelector(`[data-mid="${CSS.escape(menu.messageId)}"]`)?.closest('.chat__scroll')
    const feedTop = feed?.scrollTop ?? 0
    const onScroll = (e: Event) => {
      if (inside(e.target)) return
      if (feed && e.target === feed && Math.abs(feed.scrollTop - feedTop) < 3) return
      msgUi.closeMenu()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает только меню, а не окно или настройки под ним
      e.preventDefault()
      e.stopPropagation()
      msgUi.closeMenu(true)
    }
    const shut = () => msgUi.closeMenu()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', shut)
    window.addEventListener('blur', shut)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', shut)
      window.removeEventListener('blur', shut)
    }
  }, [menu.messageId])

  // «Точно удалить?» само сбрасывается
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])

  const react = (emoji: string) => {
    rememberEmoji(emoji)
    void reactToMessage(message, emoji)
    msgUi.closeMenu(true)
  }

  const copy = async (what: 'text' | 'id') => {
    const ok = await copyText(what === 'id' ? message.id : menu.selection || message.content)
    if (!ok) return msgUi.closeMenu(true)
    // коротко показываем «Скопировано» — и закрываем
    setCopied(what)
    window.setTimeout(() => msgUi.closeMenu(true), 550)
  }

  const remove = async (e: MouseEvent) => {
    if (busy) return
    if (!armed && !e.shiftKey) return setArmed(true)
    setBusy(true)
    if (await deleteMessage(message)) msgUi.closeMenu()
    else {
      setBusy(false)
      setArmed(false)
    }
  }

  // Стрелки: ←/→ по реакциям, ↑/↓ по пунктам; Tab не выпускает фокус из меню
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'menu' || !popRef.current) return
    const all = [...popRef.current.querySelectorAll<HTMLElement>('[data-mi]:not(:disabled)')]
    const reacts = all.filter((el) => el.dataset.mi === 'react')
    const items = all.filter((el) => el.dataset.mi === 'item')
    const cur = document.activeElement as HTMLElement
    const inReacts = reacts.includes(cur)
    const i = items.indexOf(cur)
    let next: HTMLElement | undefined
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        if (!inReacts) return
        next = reacts[(reacts.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : reacts.length - 1)) % reacts.length]
        break
      case 'ArrowDown':
        next = inReacts ? (items[0] ?? reacts[0]) : (items[i + 1] ?? reacts[0] ?? items[0])
        break
      case 'ArrowUp':
        next = inReacts ? items[items.length - 1] : i > 0 ? items[i - 1] : (reacts[0] ?? items[items.length - 1])
        break
      case 'Home':
        next = all[0]
        break
      case 'End':
        next = all[all.length - 1]
        break
      case 'Tab': {
        const j = all.indexOf(cur)
        next = all[(j + (e.shiftKey ? all.length - 1 : 1) + all.length) % all.length]
        break
      }
      default:
        return
    }
    e.preventDefault()
    next?.focus()
  }

  const item = (label: ReactNode, icon: ReactNode, onClick: (e: MouseEvent) => void, extra = '') => (
    <button type="button" role="menuitem" data-mi="item" className={`msg-menu__item${extra}`} onClick={onClick}>
      <span className="truncate">{label}</span>
      {icon}
    </button>
  )

  const hasSelection = menu.selection.length > 0

  return (
    <div
      ref={popRef}
      className={`msg-menu${mode === 'picker' ? ' msg-menu--picker' : ''}`}
      role="menu"
      aria-label={mode === 'picker' ? 'Выбрать реакцию' : 'Действия с сообщением'}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, transformOrigin: pos?.origin }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {mode === 'picker' ? (
        <EmojiPicker isMine={isMine} onPick={react} />
      ) : (
        <>
          {rights.canReact && (
            <div className="msg-menu__reacts" role="group" aria-label="Быстрые реакции">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  data-mi="react"
                  className={`msg-menu__react${isMine(emoji) ? ' is-mine' : ''}`}
                  onClick={() => react(emoji)}
                  aria-label={isMine(emoji) ? `Убрать ${emoji}` : `Реакция ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                data-mi="react"
                className="msg-menu__react msg-menu__react--more"
                onClick={() => setMode('picker')}
                aria-label="Другие эмодзи"
                aria-haspopup="true"
              >
                <Plus size={17} />
              </button>
            </div>
          )}
          <div className="msg-menu__list">
            {rights.canReply &&
              item('Ответить', <Reply size={16} />, () => {
                msgUi.closeMenu()
                msgUi.reply(message)
              })}
            {rights.canForward &&
              item('Переслать…', <Forward size={16} />, () => {
                msgUi.closeMenu()
                msgUi.openForward(message)
              })}
            {item(
              copied === 'text' ? 'Скопировано' : hasSelection ? 'Копировать выделенное' : 'Копировать текст',
              copied === 'text' ? <Check size={16} /> : <Copy size={16} />,
              () => void copy('text'),
              copied === 'text' ? ' is-done' : '',
            )}
            {rights.canEdit &&
              item('Редактировать', <Pencil size={16} />, () => {
                msgUi.closeMenu()
                msgUi.edit(message.id)
              })}
            {rights.canDelete && (
              <>
                <div className="msg-menu__sep" role="separator" />
                {item(
                  busy ? 'Удаляем…' : armed ? 'Точно? Нажми ещё раз' : rights.mine || rights.system ? 'Удалить' : 'Удалить как модератор',
                  <Trash2 size={16} />,
                  (e) => void remove(e),
                  ` msg-menu__item--danger${armed ? ' is-armed' : ''}`,
                )}
              </>
            )}
            {devMode && (
              <>
                <div className="msg-menu__sep" role="separator" />
                {item(
                  copied === 'id' ? 'Скопировано' : 'Копировать ID',
                  copied === 'id' ? <Check size={16} /> : <IdCard size={16} />,
                  () => void copy('id'),
                  ` msg-menu__item--dev${copied === 'id' ? ' is-done' : ''}`,
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
