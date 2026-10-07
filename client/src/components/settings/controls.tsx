import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

/** Заголовок раздела настроек */
export function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="set-head">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </header>
  )
}

/** Группа настроек с подписью */
export function Group({ title, children, danger }: { title?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={`set-group${danger ? ' set-group--danger' : ''}`}>
      {title && <h3 className="set-group__title">{title}</h3>}
      {children}
    </section>
  )
}

/** Строка «подпись — значение — действие» (как в «Моём аккаунте») */
export function Row({ label, value, children }: { label: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <span className="set-row__label">{label}</span>
        {value !== undefined && <span className="set-row__value">{value}</span>}
      </div>
      {children && <div className="set-row__action">{children}</div>}
    </div>
  )
}

interface ToggleProps {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}

/** Строка с переключателем — кликается целиком */
export function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  const flip = () => !disabled && onChange(!checked)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      flip()
    }
  }
  return (
    <div className={`toggle-row${disabled ? ' is-disabled' : ''}`} onClick={flip}>
      <span className="toggle-row__text">
        <span className="toggle-row__label">{label}</span>
        {hint && <span className="toggle-row__hint">{hint}</span>}
      </span>
      <span
        className={`switch${checked ? ' is-on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKey}
      >
        <span className="switch__knob" />
      </span>
    </div>
  )
}

interface SliderProps {
  label?: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  format?: (v: number) => string
  onChange: (v: number) => void
  /** Применять только когда отпустили ползунок (для масштаба: иначе ползунок «убегает» из-под мыши) */
  commitOnRelease?: boolean
  marks?: number[]
}

export function Slider({ label, hint, value, min, max, step = 1, disabled, format = String, onChange, commitOnRelease, marks }: SliderProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const shown = commitOnRelease ? draft : value
  const pct = ((shown - min) / (max - min)) * 100
  const commit = () => commitOnRelease && draft !== value && onChange(draft)

  return (
    <div className={`slider-row${disabled ? ' is-disabled' : ''}`}>
      {label && (
        <div className="slider-row__top">
          <span className="toggle-row__label">{label}</span>
          <output className="slider-row__value">{format(shown)}</output>
        </div>
      )}
      {hint && <span className="toggle-row__hint">{hint}</span>}
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (commitOnRelease) setDraft(v)
          else onChange(v)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {marks && (
        <div className="slider-row__marks">
          {marks.map((m) => (
            <button
              key={m}
              type="button"
              className={m === shown ? 'is-active' : ''}
              style={{ left: `${((m - min) / (max - min)) * 100}%` }}
              disabled={disabled}
              onClick={() => onChange(m)}
            >
              {format(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ChoiceOption<T extends string> {
  value: T
  label: string
  hint?: string
}

/** Выбор одного варианта из нескольких — карточками */
export function Choice<T extends string>({ value, options, onChange }: { value: T; options: ChoiceOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`choice__item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className="choice__dot" />
          <span className="choice__text">
            <span className="choice__label">{o.label}</span>
            {o.hint && <span className="choice__hint">{o.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

interface SelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  onChange: (v: string) => void
}

export function Select({ label, value, options, disabled, onChange }: SelectProps) {
  return (
    <label className="select-field">
      <span className="set-group__title">{label}</span>
      <span className="select">
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  )
}
