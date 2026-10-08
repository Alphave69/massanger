import { useState } from 'react'
import { LoaderCircle, Megaphone, Send } from 'lucide-react'
import { useAnnouncements } from '../../lib/admin'
import { api } from '../../lib/api'
import { formatStamp } from '../../lib/format'
import { chat, useChat } from '../../lib/store'
import { Avatar } from '../Avatar'
import { errorText } from './bits'

const MAX = 300

/** «Объявление»: всплывашка у всех, кто сейчас в сети */
export function AdminAnnounce({ online }: { online: number }) {
  const me = useChat((s) => s.me!)
  const users = useChat((s) => s.users)
  const recent = useAnnouncements((s) => s.list)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)

  const clean = text.trim()
  const left = MAX - text.length

  const send = async () => {
    if (!clean || busy) return
    setBusy(true)
    try {
      await api.adminAnnounce(clean)
      setText('')
      setSent((n) => n + 1)
    } catch (err) {
      chat.toast({ title: 'Не отправилось', text: errorText(err) })
    }
    setBusy(false)
  }

  return (
    <div className="adm-announce">
      <div className="adm-announce__grid">
        <div className="adm-announce__form">
          <label className="field-block">
            <span className="set-group__title">
              Текст <span className={`counter${left < 30 ? ' is-low' : ''}`}>{left}</span>
            </span>
            <textarea
              className="input textarea"
              value={text}
              maxLength={MAX}
              rows={5}
              placeholder="Например: «Сегодня в 22:00 перезапустим сервер на пару минут ✦»"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
          </label>
          <div className="adm-announce__actions">
            <span className="muted">
              Увидят все, кто сейчас в сети{online ? ` — это ${online}` : ''}. Ctrl+Enter — отправить.
            </span>
            <button className="btn btn--primary" disabled={!clean || busy} onClick={() => void send()}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />} Отправить всем
            </button>
          </div>
          {sent > 0 && (
            <div className="adm-announce__sent" key={sent}>
              <Megaphone size={14} /> Улетело! Объявление уже у всех на экране.
            </div>
          )}
        </div>

        <div className="adm-announce__preview">
          <span className="set-group__title">Так это увидят</span>
          <div className={`adm-toast glow${clean ? '' : ' is-empty'}`}>
            <span className="adm-toast__icon">
              <Avatar user={me} size={34} />
            </span>
            <span className="adm-toast__text">
              <b>📣 Объявление</b>
              <span>{clean ? `${clean} — ${me.displayName}` : 'Здесь появится текст объявления'}</span>
            </span>
            <span className="adm-toast__timer" />
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <section className="adm-recent">
          <h4 className="adm-list__title">
            <Megaphone size={14} /> Недавние объявления
          </h4>
          {recent.map((a, i) => (
            <div key={`${a.at}-${i}`} className="adm-recent__item">
              <span className="adm-recent__who">{users[a.from]?.displayName ?? 'Админ'}</span>
              <span className="adm-recent__text">{a.text}</span>
              <time className="adm-recent__time">{formatStamp(a.at)}</time>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
