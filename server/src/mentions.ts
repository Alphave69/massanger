import * as store from './store.js'
import { findRole, hasChannelPermission, hasGuildPermission, isEveryone } from './permissions.js'

/**
 * Упоминания в тексте сообщения — как в Discord:
 *   <@idЧеловека>  <@&idРоли>  @everyone  @here
 * Клиент сам превращает «@логин» и «@Роль» в такие метки перед отправкой.
 * Здесь проверяем, кого из упомянутых и правда можно позвать; остальные метки остаются просто текстом.
 */

const USER_TOKEN = /<@([\w-]{1,64})>/g
const ROLE_TOKEN = /<@&([\w-]{1,64})>/g
/** @everyone / @here — отдельным словом: перед ним начало, пробел или открывающая скобка/кавычка (не почта, не ссылка) */
const MASS_TOKEN = /(^|[\s([{«"'„“])@(everyone|here)(?![\p{L}\p{N}_])/gu
/** `код` и ```блоки кода``` — в них упоминаний нет (так же режет клиент: client/src/lib/linkify.ts) */
const CODE = /```([\s\S]*?)```|`([^`\n]+)`/g

/** Больше разных людей и ролей в одном сообщении не зовём — защита от «пинга всех по одному» */
const MAX_MENTIONS = 25

const uniq = (re: RegExp, text: string) => [...new Set([...text.matchAll(re)].map((m) => m[1]))]

interface Options {
  /** Кто сейчас в сети (для @here) */
  isOnline: (userId: string) => boolean
  /** Прошлые упоминания (при правке): @here не зовёт людей заново */
  previous?: store.Mentions
}

/** Проверенные упоминания для сообщения автора в этом канале; undefined — никого не позвали */
export function parseMentions(raw: string, access: store.ChannelAccess, authorId: string, { isOnline, previous }: Options): store.Mentions | undefined {
  // пустой блок «``````» клиент кодом не считает — и мы не вырезаем
  const content = raw.includes('`') ? raw.replace(CODE, (m, block?: string) => (block !== undefined && !block.trim() ? m : ' ')) : raw
  // человек: существует и видит этот канал (в личке и группе — её участник)
  const users = uniq(USER_TOKEN, content)
    .filter((id) => store.findUser(id) && store.canSee(access, id))
    .slice(0, MAX_MENTIONS)

  let roles: string[] = []
  let everyone = false
  let here: string[] | undefined
  // роли и «всех сразу» — только на серверах
  if (access.kind === 'guild') {
    const { guild, channel } = access
    // Роль, которую не отметили «Можно упоминать», зовут только те, кто может звать всех или управляет ролями:
    // иначе роль «есть у всех» работала бы как @everyone без права на это
    let mayPingAny: boolean | undefined
    const mayPing = (role: store.Role) =>
      role.mentionable ||
      (mayPingAny ??= hasChannelPermission(guild, channel, authorId, 'MENTION_EVERYONE') || hasGuildPermission(guild, authorId, 'MANAGE_ROLES'))
    roles = uniq(ROLE_TOKEN, content)
      .filter((id) => {
        const role = findRole(guild, id)
        return role && !isEveryone(guild, role) && mayPing(role)
      })
      .slice(0, MAX_MENTIONS)
    const mass = new Set([...content.matchAll(MASS_TOKEN)].map((m) => m[2]))
    if (mass.size && hasChannelPermission(guild, channel, authorId, 'MENTION_EVERYONE')) {
      everyone = mass.has('everyone')
      if (mass.has('here')) here = previous?.here ?? store.viewersOf(access).filter((id) => id !== authorId && isOnline(id))
    }
  }

  if (!users.length && !roles.length && !everyone && !here) return undefined
  return { users, roles, everyone, ...(here ? { here } : {}) }
}
