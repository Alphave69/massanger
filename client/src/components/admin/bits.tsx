import { useEffect, useRef, useState } from 'react'
import { ApiError, type AdminUser, type Presence } from '../../lib/api'
import { calmMotion } from '../../lib/badges'

export const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

const numFmt = new Intl.NumberFormat('ru-RU')
export const fmtNum = (n: number) => numFmt.format(n)

export const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

/** Как человек выглядит для админа: невидимку показываем «не в сети» на аватаре, но подписываем */
export function presenceOfAdmin(u: AdminUser): Presence {
  if (!u.online || u.status === 'invisible') return 'offline'
  return u.status
}

/** Число «набегает» от прошлого значения к новому (при «меньше анимаций» — сразу) */
export function useCountUp(value: number, ms = 900) {
  const [shown, setShown] = useState(() => (calmMotion() ? value : 0))
  const from = useRef(shown)

  useEffect(() => {
    if (calmMotion()) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = Math.round(a + (value - a) * eased)
      from.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])

  return shown
}

/** Число с «набеганием» */
export function CountUp({ value }: { value: number }) {
  return <>{fmtNum(useCountUp(value))}</>
}
