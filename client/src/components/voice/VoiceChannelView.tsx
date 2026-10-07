import { Users, Volume2 } from 'lucide-react'
import type { Channel, Guild } from '../../lib/api'
import { ui, useUi } from '../../lib/ui'
import { VoiceStage } from './VoiceStage'

/** Середина экрана, когда открыт голосовой канал сервера */
export function VoiceChannelView({ guild, channel }: { guild: Guild; channel: Channel }) {
  const asideOpen = useUi((s) => s.asideOpen)
  return (
    <section className="main panel glow">
      <header className="main__head">
        <div className="main__title">
          <span className="hash-tile">
            <Volume2 size={17} />
          </span>
          <h2 className="truncate">{channel.name}</h2>
          <span className="main__sub">голосовой канал · {guild.name}</span>
        </div>
        <div className="main__actions">
          <button className={`icon-btn${asideOpen ? ' is-active' : ''}`} onClick={ui.toggleAside} data-tip="Участники">
            <Users size={19} />
          </button>
        </div>
      </header>
      <VoiceStage roomId={channel.id} variant="channel" />
    </section>
  )
}
