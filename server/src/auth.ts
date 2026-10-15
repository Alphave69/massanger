import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextFunction, Request, Response } from 'express'
import { findUser, type User } from './store.js'

const ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')
const MIN_SECRET_LENGTH = 32

function refuseToStart(problem: string): never {
  console.error(`\n  ✖ ${problem}`)
  console.error(`    Создай ключ: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
  console.error('    и впиши его в server/.env строкой JWT_SECRET=... (без # в начале), потом перезапусти сервер.\n')
  process.exit(1)
}

/**
 * Ключ, которым подписываются токены входа. Вшитого запасного ключа нет: он лежал бы в открытом
 * репозитории, и любой мог бы подписать себе вход под чужим аккаунтом.
 * Ключа нет: на боевом сервере (NODE_ENV=production) не стартуем; на своём компьютере — создаём
 * случайный и записываем в server/.env, чтобы входы переживали перезапуск.
 */
function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      refuseToStart(`JWT_SECRET в server/.env слишком короткий: ${fromEnv.length} символов, нужно не меньше ${MIN_SECRET_LENGTH}.`)
    }
    return fromEnv
  }
  if (process.env.NODE_ENV === 'production') refuseToStart('В server/.env нет JWT_SECRET — без него сервер не запускается.')

  const secret = randomBytes(48).toString('hex')
  const line = `JWT_SECRET=${secret}`
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  // пустая строка «JWT_SECRET=» — заменяем её, иначе она так и перекрывала бы новую
  const next = /^[ \t]*JWT_SECRET[ \t]*=[ \t]*$/m.test(text)
    ? text.replace(/^[ \t]*JWT_SECRET[ \t]*=[ \t]*$/m, line)
    : `${text}${text && !text.endsWith('\n') ? '\n' : ''}# Ключ для токенов входа — создан при первом запуске, никому не показывай\n${line}\n`
  try {
    writeFileSync(ENV_FILE, next)
  } catch {
    refuseToStart('В server/.env нет JWT_SECRET, а записать новый не получилось.')
  }
  console.log('  🔑 JWT_SECRET не было — создал случайный и записал в server/.env')
  process.env.JWT_SECRET = secret
  return secret
}

const SECRET = jwtSecret()

export const hashPassword = (password: string) => bcrypt.hash(password, 10)
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

/** В токене — версия: после смены пароля или «выйти везде» старые токены не принимаются */
export const signToken = (user: User) => jwt.sign({ sub: user.id, v: user.tokenVersion }, SECRET, { expiresIn: '30d' })

export function userFromToken(token: string | undefined): User | undefined {
  if (!token) return undefined
  try {
    const { sub, v } = jwt.verify(token, SECRET) as { sub: string; v?: number }
    const user = findUser(sub)
    // заблокированного не пускаем, даже если токен ещё живой
    if (!user || user.banned || (v ?? 0) !== user.tokenVersion) return undefined
    return user
  } catch {
    return undefined
  }
}

export interface AuthedRequest extends Request {
  user: User
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  const user = userFromToken(token)
  if (!user) {
    res.status(401).json({ error: 'Нужно войти заново' })
    return
  }
  ;(req as AuthedRequest).user = user
  next()
}
