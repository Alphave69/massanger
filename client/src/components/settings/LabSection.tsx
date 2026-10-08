import { FlaskConical, PartyPopper, Power } from 'lucide-react'
import { findEgg, party } from '../../lib/eggs'
import { resetSettings, setSetting, useSettings } from '../../lib/settings'
import { chat, useChat } from '../../lib/store'
import { ui } from '../../lib/ui'
import { Group, Row, SectionHead, Toggle } from './controls'

const LAB_KEYS = ['labNegative', 'labMirror', 'labRetro'] as const

/** «Лаборатория» — открывается пасхалкой «Разработчик» (7 кликов по версии) */
export function LabSection() {
  const s = useSettings()
  const me = useChat((st) => st.me!)
  const eggs = me.eggs?.length ?? 0

  const leave = () => {
    resetSettings([...LAB_KEYS])
    setSetting('devMode', false)
    ui.openSettings('account')
    chat.toast({ title: 'Режим разработчика выключен', text: 'Лаборатория закрыта до следующего раза' })
  }

  return (
    <>
      <SectionHead title="Лаборатория" subtitle="Экспериментальные режимы для тех, кто нашёл дверь. Ничего не ломают — выключаются здесь же." />

      <div className="lab-hero glow">
        <span className="lab-hero__icon">
          <FlaskConical size={26} />
        </span>
        <span className="lab-hero__text">
          <b>Ты разработчик ✦</b>
          <span>
            Пасхалок найдено: {eggs}
            {me.eggTotal ? ` из ${me.eggTotal}` : ''}. Остальные где-то рядом.
          </span>
        </span>
      </div>

      <Group title="Визуальные режимы">
        <Toggle
          label="Негатив"
          hint="Чёрное становится белым, белое — чёрным. Фото и видео остаются как есть"
          checked={s.labNegative}
          onChange={(v) => setSetting('labNegative', v)}
        />
        <Toggle
          label="Зазеркалье"
          hint="Весь интерфейс отражается слева направо. Читать — на свой страх и риск"
          checked={s.labMirror}
          onChange={(v) => {
            setSetting('labMirror', v)
            if (v) findEgg('mirror')
          }}
        />
        <Toggle
          label="Ретро-терминал"
          hint="Зелёный фосфор, моноширинный шрифт и строки развёртки — как в 1982-м"
          checked={s.labRetro}
          onChange={(v) => setSetting('labRetro', v)}
        />
        {(s.labNegative || s.labMirror || s.labRetro) && (
          <div className="set-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => resetSettings([...LAB_KEYS])}>
              Вернуть как было
            </button>
          </div>
        )}
      </Group>

      <Group title="Игрушки">
        <Row label="Вечеринка" value="Конфетти из точек на шесть секунд. Без повода.">
          <button className="btn btn--outline btn--sm" onClick={party}>
            <PartyPopper size={15} /> Устроить
          </button>
        </Row>
        <Row label="Мой id" value={<code className="lab-code">{me.id}</code>} />
        <Row label="Номер в Nuntius" value={me.number ? `№ ${me.number}` : '—'} />
      </Group>

      <Group title="Режим разработчика" danger>
        <p className="muted">Лаборатория спрячется, все режимы выключатся. Вернуть — снова семь кликов по версии внизу слева.</p>
        <div className="set-actions">
          <button className="btn btn--outline btn--sm" onClick={leave}>
            <Power size={15} /> Выключить режим разработчика
          </button>
        </div>
      </Group>
    </>
  )
}
