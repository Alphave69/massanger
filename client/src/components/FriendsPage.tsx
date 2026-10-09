import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, MessageCircle, Send, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { acceptFriend, openDmWith, removeFriend, sendFriendRequest } from '../lib/actions'
import { STATUS_LABEL, isOnline } from '../lib/status'
import { chat, presenceOf, useChat, type FriendRef, type FriendsTab } from '../lib/store'
import { ui } from '../lib/ui'
import { Avatar } from './Avatar'
import { MiniSphere } from './MiniSphere'
import { UserTags } from './UserTags'
import { BackButton } from './ChatView'
import { useIsMobile } from '../lib/mobile'

const TABS: { id: FriendsTab; label: string }[] = [
  { id: 'online', label: 'В сети' },
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Заявки' },
]

/** Приветствие по времени суток */
function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'Доброе утро'
  if (hour >= 12 && hour < 18) return 'Добрый день'
  if (hour >= 18 && hour < 23) return 'Добрый вечер'
  return 'Доброй ночи'
}

/** Шутки для пустых списков — сменяются сами и по клику */
const JOKES: Record<Exclude<FriendsTab, 'add'>, string[]> = {
  online: [
    'Сейчас никого из друзей нет в сети. Сфера скучает.',
    'Все ушли гулять. Сфера осталась за главную.',
    'Тишина в эфире. Напиши первым — вдруг проснутся.',
    'Друзья не в сети. Наверное, трогают траву.',
    'Никого. Можно спокойно поговорить с самим собой.',
  ],
  all: [
    'Пока ни одного друга. Самое время позвать кого-нибудь!',
    'Список друзей пуст, как сфера без точек.',
    'Один в поле не воин. Позови кого-нибудь!',
    'Здесь будут твои люди. Начни с одного.',
  ],
  pending: [
    'Заявок нет. Тишина и покой.',
    'Почтовый голубь пролетел мимо. Заявок нет.',
    'Пусто. Даже спам-боты не стучатся.',
    'Заявок нет — значит, все уже твои друзья. Или пока не знают о тебе.',
  ],
}

export function FriendsPage({ tab }: { tab: FriendsTab }) {
  const friends = useChat((s) => s.friends)
  const presence = useChat((s) => s.presence)
  const myName = useChat((s) => s.me?.displayName ?? '')
  const requests = friends.filter((f) => f.state === 'incoming').length
  const firstName = myName.trim().split(/\s+/)[0]
  const mobile = useIsMobile()

  const setTab = (t: FriendsTab) => chat.setView({ kind: 'home', tab: t })

  let list: FriendRef[] = []
  let title = ''
  if (tab === 'online') {
    list = friends.filter((f) => f.state === 'friends' && isOnline(presence[f.userId]))
    title = 'В сети'
  } else if (tab === 'all') {
    list = friends.filter((f) => f.state === 'friends')
    title = 'Все друзья'
  } else if (tab === 'pending') {
    list = [...friends.filter((f) => f.state === 'incoming'), ...friends.filter((f) => f.state === 'outgoing')]
    title = 'Заявки'
  }

  return (
    <section className="main panel glow">
      <header className="main__head friends-head">
        <BackButton />
        <div className="main__title">
          <Users size={20} />
          <h2>Друзья</h2>
        </div>
        <span className="main__divider" />
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'pending' && requests > 0 && <span className="count-badge">{requests}</span>}
            </button>
          ))}
          <button className={`tab tab--accent${tab === 'add' ? ' is-active' : ''}`} onClick={() => setTab('add')}>
            <UserPlus size={15} /> {mobile ? 'Добавить' : 'Добавить в друзья'}
          </button>
        </nav>
        {firstName && (
          <span className="friends-greet truncate">
            {greeting(new Date().getHours())}, <b>{firstName}</b>
          </span>
        )}
      </header>

      <div className="main__scroll friends" key={tab}>
        {tab === 'add' ? (
          <AddFriend />
        ) : list.length === 0 ? (
          <EmptyFriends tab={tab} />
        ) : (
          <>
            <div className="friends__label">
              {title} — {list.length}
            </div>
            {list.map((f, i) => (
              <FriendRow key={f.userId} friend={f} index={i} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function FriendRow({ friend, index }: { friend: FriendRef; index: number }) {
  const user = useChat((s) => s.users[friend.userId])
  const status = useChat((s) => presenceOf(s, friend.userId))
  const [confirm, setConfirm] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!user) return null

  const sub =
    friend.state === 'incoming' ? 'Входящая заявка' : friend.state === 'outgoing' ? 'Исходящая заявка' : user.customStatus || STATUS_LABEL[status]

  const askRemove = () => {
    if (confirm) {
      void removeFriend(user.id)
      return
    }
    setConfirm(true)
    timer.current = window.setTimeout(() => setConfirm(false), 3000)
  }

  return (
    <div className="friend glow" style={{ animationDelay: `${index * 40}ms` }}>
      <button className="friend__who" onClick={(e) => ui.showProfile(user.id, e.currentTarget)}>
        <Avatar user={user} size={40} status={friend.state === 'friends' ? status : undefined} />
        <span className="friend__text">
          <span className="friend__name">
            {user.displayName} <UserTags user={user} /> <span className="friend__tag">@{user.username}</span>
          </span>
          <span className="friend__sub truncate">{sub}</span>
        </span>
      </button>

      <div className="friend__actions">
        {friend.state === 'friends' && (
          <>
            <button className="round-btn" data-tip="Написать" onClick={() => void openDmWith(user.id)}>
              <MessageCircle size={18} />
            </button>
            <button className={`round-btn${confirm ? ' round-btn--confirm' : ''}`} data-tip={confirm ? 'Нажми ещё раз' : 'Удалить из друзей'} onClick={askRemove}>
              {confirm ? <span className="round-btn__text">Точно?</span> : <UserMinus size={18} />}
            </button>
          </>
        )}
        {friend.state === 'incoming' && (
          <>
            <button className="round-btn round-btn--solid" data-tip="Принять" onClick={() => void acceptFriend(user.id)}>
              <Check size={18} />
            </button>
            <button className="round-btn" data-tip="Отклонить" onClick={() => void removeFriend(user.id)}>
              <X size={18} />
            </button>
          </>
        )}
        {friend.state === 'outgoing' && (
          <button className="round-btn" data-tip="Отменить заявку" onClick={() => void removeFriend(user.id)}>
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

function AddFriend() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const username = value.trim()
    if (!username || busy) return
    setBusy(true)
    const res = await sendFriendRequest(username)
    setBusy(false)
    if ('error' in res) {
      setResult({ ok: false, text: res.error })
    } else {
      setResult({ ok: true, text: res.accepted ? `Готово — вы с @${username} теперь друзья!` : `Заявка для @${username} отправлена ✦` })
      setValue('')
    }
  }

  return (
    <div className="add-friend">
      <h3>Добавить в друзья</h3>
      <p>Введи логин друга — тот, с которым он входит в Nuntius. Ему придёт заявка.</p>
      <form className={`add-friend__box glow${result ? (result.ok ? ' is-ok' : ' is-error') : ''}`} onSubmit={submit}>
        <span className="add-friend__at">@</span>
        <input
          value={value}
          autoFocus
          spellCheck={false}
          placeholder="логин друга"
          onChange={(e) => {
            setValue(e.target.value)
            setResult(null)
          }}
        />
        <button className="btn btn--primary" type="submit" disabled={!value.trim() || busy}>
          <Send size={16} /> Отправить заявку
        </button>
      </form>
      {result && <div className={`add-friend__result${result.ok ? ' is-ok' : ''}`}>{result.text}</div>}

      <div className="add-friend__hero">
        <MiniSphere size={160} dots={260} />
        <span>Чем больше друзей — тем плотнее сфера</span>
      </div>
    </div>
  )
}

function EmptyFriends({ tab }: { tab: FriendsTab }) {
  const jokes = JOKES[tab === 'add' ? 'all' : tab]
  const [index, setIndex] = useState(() => Math.floor(Math.random() * jokes.length))
  const next = () => setIndex((i) => (i + 1) % jokes.length)

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % jokes.length), 9000)
    return () => window.clearInterval(timer)
  }, [jokes])

  return (
    <div className="empty">
      <MiniSphere size={120} dots={200} />
      <p key={index} className="empty__joke" onClick={next}>
        {jokes[index % jokes.length]}
      </p>
      {tab !== 'pending' && (
        <button className="btn btn--primary" onClick={() => chat.setView({ kind: 'home', tab: 'add' })}>
          <UserPlus size={16} /> Добавить в друзья
        </button>
      )}
    </div>
  )
}
