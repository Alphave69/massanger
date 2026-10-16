import { create } from 'zustand'
import type { Attachment } from './api'

/** Просмотр фото на весь экран: картинки одного сообщения и какая открыта */
interface LightboxState {
  items: Attachment[]
  index: number
  open: boolean
}

export const useLightbox = create<LightboxState>(() => ({ items: [], index: 0, open: false }))

export const lightbox = {
  open(items: Attachment[], index: number) {
    if (!items.length) return
    useLightbox.setState({ items, index: Math.max(0, Math.min(index, items.length - 1)), open: true })
  },
  close: () => useLightbox.setState({ open: false }),
  /** Следующая (+1) / предыдущая (-1); по кругу не ходим */
  go(step: number) {
    const { items, index } = useLightbox.getState()
    const next = index + step
    if (next >= 0 && next < items.length) useLightbox.setState({ index: next })
  },
}
