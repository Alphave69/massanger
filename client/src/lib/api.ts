export type Status = 'online' | 'idle' | 'sleep' | 'dnd' | 'invisible'
/** Что видят другие: невидимка выглядит как «не в сети» */
export type Presence = Exclude<Status, 'invisible'> | 'offline'

export interface User {
  id: string
  username: string
  displayName: string
  customStatus: string
  bio: string
  createdAt: number
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
}

export interface VoiceMember {
  userId: string
  muted: boolean
  deafened: boolean
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
}

export interface Guild {
  id: string
  name: string
  ownerId: string
  /** Общий сервер для всех — его нельзя удалить */
  isLobby: boolean
  channels: Channel[]
  members: User[]
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

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
}

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
}
