import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { DAYS, daysSince } from '../../lib/badges'
import { formatSince, plural } from '../../lib/format'
import { STATUS_LABEL, selfPresence } from '../../lib/status'
import { chat, useChat } from '../../lib/store'
import { Avatar } from '../Avatar'
import { BadgeRow } from '../badges/BadgeRow'
import { UserNumber } from '../ProfileView'
import { StatusIcon } from '../StatusIcon'
import { UserTags } from '../UserTags'
import { SectionHead } from './controls'

const BIO_MAX = 190

export function ProfileSection() {
  const me = useChat((s) => s.me!)
  const [displayName, setDisplayName] = useState(me.displayName)
  const [customStatus, setCustomStatus] = useState(me.customStatus)
  const [bio, setBio] = useState(me.bio)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = displayName !== me.displayName || customStatus !== me.customStatus || bio !== me.bio
  const days = daysSince(me.createdAt)
  const status = selfPresence(me.status)

  const reset = () => {
    setDisplayName(me.displayName)
    setCustomStatus(me.customStatus)
    setBio(me.bio)
    setError(null)
  }

  const save = async () => {
    if (!displayName.trim()) return setError('Имя не может быть пустым')
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.updateMe({ displayName: displayName.trim(), customStatus: customStatus.trim(), bio: bio.trim() })
      chat.setMe(user)
      setDisplayName(user.displayName)
      setCustomStatus(user.customStatus)
      setBio(user.bio)
      chat.toast({ title: 'Профиль сохранён', text: 'Друзья уже видят изменения' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не получилось сохранить')
    }
    setBusy(false)
  }

  return (
    <>
      <SectionHead title="Профиль" subtitle="Как тебя видят друзья: имя, статус и пара слов о себе." />

      <div className="profile-edit">
        <div className="profile-edit__form">
          <label className="field-block">
            <span className="set-group__title">Отображаемое имя</span>
            <input className="input" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          <label className="field-block">
            <span className="set-group__title">Статус</span>
            <input
              className="input"
              value={customStatus}
              maxLength={64}
              placeholder="Чем занят? Например, «пишу диплом»"
              onChange={(e) => setCustomStatus(e.target.value)}
            />
          </label>

          <label className="field-block">
            <span className="set-group__title">
              О себе <span className="counter">{BIO_MAX - bio.length}</span>
            </span>
            <textarea
              className="input textarea"
              value={bio}
              maxLength={BIO_MAX}
              rows={4}
              placeholder="Пара слов о себе — увидят все, кто откроет твой профиль"
              onChange={(e) => setBio(e.target.value)}
            />
          </label>

          <div className="field-block">
            <span className="set-group__title">Аватар</span>
            <div className="muted">Сейчас аватар — инициалы на оттенке серого. Свою картинку добавим в одном из следующих обновлений.</div>
          </div>
        </div>

        <div className="profile-edit__preview">
          <span className="set-group__title">Превью</span>
          <div className="preview-card glow">
            <div className="profile__banner" />
            {me.number > 0 && <UserNumber n={me.number} />}
            <div className="profile__avatar">
              <Avatar user={{ id: me.id, displayName: displayName || me.displayName }} size={84} status={status} ring />
            </div>
            <div className="profile__body">
              <h3 className="profile__name">
                <span>{displayName || me.displayName}</span>
                <UserTags user={me} size={18} />
              </h3>
              <div className="profile__tag">@{me.username}</div>
              <BadgeRow user={me} max={9} />
              <div className="profile__status">
                <StatusIcon status={status} size={12} />
                {STATUS_LABEL[me.status]}
              </div>
              {customStatus.trim() && <div className="profile__custom">«{customStatus.trim()}»</div>}
              <dl className="profile__facts">
                {bio.trim() && (
                  <div>
                    <dt>О себе</dt>
                    <dd className="profile__bio">{bio.trim()}</dd>
                  </div>
                )}
                <div>
                  <dt>В Nuntius с</dt>
                  <dd>
                    {formatSince(me.createdAt)} <span className="profile__days">· {days === 0 ? 'сегодня' : plural(days, DAYS)}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="profile-edit__since">
            {days === 0 ? 'Ты с нами с сегодняшнего дня' : `Ты с нами ${plural(days, DAYS)}`}
            {me.number > 0 && ` · пользователь № ${me.number}`}
          </div>
        </div>
      </div>

      <div className={`unsaved${dirty ? ' is-visible' : ''}`} aria-hidden={!dirty}>
        <span>{error ?? 'Осторожно — есть несохранённые изменения!'}</span>
        <div className="unsaved__actions">
          <button className="btn btn--ghost btn--sm" onClick={reset} tabIndex={dirty ? 0 : -1}>
            Сбросить
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => void save()} disabled={busy} tabIndex={dirty ? 0 : -1}>
            {busy && <LoaderCircle size={15} className="spin" />} Сохранить
          </button>
        </div>
      </div>
    </>
  )
}
