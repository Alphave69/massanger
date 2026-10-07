import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { findUser, type User } from './store.js'

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

export const hashPassword = (password: string) => bcrypt.hash(password, 10)
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

/** В токене — версия: после смены пароля или «выйти везде» старые токены не принимаются */
export const signToken = (user: User) => jwt.sign({ sub: user.id, v: user.tokenVersion }, SECRET, { expiresIn: '30d' })

export function userFromToken(token: string | undefined): User | undefined {
  if (!token) return undefined
  try {
    const { sub, v } = jwt.verify(token, SECRET) as { sub: string; v?: number }
    const user = findUser(sub)
    if (!user || (v ?? 0) !== user.tokenVersion) return undefined
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
