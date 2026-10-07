import { useState, type FormEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { api, ApiError, type Guild } from '../lib/api'
import { chat, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { Modal } from './Modal'

export function Modals() {
  const modal = useUi((s) => s.modal)
  const view = useChat((s) => s.view)
  const guild = useChat((s) => (view.kind === 'guild' ? s.guilds.find((g) => g.id === view.guildId) : undefined))

  if (modal === 'create-guild') {
    return (
      <SingleInputModal
        title="Создать сервер"
        subtitle="Своё место для тебя и друзей. Название можно поменять потом."
        label="Название сервера"
        action="Создать"
        onSubmit={async (name) => {
          const { guild } = await api.createGuild(name)
          openGuild(guild)
          chat.toast({ title: `«${guild.name}» создан`, text: 'Зови друзей — код в меню сервера' })
        }}
      />
    )
  }
  if (modal === 'join-guild') {
    return (
      <SingleInputModal
        title="Войти по приглашению"
        subtitle="Вставь код приглашения, который прислал друг."
        label="Код приглашения"
        action="Войти на сервер"
        onSubmit={async (code) => openGuild((await api.joinGuild(code)).guild)}
      />
    )
  }
  if (modal === 'invite' && guild) return <InviteModal guild={guild} />
  return null
}

function openGuild(guild: Guild) {
  chat.upsertGuild(guild)
  chat.setView({ kind: 'guild', guildId: guild.id })
  ui.closeModal()
}

interface SingleInputProps {
  title: string
  subtitle: string
  label: string
  action: string
  onSubmit: (value: string) => Promise<void>
}

function SingleInputModal({ title, subtitle, label, action, onSubmit }: SingleInputProps) {
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
    <Modal title={title} subtitle={subtitle} onClose={ui.closeModal}>
      <form onSubmit={submit} className="modal__form">
        <label className="modal__label">
          <span className="label">{label}</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus spellCheck={false} />
        </label>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={ui.closeModal}>
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

function InviteModal({ guild }: { guild: Guild }) {
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
    <Modal title={`Пригласить в «${guild.name}»`} subtitle="Отправь другу этот код — он вставит его в «Войти по приглашению» (компас в левой колонке)." onClose={ui.closeModal}>
      <div className="invite glow">
        <code className="invite__code">{guild.id}</code>
        <button className={`btn btn--primary invite__copy${copied ? ' is-copied' : ''}`} onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
    </Modal>
  )
}
