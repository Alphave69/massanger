import { RotateCcw } from 'lucide-react'
import { resetSettings, setSetting, useSettings } from '../../lib/settings'
import { useChat } from '../../lib/store'
import { Avatar } from '../Avatar'
import { Group, SectionHead, Slider, Toggle } from './controls'

const APPEARANCE_KEYS = ['uiScale', 'chatFontSize', 'compact', 'sphere', 'sphereBrightness', 'cursorGlow', 'reduceMotion'] as const

export function AppearanceSection() {
  const s = useSettings()
  const me = useChat((st) => st.me!)
  const friend = { id: 'preview-friend', displayName: 'Друг' }

  return (
    <>
      <SectionHead title="Внешний вид" subtitle="Масштаб, размер текста и эффекты — под твой экран и вкус." />

      <div className="appearance-preview glow">
        <div className="mgroup">
          <span className="mgroup__avatar">
            <Avatar user={friend} size={38} />
          </span>
          <div className="mgroup__body">
            <div className="mgroup__meta">
              <span className="mgroup__author">Друг</span>
              <time>Сегодня в 21:04</time>
            </div>
            <div className="bubble">
              <span className="bubble__text">Ну как тебе такой размер?</span>
              <time className="bubble__time">21:04</time>
            </div>
            <div className="bubble">
              <span className="bubble__text">Если мелко — подвинь ползунок 👇</span>
              <time className="bubble__time">21:04</time>
            </div>
          </div>
        </div>
        <div className="mgroup mgroup--mine">
          <div className="mgroup__body">
            <div className="bubble">
              <span className="bubble__text">Идеально ✦</span>
              <time className="bubble__time">21:05</time>
            </div>
          </div>
        </div>
        <span className="appearance-preview__me">
          <Avatar user={me} size={22} /> так видят твои сообщения
        </span>
      </div>

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
        <Toggle label="Компактные сообщения" hint="Меньше отступов — больше сообщений на экране" checked={s.compact} onChange={(v) => setSetting('compact', v)} />
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
        <Toggle label="Подсветка за курсором" hint="Рамки панелей и точки фона загораются рядом с мышью" checked={s.cursorGlow} onChange={(v) => setSetting('cursorGlow', v)} />
        <Toggle label="Меньше анимаций" hint="Убирает почти всё движение интерфейса — спокойнее и легче для слабых компьютеров" checked={s.reduceMotion} onChange={(v) => setSetting('reduceMotion', v)} />
      </Group>

      <button className="btn btn--ghost" onClick={() => resetSettings([...APPEARANCE_KEYS])}>
        <RotateCcw size={16} /> Вернуть как было
      </button>
    </>
  )
}
