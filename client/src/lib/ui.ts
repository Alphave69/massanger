import { create } from 'zustand'
import { isMobile } from './mobile'

export type ModalKind = 'create-guild' | 'join-guild' | 'invite' | null

export type SettingsSection = 'account' | 'profile' | 'badges' | 'privacy' | 'appearance' | 'voice' | 'notifications' | 'lab' | 'admin'

export type ServerSection = 'overview' | 'roles' | 'channels' | 'members' | 'invite'

export type ChannelModal = { mode: 'create'; guildId: string; type: 'text' | 'voice' } | { mode: 'edit'; guildId: string; channelId: string }

export type GroupModal = { mode: 'create' } | { mode: 'add'; dmId: string }

interface UiState {
  modal: ModalKind
  /** Карточка профиля: чей и где показать */
  profile: { userId: string; left: number; right: number; top: number } | null
  asideOpen: boolean
  statusMenuOpen: boolean
  /** Открытый раздел настроек (null — настройки закрыты) */
  settings: SettingsSection | null
  /** Настройки сервера (полноэкранные) */
  serverSettings: { guildId: string; section: ServerSection } | null
  channelModal: ChannelModal | null
  groupModal: GroupModal | null
  /** Телефон: открыт сам чат (true) или список — док и каналы (false) */
  mobileMain: boolean
  /** Телефон: в настройках сначала список разделов, раздел открывается нажатием */
  settingsList: boolean
}

export const useUi = create<UiState>(() => ({
  modal: null,
  profile: null,
  asideOpen: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  statusMenuOpen: false,
  settings: null,
  serverSettings: null,
  channelModal: null,
  groupModal: null,
  mobileMain: false,
  settingsList: false,
}))

export const ui = {
  openModal: (modal: ModalKind) => useUi.setState({ modal }),
  closeModal: () => useUi.setState({ modal: null }),
  toggleAside: () => useUi.setState((s) => ({ asideOpen: !s.asideOpen })),
  closeAside: () => useUi.setState({ asideOpen: false }),
  setStatusMenu: (open: boolean) => useUi.setState({ statusMenuOpen: open }),
  /** Показать карточку профиля рядом с элементом, по которому кликнули */
  showProfile(userId: string, anchor: Element) {
    const r = anchor.getBoundingClientRect()
    useUi.setState({ profile: { userId, left: r.left, right: r.right, top: r.top } })
  },
  hideProfile: () => useUi.setState({ profile: null }),
  /** Без раздела (шестерёнка) на телефоне сначала показываем список разделов */
  openSettings: (section?: SettingsSection) =>
    useUi.setState({ settings: section ?? 'account', settingsList: !section, statusMenuOpen: false, profile: null }),
  closeSettings: () => useUi.setState({ settings: null }),
  openServerSettings: (guildId: string, section?: ServerSection) =>
    useUi.setState({ serverSettings: { guildId, section: section ?? 'overview' }, settingsList: !section, profile: null, statusMenuOpen: false }),
  closeServerSettings: () => useUi.setState({ serverSettings: null }),
  /** Телефон: из раздела настроек — обратно к списку разделов */
  settingsBack: () => useUi.setState({ settingsList: true }),
  /** Переходим куда-то из уведомления или звонка — полноэкранные настройки не должны закрывать новый экран */
  closeOverlays: () => {
    useUi.setState({ settings: null, serverSettings: null, profile: null })
    ui.showMain()
  },
  /** Телефон: открыть сам чат (канал, личку, друзей) на весь экран. «Назад» браузера вернёт к списку — см. Shell */
  showMain() {
    if (!isMobile()) return
    useUi.setState({ mobileMain: true, asideOpen: false })
  },
  /** Телефон: обратно к списку (кнопка ← в шапке или «Назад») */
  showNav: () => useUi.setState({ mobileMain: false, asideOpen: false }),
  openChannelModal: (modal: ChannelModal) => useUi.setState({ channelModal: modal }),
  closeChannelModal: () => useUi.setState({ channelModal: null }),
  openGroupModal: (modal: GroupModal) => useUi.setState({ groupModal: modal }),
  closeGroupModal: () => useUi.setState({ groupModal: null }),
  reset: () =>
    useUi.setState({
      modal: null,
      profile: null,
      statusMenuOpen: false,
      settings: null,
      serverSettings: null,
      channelModal: null,
      groupModal: null,
      mobileMain: false,
      settingsList: false,
    }),
}
