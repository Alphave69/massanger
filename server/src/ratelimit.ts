/**
 * Ограничитель частоты: не больше max событий по ключу за окно windowMs (скользящее окно).
 * Всё в памяти — после перезапуска сервера счётчики обнуляются, для наших масштабов этого хватает.
 * Старые отметки чистим сами, чтобы карта не росла бесконечно.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {
    setInterval(() => this.sweep(), windowMs).unref()
  }

  /** Сколько миллисекунд ждать до следующей попытки; 0 — можно. Попытку не засчитывает */
  retryAfter(key: string): number {
    const list = this.fresh(key)
    return list.length >= this.max ? Math.max(1, list[0] + this.windowMs - Date.now()) : 0
  }

  /** Засчитать событие */
  hit(key: string) {
    const list = this.fresh(key)
    list.push(Date.now())
    this.hits.set(key, list)
  }

  /** Забыть ключ (например, после удачного входа) */
  reset(key: string) {
    this.hits.delete(key)
  }

  private fresh(key: string): number[] {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (list.length) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  private sweep() {
    for (const key of [...this.hits.keys()]) this.fresh(key)
  }
}

/** «через 3 мин» / «через 40 с» — для текста ошибки */
export function waitText(ms: number) {
  const s = Math.ceil(ms / 1000)
  return s >= 60 ? `через ${Math.ceil(s / 60)} мин` : `через ${s} с`
}
