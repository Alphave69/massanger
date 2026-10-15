import { RateLimiter } from './ratelimit.js'

/**
 * Анти-спам поверх общего RateLimiter: больше max событий за windowMs от одного человека — пауза.
 * Попался снова вскоре после прошлой паузы — следующая длиннее (по списку cooldowns).
 * Всё в памяти: после перезапуска сервера счётчики начинаются заново — для антиспама это нормально.
 */

export interface LimitRule {
  max: number
  windowMs: number
  /** Длина паузы за 1-е, 2-е, 3-е… нарушение подряд (последняя — потолок) */
  cooldowns: number[]
  /** Через столько после прошлого нарушения его «забываем» — снова самая короткая пауза */
  forgiveMs: number
}

interface Penalty {
  until: number
  strikes: number
  lastStrike: number
}

export function createLimiter(rule: LimitRule) {
  const window = new RateLimiter(rule.max, rule.windowMs)
  const penalties = new Map<string, Penalty>()

  // Раз в минуту выбрасываем тех, кого уже простили
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [id, p] of penalties) if (now > p.until && now - p.lastStrike > rule.forgiveMs) penalties.delete(id)
  }, 60_000)
  sweep.unref?.()

  return {
    /** Засчитать событие. null — можно; число — сколько миллисекунд ещё ждать (событие не засчитано) */
    hit(userId: string): number | null {
      const now = Date.now()
      const p = penalties.get(userId)
      if (p && now < p.until) return p.until - now
      if (window.retryAfter(userId)) {
        const strikes = p && now - p.lastStrike < rule.forgiveMs ? p.strikes + 1 : 1
        const pause = rule.cooldowns[Math.min(strikes, rule.cooldowns.length) - 1]
        penalties.set(userId, { until: now + pause, strikes, lastStrike: now })
        // после паузы окно начинается заново
        window.reset(userId)
        return pause
      }
      window.hit(userId)
      return null
    },
  }
}

const SLOW_LINES = ['Воу-воу, полегче, амиго 🤠', 'Клавиатура дымится — дай ей остыть', 'Ты печатаешь быстрее, чем мы читаем']

/**
 * Ответ клиенту «притормози»: он покажет предупреждение с обратным отсчётом.
 * retryAfter — в секундах (с округлением вверх, как Retry-After), retryAfterMs — точно.
 */
export const slowDown = (waitMs: number, error = SLOW_LINES[Math.floor(Math.random() * SLOW_LINES.length)]) => ({
  error: `${error} Подожди ${Math.ceil(waitMs / 1000)} с`,
  code: 'slow_down' as const,
  retryAfter: Math.ceil(waitMs / 1000),
  retryAfterMs: waitMs,
})
