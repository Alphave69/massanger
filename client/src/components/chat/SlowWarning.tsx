import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { dismissSlow, useSlow } from '../../lib/antispam'

/** Сколько секунд осталось до конца паузы анти-спама (перерисовывается сам) */
export function useSlowLeft(): number {
  const until = useSlow((s) => s.until)
  const [, tick] = useState(0)
  useEffect(() => {
    if (until <= Date.now()) return
    const timer = window.setInterval(() => {
      tick((n) => n + 1)
      if (Date.now() >= until) window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [until])
  return Math.max(0, until - Date.now())
}

/**
 * «Воу-воу, полегче» над полем ввода: шутка, обратный отсчёт и крестик.
 * Крестик прячет плашку, но пауза всё равно идёт — отправить раньше не выйдет.
 */
export function SlowWarning({ left }: { left: number }) {
  const line = useSlow((s) => s.line)
  const dismissed = useSlow((s) => s.dismissed)
  const until = useSlow((s) => s.until)
  // колечко вокруг цифры тает за всю паузу (продлили паузу — начинается заново)
  const ringMs = useMemo(() => Math.max(0, until - Date.now()), [until])
  if (left <= 0 || dismissed) return null
  const secs = Math.ceil(left / 1000)
  return (
    <div className="slow-warn" role="status">
      <span className="slow-warn__count" aria-hidden="true">
        <svg className="slow-warn__ring" viewBox="0 0 36 36">
          <circle key={until} cx="18" cy="18" r="16" pathLength={100} style={{ animationDuration: `${ringMs}ms` }} />
        </svg>
        {secs}
      </span>
      <span className="slow-warn__text">
        <b>{line}</b>
        <span>Писать можно снова через {secs} с</span>
      </span>
      <button type="button" className="slow-warn__close" onClick={dismissSlow} aria-label="Закрыть предупреждение" data-tip="Закрыть">
        <X size={15} />
      </button>
    </div>
  )
}
