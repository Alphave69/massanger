import type { Socket } from 'socket.io'

/**
 * Обработчик события сокета, который не роняет сервер.
 * Socket.IO вызывает обработчики вне try/catch, и одна ошибка (кривые данные от клиента)
 * иначе остановила бы весь процесс — у всех бы отвалилась связь.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function on(socket: Socket, event: string, handler: (...args: any[]) => void) {
  socket.on(event, (...args: unknown[]) => {
    try {
      handler(...args)
    } catch (err) {
      console.error(`socket ${event}:`, err)
    }
  })
}

/** Ответ клиенту (ack): второй аргумент может оказаться чем угодно, а не функцией */
export const reply = (ack: unknown): ((r: unknown) => void) => (typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {})
