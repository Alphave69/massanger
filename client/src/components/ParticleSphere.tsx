import { useEffect, useRef } from 'react'

/**
 * Вращающаяся сфера из точек.
 * Точки лежат на сфере Фибоначчи, вращаются в 3D и проецируются на экран.
 * У каждой точки есть собственное экранное смещение на «пружинке»:
 * курсор отталкивает точки (с лёгким завихрением, чтобы они обтекали его),
 * а пружина возвращает их обратно на сферу. Клик — ударная волна.
 */

interface Props {
  className?: string
}

const BUCKETS = 12 // точки рисуются пачками по яркости — так быстрее, чем по одной

export function ParticleSphere({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
    let cx = 0
    let cy = 0
    let radius = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // На широком экране сфера слева от формы, на узком — сверху
      const wide = w >= 900
      cx = wide ? w * 0.34 : w / 2
      cy = wide ? h / 2 : Math.min(h * 0.24, 220)
      radius = wide ? Math.min(w * 0.22, h * 0.36) : Math.min(w * 0.36, h * 0.17)
    }
    resize()

    // Появление: точки разбросаны по экрану и слетаются в сферу
    if (!reduceMotion) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2
        const d = (0.6 + Math.random()) * Math.max(w, h) * 0.6
        ox[i] = Math.cos(a) * d
        oy[i] = Math.sin(a) * d
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
      if (mouse.active) {
        const dx = p.x - lastMoveX
        const dy = p.y - lastMoveY
        // Движение рядом со сферой слегка её подкручивает
        if (Math.hypot(p.x - cx, p.y - cy) < radius * 1.4) spin += dx * 0.00006 + dy * 0.00002
      }
      lastMoveX = p.x
      lastMoveY = p.y
      mouse.x = p.x
      mouse.y = p.y
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = mouse.y = -1e4
    }
    const onDown = (e: PointerEvent) => {
      // Клик — ударная волна от точки нажатия
      const p = toLocal(e)
      const reach = radius * 1.3
      for (let i = 0; i < count; i++) {
        const dx = sx[i] - p.x
        const dy = sy[i] - p.y
        const d = Math.hypot(dx, dy) || 1
        if (d < reach) {
          const f = (1 - d / reach) * 14
          vx[i] += (dx / d) * f
          vy[i] += (dy / d) * f
        }
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let rotY = 0
    let tiltX = 0.38
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 16.667, 3)
      last = now

      spin *= Math.pow(0.95, dt)
      rotY += ((reduceMotion ? 0.0008 : 0.0028) + spin) * dt

      // Лёгкий наклон к курсору — сфера будто следит за ним
      const targetTilt = 0.38 + (mouse.active ? ((mouse.y - cy) / Math.max(h, 1)) * 0.5 : 0)
      tiltX += (targetTilt - tiltX) * 0.03 * dt

      const cosY = Math.cos(rotY)
      const sinY = Math.sin(rotY)
      const cosX = Math.cos(tiltX)
      const sinX = Math.sin(tiltX)
      const persp = 2.6 // чем меньше — тем сильнее перспектива

      const repelR = Math.max(80, radius * 0.42)
      const repelR2 = repelR * repelR
      const spring = 0.018
      const damping = Math.pow(0.88, dt)

      for (let i = 0; i < count; i++) {
        // вращение вокруг Y, затем наклон вокруг X
        const x1 = bx[i] * cosY - bz[i] * sinY
        const z1 = bx[i] * sinY + bz[i] * cosY
        const y2 = by[i] * cosX - z1 * sinX
        const z2 = by[i] * sinX + z1 * cosX // z2 > 0 — точка дальше от нас

        const scale = persp / (persp + z2)
        const px = cx + x1 * radius * scale
        const py = cy + y2 * radius * scale

        let x = px + ox[i]
        let y = py + oy[i]

        if (mouse.active) {
          const dx = x - mouse.x
          const dy = y - mouse.y
          const d2 = dx * dx + dy * dy
          if (d2 < repelR2) {
            const d = Math.sqrt(d2) || 0.001
            const t = 1 - d / repelR
            const f = t * 5.5 * dt
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
        x = px + ox[i]
        y = py + oy[i]

        const depth = (1 - z2) / 2 // 1 — ближняя сторона, 0 — дальняя
        const excited = Math.min(1, Math.hypot(ox[i], oy[i]) / 60)
        const alpha = Math.min(1, 0.1 + depth * 0.8 + excited * 0.35)

        sx[i] = x
        sy[i] = y
        ss[i] = (0.45 + depth * 1.05) * grain[i] * scale
        sb[i] = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS))
      }

      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      for (let b = 0; b < BUCKETS; b++) {
        ctx.globalAlpha = (b + 0.5) / BUCKETS
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
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
