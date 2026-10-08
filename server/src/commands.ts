import type { MessageFlavor } from './store.js'

/**
 * Команды в чате: /roll, /flip, /8ball, /me и смайлики-приколы.
 * null — это не команда (или неизвестная): сообщение уходит как есть.
 */
export type CommandResult = { content: string; flavor?: MessageFlavor } | { error: string } | null

const BALL = [
  'Бесспорно',
  'Предрешено',
  'Никаких сомнений',
  'Определённо да',
  'Можешь быть уверен(а) в этом',
  'Мне кажется — да',
  'Вероятнее всего',
  'Хорошие перспективы',
  'Знаки говорят — да',
  'Да',
  'Пока не ясно, попробуй снова',
  'Спроси позже',
  'Лучше не рассказывать',
  'Сейчас нельзя предсказать',
  'Сконцентрируйся и спроси опять',
  'Даже не думай',
  'Мой ответ — нет',
  'По моим данным — нет',
  'Перспективы не очень хорошие',
  'Весьма сомнительно',
]

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]
const rand = (max: number) => 1 + Math.floor(Math.random() * max)

/** /roll, /roll 20, /roll 2d6 */
function roll(arg: string): CommandResult {
  let count = 1
  let sides = 6
  const dice = /^(\d{1,2})?d(\d{1,4})$/i.exec(arg)
  if (dice) {
    count = dice[1] ? Number(dice[1]) : 1
    sides = Number(dice[2])
  } else if (/^\d{1,4}$/.test(arg)) {
    sides = Number(arg)
  } else if (arg) {
    return { error: 'Так: /roll, /roll 20 или /roll 2d6' }
  }
  if (count < 1 || count > 10) return { error: 'Кубиков — от 1 до 10' }
  if (sides < 2 || sides > 1000) return { error: 'Граней — от 2 до 1000' }
  const values = Array.from({ length: count }, () => rand(sides))
  const sum = values.reduce((a, b) => a + b, 0)
  const label = count === 1 ? `d${sides}` : `${count}d${sides}`
  const result = count === 1 ? String(sum) : `${values.join(' + ')} = ${sum}`
  return { content: `🎲 бросает ${label} — выпало ${result}`, flavor: 'roll' }
}

export function runCommand(text: string): CommandResult {
  const m = /^\/([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const name = m[1].toLowerCase()
  const arg = (m[2] ?? '').trim()
  const tail = (s: string) => (arg ? `${arg} ${s}` : s)
  switch (name) {
    case 'roll':
      return roll(arg)
    case 'flip':
      return { content: `🪙 подбрасывает монетку — ${pick(['орёл', 'решка'])}`, flavor: 'flip' }
    case '8ball':
      if (!arg) return { error: '🎱 Задай вопрос: /8ball будет ли завтра солнце?' }
      return { content: `🎱 «${arg.slice(0, 300)}» — ${pick(BALL)}`, flavor: 'ball' }
    case 'me':
      if (!arg) return { error: 'Напиши действие: /me машет рукой' }
      return { content: arg, flavor: 'me' }
    case 'shrug':
      return { content: tail('¯\\_(ツ)_/¯') }
    case 'tableflip':
      return { content: tail('(╯°□°)╯︵ ┻━┻') }
    case 'unflip':
      return { content: tail('┬─┬ ノ( ゜-゜ノ)') }
    case 'lenny':
      return { content: tail('( ͡° ͜ʖ ͡°)') }
    default:
      return null
  }
}
