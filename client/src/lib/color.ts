/**
 * Цветовая математика для тем: OKLab/OKLCH (там «светлота» честная — одинаковый шаг выглядит одинаково
 * для любого оттенка), контраст по WCAG и подгонка акцента под фон темы.
 */

export type RGB = [number, number, number] // 0…255

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** '#rrggbb' для заведомо правильного hex из кода тем */
export const rgb = (hex: string): RGB => hexToRgb(hex) ?? [0, 0, 0]

export const rgbToHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** «R G B» — так цвета лежат в CSS-переменных: rgb(var(--fg-rgb) / 0.1) */
export const channels = (c: RGB) => c.map((v) => Math.round(v)).join(' ')

const toLin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export type Lab = [number, number, number] // L 0…1, a, b

export function toLab([r, g, b]: RGB): Lab {
  const lr = toLin(r)
  const lg = toLin(g)
  const lb = toLin(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Линейный RGB 0…1 — может выйти за пределы, если цвет вне sRGB */
function labToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (lin: number[]) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** OKLab → sRGB; если цвет не помещается в sRGB — уменьшаем насыщенность, сохраняя светлоту и оттенок */
export function fromLab(lab: Lab): RGB {
  let [L, a, b] = lab
  L = Math.min(1, Math.max(0, L))
  let lin = labToLinear([L, a, b])
  if (!inGamut(lin)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 18; i++) {
      const k = (lo + hi) / 2
      if (inGamut(labToLinear([L, a * k, b * k]))) lo = k
      else hi = k
    }
    lin = labToLinear([L, a * lo, b * lo])
  }
  return lin.map((v) => Math.min(255, Math.max(0, fromLin(Math.min(1, Math.max(0, v)))))) as RGB
}

export const chroma = ([, a, b]: Lab) => Math.hypot(a, b)

/** Смешать два цвета в OKLab: t = 0 — первый, 1 — второй */
export function mix(x: RGB, y: RGB, t: number): RGB {
  const p = toLab(x)
  const q = toLab(y)
  return fromLab([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t])
}

/**
 * Подкрасить цвет в оттенок акцента, не меняя светлоту: поверхности темы остаются такими же
 * светлыми/тёмными (текст на них читается как раньше), только приобретают оттенок.
 * amount 0…1, cap — насыщенность при полной силе.
 */
export function tintToward(base: RGB, accent: RGB, amount: number, cap: number): RGB {
  if (amount <= 0) return base
  const p = toLab(base)
  const q = toLab(accent)
  const c = chroma(q)
  if (c < 0.01) return base // нейтральный акцент (белый, серый) — подкрашивать нечем
  const ta = (q[1] / c) * cap
  const tb = (q[2] / c) * cap
  return fromLab([p[0], p[1] + (ta - p[1]) * amount, p[2] + (tb - p[2]) * amount])
}

export function luminance([r, g, b]: RGB) {
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
}

/** Контраст по WCAG: 1 … 21 */
export function contrast(x: RGB, y: RGB) {
  const a = luminance(x)
  const b = luminance(y)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Чем писать на цветной заливке: чёрным или белым — что контрастнее */
export function inkFor(c: RGB): RGB {
  return contrast(c, [0, 0, 0]) >= contrast(c, [255, 255, 255]) ? [0, 0, 0] : [255, 255, 255]
}

/**
 * Подогнать светлоту цвета, чтобы он читался на всех фонах `against` с контрастом не меньше `min`.
 * На тёмной теме — осветляем, на светлой — затемняем; оттенок сохраняется (насыщенность — сколько влезает).
 * Цвет, который и так читается, не трогаем.
 */
export function ensureContrast(color: RGB, against: RGB[], min: number, tone: 'dark' | 'light'): RGB {
  const ok = (c: RGB) => against.every((bg) => contrast(c, bg) >= min)
  if (ok(color)) return color
  const [L0, a, b] = toLab(color)
  const target = tone === 'dark' ? 1 : 0
  let lo = 0 // доля пути к target: 0 — исходный, 1 — белый/чёрный
  let hi = 1
  // сразу в целые 0…255 — проверяем ровно тот цвет, что попадёт в CSS
  const at = (t: number) => fromLab([L0 + (target - L0) * t, a, b]).map(Math.round) as RGB
  if (!ok(at(1))) return at(1)
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2
    if (ok(at(t))) hi = t
    else lo = t
  }
  return at(hi)
}
