import type { CSSProperties } from 'react'
import {
  AudioLines,
  BadgeHelp,
  Bug,
  BugOff,
  Building,
  Cake,
  Calendar,
  CalendarDays,
  CalendarHeart,
  Castle,
  Crown,
  Egg,
  Flame,
  FlaskConical,
  Gavel,
  Gem,
  Handshake,
  HeartHandshake,
  HelpCircle,
  Medal,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Mic,
  MonitorUp,
  Moon,
  Palette,
  PartyPopper,
  PhoneCall,
  Pickaxe,
  Radio,
  Repeat,
  Scroll,
  Search,
  ShieldCheck,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Sunrise,
  Timer,
  Users,
  UsersRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeDef } from '../../lib/api'

/** Ключ иконки из каталога (kebab-case, как у lucide) → компонент */
const ICONS: Record<string, LucideIcon> = {
  'flask-conical': FlaskConical,
  gem: Gem,
  crown: Crown,
  castle: Castle,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  'calendar-heart': CalendarHeart,
  cake: Cake,
  medal: Medal,
  repeat: Repeat,
  'message-circle': MessageCircle,
  'messages-square': MessagesSquare,
  megaphone: Megaphone,
  scroll: Scroll,
  moon: Moon,
  sunrise: Sunrise,
  skull: Skull,
  'party-popper': PartyPopper,
  snowflake: Snowflake,
  mic: Mic,
  'audio-lines': AudioLines,
  radio: Radio,
  timer: Timer,
  'phone-call': PhoneCall,
  video: Video,
  'monitor-up': MonitorUp,
  handshake: Handshake,
  users: Users,
  building: Building,
  'users-round': UsersRound,
  sparkles: Sparkles,
  egg: Egg,
  search: Search,
  pickaxe: Pickaxe,
  'shield-check': ShieldCheck,
  gavel: Gavel,
  bug: Bug,
  'bug-off': BugOff,
  star: Star,
  'heart-handshake': HeartHandshake,
  flame: Flame,
  palette: Palette,
  'help-circle': HelpCircle,
  'badge-help': BadgeHelp,
}

export const iconFor = (key: string): LucideIcon => ICONS[key] ?? Sparkles

interface Props {
  def: BadgeDef
  /** Диаметр в px */
  size?: number
  /** Ещё не получен — тусклый, без анимаций */
  locked?: boolean
  className?: string
}

/**
 * Круглый значок. Редкость видно по оправе (и в ч/б):
 * обычный — тонкое кольцо, редкий — двойное, эпический — свечение, легендарный — переливающееся вращающееся кольцо.
 */
export function BadgeIcon({ def, size = 22, locked, className = '' }: Props) {
  const Icon = iconFor(def.icon)
  return (
    <span
      className={`bdg bdg--${def.tier}${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--s': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.52)} strokeWidth={size >= 48 ? 1.6 : 2} />
    </span>
  )
}
