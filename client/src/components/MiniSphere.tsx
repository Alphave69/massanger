import { useEffect, useRef } from 'react'

interface Props {
  size?: number
  dots?: number
  /** Цвет точек (по умолчанию — текущий цвет текста) */
  color?: string
  className?: string
}

/** Маленькая вращающаяся сфера из точек — фирменный значок. Ускоряется при наведении. */
export function MiniSphere({ size = 28, dots = 90, color, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const pts: [number, number, number][] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < dots; i++) {
      const y = 1 - (i / (dots - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      pts.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r])
    }

    let hover = false
    let speed = 0.012
    const host = canvas.parentElement ?? canvas
    const enter = () => (hover = true)
    const leave = () => (hover = false)
    host.addEventListener('pointerenter', enter)
    host.addEventListener('pointerleave', leave)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let rot = Math.random() * 6
    let raf = 0
    const R = size * 0.42
    const c = size / 2
    const tilt = 0.4
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    let fill = ''
    let frameNo = 0
    const draw = () => {
      // цвет берём из CSS (currentColor), но не каждый кадр — это дорого
      if (frameNo++ % 30 === 0) fill = color ?? getComputedStyle(canvas).color
      speed += ((hover ? 0.05 : reduce ? 0.003 : 0.012) - speed) * 0.08
      rot += speed
      const cs = Math.cos(rot)
      const sn = Math.sin(rot)
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = fill
      for (const [x, y, z] of pts) {
        const x1 = x * cs - z * sn
        const z1 = x * sn + z * cs
        const y2 = y * cosT - z1 * sinT
        const z2 = y * sinT + z1 * cosT
        const depth = (1 - z2) / 2
        ctx.globalAlpha = 0.15 + depth * 0.85
        ctx.beginPath()
        ctx.arc(c + x1 * R, c + y2 * R, Math.max(0.5, size / 56 + depth * (size / 40)), 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
    }
  }, [size, dots, color])

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />
}
