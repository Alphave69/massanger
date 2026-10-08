import { create } from 'zustand'
import { blip, pulseSphere } from './fx'
import { chat, useChat } from './store'

/**
 * Админка приложения: объявления для всех и т.п.
 */

export interface Announcement {
  text: string
  from: string
  at: number
}

/** Объявления, пришедшие с момента входа (показываем в админке) */
export const useAnnouncements = create<{ list: Announcement[] }>(() => ({ list: [] }))

/** Сервер прислал объявление от админа */
export function onAnnounce(e: { text: string; from: string }): void {
  if (!e?.text) return
  useAnnouncements.setState((s) => ({ list: [{ text: e.text, from: e.from, at: Date.now() }, ...s.list].slice(0, 20) }))
  void blip()
  pulseSphere(1.6)
  const name = useChat.getState().users[e.from]?.displayName
  // Объявление показываем всегда, даже если всплывашки выключены — их шлют редко и по делу
  chat.toast({ title: '📣 Объявление', text: name ? `${e.text} — ${name}` : e.text, userId: e.from })
}

// Сменился аккаунт — чужие объявления не показываем
let lastMe: string | null = null
useChat.subscribe((st) => {
  const id = st.me?.id ?? null
  if (id === lastMe) return
  lastMe = id
  useAnnouncements.setState({ list: [] })
})
