import type { CSSProperties, ComponentType } from 'react'
import { Award, BadgeCheck, Ban, Crown, Hash, MessageSquare, Mic, Server, UserRound, Users, UsersRound, Wifi } from 'lucide-react'
import type { AdminOverview as Overview, AdminUser } from '../../lib/api'
import { plural } from '../../lib/format'
import { Avatar } from '../Avatar'
import { UserTags } from '../UserTags'
import { CountUp, fmtNum, presenceOfAdmin, shortDate } from './bits'
import type { PeopleFilter } from './AdminPeople'

interface Tile {
  icon: ComponentType<{ size?: number }>
  label: string
  value: number
  hint?: string
  /** Куда ведёт клик */
  go?: () => void
}

interface Props {
  data: Overview
  onPeople: (filter: PeopleFilter) => void
  onServers: () => void
  onPerson: (userId: string) => void
}

/** «Обзор»: цифры по всему Nuntius и пара живых списков */
export function AdminOverview({ data, onPeople, onServers, onPerson }: Props) {
  const { stats, users } = data
  const admins = users.filter((u) => u.admin || u.owner).length
  const banned = users.filter((u) => u.banned).length
  const verified = users.filter((u) => u.verified).length

  const tiles: Tile[] = [
    { icon: Users, label: 'Людей', value: stats.users, go: () => onPeople('all') },
    { icon: Wifi, label: 'В сети', value: stats.online, hint: stats.users ? `${Math.round((stats.online / stats.users) * 100)}% от всех` : undefined, go: () => onPeople('online') },
    { icon: Mic, label: 'В голосе', value: stats.inVoice },
    { icon: MessageSquare, label: 'Сообщений', value: stats.messages, hint: stats.users ? `≈ ${fmtNum(Math.round(stats.messages / stats.users))} на человека` : undefined },
    { icon: Server, label: 'Серверов', value: stats.guilds, go: onServers },
    { icon: UsersRound, label: 'Групп', value: stats.groups },
    { icon: Hash, label: 'Личек', value: stats.dms },
    { icon: Crown, label: 'Админов', value: admins, go: () => onPeople('admins') },
    { icon: BadgeCheck, label: 'С галочкой', value: verified, go: () => onPeople('verified') },
    { icon: Ban, label: 'Заблокировано', value: banned, go: () => onPeople('banned') },
  ]

  const newest = users.slice(-5).reverse()
  const chatty = [...users]
    .filter((u) => (u.stats?.messages ?? 0) > 0)
    .sort((a, b) => (b.stats?.messages ?? 0) - (a.stats?.messages ?? 0))
    .slice(0, 5)
  const collectors = [...users]
    .filter((u) => (u.badges?.length ?? 0) > 0)
    .sort((a, b) => (b.badges?.length ?? 0) - (a.badges?.length ?? 0) || (b.eggsFound ?? 0) - (a.eggsFound ?? 0))
    .slice(0, 5)

  return (
    <div className="adm-overview">
      <div className="adm-tiles">
        {tiles.map((t, i) => {
          const Icon = t.icon
          const Tag = t.go ? 'button' : 'div'
          return (
            <Tag
              key={t.label}
              className={`adm-tile glow${t.go ? ' is-link' : ''}`}
              style={{ animationDelay: `${i * 45}ms` } as CSSProperties}
              onClick={t.go}
            >
              <span className="adm-tile__icon">
                <Icon size={18} />
              </span>
              <span className="adm-tile__value">
                <CountUp value={t.value} />
              </span>
              <span className="adm-tile__label">{t.label}</span>
              {t.hint && <span className="adm-tile__hint">{t.hint}</span>}
            </Tag>
          )
        })}
      </div>

      <div className="adm-lists">
        <PeopleList title="Новенькие" icon={UserRound} people={newest} empty="Пока никого" onPerson={onPerson} aside={(u) => shortDate.format(u.createdAt)} />
        <PeopleList
          title="Болтуны"
          icon={MessageSquare}
          people={chatty}
          empty="Все молчат"
          onPerson={onPerson}
          aside={(u) => plural(u.stats?.messages ?? 0, ['сообщение', 'сообщения', 'сообщений'])}
        />
        <PeopleList
          title="Коллекционеры"
          icon={Award}
          people={collectors}
          empty="Значков ни у кого"
          onPerson={onPerson}
          aside={(u) => plural(u.badges?.length ?? 0, ['значок', 'значка', 'значков'])}
        />
      </div>
    </div>
  )
}

function PeopleList({
  title,
  icon: Icon,
  people,
  empty,
  aside,
  onPerson,
}: {
  title: string
  icon: ComponentType<{ size?: number }>
  people: AdminUser[]
  empty: string
  aside: (u: AdminUser) => string
  onPerson: (id: string) => void
}) {
  return (
    <section className="adm-list">
      <h4 className="adm-list__title">
        <Icon size={14} /> {title}
      </h4>
      {people.length === 0 && <p className="adm-list__empty">{empty}</p>}
      {people.map((u, i) => (
        <button key={u.id} className="adm-list__row" onClick={() => onPerson(u.id)} style={{ animationDelay: `${i * 50}ms` }}>
          <span className="adm-list__place">{i + 1}</span>
          <Avatar user={u} size={26} status={presenceOfAdmin(u)} />
          <span className="adm-list__name">
            <span className="truncate">{u.displayName}</span>
            <UserTags user={u} size={12} />
          </span>
          <span className="adm-list__aside">{aside(u)}</span>
        </button>
      ))}
    </section>
  )
}
