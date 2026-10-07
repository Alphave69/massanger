import { useShallow } from 'zustand/react/shallow'
import { useChat } from '../../lib/store'
import { Avatar } from '../Avatar'

/** Значок группы: два аватара внахлёст (первые участники, кроме себя) */
export function GroupAvatar({ memberIds, size }: { memberIds: string[]; size: number }) {
  const users = useChat(
    useShallow((s) =>
      memberIds
        .filter((id) => id !== s.me?.id)
        .slice(0, 2)
        .map((id) => s.users[id])
        .filter((u) => u !== undefined),
    ),
  )
  const small = Math.round(size * 0.62)
  return (
    <span className="group-avatar" style={{ width: size, height: size }}>
      {users[0] && (
        <span className="group-avatar__a">
          <Avatar user={users[0]} size={small} />
        </span>
      )}
      {users[1] ? (
        <span className="group-avatar__b">
          <Avatar user={users[1]} size={small} />
        </span>
      ) : (
        <span className="group-avatar__b group-avatar__count">{memberIds.length}</span>
      )}
    </span>
  )
}
