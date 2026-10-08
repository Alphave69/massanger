import { BadgeCheck } from 'lucide-react'
import type { User } from '../lib/api'

/**
 * Метки рядом с именем: «галочка» и т.п. Ставить сразу после displayName везде, где показывается имя.
 */
export function UserTags({ user, size = 14 }: { user: User; size?: number }) {
  if (!user.verified) return null
  return (
    <span className="user-tags">
      <span className="vcheck" data-tip="Подтверждённый аккаунт" aria-label="Подтверждённый аккаунт" role="img">
        <BadgeCheck size={size} fill="currentColor" stroke="var(--vcheck-ink, #000)" strokeWidth={2.2} />
      </span>
    </span>
  )
}
