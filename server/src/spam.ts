/**
 * Анти-спам: не больше max событий за windowMs от одного человека, иначе — пауза.
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

interface State {
  hits: number[]
  until: number
  strikes: number
  lastStrike: number
}

export function createLimiter(rule: LimitRule) {
  const states = new Map<string, State>()

  // Раз в минуту выбрасываем тех, кто давно затих
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of states) {
      if (now > s.until && now - (s.hits[s.hits.length - 1] ?? 0) > rule.windowMs && now - s.lastStrike > rule.forgiveMs) states.delete(id)
    }
  }, 60_000)
  sweep.unref?.()

  return {
    /** Засчитать событие. null — можно; число — сколько миллисекунд ещё ждать (событие не засчитано) */
    hit(userId: string, now = Date.now()): number | null {
      let s = states.get(userId)
      if (!s) {
        s = { hits: [], until: 0, strikes: 0, lastStrike: 0 }
        states.set(userId, s)
      }
      if (now < s.until) return s.until - now
      s.hits = s.hits.filter((t) => now - t < rule.windowMs)
      if (s.hits.length >= rule.max) {
        s.strikes = now - s.lastStrike < rule.forgiveMs ? s.strikes + 1 : 1
        s.lastStrike = now
        const pause = rule.cooldowns[Math.min(s.strikes, rule.cooldowns.length) - 1]
        s.until = now + pause
        s.hits = []
        return pause
      }
      s.hits.push(now)
      return null
    },
  }
}

/** Ответ клиенту «притормози»: он покажет предупреждение с обратным отсчётом */
export const slowDown = (retryAfter: number, error = 'Воу, полегче — подожди пару секунд') => ({ error, code: 'slow_down' as const, retryAfter })
