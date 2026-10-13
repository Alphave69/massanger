import { create } from 'zustand'

/**
 * «Воу, полегче»: сервер не пускает сообщения, если строчить слишком быстро,
 * и отвечает, сколько ждать (retryAfter). Здесь — общая на все каналы пауза:
 * до её конца поле ввода не отправляет, а над ним висит шуточное предупреждение с отсчётом.
 */

const LINES = [
  'Воу-воу, полегче, амиго 🤠',
  'Клавиатура дымится — дай ей остыть',
  'Ты печатаешь быстрее, чем мы читаем',
  'Тпру-у, лошадка! Пара секунд передышки 🐎',
  'Сообщения не успевают долететь — подожди чуть-чуть',
  'Спокойствие, только спокойствие 🧘',
  'Даже у спидраннеров есть кулдаун',
  'Сервер просит минутку… ну ладно, пару секунд',
]

interface SlowState {
  /** До какого момента нельзя отправлять (0 — можно) */
  until: number
  /** Шутка для этого раза */
  line: string
  /** Предупреждение закрыли крестиком — пауза всё равно идёт */
  dismissed: boolean
  /** Растёт при каждой попытке отправить во время паузы — поле ввода слегка вздрагивает */
  nudge: number
}

export const useSlow = create<SlowState>(() => ({ until: 0, line: LINES[0], dismissed: false, nudge: 0 }))

/** Сервер сказал «притормози» на retryAfter миллисекунд */
export function slowDown(retryAfter: number) {
  const st = useSlow.getState()
  const until = Date.now() + Math.max(500, Math.min(retryAfter, 15_000))
  // пауза ещё идёт (повторный отказ) — шутку не меняем и закрытое не открываем
  if (st.until > Date.now()) {
    useSlow.setState({ until: Math.max(st.until, until), nudge: st.nudge + 1 })
    return
  }
  const rest = LINES.filter((l) => l !== st.line)
  useSlow.setState({ until, line: rest[Math.floor(Math.random() * rest.length)], dismissed: false })
}

/** Сколько ещё ждать (мс); 0 — можно писать */
export const slowLeft = () => Math.max(0, useSlow.getState().until - Date.now())

/** Попытка отправить во время паузы: не шлём, только «вздрагиваем» */
export function nudgeSlow() {
  useSlow.setState((s) => ({ nudge: s.nudge + 1 }))
}

export function dismissSlow() {
  useSlow.setState({ dismissed: true })
}
