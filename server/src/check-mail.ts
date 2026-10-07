// npm run check-mail [адрес] — проверить вход в почту и отправить тестовое письмо (по умолчанию — самому себе)
import './env.js'
import { explainMailError, mailUser, sendTestMail, verifyMail } from './mail.js'

const result = await verifyMail()
console.log(`\n${result.ok ? '✅' : '❌'} Почта (SMTP): ${result.text}`)

if (result.ok && mailUser) {
  const to = process.argv[2] || mailUser
  try {
    await sendTestMail(to)
    console.log(`✅ Тестовое письмо отправлено на ${to} — проверь ящик (и папку «Спам»)\n`)
  } catch (err) {
    console.log(`❌ Письмо не ушло: ${explainMailError(err)}\n`)
  }
} else if (!result.ok) {
  console.log('   Проверь server/.env (образец — server/.env.example).\n')
}
