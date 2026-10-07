// Мелкие эффекты, общие для разных частей интерфейса

/** Импульс по фоновой сфере (новое сообщение и т.п.) */
export function pulseSphere(strength = 1) {
  window.dispatchEvent(new CustomEvent('sphere:pulse', { detail: strength }))
}

let audio: AudioContext | null = null

/** Короткий мягкий «блип» уведомления — синтезируем, без файлов */
export function blip() {
  try {
    audio ??= new AudioContext()
    const now = audio.currentTime
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, now)
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
    osc.connect(gain).connect(audio.destination)
    osc.start(now)
    osc.stop(now + 0.26)
  } catch {
    // звук недоступен — не страшно
  }
}

/**
 * Подсветка рамок, которая «следует» за курсором.
 * Каждому элементу с классом .glow выставляем координаты курсора относительно него.
 */
export function startGlowTracking() {
  let raf = 0
  let x = -1000
  let y = -1000
  const apply = () => {
    raf = 0
    document.documentElement.style.setProperty('--gx', `${x}px`)
    document.documentElement.style.setProperty('--gy', `${y}px`)
    for (const el of document.querySelectorAll<HTMLElement>('.glow')) {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${x - r.left}px`)
      el.style.setProperty('--my', `${y - r.top}px`)
    }
  }
  const onMove = (e: PointerEvent) => {
    x = e.clientX
    y = e.clientY
    if (!raf) raf = requestAnimationFrame(apply)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    cancelAnimationFrame(raf)
  }
}
