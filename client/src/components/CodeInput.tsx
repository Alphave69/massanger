import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Вызывается, как только введены все 6 цифр */
  onComplete?: (value: string) => void
  autoFocus?: boolean
  disabled?: boolean
}

/** Шесть клеток для кода из письма. Внутри — одно невидимое поле: работают вставка и автоподстановка кода из SMS/почты */
export function CodeInput({ value, onChange, onComplete, autoFocus, disabled }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={`code-input${disabled ? ' is-disabled' : ''}`} onClick={() => ref.current?.focus()}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`code-input__cell${i < value.length ? ' is-filled' : ''}${i === Math.min(value.length, 5) ? ' is-active' : ''}`}>
          {value[i] ?? ''}
        </span>
      ))}
      <input
        ref={ref}
        className="code-input__field"
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Код из письма"
        maxLength={12}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
          onChange(v)
          if (v.length === 6) onComplete?.(v)
        }}
      />
    </div>
  )
}

/** Обратный отсчёт до повторной отправки кода */
export function useCountdown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [left])
  return [left, setLeft] as const
}
