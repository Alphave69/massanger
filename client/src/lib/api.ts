export interface User {
  id: string
  username: string
  displayName: string
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

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
}

const TOKEN_KEY = 'massanger.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
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

type AuthResponse = { token: string; user: User }

export const api = {
  register: (username: string, displayName: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, displayName, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request<{ user: User }>('/me'),
  guilds: () => request<{ guilds: Guild[]; online: string[] }>('/guilds'),
  createGuild: (name: string) => request<{ guild: Guild }>('/guilds', { method: 'POST', body: { name } }),
  joinGuild: (code: string) => request<{ guild: Guild }>(`/guilds/${encodeURIComponent(code)}/join`, { method: 'POST' }),
  messages: (channelId: string) => request<{ messages: Message[] }>(`/channels/${channelId}/messages`),
}
