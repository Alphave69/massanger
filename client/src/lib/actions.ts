import { api, ApiError } from './api'
import { chat } from './store'
import { ui } from './ui'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

/** Открыть (или создать) личку с человеком */
export async function openDmWith(userId: string) {
  try {
    const { dm } = await api.openDm(userId)
    chat.upsertDm(dm)
    chat.setView({ kind: 'dm', dmId: dm.id })
    ui.hideProfile()
  } catch (err) {
    chat.toast({ title: 'Не получилось открыть чат', text: errorText(err) })
  }
}

/** Отправить заявку; возвращает текст ошибки или null */
export async function sendFriendRequest(username: string): Promise<{ error: string } | { accepted: boolean }> {
  try {
    const res = await api.addFriend(username)
    chat.setFriends(res.friends)
    return { accepted: res.accepted }
  } catch (err) {
    return { error: errorText(err) }
  }
}

export async function acceptFriend(userId: string) {
  try {
    chat.setFriends((await api.acceptFriend(userId)).friends)
  } catch (err) {
    chat.toast({ title: 'Ошибка', text: errorText(err) })
  }
}

export async function removeFriend(userId: string) {
  try {
    chat.setFriends((await api.removeFriend(userId)).friends)
  } catch (err) {
    chat.toast({ title: 'Ошибка', text: errorText(err) })
  }
}
