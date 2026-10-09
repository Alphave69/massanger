import { create } from 'zustand'
import { api, ApiError, SYSTEM_AUTHOR, type Message } from './api'
import { can, guildOfChannel } from './perms'
import { chat, useChat } from './store'

/**
 * Действия с сообщениями: контекстное меню (правый клик), ответ, правка, пересылка.
 * Здесь — общее состояние и права; рисуют components/chat/*.
 */

/** Где открыть меню: у курсора (правый клик) или у кнопки (координаты окна, без учёта масштаба) */
export type MenuAnchor = { kind: 'point'; x: number; y: number } | { kind: 'rect'; left: number; right: number; top: number; bottom: number }

export interface MenuState {
  /** Номер открытия — чтобы новое меню начиналось с чистого листа */
  seq: number
  messageId: string
  channelId: string
  anchor: MenuAnchor
  /** Сразу список действий или сразу выбор эмодзи (кнопка «добавить реакцию») */
  mode: 'menu' | 'picker'
  /** Выделенный в сообщении текст на момент клика — «Копировать выделенное» */
  selection: string
  /** Откуда открыли: правый клик, кнопки у сообщения или «+» у реакций (подсвечиваем нажатую кнопку) */
  source: 'context' | 'toolbar' | 'reactions'
}

interface MsgUiState {
  menu: MenuState | null
  /** На какое сообщение отвечаем — по каналам (у каждого поля ввода своё) */
  replies: Record<string, string>
  /** Какое сообщение сейчас правим */
  editing: string | null
  /** Какое сообщение пересылаем */
  forward: { messageId: string; channelId: string } | null
  /** Сообщение, к которому только что прыгнули (подсветка) */
  flash: string | null
}

export const useMsgUi = create<MsgUiState>(() => ({ menu: null, replies: {}, editing: null, forward: null, flash: null }))

let menuSeq = 0
let flashTimer = 0
/** Куда вернуть фокус, если меню закрыли по Esc */
let focusBefore: HTMLElement | null = null

export const msgUi = {
  /** Выход из аккаунта — забыть меню, ответы и правки */
  reset() {
    useMsgUi.setState({ menu: null, replies: {}, editing: null, forward: null, flash: null })
  },
  openMenu(message: Message, anchor: MenuAnchor, mode: MenuState['mode'], source: MenuState['source'], selection = '') {
    const active = document.activeElement
    focusBefore = active instanceof HTMLElement && active !== document.body ? active : null
    useMsgUi.setState({ menu: { seq: ++menuSeq, messageId: message.id, channelId: message.channelId, anchor, mode, source, selection } })
  },
  /** restoreFocus — закрыли по Esc: фокус туда, где он был до меню */
  closeMenu(restoreFocus = false) {
    if (!useMsgUi.getState().menu) return
    useMsgUi.setState({ menu: null })
    if (restoreFocus && focusBefore?.isConnected) focusBefore.focus()
    focusBefore = null
  },
  reply(message: Message) {
    useMsgUi.setState((s) => ({ replies: { ...s.replies, [message.channelId]: message.id }, editing: null }))
    focusComposer()
  },
  cancelReply(channelId: string) {
    useMsgUi.setState((s) => {
      if (!s.replies[channelId]) return {}
      const { [channelId]: _gone, ...rest } = s.replies
      return { replies: rest }
    })
  },
  edit(messageId: string) {
    useMsgUi.setState({ editing: messageId })
  },
  stopEdit() {
    useMsgUi.setState({ editing: null })
  },
  openForward(message: Message) {
    useMsgUi.setState({ forward: { messageId: message.id, channelId: message.channelId } })
  },
  closeForward() {
    useMsgUi.setState({ forward: null })
  },
  flash(messageId: string) {
    window.clearTimeout(flashTimer)
    // снять и поставить заново — чтобы анимация повторилась при повторном прыжке
    useMsgUi.setState({ flash: null })
    requestAnimationFrame(() => useMsgUi.setState({ flash: messageId }))
    flashTimer = window.setTimeout(() => useMsgUi.setState({ flash: null }), 1800)
  },
}

/** Поставить курсор в поле ввода сообщения */
export function focusComposer() {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus())
}

/** Прокрутить к сообщению и подсветить его; false — его нет среди загруженных */
export function jumpToMessage(messageId: string): boolean {
  const el = document.querySelector(`[data-mid="${CSS.escape(messageId)}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  msgUi.flash(messageId)
  return true
}

type ChatSnapshot = ReturnType<typeof useChat.getState>

/** Что мне можно сделать с сообщением (на клиенте — только чтобы прятать кнопки; проверяет сервер) */
export function messageRights(st: ChatSnapshot, m: Message) {
  const guild = guildOfChannel(st.guilds, m.channelId)
  const system = m.authorId === SYSTEM_AUTHOR
  const mine = !system && m.authorId === st.me?.id
  // удалять чужое: право MANAGE_MESSAGES в канале сервера (в личках — только своё) или админ приложения
  const moderator = Boolean(st.me?.admin) || (guild ? can(guild, 'MANAGE_MESSAGES', m.channelId) : false)
  // реакции и ответы — там, где можно писать (в личке это решит сервер)
  const canWrite = guild ? can(guild, 'SEND_MESSAGES', m.channelId) : true
  return {
    system,
    mine,
    moderator,
    canDelete: system ? moderator : mine || moderator,
    canReact: canWrite,
    canReply: canWrite && !system,
    canForward: !system,
    // свои обычные сообщения: результат команды и пересланное не правятся
    canEdit: mine && !m.forwarded && (!m.flavor || m.flavor === 'me'),
  }
}

export type MessageRights = ReturnType<typeof messageRights>

/** Удалить сообщение; true — удалилось */
export async function deleteMessage(message: Message): Promise<boolean> {
  try {
    await api.deleteMessage(message.id)
    chat.removeMessage(message.channelId, message.id)
    return true
  } catch (err) {
    chat.toast({ title: 'Не удалось удалить', text: err instanceof ApiError ? err.message : 'Что-то пошло не так' })
    return false
  }
}

/** Скопировать в буфер обмена; false — буфер недоступен */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Найти загруженное сообщение */
export const findLoaded = (st: ChatSnapshot, channelId: string, messageId: string) => st.messages[channelId]?.find((m) => m.id === messageId)

// ============ эмодзи ============

/** Быстрые реакции в меню */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉']

/** Набор для выбора: без самых новых эмодзи — их не умеет Windows 10 */
export const EMOJI_GROUPS: { title: string; list: string[] }[] = [
  { title: 'Эмоции', list: ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '😏', '😅', '😴', '😭', '😡', '🤯', '😱', '🥳', '🙃', '🤡', '💀'] },
  { title: 'Жесты', list: ['👍', '👎', '👌', '✌️', '🤝', '👏', '🙌', '🙏', '💪', '👀', '🤘', '🤙'] },
  { title: 'Символы', list: ['❤️', '🖤', '🤍', '💔', '🔥', '✨', '⭐', '💯', '✅', '❌', '⚡', '💥'] },
  { title: 'Разное', list: ['🎉', '🎁', '🍕', '🍺', '☕', '🎮', '🎵', '🚀', '🌙', '☀️', '🌈', '🐱', '🐶', '🦊', '🍀', '💤'] },
]

const RECENT_KEY = 'nuntius.emoji.recent'
const RECENT_MAX = 8

/** Недавно поставленные реакции (живут на устройстве) */
export function recentEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // нет доступа к хранилищу — просто не запомним
  }
}
