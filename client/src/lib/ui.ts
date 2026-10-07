import { create } from 'zustand'

export type ModalKind = 'create-guild' | 'join-guild' | 'invite' | null

export type SettingsSection = 'account' | 'profile' | 'privacy' | 'appearance' | 'voice' | 'notifications'

interface UiState {
  modal: ModalKind
  /** Карточка профиля: чей и где показать */
  profile: { userId: string; left: number; right: number; top: number } | null
  asideOpen: boolean
  statusMenuOpen: boolean
  /** Открытый раздел настроек (null — настройки закрыты) */
  settings: SettingsSection | null
}

export const useUi = create<UiState>(() => ({
  modal: null,
  profile: null,
  asideOpen: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  statusMenuOpen: false,
  settings: null,
}))

export const ui = {
  openModal: (modal: ModalKind) => useUi.setState({ modal }),
  closeModal: () => useUi.setState({ modal: null }),
  toggleAside: () => useUi.setState((s) => ({ asideOpen: !s.asideOpen })),
  setStatusMenu: (open: boolean) => useUi.setState({ statusMenuOpen: open }),
  /** Показать карточку профиля рядом с элементом, по которому кликнули */
  showProfile(userId: string, anchor: Element) {
    const r = anchor.getBoundingClientRect()
    useUi.setState({ profile: { userId, left: r.left, right: r.right, top: r.top } })
  },
  hideProfile: () => useUi.setState({ profile: null }),
  openSettings: (section: SettingsSection = 'account') => useUi.setState({ settings: section, statusMenuOpen: false, profile: null }),
  closeSettings: () => useUi.setState({ settings: null }),
  reset: () => useUi.setState({ modal: null, profile: null, statusMenuOpen: false, settings: null }),
}
