import { useChat } from '../lib/store'
import { ProfileView } from './ProfileView'

/** Правая колонка в личке — профиль собеседника */
export function DmProfile({ dmId }: { dmId: string }) {
  const userId = useChat((s) => s.dms.find((d) => d.id === dmId)?.userId)
  if (!userId) return null
  return (
    <aside className="aside panel glow aside--profile">
      <ProfileView userId={userId} inDm />
    </aside>
  )
}
