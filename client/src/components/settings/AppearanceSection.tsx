import type { CSSProperties, ReactNode } from 'react'
import { Check, Pipette, RotateCcw } from 'lucide-react'
import { formatTime } from '../../lib/format'
import { resetSettings, setSetting, useSettings, type Settings } from '../../lib/settings'
import { useChat } from '../../lib/store'
import { ACCENTS, THEMES, themeInfo } from '../../lib/themes'
import { Avatar } from '../Avatar'
import { Group, SectionHead, Slider, Toggle } from './controls'

const APPEARANCE_KEYS = [
  'uiScale',
  'chatFontSize',
  'compact',
  'sphere',
  'sphereBrightness',
  'cursorGlow',
  'reduceMotion',
  'theme',
  'accent',
  'font',
  'radius',
  'avatarShape',
  'msgSpacing',
  'glowLevel',
  'panelOpacity',
  'panelBlur',
  'clock24',
  'clockSeconds',
] as const

// Время в превью — всегда «вечер», чтобы было видно разницу 21:04 / 9:04 PM
const PREVIEW_AT = new Date(2026, 0, 1, 21, 4, 37).getTime()
const PREVIEW_AT_2 = PREVIEW_AT + 61_000

const FONT_OPTIONS: { value: Settings['font']; label: string; family: string }[] = [
  { value: 'theme', label: 'Как в теме', family: '' },
  { value: 'inter', label: 'Inter', family: "'Inter', sans-serif" },
  { value: 'system', label: 'Системный', family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { value: 'mono', label: 'Моноширинный', family: 'var(--mono)' },
]

const RADIUS_OPTIONS: { value: Settings['radius']; label: string; k: number }[] = [
  { value: 'sharp', label: 'Острые', k: 0.35 },
  { value: 'normal', label: 'Обычные', k: 1 },
  { value: 'round', label: 'Круглые', k: 1.5 },
]

export function AppearanceSection() {
  const s = useSettings()
  const me = useChat((st) => st.me!)
  const friend = { id: 'preview-friend', displayName: 'Друг' }
  const theme = themeInfo(s.theme)
  const customAccent = s.accent !== '' && !ACCENTS.some((a) => a.value === s.accent)

  return (
    <>
      <SectionHead title="Внешний вид" subtitle="Тема, цвета, шрифт и масштаб — под твой экран и вкус. Всё меняется сразу." />

      <div className="appearance-preview glow">
        <div className="look-preview">
          <div className="look-preview__side" aria-hidden="true">
            <span className="look-preview__chan is-active"># общий</span>
            <span className="look-preview__chan has-unread">
              # мемы <i />
            </span>
            <span className="look-preview__chan"># музыка</span>
          </div>
          <div className="look-preview__chat">
            <div className="mgroup">
              <span className="mgroup__avatar">
                <Avatar user={friend} size={38} />
              </span>
              <div className="mgroup__body">
                <div className="mgroup__meta">
                  <span className="mgroup__author">Друг</span>
                  <time>Сегодня в {formatTime(PREVIEW_AT)}</time>
                </div>
                <div className="bubble">
                  <span className="bubble__text">Ну как тебе такая тема?</span>
                  <time className="bubble__time">{formatTime(PREVIEW_AT)}</time>
                </div>
                <div className="bubble">
                  <span className="bubble__text">Если мелко — подвинь ползунок 👇</span>
                  <time className="bubble__time">{formatTime(PREVIEW_AT)}</time>
                </div>
              </div>
            </div>
            <div className="mgroup mgroup--mine">
              <div className="mgroup__body">
                <div className="bubble">
                  <span className="bubble__text">Идеально ✦</span>
                  <time className="bubble__time">{formatTime(PREVIEW_AT_2)}</time>
                </div>
              </div>
            </div>
          </div>
        </div>
        <span className="appearance-preview__me">
          <Avatar user={me} size={22} /> так видят твои сообщения
        </span>
      </div>

      <Group title="Тема">
        <div className="theme-grid" role="radiogroup" aria-label="Тема">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={s.theme === t.id}
              className={`theme-card${s.theme === t.id ? ' is-active' : ''}`}
              onClick={() => setSetting('theme', t.id)}
            >
              <span className="theme-card__mock theme-scope" data-theme={t.id} data-tone={t.tone} aria-hidden="true">
                <span className="theme-card__side">
                  <i className="is-active" />
                  <i />
                  <i />
                </span>
                <span className="theme-card__chat">
                  <i />
                  <i className="is-mine" />
                  <i />
                </span>
                <span className="theme-card__dots" />
              </span>
              <span className="theme-card__name">
                {t.name}
                {s.theme === t.id && <Check size={14} />}
              </span>
              <span className="theme-card__hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Акцент">
        <p className="muted look-note">Цвет активного: выбранный канал, свои сообщения, кнопки, бейджи, переключатели и рамка фокуса.</p>
        <div className="accent-row" role="radiogroup" aria-label="Цвет акцента">
          <AccentSwatch label="Как в теме" active={s.accent === ''} onClick={() => setSetting('accent', '')}>
            <span className="accent-swatch__theme theme-scope" data-theme={theme.id} data-tone={theme.tone}>
              {s.accent === '' && <Check size={15} />}
            </span>
          </AccentSwatch>
          {ACCENTS.map((a) => (
            <AccentSwatch
              key={a.value}
              label={a.name}
              active={s.accent === a.value}
              color={a.value}
              onClick={() => setSetting('accent', a.value)}
            />
          ))}
          <label
            className={`accent-swatch accent-swatch--custom${customAccent ? ' is-active' : ''}`}
            data-tip="Свой цвет"
            style={customAccent ? ({ '--sw': s.accent } as CSSProperties) : undefined}
          >
            {customAccent ? <Check size={15} /> : <Pipette size={15} />}
            <input
              type="color"
              aria-label="Свой цвет акцента"
              value={s.accent || '#22d3ee'}
              onChange={(e) => setSetting('accent', e.target.value.toLowerCase())}
            />
          </label>
        </div>
      </Group>

      <Group title="Шрифт и форма">
        <span className="look-label">Шрифт интерфейса</span>
        <Segmented
          label="Шрифт интерфейса"
          value={s.font}
          onChange={(v) => setSetting('font', v)}
          options={FONT_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            sample: (
              <span className="look-seg__font" style={{ fontFamily: o.family || (s.theme === 'retro' ? 'var(--mono)' : "'Inter', sans-serif") }}>
                Аа
              </span>
            ),
          }))}
        />

        <span className="look-label">Скругления</span>
        <Segmented
          label="Скругления"
          value={s.radius}
          onChange={(v) => setSetting('radius', v)}
          options={RADIUS_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            sample: <span className="look-seg__corner" style={{ borderRadius: `${Math.round(10 * o.k)}px` }} />,
          }))}
        />

        <span className="look-label">Аватарки</span>
        <Segmented
          label="Форма аватарок"
          value={s.avatarShape}
          onChange={(v) => setSetting('avatarShape', v)}
          options={[
            { value: 'circle', label: 'Круг', sample: <AvatarSample user={me} r="50%" /> },
            { value: 'squircle', label: 'Скруглённый квадрат', sample: <AvatarSample user={me} r="30%" /> },
          ]}
        />
      </Group>

      <Group title="Масштаб">
        <Slider
          label="Масштаб интерфейса"
          hint="Всё приложение целиком: панели, кнопки, текст. Применяется, когда отпускаешь ползунок."
          value={Math.round(s.uiScale * 100)}
          min={80}
          max={130}
          step={5}
          marks={[80, 90, 100, 110, 120, 130]}
          format={(v) => `${v}%`}
          commitOnRelease
          onChange={(v) => setSetting('uiScale', v / 100)}
        />
        <Slider
          label="Размер текста в чате"
          value={s.chatFontSize}
          min={12}
          max={20}
          marks={[12, 14, 15, 16, 18, 20]}
          format={(v) => `${v}px`}
          onChange={(v) => setSetting('chatFontSize', v)}
        />
        <Slider
          label="Расстояние между сообщениями"
          value={Math.round(s.msgSpacing * 100)}
          min={50}
          max={200}
          step={25}
          marks={[50, 100, 150, 200]}
          format={(v) => `${v}%`}
          onChange={(v) => setSetting('msgSpacing', v / 100)}
        />
        <Toggle label="Компактные сообщения" hint="Меньше отступов — больше сообщений на экране" checked={s.compact} onChange={(v) => setSetting('compact', v)} />
      </Group>

      <Group title="Время">
        <Toggle
          label="24-часовой формат"
          hint={`Сейчас так: ${formatTime(PREVIEW_AT)}`}
          checked={s.clock24}
          onChange={(v) => setSetting('clock24', v)}
        />
        <Toggle label="Показывать секунды" hint="У времени сообщений — для самых точных" checked={s.clockSeconds} onChange={(v) => setSetting('clockSeconds', v)} />
      </Group>

      <Group title="Фон и эффекты">
        <Toggle label="Сфера на фоне" hint="Та самая, с экрана входа. Выключи, если ноутбук греется" checked={s.sphere} onChange={(v) => setSetting('sphere', v)} />
        <Slider
          label="Яркость сферы"
          value={Math.round(s.sphereBrightness * 100)}
          min={10}
          max={100}
          step={5}
          disabled={!s.sphere}
          format={(v) => `${v}%`}
          onChange={(v) => setSetting('sphereBrightness', v / 100)}
        />
        <Slider
          label="Сила свечения"
          hint="Ореолы у кнопок, бейджей и активного. 0 — совсем без свечения"
          value={Math.round(s.glowLevel * 100)}
          min={0}
          max={150}
          step={10}
          marks={[0, 50, 100, 150]}
          format={(v) => `${v}%`}
          onChange={(v) => setSetting('glowLevel', v / 100)}
        />
        <Slider
          label="Плотность панелей"
          hint="Меньше — панели прозрачнее, сквозь них видно сферу и фон"
          value={Math.round(s.panelOpacity * 100)}
          min={20}
          max={100}
          step={5}
          marks={[20, 40, 60, 80, 100]}
          format={(v) => `${v}%`}
          onChange={(v) => setSetting('panelOpacity', v / 100)}
        />
        <Slider
          label="Размытие под панелями"
          value={s.panelBlur}
          min={0}
          max={24}
          step={1}
          marks={[0, 2, 8, 16, 24]}
          format={(v) => `${v}px`}
          onChange={(v) => setSetting('panelBlur', v)}
        />
        <Toggle label="Подсветка за курсором" hint="Рамки панелей и точки фона загораются рядом с мышью" checked={s.cursorGlow} onChange={(v) => setSetting('cursorGlow', v)} />
        <Toggle label="Меньше анимаций" hint="Убирает почти всё движение интерфейса — спокойнее и легче для слабых компьютеров" checked={s.reduceMotion} onChange={(v) => setSetting('reduceMotion', v)} />
      </Group>

      <button className="btn btn--ghost look-reset" onClick={() => resetSettings([...APPEARANCE_KEYS])}>
        <RotateCcw size={16} /> Сбросить внешний вид
      </button>
    </>
  )
}

function AccentSwatch({ label, active, color, onClick, children }: { label: string; active: boolean; color?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      data-tip={label}
      className={`accent-swatch${active ? ' is-active' : ''}`}
      style={color ? ({ '--sw': color } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children ?? (active && <Check size={15} />)}
    </button>
  )
}

interface SegOption<T extends string> {
  value: T
  label: string
  sample: ReactNode
}

/** Выбор из нескольких вариантов с картинкой-образцом */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="look-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`look-seg__item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className="look-seg__sample">{o.sample}</span>
          <span className="look-seg__label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function AvatarSample({ user, r }: { user: { id: string; displayName: string }; r: string }) {
  return (
    <span className="look-seg__avatar" style={{ '--avatar-r': r } as CSSProperties}>
      <Avatar user={user} size={30} />
    </span>
  )
}
