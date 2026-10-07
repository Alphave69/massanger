import { Check, MessageCircle, UserMinus, UserPlus, X } from 'lucide-react'
import { acceptFriend, openDmWith, removeFriend, sendFriendRequest } from '../lib/actions'
import { formatSince } from '../lib/format'
import { STATUS_LABEL } from '../lib/status'
import { chat, presenceOf, useChat } from '../lib/store'
import { Avatar } from './Avatar'
import { StatusIcon } from './StatusIcon'

interface Props {
  userId: string
  /** Уже в личке с этим человеком — кнопка «Написать» не нужна */
  inDm?: boolean
}

/** Профиль: используется и во всплывающей карточке, и в правой колонке лички */
export function ProfileView({ userId, inDm }: Props) {
  const user = useChat((s) => s.users[userId])
  const status = useChat((s) => presenceOf(s, userId))
  const meId = useChat((s) => s.me!.id)
  const relation = useChat((s) => s.friends.find((f) => f.userId === userId)?.state)
  const mutual = useChat((s) => s.guilds.filter((g) => g.members.some((m) => m.id === userId)).map((g) => g.name).join(', '))
  if (!user) return null

  const isMe = userId === meId

  const add = async () => {
    const res = await sendFriendRequest(user.username)
    chat.toast('error' in res ? { title: 'Не получилось', text: res.error } : { title: user.displayName, text: res.accepted ? 'Теперь вы друзья ✦' : 'Заявка отправлена ✦' })
  }

  return (
    <div className="profile">
      <div className="profile__banner" />
      <div className="profile__avatar">
        <Avatar user={user} size={84} status={status} ring />
      </div>

      <div className="profile__body">
        <h3 className="profile__name">{user.displayName}</h3>
        <div className="profile__tag">@{user.username}</div>

        <div className="profile__status">
          <StatusIcon status={status} size={12} />
          {STATUS_LABEL[status]}
        </div>
        {user.customStatus && <div className="profile__custom">«{user.customStatus}»</div>}

        <dl className="profile__facts">
          <div>
            <dt>В Nuntius с</dt>
            <dd>{formatSince(user.createdAt)}</dd>
          </div>
          {!isMe && mutual && (
            <div>
              <dt>Общие серверы</dt>
              <dd>{mutual}</dd>
            </div>
          )}
        </dl>

        {isMe ? (
          <div className="profile__note">Это ты ✦ Статус меняется внизу слева, по клику на своё имя.</div>
        ) : (
          <div className="profile__actions">
            {!inDm && (
              <button className="btn btn--primary" onClick={() => void openDmWith(userId)}>
                <MessageCircle size={16} /> Написать
              </button>
            )}
            {relation === 'friends' && (
              <button className="btn btn--ghost" onClick={() => void removeFriend(userId)}>
                <UserMinus size={16} /> Удалить из друзей
              </button>
            )}
            {relation === 'incoming' && (
              <>
                <button className="btn btn--outline" onClick={() => void acceptFriend(userId)}>
                  <Check size={16} /> Принять заявку
                </button>
                <button className="btn btn--ghost" onClick={() => void removeFriend(userId)}>
                  <X size={16} /> Отклонить
                </button>
              </>
            )}
            {relation === 'outgoing' && (
              <button className="btn btn--ghost" onClick={() => void removeFriend(userId)}>
                <X size={16} /> Отменить заявку
              </button>
            )}
            {!relation && (
              <button className="btn btn--outline" onClick={() => void add()}>
                <UserPlus size={16} /> Добавить в друзья
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
