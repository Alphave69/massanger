import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Одноразовые коды из писем. Живут в памяти: 10 минут, 5 попыток,
 * повторная отправка — не чаще раза в минуту. Сам код не храним — только его хеш.
 */
const TTL = 10 * 60_000
export const RESEND_AFTER = 60_000
const MAX_ATTEMPTS = 5

interface Pending {
  codeHash: Buffer
  expires: number
  attempts: number
  sentAt: number
  data: unknown
}

const pending = new Map<string, Pending>()
const hash = (code: string) => createHash('sha256').update(code).digest()

/**
 * Выдать код для ключа. Если прошлый отправлен меньше минуты назад — новый не выдаём
 * (данные обновляем, код прежний), а говорим, сколько секунд подождать.
 */
export function issueCode(key: string, data: unknown): { code: string | null; resendIn: number } {
  const now = Date.now()
  const prev = pending.get(key)
  if (prev && prev.expires > now && now - prev.sentAt < RESEND_AFTER) {
    prev.data = data
    return { code: null, resendIn: Math.ceil((RESEND_AFTER - (now - prev.sentAt)) / 1000) }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  pending.set(key, { codeHash: hash(code), expires: now + TTL, attempts: 0, sentAt: now, data })
  return { code, resendIn: RESEND_AFTER / 1000 }
}

/** Сколько секунд осталось до возможности отправить новый код (0 — можно) */
export function cooldownLeft(key: string) {
  const p = pending.get(key)
  if (!p || p.expires < Date.now()) return 0
  return Math.max(0, Math.ceil((RESEND_AFTER - (Date.now() - p.sentAt)) / 1000))
}

export const pendingData = <T>(key: string) => pending.get(key)?.data as T | undefined

export function dropCode(key: string) {
  pending.delete(key)
}

export type CodeCheck<T> = { ok: true; data: T } | { ok: false; error: string }

export function checkCode<T>(key: string, code: unknown): CodeCheck<T> {
  const p = pending.get(key)
  if (!p || p.expires < Date.now()) {
    pending.delete(key)
    return { ok: false, error: 'Код устарел или не запрашивался — отправь новый' }
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return { ok: false, error: 'Код — это 6 цифр из письма' }
  p.attempts++
  if (!timingSafeEqual(hash(code.trim()), p.codeHash)) {
    if (p.attempts >= MAX_ATTEMPTS) {
      pending.delete(key)
      return { ok: false, error: 'Слишком много неверных попыток — запроси новый код' }
    }
    return { ok: false, error: `Неверный код. Осталось попыток: ${MAX_ATTEMPTS - p.attempts}` }
  }
  pending.delete(key)
  return { ok: true, data: p.data as T }
}

// Чистим протухшие коды раз в минуту
setInterval(() => {
  const now = Date.now()
  for (const [key, p] of pending) if (p.expires < now) pending.delete(key)
}, 60_000).unref()
