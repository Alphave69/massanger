import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Message } from '../../lib/api'
import { focusComposer, msgUi } from '../../lib/msgActions'
import { editMessage } from '../../lib/realtime'

const MAX_LENGTH = 4000

/** Правка прямо в пузыре: Enter — сохранить, Shift+Enter — новая строка, Esc — отмена */
export function MessageEditor({ message }: { message: Message }) {
  const [value, setValue] = useState(message.content)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Поле растёт вместе с текстом
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value])

  // Курсор — в конец текста, само сообщение — в поле зрения
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const stop = () => {
    msgUi.stopEdit()
    focusComposer()
  }

  const save = async () => {
    const content = value.trim()
    if (busy || !content) return
    if (content === message.content) return stop()
    setBusy(true)
    const ok = await editMessage(message.id, content)
    setBusy(false)
    if (ok) stop()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stop()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void save()
    }
  }

  const empty = !value.trim()

  return (
    <div className="msg-editor">
      <textarea
        ref={ref}
        className="msg-editor__field"
        rows={1}
        value={value}
        maxLength={MAX_LENGTH}
        readOnly={busy}
        aria-label="Изменить сообщение"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="msg-editor__hint">
        <kbd>Esc</kbd>{' '}
        <button type="button" onClick={stop}>
          отмена
        </button>
        {' · '}
        <kbd>Enter</kbd>{' '}
        <button type="button" onClick={() => void save()} disabled={empty || busy}>
          {busy ? 'сохраняем…' : 'сохранить'}
        </button>
        {empty && <span className="msg-editor__warn"> · пустым сообщение быть не может</span>}
      </div>
    </div>
  )
}
