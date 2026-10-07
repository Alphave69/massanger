import { useState, type FormEvent } from 'react'
import { Hash, Trash2, Volume2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { chat, useChat } from '../../lib/store'
import { ui, useUi } from '../../lib/ui'
import { Modal } from '../Modal'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

/** Создать канал / переименовать или удалить канал */
export function ChannelModal() {
  const modal = useUi((s) => s.channelModal)
  if (!modal) return null
  return modal.mode === 'create' ? (
    <CreateChannel key={`create-${modal.type}`} guildId={modal.guildId} initialType={modal.type} />
  ) : (
    <EditChannel key={modal.channelId} guildId={modal.guildId} channelId={modal.channelId} />
  )
}

function CreateChannel({ guildId, initialType }: { guildId: string; initialType: 'text' | 'voice' }) {
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { guild, channel } = await api.createChannel(guildId, name, type)
      chat.upsertGuild(guild)
      if (channel.type === 'text') chat.openGuildChannel(guildId, channel.id)
      ui.closeChannelModal()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Создать канал" subtitle="Текстовый — для переписки, голосовой — чтобы созвониться." onClose={ui.closeChannelModal}>
      <form className="modal__form" onSubmit={submit}>
        <div className="type-cards">
          <button type="button" className={`type-card${type === 'text' ? ' is-active' : ''}`} onClick={() => setType('text')}>
            <Hash size={22} />
            <span>
              <b>Текстовый</b>
              <span>Сообщения, мемы, ссылки</span>
            </span>
          </button>
          <button type="button" className={`type-card${type === 'voice' ? ' is-active' : ''}`} onClick={() => setType('voice')}>
            <Volume2 size={22} />
            <span>
              <b>Голосовой</b>
              <span>Голос, видео, экран</span>
            </span>
          </button>
        </div>
        <label className="modal__label">
          <span className="label">Название канала</span>
          <span className="channel-input">
            {type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
            <input className="input" value={name} autoFocus maxLength={32} placeholder={type === 'text' ? 'новый-канал' : 'Болталка'} onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={ui.closeChannelModal}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
            Создать канал
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditChannel({ guildId, channelId }: { guildId: string; channelId: string }) {
  const channel = useChat((s) => s.guilds.find((g) => g.id === guildId)?.channels.find((c) => c.id === channelId))
  const [name, setName] = useState(channel?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!channel) return null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      chat.upsertGuild((await api.updateChannel(guildId, channelId, { name })).guild)
      ui.closeChannelModal()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try {
      chat.upsertGuild((await api.deleteChannel(guildId, channelId)).guild)
      ui.closeChannelModal()
      chat.toast({ title: 'Канал удалён', text: `${channel.type === 'text' ? '#' : ''}${channel.name}` })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Настройки канала" subtitle={channel.type === 'text' ? 'Текстовый канал' : 'Голосовой канал'} onClose={ui.closeChannelModal}>
      <form className="modal__form" onSubmit={save}>
        <label className="modal__label">
          <span className="label">Название</span>
          <span className="channel-input">
            {channel.type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
            <input className="input" value={name} autoFocus maxLength={32} onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions modal__actions--split">
          <button type="button" className={`btn ${confirmDelete ? 'btn--primary' : 'btn--ghost'}`} onClick={() => void remove()} disabled={busy}>
            <Trash2 size={16} /> {confirmDelete ? 'Точно удалить? Сообщения пропадут' : 'Удалить канал'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  )
}
