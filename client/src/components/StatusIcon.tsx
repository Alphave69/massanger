import { useId } from 'react'
import type { Presence } from '../lib/api'

interface Props {
  status: Presence | 'invisible'
  size?: number
}

/**
 * Значки статусов в монохроме: различаются формой, а не цветом.
 * ● в сети · ◐ не активен · ☾ спит · ⊖ не беспокоить · ○ не в сети/невидимка
 */
export function StatusIcon({ status, size = 12 }: Props) {
  const mask = useId()
  return (
    <svg className={`status-icon status-icon--${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {status === 'online' && <circle cx="8" cy="8" r="6.5" fill="currentColor" />}
      {status === 'idle' && (
        <>
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 2.4 A5.6 5.6 0 0 0 8 13.6 Z" fill="currentColor" />
        </>
      )}
      {status === 'sleep' && (
        <>
          <mask id={mask}>
            <rect width="16" height="16" fill="#fff" />
            <circle cx="11.6" cy="4.6" r="5.2" fill="#000" />
          </mask>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" mask={`url(#${mask})`} />
        </>
      )}
      {status === 'dnd' && (
        <>
          <mask id={mask}>
            <rect width="16" height="16" fill="#fff" />
            <rect x="3.6" y="6.7" width="8.8" height="2.6" rx="1.3" fill="#000" />
          </mask>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" mask={`url(#${mask})`} />
        </>
      )}
      {(status === 'offline' || status === 'invisible') && (
        <circle cx="8" cy="8" r="4.8" fill="none" stroke="currentColor" strokeWidth="2.6" />
      )}
    </svg>
  )
}
