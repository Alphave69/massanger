export type Status = 'online' | 'idle' | 'sleep' | 'dnd' | 'invisible'
/** Что видят другие: невидимка выглядит как «не в сети» */
export type Presence = Exclude<Status, 'invisible'> | 'offline'

export interface User {
  id: string
  username: string
  displayName: string
  customStatus: string
  createdAt: number
}

export interface Me extends User {
  status: Status
}

export interface Channel {
  id: string
  name: string
  type: 'text' | 'voice'
}

export interface Guild {
  id: string
  name: string
  ownerId: string
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
  user: User | null
  lastMessageAt: number
}

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
type FriendsResponse = { friends: FriendEntry[] }

export const api = {
  register: (username: string, displayName: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, displayName, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request<{ user: Me }>('/me'),
  state: () => request<InitialState>('/state'),
  updateMe: (patch: Partial<Pick<Me, 'displayName' | 'customStatus' | 'status'>>) =>
    request<{ user: Me }>('/me', { method: 'PATCH', body: patch }),

  createGuild: (name: string) => request<{ guild: Guild }>('/guilds', { method: 'POST', body: { name } }),
  joinGuild: (code: string) => request<{ guild: Guild }>(`/guilds/${encodeURIComponent(code)}/join`, { method: 'POST' }),

  addFriend: (username: string) =>
    request<FriendsResponse & { accepted: boolean }>('/friends', { method: 'POST', body: { username } }),
  acceptFriend: (userId: string) => request<FriendsResponse>(`/friends/${userId}/accept`, { method: 'POST' }),
  removeFriend: (userId: string) => request<FriendsResponse>(`/friends/${userId}`, { method: 'DELETE' }),

  openDm: (userId: string) => request<{ dm: DmView }>('/dms', { method: 'POST', body: { userId } }),
  messages: (channelId: string) => request<{ messages: Message[] }>(`/channels/${channelId}/messages`),
}
