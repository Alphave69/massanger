import { useChat } from '../lib/store'
import { GroupAside } from './groups/GroupAside'
import { ProfileView } from './ProfileView'

/** Правая колонка в личке — профиль собеседника, в группе — участники */
export function DmProfile({ dmId }: { dmId: string }) {
  const dm = useChat((s) => s.dms.find((d) => d.id === dmId))
  if (!dm) return null
  if (dm.kind === 'group') return <GroupAside dm={dm} />
  if (!dm.userId) return null
  return (
    <aside className="aside panel glow aside--profile">
      <ProfileView userId={dm.userId} inDm />
    </aside>
  )
}
