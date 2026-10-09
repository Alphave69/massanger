export type Status = 'online' | 'idle' | 'sleep' | 'dnd' | 'invisible'
/** Что видят другие: невидимка выглядит как «не в сети» */
export type Presence = Exclude<Status, 'invisible'> | 'offline'

export interface EarnedBadge {
  id: string
  at: number
}

export interface User {
  id: string
  username: string
  displayName: string
  customStatus: string
  bio: string
  createdAt: number
  /** «Галочка» у имени — выдаёт админ */
  verified: boolean
  /** Номер регистрации: 1 — самый первый человек в Nuntius */
  number: number
  badges: EarnedBadge[]
}

/** Счётчики для значков (видны только себе и админу) */
export interface UserStats {
  messages: number
  voiceSeconds: number
  longestVoice: number
  calls: number
  commands: number
}

/** Что разрешено во всём приложении (меняет админ) */
export interface Privileges {
  createServers: boolean
  createGroups: boolean
}

export interface FoundEgg {
  id: string
  name: string
  at: number
}

export interface Privacy {
  dms: 'servers' | 'friends'
  friendRequests: 'everyone' | 'nobody'
}

export interface Me extends User {
  status: Status
  privacy: Privacy
  /** Подтверждённая почта (у старых аккаунтов может не быть) */
  email: string | null
  stats: UserStats
  /** Найденные пасхалки и сколько их всего */
  eggs: FoundEgg[]
  eggTotal: number
  /** Доступ к админке приложения */
  admin: boolean
  /** Владелец приложения (админ навсегда) */
  owner: boolean
  privileges: Privileges
}

// ============ значки ============

export type BadgeTier = 'common' | 'rare' | 'epic' | 'legendary'
export type BadgeGroup = 'time' | 'messages' | 'voice' | 'social' | 'eggs' | 'special'

export interface BadgeDef {
  id: string
  /** У секретного неполученного значка — «???» */
  name: string
  description: string
  /** Ключ иконки (имя иконки lucide в kebab-case, например 'moon') */
  icon: string
  tier: BadgeTier
  group: BadgeGroup
  /** Секретный: условия скрыты, пока не получишь */
  secret: boolean
  /** Выдаётся только админом вручную */
  manual: boolean
}

export interface BadgeCatalog {
  badges: BadgeDef[]
  /** id значка → у скольких людей он есть */
  holders: Record<string, number>
  /** Всего людей (для процентов редкости) */
  users: number
  eggTotal: number
  /** Мой прогресс к значкам-счётчикам: id → сколько есть / сколько нужно */
  progress: Record<string, { current: number; target: number }>
}

// ============ права на серверах ============

export const PERMISSIONS = [
  'ADMINISTRATOR',
  'MANAGE_SERVER',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'KICK_MEMBERS',
  'CREATE_INVITE',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'MANAGE_MESSAGES',
  'CONNECT',
  'SPEAK',
  'VIDEO',
  'MUTE_MEMBERS',
  'MOVE_MEMBERS',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** Права, которые можно настроить отдельному каналу */
export const CHANNEL_PERMISSIONS: Permission[] = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'MOVE_MEMBERS']

export interface Role {
  id: string
  name: string
  /** '#rrggbb' или null */
  color: string | null
  /** Показывать отдельной группой в списке участников */
  hoist: boolean
  permissions: Permission[]
  /** Чем больше, тем выше; у @everyone (id = id сервера) — 0 */
  position: number
}

export interface Override {
  allow: Permission[]
  deny: Permission[]
}

export interface VoiceMember {
  userId: string
  muted: boolean
  deafened: boolean
  /** Заглушён модератором сервера — говорить не может, пока не снимут */
  serverMuted: boolean
  video: boolean
  screen: boolean
  cameraStream: string | null
  screenStream: string | null
  joinedAt: number
}

/** Служебные сообщения («теперь вы друзья») приходят с таким автором */
export const SYSTEM_AUTHOR = 'system'

export interface Channel {
  id: string
  name: string
  type: 'text' | 'voice'
  /** id роли → исключения в этом канале */
  overrides: Record<string, Override>
  /** Мои итоговые права в этом канале (каналы без VIEW_CHANNEL сервер не присылает) */
  perms: Permission[]
}

export interface Guild {
  id: string
  name: string
  ownerId: string
  /** Общий сервер для всех — его нельзя удалить */
  isLobby: boolean
  channels: Channel[]
  members: User[]
  /** Роли по убыванию: первой идёт самая высокая, последней — @everyone */
  roles: Role[]
  /** id участника → id его ролей (без @everyone) */
  memberRoles: Record<string, string[]>
  /** Мои права на сервере */
  perms: Permission[]
}

export type FriendState = 'friends' | 'incoming' | 'outgoing'

export interface FriendEntry {
  user: User
  state: FriendState
  since: number
}

export interface DmView {
  id: string
  kind: 'dm' | 'group'
  /** Название группы ('' — показываем имена участников) */
  name: string
  ownerId: string | null
  members: User[]
  /** Собеседник в личке (у группы — null) */
  user: User | null
  lastMessageAt: number
}

export const GROUP_LIMIT = 10

/** Результат команды: /roll, /flip, /8ball, /me */
export type MessageFlavor = 'roll' | 'flip' | 'ball' | 'me'

/** Ответ: снимок сообщения, на которое ответили (остаётся, даже если оригинал удалят) */
export interface ReplyRef {
  id: string
  authorId: string
  /** Начало текста оригинала (до 200 символов) */
  content: string
}

/** Пересланное: кто написал оригинал, откуда («#общий · Nuntius», «личка», название группы) и когда */
export interface Forwarded {
  authorId: string
  from: string
  createdAt: number
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
  flavor?: MessageFlavor
  /** Реакции: эмодзи → id поставивших (по порядку) */
  reactions?: Record<string, string[]>
  replyTo?: ReplyRef
  forwarded?: Forwarded
  /** Когда текст меняли в последний раз */
  editedAt?: number
}

// ============ админка ============

export interface AdminUser extends User {
  email: string | null
  status: Status
  online: boolean
  admin: boolean
  owner: boolean
  banned: boolean
  privileges: Privileges
  stats: UserStats
  eggsFound: number
}

export interface AdminGuild {
  id: string
  name: string
  ownerId: string
  members: number
  isLobby: boolean
}

export interface AdminOverview {
  stats: { users: number; online: number; inVoice: number; guilds: number; groups: number; dms: number; messages: number }
  users: AdminUser[]
  guilds: AdminGuild[]
}

export type AdminUserPatch = Partial<{ verified: boolean; admin: boolean; banned: boolean; privileges: Partial<Privileges> }>

export interface InitialState {
  user: Me
  guilds: Guild[]
  friends: FriendEntry[]
  dms: DmView[]
  presence: Record<string, Presence>
  voice: Record<string, VoiceMember[]>
  rings: { roomId: string; from: string }[]
}

const TOKEN_KEY = 'nuntius.token'
const OLD_TOKEN_KEY = 'massanger.token' // до переименования — чтобы не выкидывало из аккаунта

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(OLD_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(OLD_TOKEN_KEY)
  } catch {
    // приватный режим — просто не запомним вход
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError('Сервер недоступен', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? 'Что-то пошло не так', res.status)
  return data as T
}

type AuthResponse = { token: string; user: Me }
/** Код отправлен на почту; resendIn — через сколько секунд можно запросить новый */
type CodeSent = { email: string; resendIn: number }
type FriendsResponse = { friends: FriendEntry[] }

export const api = {
  register: (email: string, username: string, displayName: string, password: string) =>
    request<CodeSent>('/auth/register', { method: 'POST', body: { email, username, displayName, password } }),
  verifyRegistration: (email: string, code: string) => request<AuthResponse>('/auth/register/verify', { method: 'POST', body: { email, code } }),
  /** login — логин или почта */
  login: (login: string, password: string) => request<AuthResponse>('/auth/login', { method: 'POST', body: { username: login, password } }),
  requestReset: (email: string) => request<CodeSent>('/auth/reset', { method: 'POST', body: { email } }),
  finishReset: (email: string, code: string, password: string) =>
    request<AuthResponse>('/auth/reset/verify', { method: 'POST', body: { email, code, password } }),
  startEmailBind: (email: string, password: string) => request<CodeSent>('/me/email', { method: 'POST', body: { email, password } }),
  verifyEmailBind: (code: string) => request<{ user: Me }>('/me/email/verify', { method: 'POST', body: { code } }),
  me: () => request<{ user: Me }>('/me'),
  state: () => request<InitialState>('/state'),
  updateMe: (
    patch: Partial<Pick<Me, 'displayName' | 'username' | 'customStatus' | 'bio' | 'status'>> & { privacy?: Partial<Privacy>; password?: string },
  ) =>
    request<{ user: Me }>('/me', { method: 'PATCH', body: patch }),
  changePassword: (current: string, next: string) => request<{ token: string }>('/me/password', { method: 'POST', body: { current, next } }),
  logoutAll: () => request<{ token: string }>('/me/logout-all', { method: 'POST' }),

  createGuild: (name: string) => request<{ guild: Guild }>('/guilds', { method: 'POST', body: { name } }),
  renameGuild: (id: string, name: string) => request<{ guild: Guild }>(`/guilds/${id}`, { method: 'PATCH', body: { name } }),
  deleteGuild: (id: string) => request<{ ok: true }>(`/guilds/${id}`, { method: 'DELETE' }),
  leaveGuild: (id: string) => request<{ ok: true }>(`/guilds/${id}/leave`, { method: 'POST' }),
  kickMember: (id: string, userId: string) => request<{ guild: Guild }>(`/guilds/${id}/members/${userId}`, { method: 'DELETE' }),
  createChannel: (id: string, name: string, type: Channel['type']) =>
    request<{ guild: Guild; channel: Channel }>(`/guilds/${id}/channels`, { method: 'POST', body: { name, type } }),
  updateChannel: (id: string, channelId: string, patch: { name?: string; move?: -1 | 1 }) =>
    request<{ guild: Guild }>(`/guilds/${id}/channels/${channelId}`, { method: 'PATCH', body: patch }),
  deleteChannel: (id: string, channelId: string) => request<{ guild: Guild }>(`/guilds/${id}/channels/${channelId}`, { method: 'DELETE' }),

  createGroup: (userIds: string[], name: string) => request<{ dm: DmView }>('/groups', { method: 'POST', body: { userIds, name } }),
  renameGroup: (id: string, name: string) => request<{ dm: DmView }>(`/groups/${id}`, { method: 'PATCH', body: { name } }),
  addToGroup: (id: string, userIds: string[]) => request<{ dm: DmView }>(`/groups/${id}/members`, { method: 'POST', body: { userIds } }),
  removeFromGroup: (id: string, userId: string) => request<{ dm: DmView }>(`/groups/${id}/members/${userId}`, { method: 'DELETE' }),
  leaveGroup: (id: string) => request<{ ok: true }>(`/groups/${id}/leave`, { method: 'POST' }),
  joinGuild: (code: string) => request<{ guild: Guild }>(`/guilds/${encodeURIComponent(code)}/join`, { method: 'POST' }),

  addFriend: (username: string) =>
    request<FriendsResponse & { accepted: boolean }>('/friends', { method: 'POST', body: { username } }),
  acceptFriend: (userId: string) => request<FriendsResponse>(`/friends/${userId}/accept`, { method: 'POST' }),
  removeFriend: (userId: string) => request<FriendsResponse>(`/friends/${userId}`, { method: 'DELETE' }),

  openDm: (userId: string) => request<{ dm: DmView }>('/dms', { method: 'POST', body: { userId } }),
  messages: (channelId: string) => request<{ messages: Message[] }>(`/channels/${channelId}/messages`),
  /** Удалить сообщение: своё — всегда, чужое — с правом MANAGE_MESSAGES */
  deleteMessage: (messageId: string) => request<{ ok: true }>(`/messages/${messageId}`, { method: 'DELETE' }),

  // --- роли ---
  createRole: (guildId: string, role: Partial<Pick<Role, 'name' | 'color' | 'hoist' | 'permissions'>>) =>
    request<{ guild: Guild; role: Role }>(`/guilds/${guildId}/roles`, { method: 'POST', body: role }),
  /** move: -1 — выше, 1 — ниже */
  updateRole: (guildId: string, roleId: string, patch: Partial<Pick<Role, 'name' | 'color' | 'hoist' | 'permissions'>> & { move?: -1 | 1 }) =>
    request<{ guild: Guild }>(`/guilds/${guildId}/roles/${roleId}`, { method: 'PATCH', body: patch }),
  deleteRole: (guildId: string, roleId: string) => request<{ guild: Guild }>(`/guilds/${guildId}/roles/${roleId}`, { method: 'DELETE' }),
  setMemberRoles: (guildId: string, userId: string, roleIds: string[]) =>
    request<{ guild: Guild }>(`/guilds/${guildId}/members/${userId}/roles`, { method: 'PUT', body: { roleIds } }),
  /** Пустые allow и deny — убрать исключение */
  setOverride: (guildId: string, channelId: string, roleId: string, override: Override) =>
    request<{ guild: Guild }>(`/guilds/${guildId}/channels/${channelId}/overrides/${roleId}`, { method: 'PUT', body: override }),

  // --- значки и пасхалки ---
  badges: () => request<BadgeCatalog>('/badges'),
  findEgg: (id: string) => request<{ isNew: boolean; egg: FoundEgg | null; user: Me }>('/me/eggs', { method: 'POST', body: { id } }),

  // --- админка ---
  adminOverview: () => request<AdminOverview>('/admin/overview'),
  adminUpdateUser: (userId: string, patch: AdminUserPatch) => request<{ user: AdminUser }>(`/admin/users/${userId}`, { method: 'PATCH', body: patch }),
  adminGrantBadge: (userId: string, badgeId: string) => request<{ user: AdminUser }>(`/admin/users/${userId}/badges`, { method: 'POST', body: { badgeId } }),
  adminRevokeBadge: (userId: string, badgeId: string) => request<{ user: AdminUser }>(`/admin/users/${userId}/badges/${badgeId}`, { method: 'DELETE' }),
  adminAnnounce: (text: string) => request<{ ok: true }>('/admin/announce', { method: 'POST', body: { text } }),
  adminDeleteGuild: (guildId: string) => request<{ ok: true }>(`/admin/guilds/${guildId}`, { method: 'DELETE' }),
}
