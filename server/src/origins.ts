/**
 * С каких сайтов браузеру можно ходить к нашему API и сокету (CORS).
 * Список — из CORS_ORIGINS через запятую (на сервере: https://nuntius.site, у себя: http://localhost:5173).
 * Не задан — берём https://<NUNTIUS_DOMAIN> (его пишет deploy/setup.sh), а у себя на компьютере — Vite на 5173.
 * Сам сайт (страница с того же адреса, что и сервер) разрешён всегда — список нужен для чужих адресов.
 */
function configuredOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim()
  if (raw) return raw.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
  const domain = process.env.NUNTIUS_DOMAIN?.trim()
  if (domain) return [`https://${domain}`]
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']
}

export const allowedOrigins = configuredOrigins()

/** Можно ли пустить запрос с таким Origin. host — заголовок Host (Caddy передаёт его как есть) */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  // без Origin — не браузерный запрос со стороннего сайта (curl, приложение для Windows из своего процесса)
  if (!origin) return true
  if (allowedOrigins.includes(origin)) return true
  try {
    return Boolean(host) && new URL(origin).host === host
  } catch {
    return false
  }
}
