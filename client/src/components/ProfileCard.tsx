import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { uiZoom } from '../lib/settings'
import { useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { ProfileView } from './ProfileView'

const WIDTH = 320
const GAP = 12

/** Всплывающая карточка профиля рядом с тем, по кому кликнули */
export function ProfileCard() {
  const profile = useUi((s) => s.profile)
  const view = useChat((s) => s.view)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Сменился экран — карточку закрываем
  useEffect(() => ui.hideProfile(), [view])

  useEffect(() => {
    if (!profile) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.('.mgroup__avatar, .mgroup__author, .member, .friend__who, .main__title--user')) ui.hideProfile()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.hideProfile()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [profile])

  useLayoutEffect(() => {
    if (!profile || !ref.current) return setPos(null)
    // Карточка живёт внутри масштабированного интерфейса: экранные координаты делим на масштаб
    const k = uiZoom()
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const anchor = { left: profile.left / k, right: profile.right / k, top: profile.top / k }
    const h = ref.current.offsetHeight
    const fitsRight = anchor.right + GAP + WIDTH < vw - GAP
    const left = fitsRight ? anchor.right + GAP : Math.max(GAP, anchor.left - GAP - WIDTH)
    const top = Math.min(Math.max(GAP, anchor.top - 40), vh - h - GAP)
    setPos({ left, top })
  }, [profile])

  if (!profile) return null

  return (
    <div
      ref={ref}
      className="profile-card glow"
      key={profile.userId}
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <ProfileView userId={profile.userId} />
    </div>
  )
}
