import type { Server, Socket } from 'socket.io'
import * as store from './store.js'
import { on, reply } from './safe.js'
import { runCommand } from './commands.js'
import { hasChannelPermission } from './permissions.js'
import { parseMentions } from './mentions.js'
import { createLimiter, slowDown } from './spam.js'
import type { Badges } from './badges.js'

/**
 * Сообщения в реальном времени: отправить (в том числе ответом), реакции, правка, пересылка.
 * Каждое событие отвечает клиенту (ack): { message } или { error: 'понятный текст' }.
 */

interface Deps {
  io: Server
  badges: Badges
  dmView: (dm: store.Dm, userId: string) => unknown
  /** Может ли человек писать в личку другому (с учётом приватности) */
  canWriteDm: (fromId: string, to: store.User, dmId?: string) => boolean
  emitTo: (userIds: string[], event: string, payload: unknown, except?: Socket) => void
  /** В сети ли человек сейчас (для @here) */
  isOnline: (userId: string) => boolean
}

const MAX_LENGTH = 4000
/** Эмодзи-реакция: до 16 символов UTF-16 (хватает и на «семью» из нескольких эмодзи), без пробелов и управляющих символов */
const MAX_EMOJI = 16

const validEmoji = (emoji: string) => emoji.length > 0 && emoji.length <= MAX_EMOJI && !/\s/.test(emoji) && !/\p{Cc}/u.test(emoji)

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Анти-спам, общий на все каналы: больше 5 сообщений за 4 секунды — пауза 2 с,
 * попался снова в течение полуминуты — пауза дольше (до 10 с). Сообщения во время паузы не доходят.
 * Реакции, правки и пересылки ограничены мягче.
 */
/**
 * Повтор отправки после обрыва (клиент шлёт тот же nonce): «userId:nonce» → id сообщения, ~2 минуты.
 * Сообщение могло дойти, а ответ — потеряться; второй копии не создаём.
 */
const NONCE_TTL = 2 * 60_000
const sentNonces = new Map<string, { id: string; at: number }>()
function rememberNonce(key: string, id: string) {
  const now = Date.now()
  // Map хранит порядок вставки — старые записи в начале
  for (const [k, v] of sentNonces) {
    if (now - v.at < NONCE_TTL) break
    sentNonces.delete(k)
  }
  sentNonces.set(key, { id, at: now })
}

const sendLimit = createLimiter({ max: 5, windowMs: 4000, cooldowns: [2000, 3000, 5000, 8000, 10_000], forgiveMs: 30_000 })
const reactLimit = createLimiter({ max: 12, windowMs: 4000, cooldowns: [1500, 3000, 5000], forgiveMs: 30_000 })
const editLimit = createLimiter({ max: 6, windowMs: 5000, cooldowns: [2000, 4000, 6000], forgiveMs: 30_000 })
const forwardLimit = createLimiter({ max: 5, windowMs: 5000, cooldowns: [2000, 4000, 8000], forgiveMs: 30_000 })

/** Больше файлов в одном сообщении не принимаем */
const MAX_ATTACHMENTS = 10

/** Можно ли прикреплять файлы в этом канале (в личках и группах — всегда) */
const canAttach = (access: store.ChannelAccess, userId: string) =>
  access.kind !== 'guild' || hasChannelPermission(access.guild, access.channel, userId, 'ATTACH_FILES')

/** Файлы к новому сообщению: только свои и ещё ни к чему не прикреплённые загрузки */
function pickUploads(raw: unknown, userId: string): { files: store.Attachment[] } | { error: string } {
  if (raw == null) return { files: [] }
  if (!Array.isArray(raw)) return { error: 'Не удалось прикрепить файлы' }
  const ids = [...new Set(raw.map(str).filter(Boolean))]
  if (ids.length > MAX_ATTACHMENTS) return { error: `Не больше ${MAX_ATTACHMENTS} файлов в одном сообщении` }
  const files: store.Attachment[] = []
  for (const id of ids) {
    const u = store.findUpload(id)
    if (!u || u.ownerId !== userId || u.attachedTo) return { error: 'Файл не найден — загрузи его ещё раз' }
    files.push(store.attachmentOf(u))
  }
  return { files }
}

/** Как назвать место, откуда переслали: «#общий · Nuntius», «личка» или название группы */
function placeName(access: store.ChannelAccess) {
  if (access.kind === 'guild') return `#${access.channel.name} · ${access.guild.name}`
  return access.dm.kind === 'dm' ? 'личка' : access.dm.name || 'группа'
}

export function createMessages({ io, badges, dmView, canWriteDm, emitTo, isOnline }: Deps) {
  /** Собеседник в 1:1 личке */
  const otherIn = (dm: store.Dm, userId: string) => store.findUser(dm.memberIds.find((id) => id !== userId) ?? '')

  /** Почему человек не может писать в канал (null — может) */
  function writeProblem(access: store.ChannelAccess, userId: string): string | null {
    if (access.kind === 'guild') {
      if (access.channel.type !== 'text') return 'Сюда нельзя писать'
      if (!hasChannelPermission(access.guild, access.channel, userId, 'SEND_MESSAGES')) return 'Нет прав писать в этом канале'
      return null
    }
    if (access.dm.kind === 'dm') {
      const other = otherIn(access.dm, userId)
      if (!other || !canWriteDm(userId, other, access.dm.id)) return 'Собеседник принимает сообщения только от друзей'
    }
    return null
  }

  /** Сообщение, если человек видит его канал */
  function visibleMessage(rawId: unknown, userId: string) {
    const message = store.findMessage(str(rawId))
    const access = message ? store.channelAccess(message.channelId, userId) : undefined
    return message && access ? { message, access } : undefined
  }

  /** Новое сообщение: тем, кто видит канал; у лички — ещё и обновить список переписок */
  function publish(access: store.ChannelAccess, message: store.Message) {
    emitTo(store.viewersOf(access), 'message:new', message)
    if (access.kind === 'dm') {
      for (const id of access.dm.memberIds) io.to(`user:${id}`).emit('dm:update', dmView(access.dm, id))
    }
  }

  /** Сообщение изменилось (реакции, текст) — всем, кто видит канал, целиком */
  const publishUpdate = (access: store.ChannelAccess, message: store.Message) => emitTo(store.viewersOf(access), 'message:update', message)

  function attach(socket: Socket, userId: string) {
    on(socket, 'message:send', (payload: { channelId?: unknown; content?: unknown; replyTo?: unknown; attachments?: unknown; nonce?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      // Повтор того, что уже дошло, — отдаём то же сообщение (без лимита и без второй рассылки)
      const nonce = str(payload?.nonce).slice(0, 64)
      const nonceKey = nonce ? `${userId}:${nonce}` : ''
      const seen = nonceKey ? sentNonces.get(nonceKey) : undefined
      const already = seen && Date.now() - seen.at < NONCE_TTL ? store.findMessage(seen.id) : undefined
      if (already && already.authorId === userId) {
        answer({ message: already })
        return
      }
      // Строчит слишком быстро — сообщение не доходит, клиент покажет «полегче» с отсчётом
      const wait = sendLimit.hit(userId)
      if (wait !== null) {
        answer(slowDown(wait))
        return
      }
      const channelId = str(payload?.channelId)
      const content = store.snip(str(payload?.content).trim(), MAX_LENGTH)
      const access = channelId ? store.channelAccess(channelId, userId) : undefined
      // файлы: можно и без текста
      const picked = pickUploads(payload?.attachments, userId)
      if ('error' in picked) {
        answer({ error: picked.error })
        return
      }
      const { files } = picked
      if ((!content && !files.length) || !access || (access.kind === 'guild' && access.channel.type !== 'text')) {
        answer({ error: 'Не удалось отправить сообщение' })
        return
      }
      const problem = writeProblem(access, userId)
      if (problem) {
        answer({ error: problem })
        return
      }
      if (files.length && !canAttach(access, userId)) {
        answer({ error: 'Нет прав прикреплять файлы в этом канале' })
        return
      }
      // Ответ: только на сообщение из этого же канала; храним снимок оригинала
      let replyTo: store.ReplyRef | undefined
      if (payload?.replyTo != null) {
        const original = store.findMessage(str(payload.replyTo))
        if (!original || original.channelId !== channelId) {
          answer({ error: 'Сообщение, на которое ты отвечаешь, уже удалено' })
          return
        }
        replyTo = store.replyRef(original)
      }
      // Команды: /roll, /flip, /8ball, /me… (с файлами текст — просто подпись)
      const command = files.length ? null : runCommand(content)
      if (command && 'error' in command) {
        answer({ error: command.error })
        return
      }
      const text = command ? command.content : content
      const mentions = parseMentions(text, access, userId, { isOnline })
      const message = store.addMessage(channelId, userId, text, command?.flavor, { replyTo, mentions })
      store.setAttachments(message, files)
      const author = store.findUser(userId)
      if (author) {
        badges.onMessage(author, message.createdAt)
        if (command) {
          author.stats.commands++
          badges.findEgg(author, 'commands', true)
        }
      }
      // серверный канал — только тем, кто его видит; личка — её участникам
      if (nonceKey) rememberNonce(nonceKey, message.id)
      publish(access, message)
      answer({ message })
    })

    // Реакция: повторное нажатие на ту же — снимает её
    on(socket, 'message:react', (payload: { messageId?: unknown; emoji?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      const found = visibleMessage(payload?.messageId, userId)
      if (!found) {
        answer({ error: 'Сообщение не найдено — возможно, его уже удалили' })
        return
      }
      const emoji = str(payload?.emoji)
      if (!validEmoji(emoji)) {
        answer({ error: 'Такую реакцию поставить нельзя' })
        return
      }
      const { message, access } = found
      const wait = reactLimit.hit(userId)
      if (wait !== null) {
        answer(slowDown(wait, 'Полегче с реакциями — секундочку'))
        return
      }
      // Снять свою реакцию можно всегда, поставить — только там, где можно писать
      const removing = Boolean(message.reactions?.[emoji]?.includes(userId))
      const problem = removing ? null : writeProblem(access, userId)
      if (problem) {
        answer({ error: problem === 'Нет прав писать в этом канале' ? 'Нет прав ставить реакции в этом канале' : problem })
        return
      }
      if (store.toggleReaction(message, emoji, userId) === 'limit') {
        answer({ error: `На сообщении уже ${store.MAX_REACTIONS} разных реакций — выбери одну из них` })
        return
      }
      publishUpdate(access, message)
      answer({ message })
    })

    // Правка: только своё обычное сообщение (не служебное, не пересланное и не результат команды)
    on(socket, 'message:edit', (payload: { messageId?: unknown; content?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      const found = visibleMessage(payload?.messageId, userId)
      if (!found) {
        answer({ error: 'Сообщение не найдено — возможно, его уже удалили' })
        return
      }
      const { message, access } = found
      if (message.authorId === store.SYSTEM_AUTHOR || message.authorId !== userId) {
        answer({ error: 'Изменять можно только свои сообщения' })
        return
      }
      if (message.forwarded) {
        answer({ error: 'Пересланное сообщение изменить нельзя' })
        return
      }
      if (message.flavor && message.flavor !== 'me') {
        answer({ error: 'Результат команды изменить нельзя' })
        return
      }
      const content = str(payload?.content).trim()
      // у сообщения с файлами подпись можно и стереть
      if (!content && !message.attachments?.length) {
        answer({ error: 'Сообщение не может быть пустым — его можно удалить' })
        return
      }
      if (content.length > MAX_LENGTH) {
        answer({ error: `Слишком длинно — максимум ${MAX_LENGTH} символов` })
        return
      }
      if (content !== message.content) {
        const wait = editLimit.hit(userId)
        if (wait !== null) {
          answer(slowDown(wait, 'Слишком часто правишь — выдохни пару секунд'))
          return
        }
        store.editMessage(message, content, parseMentions(content, access, userId, { isOnline, previous: message.mentions }))
        publishUpdate(access, message)
      }
      answer({ message })
    })

    // Переслать в другой канал / личку / группу: новое сообщение с пометкой, откуда оно
    on(socket, 'message:forward', (payload: { messageId?: unknown; toChannelId?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      const found = visibleMessage(payload?.messageId, userId)
      if (!found) {
        answer({ error: 'Сообщение не найдено — возможно, его уже удалили' })
        return
      }
      const { message: source, access: from } = found
      if (source.authorId === store.SYSTEM_AUTHOR) {
        answer({ error: 'Служебные сообщения не пересылают' })
        return
      }
      const toId = str(payload?.toChannelId)
      const to = toId ? store.channelAccess(toId, userId) : undefined
      if (!to) {
        answer({ error: 'Канал не найден' })
        return
      }
      const problem = writeProblem(to, userId)
      if (problem) {
        answer({ error: problem })
        return
      }
      // файлы пересылаются ссылками на те же самые (если их ещё не удалили)
      const files = (source.attachments ?? []).filter((a) => store.findUpload(a.id))
      if (files.length && !canAttach(to, userId)) {
        answer({ error: 'Нет прав прикреплять файлы в этом канале' })
        return
      }
      if (!source.content && !files.length) {
        answer({ error: 'Файлы этого сообщения уже удалены' })
        return
      }
      const wait = forwardLimit.hit(userId)
      if (wait !== null) {
        answer(slowDown(wait, 'Полегче с пересылкой — подожди пару секунд'))
        return
      }
      // Пересылают пересланное — указываем настоящего автора и исходное место
      const forwarded: store.Forwarded = source.forwarded ?? { authorId: source.authorId, from: placeName(from), createdAt: source.createdAt }
      // Упоминания проверяем заново — уже для нового места (позвать их пересылка не зовёт: это делает клиент)
      const mentions = parseMentions(source.content, to, userId, { isOnline })
      const message = store.addMessage(toId, userId, source.content, source.flavor, { forwarded, mentions })
      store.setAttachments(message, files.map((a) => ({ ...a })))
      const author = store.findUser(userId)
      if (author) badges.onMessage(author, message.createdAt)
      publish(to, message)
      answer({ message })
    })
  }

  return { attach, writeProblem }
}
