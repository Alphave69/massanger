import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Check, Copy } from 'lucide-react'
import { api, ApiError, getToken, type Channel, type Guild, type Message, type User } from '../lib/api'
import { ServerRail } from './ServerRail'
import { ChannelSidebar } from './ChannelSidebar'
import { ChatView } from './ChatView'
import { MemberList } from './MemberList'
import { Modal } from './Modal'

interface Props {
  user: User
  onLogout: () => void
}

type ModalKind = 'create' | 'join' | 'invite' | null

const TYPING_TTL = 3500

export function AppShell({ user, onLogout }: Props) {
  const [guilds, setGuilds] = useState<Guild[]>([])
  const [online, setOnline] = useState<Set<string>>(() => new Set([user.id]))
  const [activeGuildId, setActiveGuildId] = useState<string | null>(null)
  const [activeChannels, setActiveChannels] = useState<Record<string, string>>({})
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({})
  const [membersOpen, setMembersOpen] = useState(() => window.innerWidth > 1100)
  const [modal, setModal] = useState<ModalKind>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const socketRef = useRef<Socket | null>(null)
  const lastTypingSent = useRef(0)

  const showToast = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 2600)
  }, [])

  const upsertGuild = useCallback((guild: Guild) => {
    setGuilds((list) => (list.some((g) => g.id === guild.id) ? list.map((g) => (g.id === guild.id ? guild : g)) : [...list, guild]))
  }, [])

  // --- начальная загрузка + сокет ---
  useEffect(() => {
    api
      .guilds()
      .then(({ guilds, online }) => {
        setGuilds(guilds)
        setOnline(new Set(online))
        setActiveGuildId((cur) => cur ?? guilds[0]?.id ?? null)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onLogout()
      })

    const socket = io({ auth: { token: getToken() } })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') onLogout()
      else setConnected(false)
    })
    socket.on('presence', (ids: string[]) => setOnline(new Set(ids)))
    socket.on('guild:update', (guild: Guild) => upsertGuild(guild))
    socket.on('message:new', (m: Message) => {
      setMessages((all) => {
        const list = all[m.channelId]
        if (!list) return all // канал ещё не открывали — подгрузится при открытии
        if (list.some((x) => x.id === m.id)) return all
        return { ...all, [m.channelId]: [...list, m] }
      })
      // Автор перестал печатать
      setTyping((t) => {
        if (!t[m.channelId]?.[m.authorId]) return t
        const { [m.authorId]: _, ...rest } = t[m.channelId]
        return { ...t, [m.channelId]: rest }
      })
    })
    socket.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
      setTyping((t) => ({ ...t, [channelId]: { ...t[channelId], [userId]: Date.now() + TYPING_TTL } }))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [onLogout, upsertGuild])

  // Чистим протухшие «печатает…»
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTyping((t) => {
        let changed = false
        const next: typeof t = {}
        for (const [ch, users] of Object.entries(t)) {
          next[ch] = {}
          for (const [uid, until] of Object.entries(users)) {
            if (until > now) next[ch][uid] = until
            else changed = true
          }
        }
        return changed ? next : t
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const activeGuild = guilds.find((g) => g.id === activeGuildId) ?? null
  const activeChannel = useMemo(() => {
    if (!activeGuild) return null
    const text = activeGuild.channels.filter((c) => c.type === 'text')
    return text.find((c) => c.id === activeChannels[activeGuild.id]) ?? text[0] ?? null
  }, [activeGuild, activeChannels])

  // Подгружаем историю канала при первом открытии
  useEffect(() => {
    if (!activeChannel || messages[activeChannel.id]) return
    const channelId = activeChannel.id
    api
      .messages(channelId)
      .then(({ messages: list }) => setMessages((all) => ({ ...all, [channelId]: all[channelId] ?? list })))
      .catch(() => showToast('Не удалось загрузить сообщения'))
  }, [activeChannel, messages, showToast])

  const usersById = useMemo(() => {
    const map = new Map<string, User>([[user.id, user]])
    for (const g of guilds) for (const m of g.members) map.set(m.id, m)
    return map
  }, [guilds, user])

  const selectChannel = (channel: Channel) => {
    if (!activeGuild) return
    if (channel.type === 'voice') {
      showToast('Голосовые каналы — следующий этап 🎧')
      return
    }
    setActiveChannels((m) => ({ ...m, [activeGuild.id]: channel.id }))
  }

  const sendMessage = (content: string) =>
    new Promise<boolean>((resolve) => {
      const socket = socketRef.current
      if (!socket?.connected || !activeChannel) {
        showToast('Нет соединения с сервером')
        resolve(false)
        return
      }
      socket.timeout(8000).emit('message:send', { channelId: activeChannel.id, content }, (err: Error | null, res: { error?: string; message?: Message }) => {
        if (err || res?.error || !res?.message) {
          showToast(res?.error ?? 'Сообщение не отправлено')
          resolve(false)
          return
        }
        const m = res.message
        setMessages((all) => {
          const list = all[m.channelId] ?? []
          return list.some((x) => x.id === m.id) ? all : { ...all, [m.channelId]: [...list, m] }
        })
        resolve(true)
      })
    })

  const notifyTyping = () => {
    const now = Date.now()
    if (!activeChannel || now - lastTypingSent.current < 2000) return
    lastTypingSent.current = now
    socketRef.current?.emit('typing', { channelId: activeChannel.id })
  }

  const typingUserIds = activeChannel ? Object.keys(typing[activeChannel.id] ?? {}).filter((id) => id !== user.id) : []

  return (
    <div className="shell">
      <ServerRail
        guilds={guilds}
        activeGuildId={activeGuildId}
        onSelect={setActiveGuildId}
        onCreate={() => setModal('create')}
        onJoin={() => setModal('join')}
      />
      <ChannelSidebar
        guild={activeGuild}
        activeChannelId={activeChannel?.id ?? null}
        user={user}
        onSelectChannel={selectChannel}
        onInvite={() => setModal('invite')}
        onLogout={onLogout}
      />
      <ChatView
        channel={activeChannel}
        messages={activeChannel ? messages[activeChannel.id] : undefined}
        usersById={usersById}
        currentUserId={user.id}
        typingUserIds={typingUserIds}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((v) => !v)}
        onSend={sendMessage}
        onTyping={notifyTyping}
      />
      <div className={`members-wrap${membersOpen ? ' is-open' : ''}`}>
        <MemberList members={activeGuild?.members ?? []} online={online} ownerId={activeGuild?.ownerId} />
      </div>

      {!connected && <div className="conn-banner">Переподключаемся к серверу…</div>}
      <div className={`toast${toast ? ' is-visible' : ''}`}>{toast}</div>

      {modal === 'create' && (
        <CreateGuildModal
          onClose={() => setModal(null)}
          onCreated={(g) => {
            upsertGuild(g)
            setActiveGuildId(g.id)
            setModal(null)
            showToast(`Сервер «${g.name}» создан`)
          }}
        />
      )}
      {modal === 'join' && (
        <JoinGuildModal
          onClose={() => setModal(null)}
          onJoined={(g) => {
            upsertGuild(g)
            setActiveGuildId(g.id)
            setModal(null)
          }}
        />
      )}
      {modal === 'invite' && activeGuild && <InviteModal guild={activeGuild} onClose={() => setModal(null)} />}
    </div>
  )
}

function CreateGuildModal({ onClose, onCreated }: { onClose: () => void; onCreated: (g: Guild) => void }) {
  return (
    <SingleInputModal
      title="Создать сервер"
      subtitle="Своё место для тебя и друзей. Название можно поменять потом."
      label="Название сервера"
      action="Создать"
      onClose={onClose}
      onSubmit={async (name) => onCreated((await api.createGuild(name)).guild)}
    />
  )
}

function JoinGuildModal({ onClose, onJoined }: { onClose: () => void; onJoined: (g: Guild) => void }) {
  return (
    <SingleInputModal
      title="Присоединиться"
      subtitle="Вставь код приглашения, который прислал друг."
      label="Код приглашения"
      action="Войти на сервер"
      onClose={onClose}
      onSubmit={async (code) => onJoined((await api.joinGuild(code)).guild)}
    />
  )
}

interface SingleInputProps {
  title: string
  subtitle: string
  label: string
  action: string
  onClose: () => void
  onSubmit: (value: string) => Promise<void>
}

function SingleInputModal({ title, subtitle, label, action, onClose, onSubmit }: SingleInputProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value.trim())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form onSubmit={submit} className="modal__form">
        <label className="modal__label">
          {label}
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus spellCheck={false} />
        </label>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!value.trim() || busy}>
            {action}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function InviteModal({ guild, onClose }: { guild: Guild; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(guild.id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // буфер обмена недоступен — код всё равно можно выделить вручную
    }
  }
  return (
    <Modal title={`Пригласить в «${guild.name}»`} subtitle="Отправь другу этот код — он вставит его в «Присоединиться»." onClose={onClose}>
      <div className="invite">
        <code className="invite__code">{guild.id}</code>
        <button className={`btn btn--primary invite__copy${copied ? ' is-copied' : ''}`} onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
    </Modal>
  )
}
