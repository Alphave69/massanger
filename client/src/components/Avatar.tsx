import { initials, shadeFor } from '../lib/format'
import type { User } from '../lib/api'

interface Props {
  user: User
  size?: number
  status?: 'online' | 'offline'
}

export function Avatar({ user, size = 40, status }: Props) {
  const shade = shadeFor(user.id)
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <span className="avatar__face" style={{ background: shade.bg, color: shade.fg, fontSize: size * 0.38 }}>
        {initials(user.displayName)}
      </span>
      {status && <span className={`avatar__status avatar__status--${status}`} />}
    </span>
  )
}
