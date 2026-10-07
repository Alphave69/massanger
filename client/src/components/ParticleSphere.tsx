import { useEffect, useRef } from 'react'

/**
 * Вращающаяся сфера из точек — живёт на фоне всего приложения.
 *
 * Точки лежат на сфере Фибоначчи, вращаются в 3D и проецируются на экран.
 * У каждой точки есть экранное смещение на «пружинке»: курсор отталкивает точки
 * (с завихрением, чтобы они обтекали его), пружина возвращает их на место.
 *
 * Режимы:
 *  - hero    — крупно на экране входа; клик даёт ударную волну;
 *  - ambient — после входа сфера укатывается вправо (катится, как шар) и тускнеет.
 * Событие `sphere:pulse` на window — импульс от центра (новое сообщение).
 */

export type SphereMode = 'hero' | 'ambient'

interface Props {
  mode: SphereMode
  className?: string
}

const BUCKETS = 12 // точки рисуются пачками по яркости — так быстрее, чем по одной

interface Layout {
  cx: number
  cy: number
  r: number
  a: number // общая яркость
}

function layoutFor(mode: SphereMode, w: number, h: number): Layout {
  const wide = w >= 900
  if (mode === 'hero') {
    return wide
      ? { cx: w * 0.34, cy: h / 2, r: Math.min(w * 0.22, h * 0.36), a: 1 }
      : { cx: w / 2, cy: Math.min(h * 0.24, 220), r: Math.min(w * 0.36, h * 0.17), a: 1 }
  }
  return wide
    ? { cx: w * 0.8, cy: h * 0.56, r: Math.min(w * 0.21, h * 0.42), a: 0.5 }
    : { cx: w * 0.72, cy: h * 0.32, r: Math.min(w * 0.42, h * 0.26), a: 0.35 }
}

export function ParticleSphere({ mode, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const count = window.innerWidth < 700 ? 800 : 1600

    // --- точки на единичной сфере (спираль Фибоначчи) ---
    const bx = new Float32Array(count)
    const by = new Float32Array(count)
    const bz = new Float32Array(count)
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const theta = golden * i
      // Небольшой шум ломает регулярный узор спирали (иначе на краю видны «гребёнки»)
      const nx = Math.cos(theta) * r + (Math.random() - 0.5) * 0.04
      const ny = y + (Math.random() - 0.5) * 0.04
      const nz = Math.sin(theta) * r + (Math.random() - 0.5) * 0.04
      const len = Math.hypot(nx, ny, nz) || 1
      bx[i] = nx / len
      by[i] = ny / len
      bz[i] = nz / len
    }

    // --- физика: смещение от «домашней» позиции и скорость ---
    const ox = new Float32Array(count)
    const oy = new Float32Array(count)
    const vx = new Float32Array(count)
    const vy = new Float32Array(count)
    const grain = new Float32Array(count)
    for (let i = 0; i < count; i++) grain[i] = 0.7 + Math.random() * 0.6

    // буферы кадра
    const sx = new Float32Array(count)
    const sy = new Float32Array(count)
    const ss = new Float32Array(count)
    const sb = new Uint8Array(count)

    let w = 0
    let h = 0
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // Текущая раскладка плавно догоняет целевую — так сфера «уезжает»
    const cur: Layout = { ...layoutFor(modeRef.current, w, h), a: 0 }

    // Появление: точки разбросаны по экрану и слетаются в сферу
    if (!reduceMotion) {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2
        const d = (0.6 + Math.random()) * Math.max(w, h) * 0.6
        ox[i] = Math.cos(ang) * d
        oy[i] = Math.sin(ang) * d
      }
    }

    const mouse = { x: -1e4, y: -1e4, active: false }
    let lastMoveX = 0
    let lastMoveY = 0
    let spin = 0 // дополнительное вращение от движений мыши

    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onMove = (e: PointerEvent) => {
      const p = toLocal(e)
      if (mouse.active && Math.hypot(p.x - cur.cx, p.y - cur.cy) < cur.r * 1.4) {
        // Движение рядом со сферой слегка её подкручивает
        spin += (p.x - lastMoveX) * 0.00006 + (p.y - lastMoveY) * 0.00002
      }
      lastMoveX = mouse.x = p.x
      lastMoveY = mouse.y = p.y
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = mouse.y = -1e4
    }

    const burst = (fromX: number, fromY: number, reach: number, power: number) => {
      for (let i = 0; i < count; i++) {
        const dx = sx[i] - fromX
        const dy = sy[i] - fromY
        const d = Math.hypot(dx, dy) || 1
        if (d < reach) {
          const f = (1 - d / reach) * power
          vx[i] += (dx / d) * f
          vy[i] += (dy / d) * f
        }
      }
    }

    const onDown = (e: PointerEvent) => {
      // Клик — ударная волна (только на экране входа, в приложении клики для дела)
      if (modeRef.current !== 'hero') return
      const p = toLocal(e)
      burst(p.x, p.y, cur.r * 1.3, 14)
    }

    const onPulse = (e: Event) => {
      // Импульс изнутри: сфера «вздыхает» от нового сообщения
      const strength = Number((e as CustomEvent).detail) || 1
      for (let i = 0; i < count; i++) {
        const dx = sx[i] - cur.cx
        const dy = sy[i] - cur.cy
        const d = Math.hypot(dx, dy) || 1
        const f = strength * (2 + Math.random() * 3) * (d / cur.r)
        vx[i] += (dx / d) * f
        vy[i] += (dy / d) * f
      }
      spin += 0.004 * strength
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('sphere:pulse', onPulse)
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let rotY = 0
    let rotZ = 0
    let tiltX = 0.38
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 16.667, 3)
      last = now
      const hero = modeRef.current === 'hero'

      // --- плавный переезд между режимами ---
      const target = layoutFor(modeRef.current, w, h)
      const k = 1 - Math.pow(1 - 0.045, dt)
      const prevCx = cur.cx
      cur.cx += (target.cx - cur.cx) * k
      cur.cy += (target.cy - cur.cy) * k
      cur.r += (target.r - cur.r) * k
      cur.a += (target.a - cur.a) * (1 - Math.pow(1 - 0.03, dt))
      // Катится: поворот в плоскости экрана ровно на пройденный путь / радиус
      rotZ += (cur.cx - prevCx) / Math.max(cur.r, 1)

      spin *= Math.pow(0.95, dt)
      rotY += ((reduceMotion ? 0.0008 : hero ? 0.0028 : 0.0016) + spin) * dt

      // Лёгкий наклон к курсору — сфера будто следит за ним
      const targetTilt = 0.38 + (hero && mouse.active ? ((mouse.y - cur.cy) / Math.max(h, 1)) * 0.5 : 0)
      tiltX += (targetTilt - tiltX) * 0.03 * dt

      const cosY = Math.cos(rotY)
      const sinY = Math.sin(rotY)
      const cosX = Math.cos(tiltX)
      const sinX = Math.sin(tiltX)
      const cosZ = Math.cos(rotZ)
      const sinZ = Math.sin(rotZ)
      const persp = 2.6 // чем меньше — тем сильнее перспектива

      const { cx, cy, r: radius } = cur
      const repelR = Math.max(80, radius * 0.42)
      const repelR2 = repelR * repelR
      const spring = 0.018
      const damping = Math.pow(0.88, dt)

      for (let i = 0; i < count; i++) {
        // вращение вокруг Y, наклон вокруг X, затем «качение» в плоскости экрана
        const x1 = bx[i] * cosY - bz[i] * sinY
        const z1 = bx[i] * sinY + bz[i] * cosY
        const y2 = by[i] * cosX - z1 * sinX
        const z2 = by[i] * sinX + z1 * cosX // z2 > 0 — точка дальше от нас
        const x3 = x1 * cosZ - y2 * sinZ
        const y3 = x1 * sinZ + y2 * cosZ

        const scale = persp / (persp + z2)
        const px = cx + x3 * radius * scale
        const py = cy + y3 * radius * scale

        if (mouse.active) {
          const dx = px + ox[i] - mouse.x
          const dy = py + oy[i] - mouse.y
          const d2 = dx * dx + dy * dy
          if (d2 < repelR2) {
            const d = Math.sqrt(d2) || 0.001
            const f = (1 - d / repelR) * 5.5 * dt
            const nx = dx / d
            const ny = dy / d
            // отталкивание + небольшое завихрение — точки обтекают курсор
            vx[i] += (nx - ny * 0.35) * f
            vy[i] += (ny + nx * 0.35) * f
          }
        }

        vx[i] = (vx[i] - ox[i] * spring * dt) * damping
        vy[i] = (vy[i] - oy[i] * spring * dt) * damping
        ox[i] += vx[i] * dt
        oy[i] += vy[i] * dt

        const depth = (1 - z2) / 2 // 1 — ближняя сторона, 0 — дальняя
        const excited = Math.min(1, Math.hypot(ox[i], oy[i]) / 60)
        const alpha = Math.min(1, 0.1 + depth * 0.8 + excited * 0.5)

        sx[i] = px + ox[i]
        sy[i] = py + oy[i]
        ss[i] = (0.45 + depth * 1.05) * grain[i] * scale * (1 + excited * 0.4)
        sb[i] = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS))
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      for (let b = 0; b < BUCKETS; b++) {
        ctx.globalAlpha = Math.min(1, ((b + 0.5) / BUCKETS) * cur.a)
        ctx.beginPath()
        for (let i = 0; i < count; i++) {
          if (sb[i] !== b) continue
          ctx.moveTo(sx[i] + ss[i], sy[i])
          ctx.arc(sx[i], sy[i], ss[i], 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('sphere:pulse', onPulse)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
