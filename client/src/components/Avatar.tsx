import { useState } from 'react'
import { initials, shadeFor } from '../lib/format'
import type { Presence, User } from '../lib/api'
import { STATUS_LABEL } from '../lib/status'
import { StatusIcon } from './StatusIcon'

interface Props {
  user: Pick<User, 'id' | 'displayName'> & { avatar?: string | null }
  size?: number
  status?: Presence
  /** Светящееся кольцо вокруг (для профиля) */
  ring?: boolean
}

export function Avatar({ user, size = 40, status, ring }: Props) {
  const shade = shadeFor(user.id)
  const badge = Math.max(12, Math.round(size * 0.36))
  // картинка не загрузилась (удалили, нет сети) — показываем инициалы
  const [broken, setBroken] = useState<string | null>(null)
  const photo = user.avatar && user.avatar !== broken ? user.avatar : null
  return (
    <span className={`avatar${ring ? ' avatar--ring' : ''}${status && status !== 'offline' ? ' is-online' : ''}`} style={{ width: size, height: size }}>
      <span
        className={`avatar__face${shade.dark ? ' avatar__face--dark' : ''}${photo ? ' avatar__face--photo' : ''}`}
        style={{ background: shade.bg, color: shade.fg, fontSize: size * 0.38 }}
      >
        {photo ? (
          <img className="avatar__img" src={photo} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(photo)} />
        ) : (
          initials(user.displayName)
        )}
      </span>
      {status && (
        <span className={`avatar__badge avatar__badge--${status}`} style={{ width: badge, height: badge }} title={STATUS_LABEL[status]}>
          <StatusIcon status={status} size={badge - 4} />
        </span>
      )}
      {/* спит — над аватаркой всплывают «z» */}
      {status === 'sleep' && size >= 32 && (
        <span className="avatar__zzz" style={{ fontSize: Math.max(9, Math.round(size * 0.22)) }} aria-hidden="true">
          <i>z</i>
          <i>z</i>
          <i>z</i>
        </span>
      )}
    </span>
  )
}
