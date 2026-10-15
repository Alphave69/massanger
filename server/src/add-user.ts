// npm run add-user -- <почта> <логин> "<имя>" <пароль>
// Завести аккаунт вручную, без кода из письма (когда почта не доходит).
// Сервер на это время останови: он держит базу в памяти и при следующем сохранении затёр бы новую запись.
import bcrypt from 'bcryptjs'
import * as store from './store.js'

const [emailArg, username, displayName, password] = process.argv.slice(2)
const email = (emailArg ?? '').trim().toLowerCase()

const problem =
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'почта выглядит неправильно'
  : !/^[a-zA-Z0-9_.]{3,32}$/.test(username ?? '') ? 'логин: 3–32 символа, латиница, цифры, _ и .'
  : !displayName?.trim() ? 'нужно имя'
  : (password ?? '').length < 6 ? 'пароль — не короче 6 символов'
  : store.findUserByEmail(email) ? 'эта почта уже привязана к аккаунту'
  : store.findUserByName(username) ? 'такой логин уже занят'
  : null

if (problem) {
  console.error(`✖ Не создал: ${problem}`)
  console.error('  Как вызывать: npm run add-user -- почта логин "Имя" пароль')
  process.exit(1)
}

const user = store.createUser({ email, username, displayName: displayName.trim().slice(0, 32), passwordHash: await bcrypt.hash(password, 10) })
// база сохраняется с задержкой 200 мс — процесс сам дождётся записи и выйдет
console.log(`✅ Аккаунт создан: ${user.username} (${user.email}). Можно входить по логину или почте.`)
