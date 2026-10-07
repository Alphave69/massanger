interface Props {
  size?: number
  spinning?: boolean
}

// Маленькая «сфера» из точек — логотип
const DOTS: [number, number, number][] = [
  [16, 5, 1.6], [8.5, 8.5, 1.4], [23.5, 8.5, 1.4], [5, 16, 1.6], [16, 16, 2.6], [27, 16, 1.6],
  [8.5, 23.5, 1.4], [23.5, 23.5, 1.4], [16, 27, 1.6], [12, 12.5, 1], [20, 12.5, 1], [12, 19.5, 1], [20, 19.5, 1],
]

export function Logo({ size = 32, spinning = false }: Props) {
  return (
    <svg className={`logo${spinning ? ' logo--spin' : ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {DOTS.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </svg>
  )
}
