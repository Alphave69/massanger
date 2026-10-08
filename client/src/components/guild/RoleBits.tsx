import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { Role } from '../../lib/api'

/** Кружок цвета роли (без цвета — пустое колечко) */
export function RoleDot({ color, size = 10 }: { color: string | null; size?: number }) {
  return (
    <span
      className={`role-dot${color ? '' : ' role-dot--none'}`}
      style={{ width: size, height: size, ...(color ? ({ '--role': color } as CSSProperties) : null) }}
      aria-hidden
    />
  )
}

/** Плашка роли у участника: цвет, название и крестик (если роль можно снять) */
export function RoleChip({ role, onRemove, busy }: { role: Role; onRemove?: () => void; busy?: boolean }) {
  return (
    <span className={`role-chip${busy ? ' is-busy' : ''}`} style={role.color ? ({ '--role': role.color } as CSSProperties) : undefined}>
      <RoleDot color={role.color} size={8} />
      <span className="truncate">{role.name}</span>
      {onRemove && (
        <button className="role-chip__x" onClick={onRemove} disabled={busy} aria-label={`Снять роль ${role.name}`} data-tip="Снять роль">
          <X size={11} />
        </button>
      )}
    </span>
  )
}
