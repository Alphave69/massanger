/**
 * Ссылки и код в тексте сообщения.
 * Ссылкой становится только http(s): «https://…», «www.…» и голые домены вроде nuntius.site/x
 * (с известной доменной зоной — чтобы «file.txt» и «т.е.» не светились). Никаких javascript:/data:.
 * Внутри `кода` и ```блоков кода``` ни ссылок, ни упоминаний нет — там всё как написано.
 */

export type RichPart =
  | { kind: 'text'; text: string }
  /** text — как в сообщении, label — что показать (домен-«двойник» — в виде xn--…) */
  | { kind: 'link'; href: string; text: string; label: string }
  /** raw — как было в тексте (с обратными кавычками), text — что показать */
  | { kind: 'code'; text: string; raw: string; block: boolean }

/** ```блок``` или `код в строке` — так же режет сервер (server/src/mentions.ts) */
export const CODE_RE = /```([\s\S]*?)```|`([^`\n]+)`/g

/** Доменные зоны, которые узнаём без «https://» (остальные — только с ним или с «www.») */
const ZONES = new Set(
  (
    'com net org ru su рф ua by kz uz am ge io me dev app gg tv co uk de fr it es nl pl cz eu us ca info xyz online site ' +
    'store shop tech ai ly fm to pro link club space live cloud games art page blog news wiki team chat be gl cc jp cn kr ' +
    'edu gov moscow tk ws lt lv ee fi se no ch at gr tr il bg ro hu sk rs hr si'
  ).split(' '),
)

/** Символы, которыми ссылка не может заканчиваться (точка в конце предложения, скобка, кавычка…) */
const TRAILING = /[.,;:!?…»”’"'*~]$/
const URL_CHARS = String.raw`[^\s<>"'\u0060«»“”]`
const LINK_RE = new RegExp(
  String.raw`(https?:\/\/${URL_CHARS}+)|((?:www\.)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(\p{L}{2,24})(?::\d{2,5})?(?:[/?#]${URL_CHARS}*)?)`,
  'giu',
)
/** Перед голым доменом не должно быть буквы, «@» (это почта), точки, слэша… */
const GLUED_BEFORE = /[\p{L}\p{N}_@.\-/:]/u
const LETTER = /[\p{L}\p{N}]/u

const count = (s: string, ch: string) => s.split(ch).length - 1

/** Отрезать хвост, который к ссылке не относится: «.», «)», если скобка не открывалась внутри, и т.п. */
function trimTail(url: string): string {
  for (;;) {
    if (TRAILING.test(url)) {
      url = url.slice(0, -1)
      continue
    }
    const last = url[url.length - 1]
    const pair = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : ''
    if (pair && count(url, pair) < count(url, last)) {
      url = url.slice(0, -1)
      continue
    }
    return url
  }
}

/**
 * Ссылка безопасна: только http/https и с настоящим адресом. С «логином» в адресе (https://nuntius.site@evil.org) —
 * не ссылка: на вид ведёт на один сайт, а открывает другой
 */
function safeHref(href: string): string | null {
  try {
    const u = new URL(href)
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null
    return u.href
  } catch {
    return null
  }
}

/** Где в тексте ссылки хост (с портом): после «схема://» и до / ? # */
function hostSpan(text: string): [number, number] {
  const start = /^[a-z][a-z\d+.-]*:\/\//i.exec(text)?.[0].length ?? 0
  const end = text.slice(start).search(/[/?#]/)
  return [start, end < 0 ? text.length : start + end]
}

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u]
/** Кириллица, которая выглядит как латиница */
const LOOKALIKE = /^[аеорсухіјѕһԁӏԛԝ\d-]+$/u

/**
 * Домен-«двойник»: в одной части смешаны алфавиты (аpple.com с русской «а») или она целиком из «латинских» русских
 * букв при латинской зоне (асе.com). Обычные русские домены (пример.рф, яндекс.рус) показываем как есть
 */
function deceptiveHost(host: string) {
  const labels = host.toLowerCase().split('.')
  const latinZone = /^[a-z]+$/.test(labels[labels.length - 1] ?? '')
  return labels.some((l) => /[^\x00-\x7f]/.test(l) && (SCRIPTS.filter((re) => re.test(l)).length > 1 || (latinZone && LOOKALIKE.test(l))))
}

/** Что показать вместо ссылки: домен-«двойник» — в настоящем виде (xn--…), остальное — как написано */
function linkLabel(text: string, href: string) {
  const [from, to] = hostSpan(text)
  if (!deceptiveHost(text.slice(from, to))) return text
  return text.slice(0, from) + new URL(href).host + text.slice(to)
}

/** Найти ссылки в обычном тексте (без кода) */
export function splitLinks(text: string): RichPart[] {
  if (!text.includes('.') && !/https?:/i.test(text)) return [{ kind: 'text', text }]
  const out: RichPart[] = []
  let last = 0
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0
    const before = at > 0 ? text[at - 1] : ''
    let raw: string
    let href: string | null
    if (m[1]) {
      // https://… — слово не должно начинаться посреди другого («xhttps://»)
      if (before && LETTER.test(before)) continue
      raw = trimTail(m[1])
      if (!/^https?:\/\/[\p{L}\p{N}\[]/iu.test(raw)) continue
      href = safeHref(raw)
    } else {
      if (before && GLUED_BEFORE.test(before)) continue
      const isWww = /^www\./i.test(m[2])
      if (!isWww && !ZONES.has(m[3].toLowerCase())) continue
      raw = trimTail(m[2])
      // после обрезки хвоста зона должна остаться целой
      if (!/\.\p{L}{2,24}(?::\d{2,5})?(?:[/?#].*)?$/u.test(raw)) continue
      href = safeHref(`https://${raw}`)
    }
    if (!href || !raw) continue
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    out.push({ kind: 'link', href, text: raw, label: linkLabel(raw, href) })
    last = at + raw.length
  }
  if (!out.length) return [{ kind: 'text', text }]
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** Код: у блока убираем первую строку-язык («```js») и крайние переводы строк */
function codePart(raw: string, block?: string, inline?: string): RichPart {
  if (inline !== undefined) return { kind: 'code', text: inline, raw, block: false }
  let body = block ?? ''
  const lang = /^[\w+#.-]{1,20}\n/.exec(body)
  if (lang) body = body.slice(lang[0].length)
  body = body.replace(/^\n/, '').replace(/\n$/, '')
  return { kind: 'code', text: body, raw, block: true }
}

/** Разрезать текст на код и всё остальное (ссылки не ищем) */
export function splitCode(content: string): RichPart[] {
  if (!content.includes('`')) return [{ kind: 'text', text: content }]
  const out: RichPart[] = []
  let last = 0
  for (const m of content.matchAll(CODE_RE)) {
    const at = m.index ?? 0
    // пустой блок «``````» — просто текст
    if (m[1] !== undefined && !m[1].trim()) continue
    if (at > last) out.push({ kind: 'text', text: content.slice(last, at) })
    out.push(codePart(m[0], m[1], m[2]))
    last = at + m[0].length
  }
  if (last < content.length) out.push({ kind: 'text', text: content.slice(last) })
  return out
}

/** Текст сообщения → код, ссылки и обычный текст (в нём потом ищут упоминания) */
export function richParts(content: string): RichPart[] {
  return splitCode(content).flatMap((p) => (p.kind === 'text' ? splitLinks(p.text) : [p]))
}

/** Как текст выглядел в исходнике — чтобы собрать его обратно */
export const rawOf = (p: RichPart) => (p.kind === 'code' ? p.raw : p.text)

/** Длинную ссылку показываем короче: начало…конец (целиком — в подсказке). Сайт (хост) не режем никогда */
export function shortLink(text: string, max = 64): string {
  if (text.length <= max) return text
  const tail = 16
  const [, hostEnd] = hostSpan(text)
  const keep = Math.max(hostEnd + 1, max - tail - 1)
  if (keep + tail + 1 >= text.length) return text
  return `${text.slice(0, keep)}…${text.slice(-tail)}`
}
