import nodemailer from 'nodemailer'

// Настройки почты — из server/.env (см. server/.env.example)
const host = process.env.SMTP_HOST?.trim()
const port = Number(process.env.SMTP_PORT?.trim() || 465)
const user = process.env.SMTP_USER?.trim()
const pass = process.env.SMTP_PASS?.trim()
// Яндекс отправляет письма только от имени того ящика, в который вошли
const from = process.env.SMTP_FROM?.trim() || (user ? `Nuntius <${user}>` : '')

export const mailConfigured = Boolean(host && user && pass)
export const mailUser = user

const transport = mailConfigured
  ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 15_000 })
  : null

export type CodePurpose = 'register' | 'reset' | 'bind'

const SUBJECT: Record<CodePurpose, string> = {
  register: 'код для регистрации в Nuntius',
  reset: 'код для смены пароля в Nuntius',
  bind: 'код для привязки почты к Nuntius',
}

const LEAD: Record<CodePurpose, string> = {
  register: 'Ты регистрируешься в Nuntius. Введи этот код, чтобы подтвердить почту:',
  reset: 'Кто-то (надеемся, ты) хочет сменить пароль в Nuntius. Код для смены пароля:',
  bind: 'Ты привязываешь эту почту к аккаунту Nuntius. Код подтверждения:',
}

const FOOTER = 'Код действует 10 минут. Если это был не ты — просто проигнорируй письмо.'

function html(purpose: CodePurpose, code: string) {
  const digits = code
    .split('')
    .map(
      (d) =>
        `<td style="width:44px;height:56px;border:1px solid #444;border-radius:10px;background:#0d0d0d;color:#fff;font:700 28px/56px 'JetBrains Mono',Consolas,monospace;text-align:center">${d}</td>`,
    )
    .join('<td style="width:8px"></td>')
  return `<!doctype html><html><body style="margin:0;padding:0;background:#000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 16px">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#050505;border:1px solid #2a2a2a;border-radius:20px;padding:36px 32px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#d9d9d9">
<tr><td style="font:700 22px Arial,sans-serif;color:#fff;letter-spacing:-0.5px">● Nuntius</td></tr>
<tr><td style="padding:22px 0 18px;font-size:15px;line-height:1.5">${LEAD[purpose]}</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table></td></tr>
<tr><td style="padding-top:22px;font-size:13px;line-height:1.5;color:#8a8a8a">${FOOTER}</td></tr>
</table>
</td></tr></table></body></html>`
}

/** Отправить код. Если почта не настроена — печатаем код в окне сервера (удобно для проверки) */
export async function sendCode(to: string, code: string, purpose: CodePurpose) {
  if (!transport) {
    console.log(`\n  ✉  Почта не настроена (server/.env) — код для ${to}: ${code}\n`)
    return
  }
  await transport.sendMail({
    from,
    to,
    subject: `${code} — ${SUBJECT[purpose]}`,
    text: `${LEAD[purpose]}\n\n${code}\n\n${FOOTER}`,
    html: html(purpose, code),
  })
}

/** Понятное объяснение ошибки почты — для окна сервера и для пользователя */
export function explainMailError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string }
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    return 'Яндекс не принимает логин или пароль. Нужен именно пароль приложения (не обычный пароль от почты), и в ящике должен быть включён доступ почтовых программ'
  }
  if (e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'EDNS') {
    return 'Не получается достучаться до почтового сервера — проверь SMTP_HOST и SMTP_PORT, интернет, VPN или антивирус'
  }
  if (e.responseCode === 550 || e.responseCode === 553) {
    return 'Почтовый сервер отклонил письмо — проверь адрес получателя и что SMTP_FROM совпадает с SMTP_USER'
  }
  return e.message ?? 'неизвестная ошибка почты'
}

/** Проверка входа в почтовый сервер (при старте и в npm run check-mail) */
export async function verifyMail(): Promise<{ ok: boolean; text: string }> {
  if (!transport) return { ok: false, text: 'не настроена — коды подтверждения будут печататься здесь, в окне сервера' }
  try {
    await transport.verify()
    return { ok: true, text: `вход в ${host} как ${user} успешен` }
  } catch (err) {
    return { ok: false, text: explainMailError(err) }
  }
}

export async function sendTestMail(to: string) {
  if (!transport) throw new Error('почта не настроена')
  await transport.sendMail({
    from,
    to,
    subject: 'Nuntius: проверка почты ✓',
    text: 'Если ты читаешь это письмо — почта в Nuntius настроена правильно.',
    html: html('register', '123456').replace(LEAD.register, 'Почта в Nuntius настроена правильно ✓ Так будут выглядеть письма с кодами:'),
  })
}
