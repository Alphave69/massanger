import { CHANNEL_PERMISSIONS, type Channel, type Guild, type Message, type Permission, type Role, type User } from './api'
import { can, everyoneOf, guildOfChannel, rolesOf } from './perms'
import { presenceOf, useChat } from './store'
import { isOnline } from './status'
import { rawOf, richParts } from './linkify'

/**
 * Упоминания: в тексте сообщения хранятся метки <@id>, <@&idРоли>, @everyone, @here.
 * В поле ввода человек видит и пишет «@логин» и «@Роль» — перед отправкой они превращаются в метки,
 * а при правке — обратно. Кого упомянули на самом деле, решает сервер (message.mentions).
 */

type ChatState = ReturnType<typeof useChat.getState>

/** Кусок текста сообщения: просто текст или упоминание */
export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'user'; id: string; raw: string }
  | { kind: 'role'; id: string; raw: string }
  | { kind: 'mass'; which: 'everyone' | 'here'; raw: string }

const TOKEN_RE = /<@(&?)([\w-]{1,64})>|@(everyone|here)(?![\p{L}\p{N}_])/gu
/**
 * «@» считается упоминанием, только если перед ним начало, пробел или открывающая скобка/кавычка —
 * не почта, не кусок ссылки и не ник. Так же считает сервер (server/src/mentions.ts)
 */
const FREE_BEFORE = /[\s([{«"'„“]/u
const freeAt = (text: string, i: number) => i === 0 || FREE_BEFORE.test(text[i - 1])
const WORD = /[\p{L}\p{N}_]/u

/** Разрезать обычный текст (без кода и ссылок) на куски и метки упоминаний */
export function splitMentions(content: string): Piece[] {
  const out: Piece[] = []
  let last = 0
  for (const m of content.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0
    if (m[3] && !freeAt(content, at)) continue
    if (at > last) out.push({ kind: 'text', text: content.slice(last, at) })
    if (m[3]) out.push({ kind: 'mass', which: m[3] as 'everyone' | 'here', raw: m[0] })
    else out.push({ kind: m[1] ? 'role' : 'user', id: m[2], raw: m[0] })
    last = at + m[0].length
  }
  if (last < content.length) out.push({ kind: 'text', text: content.slice(last) })
  return out
}

/** Пройтись по обычному тексту сообщения, не трогая код и ссылки */
const mapText = (content: string, fn: (text: string) => string) =>
  richParts(content)
    .map((p) => (p.kind === 'text' ? fn(p.text) : rawOf(p)))
    .join('')

/**
 * Текст с метками → читаемый: <@id> → @логин (или @Имя для цитат и уведомлений), <@&id> → @Роль.
 * Незнакомые метки оставляем как есть.
 */
export function readable(content: string, channelId: string, how: 'login' | 'name' = 'name', st: ChatState = useChat.getState()): string {
  if (!content.includes('<@')) return content
  const guild = guildOfChannel(st.guilds, channelId)
  return mapText(content, (text) =>
    splitMentions(text)
      .map((p) => {
        if (p.kind === 'text') return p.text
        if (p.kind === 'mass') return p.raw
        if (p.kind === 'user') {
          const u = st.users[p.id]
          return u ? `@${how === 'login' ? u.username : u.displayName}` : p.raw
        }
        const role = guild?.roles?.find((r) => r.id === p.id)
        return role ? `@${role.name}` : p.raw
      })
      .join(''),
  )
}

// ============ кого можно упомянуть в канале ============

/** Права участника в канале — так же, как считает сервер (permissions.ts) */
export function memberCan(guild: Guild, channel: Channel | undefined, userId: string, perm: Permission): boolean {
  if (guild.ownerId === userId) return true
  const roles = rolesOf(guild, userId)
  const out = new Set<Permission>(everyoneOf(guild)?.permissions ?? [])
  for (const r of roles) for (const p of r.permissions) out.add(p)
  if (out.has('ADMINISTRATOR')) return true
  if (!channel || !CHANNEL_PERMISSIONS.includes(perm)) return out.has(perm)
  const apply = (deny: Permission[], allow: Permission[]) => {
    for (const p of deny) if (CHANNEL_PERMISSIONS.includes(p)) out.delete(p)
    for (const p of allow) if (CHANNEL_PERMISSIONS.includes(p)) out.add(p)
  }
  const everyone = channel.overrides?.[guild.id]
  if (everyone) apply(everyone.deny, everyone.allow)
  const deny: Permission[] = []
  const allow: Permission[] = []
  for (const r of roles) {
    const o = channel.overrides?.[r.id]
    if (o) {
      deny.push(...o.deny)
      allow.push(...o.allow)
    }
  }
  apply(deny, allow)
  return out.has('VIEW_CHANNEL') && out.has(perm)
}

export type Suggestion =
  | { kind: 'user'; user: User; label: string; token: string }
  | { kind: 'role'; role: Role; label: string; token: string }
  | { kind: 'mass'; which: 'everyone' | 'here'; label: string; token: string }

/** Все, кого можно упомянуть в канале: люди, которые его видят, роли сервера, @everyone/@here (если есть право) */
export function mentionables(st: ChatState, channelId: string): Suggestion[] {
  const out: Suggestion[] = []
  const guild = guildOfChannel(st.guilds, channelId)
  if (guild) {
    const channel = guild.channels.find((c) => c.id === channelId)
    for (const user of guild.members) {
      if (memberCan(guild, channel, user.id, 'VIEW_CHANNEL')) out.push({ kind: 'user', user, label: `@${user.username}`, token: `<@${user.id}>` })
    }
    for (const role of guild.roles ?? []) {
      if (role.id !== guild.id) out.push({ kind: 'role', role, label: `@${role.name}`, token: `<@&${role.id}>` })
    }
    if (can(guild, 'MENTION_EVERYONE', channelId)) {
      out.push({ kind: 'mass', which: 'everyone', label: '@everyone', token: '@everyone' })
      out.push({ kind: 'mass', which: 'here', label: '@here', token: '@here' })
    }
    return out
  }
  const dm = st.dms.find((d) => d.id === channelId)
  for (const id of dm?.memberIds ?? []) {
    const user = st.users[id]
    if (user) out.push({ kind: 'user', user, label: `@${user.username}`, token: `<@${user.id}>` })
  }
  return out
}

/** Подсказки для набранного после «@»: сначала совпадения с начала логина/имени, люди в сети — выше */
export function suggest(st: ChatState, channelId: string, query: string, limit = 8): Suggestion[] {
  const q = query.toLowerCase()
  const meId = st.me?.id
  const scored: { s: Suggestion; score: number }[] = []
  for (const s of mentionables(st, channelId)) {
    const names =
      s.kind === 'user' ? [s.user.username, s.user.displayName] : s.kind === 'role' ? [s.role.name] : [s.which]
    const lower = names.map((n) => n.toLowerCase())
    let score = lower.some((n) => n.startsWith(q)) ? 3 : lower.some((n) => n.includes(q)) ? 1 : -1
    if (score < 0) continue
    if (s.kind === 'user') {
      if (s.user.id === meId) score -= 2
      else if (isOnline(presenceOf(st, s.user.id))) score += 1
    }
    // @everyone и @here — в конце, чтобы случайно не позвать всех
    if (s.kind === 'mass') score -= 3
    scored.push({ s, score })
  }
  // при равенстве — сначала люди, потом роли
  const kindOrder = { user: 0, role: 1, mass: 2 }
  return scored
    .sort((a, b) => b.score - a.score || kindOrder[a.s.kind] - kindOrder[b.s.kind] || a.s.label.localeCompare(b.s.label, 'ru'))
    .slice(0, limit)
    .map((x) => x.s)
}

/**
 * Читаемый текст из поля ввода → текст с метками: «@логин» → <@id>, «@Роль» → <@&id>.
 * Ищем самое длинное совпадение (роль «Модераторы чата» раньше «Модераторы»), регистр не важен.
 */
export function toTokens(text: string, list: Suggestion[]): string {
  if (!text.includes('@')) return text
  const sorted = list.filter((s) => s.kind !== 'mass').sort((a, b) => b.label.length - a.label.length)
  // в коде и ссылках «@» — не упоминание
  return mapText(text, (part) => {
    let out = ''
    let i = 0
    while (i < part.length) {
      if (part[i] === '@' && freeAt(part, i)) {
        const hit = sorted.find((s) => {
          const end = i + s.label.length
          return part.slice(i, end).toLowerCase() === s.label.toLowerCase() && !(end < part.length && WORD.test(part[end]))
        })
        if (hit) {
          out += hit.token
          i += hit.label.length
          continue
        }
      }
      out += part[i]
      i++
    }
    return out
  })
}

/** Упоминает ли сообщение меня: прямо, через мою роль, @everyone или @here (когда я был в сети) */
export function mentionsMe(st: ChatState, m: Message): boolean {
  const me = st.me?.id
  const mentions = m.mentions
  if (!me || !mentions || m.authorId === me) return false
  if (mentions.everyone || mentions.users.includes(me) || mentions.here?.includes(me)) return true
  if (!mentions.roles.length) return false
  const guild = guildOfChannel(st.guilds, m.channelId)
  const mine = guild?.memberRoles?.[me] ?? []
  return mentions.roles.some((id) => mine.includes(id))
}
