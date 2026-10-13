import { create } from 'zustand'

/** Где открыть меню: у курсора (правый клик, долгое нажатие) или у кнопки «⋯» */
export type VoiceMenuAnchor = { kind: 'point'; x: number; y: number } | { kind: 'rect'; left: number; right: number; top: number; bottom: number }

export interface VoiceMenuState {
  userId: string
  /** Комната, где сидит человек: от неё зависят права модерации (в личке/группе их нет) */
  roomId: string
  anchor: VoiceMenuAnchor
  /** Каждое открытие — новое меню (сбрасывает «точно выгнать?» и позицию) */
  seq: number
}

/** Меню участника голоса: правый клик / долгое нажатие по плитке звонка или по человеку под голосовым каналом */
export const useVoiceMenu = create<{ menu: VoiceMenuState | null }>(() => ({ menu: null }))

let seq = 0

export const voiceMenu = {
  open(userId: string, roomId: string, anchor: VoiceMenuAnchor) {
    useVoiceMenu.setState({ menu: { userId, roomId, anchor, seq: ++seq } })
  },
  /** Меню у элемента (кнопка «⋯»): под ним, правым краем к его правому краю */
  openAt(userId: string, roomId: string, el: Element) {
    const r = el.getBoundingClientRect()
    voiceMenu.open(userId, roomId, { kind: 'rect', left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  },
  close: () => useVoiceMenu.getState().menu && useVoiceMenu.setState({ menu: null }),
}
