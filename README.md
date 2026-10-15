# Nuntius

Свой мессенджер для себя и друзей. Монохромный дизайн: чистый чёрный и белый, свечение, сфера из точек на фоне.

## Что уже есть

- **Почта:** регистрация с кодом из письма, вход по логину или почте, «Забыл пароль?», привязка почты в настройках.
- **Вход и регистрация.** Большая сфера из ~1600 точек: точки разлетаются от курсора и возвращаются, клик даёт ударную волну. После входа сфера укатывается вправо и остаётся на фоне приглушённой. От новых сообщений она вздрагивает.
- **Серверы и каналы.** Общий сервер для всех, свои серверы, приглашения по коду.
- **Друзья.** Заявки по логину, принять, отклонить, удалить. Уведомления о заявках.
- **Личные сообщения** с друзьями и людьми с общих серверов, непрочитанные и всплывающие уведомления со звуком.
- **Статусы:** в сети ● · не активен ◐ (ставится сам через 5 минут бездействия) · спит ☾ · не беспокоить ⊖ (без звуков и уведомлений) · невидимка ○. Плюс свой текстовый статус.
- **Профили:** карточка по клику на любого человека, профиль собеседника справа в личке.
- **Чат:** пузыри сообщений, группировка, разделители по дням, «печатает…», анимации появления.
- Голосовые каналы пока заглушка, это следующий этап.

## Стек

| Часть  | Технологии                                                         |
| ------ | ------------------------------------------------------------------ |
| client | React 19, TypeScript, Vite, zustand, lucide-react, шрифты локально |
| server | Node.js, Express 5, Socket.IO, JWT, bcrypt                         |
| данные | JSON-файл `server/data/db.json` (позже — БД)                       |

## Почта (коды подтверждения)

Регистрация подтверждается кодом из письма, по почте можно войти и восстановить пароль.

1. Скопируй `server/.env.example` в `server/.env` и впиши пароль приложения Яндекса в `SMTP_PASS`.
   Файл `server/.env` в git не попадает — пароль остаётся только у тебя.
2. Проверь: `npm run check-mail` — должно быть «✅ вход … успешен» и прийти тестовое письмо.

Без `server/.env` всё тоже работает: коды печатаются в окне сервера.

## Запуск

**Windows, проще всего:** дважды кликнуть `start.bat` в папке проекта. Он сам скачает обновления, поставит зависимости, запустит сервер и откроет браузер. Окно не закрывать, пока пользуешься.

**Вручную (любая ОС):**

```bash
npm install
npm run dev
```

Браузер откроется сам на http://localhost:5173. Если включён VPN, добавь `localhost` в его исключения.

Продакшен (один порт):

```bash
npm run build
JWT_SECRET=какой-то-длинный-секрет npm start   # http://localhost:3001
```

## Структура

```
client/src/
  components/
    ParticleSphere.tsx   фоновая сфера (canvas): режимы hero / ambient
    MiniSphere.tsx       маленькая сфера — значок «Личное», пустые экраны
    AuthPage.tsx         вход / регистрация
    Shell.tsx            каркас приложения
    Dock.tsx             колонка слева: личное + серверы
    GuildSidebar.tsx     каналы сервера
    HomeSidebar.tsx      друзья + личные сообщения
    FriendsPage.tsx      друзья, заявки, добавление
    ChatView.tsx         чат (каналы и лички)
    MemberList.tsx       участники сервера
    ProfileView.tsx      профиль (карточка и правая колонка)
    UserBar.tsx          своя панель + выбор статуса
  lib/
    api.ts               REST-клиент и типы
    store.ts             состояние (zustand)
    realtime.ts          Socket.IO, уведомления, авто-«не активен»
    fx.ts                импульс сферы, звук, подсветка рамок
  styles/                global / auth / app
server/src/
  index.ts               REST + Socket.IO, статусы, друзья, лички
  auth.ts                пароли и JWT
  store.ts               хранилище
```

## Чтобы работало без твоего ПК

- **Сервер 24/7** — пошагово в [DEPLOY.md](DEPLOY.md): арендуешь VPS, запускаешь `deploy/setup.sh`, готово.
- **Приложение для Windows** (установщик, который можно просто скинуть друзьям) — в [desktop/README.md](desktop/README.md).

## Security

Nuntius is a small self-hosted messenger used by a group of friends. This section describes what the server protects against, how, and what it does not cover yet.

### Authentication

- Passwords are hashed with bcrypt (cost 10). Plain passwords are never stored or logged.
- Login sessions use JWTs signed with `JWT_SECRET` (HS256, valid for 30 days). Each token carries the user's `tokenVersion`. Changing the password or using "log out everywhere" increments it, which invalidates every older token. Banned users are rejected even with a valid token.
- There is no built-in fallback secret. If `JWT_SECRET` is shorter than 32 characters, or missing with `NODE_ENV=production`, the server refuses to start. In local development a random secret is generated on first start and saved to `server/.env`.
- E-mail confirmation codes (registration, password reset, e-mail change) have 6 digits. Only their SHA-256 hash is kept in memory. Each code expires after 10 minutes, allows at most 5 attempts, and can be resent at most once a minute. If the mail server is unreachable, the code is written to the server log so the owner can pass it on by hand.

### Abuse limits

All limits are in-memory sliding windows and reset when the server restarts.

| What | Limit |
| ---- | ----- |
| Failed logins per login/e-mail **from one IP** | 5 per 15 min |
| Failed logins per login/e-mail from all IPs together | 30 per hour |
| Failed logins per IP (any logins) | 20 per 15 min |
| Code e-mails per IP (register, reset, e-mail change) | 10 per hour |
| Messages per user (`message:send`) | 5 per 4 s |

Requests over a limit get HTTP 429 with `Retry-After`. Messages over the limit are not delivered.

The app runs behind Caddy on the same machine. Express uses `trust proxy = loopback`, so `req.ip` is the real client address from `X-Forwarded-For`, and only the local proxy is trusted to set that header.

### Origins (CORS)

- The REST API (`/api`) and Socket.IO accept browser requests only from the site's own origin and from the origins in `CORS_ORIGINS` (comma-separated). `deploy/setup.sh` sets it to `https://<domain>`. In development it defaults to `http://localhost:5173`.
- Requests with any other `Origin` get 403.
- Socket.IO checks the `Origin` header in `allowRequest` before the handshake, because browsers do not apply CORS to WebSockets.

### Authorization

- Every socket event and REST route checks server permissions with role hierarchy and per-channel overrides on the server (`server/src/permissions.ts`), not only in the UI.
- Message, typing, voice and presence events are sent only to users who can see the channel.

### Deployment hardening (`deploy/`)

- **HTTPS.** Caddy obtains TLS certificates automatically.
- **Firewall.** ufw allows only SSH, HTTP/HTTPS, and the TURN ports.
- **systemd sandbox.** The service runs as a dedicated `nuntius` user with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` and `ProtectHome=read-only`. It can write only to `server/data`.
- **TURN.** coturn uses long-term credentials and denies relaying to private and loopback networks (`denied-peer-ip`), so it can't be used to reach the server's internal network.
- **Secrets.** `server/.env` holds the JWT secret, SMTP app password and TURN credentials. It is created by `setup.sh` with restrictive permissions and is git-ignored.

### Known limitations

- Messages are stored unencrypted in `server/data/db.json`, so whoever controls the server can read them. Voice and video are peer-to-peer WebRTC (DTLS-SRTP) unless relayed through TURN.
- Rate-limit counters live in memory and are lost on restart.
- The TURN credentials are static, not short-lived TURN REST credentials.
- There is no 2FA yet.

### Security fixes

- **Hard-coded JWT secret.** The server used to sign tokens with a hard-coded development secret whenever `JWT_SECRET` was not set. That string is visible in this public repository, so on such a deployment anyone could forge a login token for any user id. The production server was configured with a random secret by `setup.sh`. The fallback has now been removed, and the server refuses to start without a strong secret.
- **Missing limits.** Login and e-mail endpoints, and message sending, had no rate limits. Limits were added as described above.
- **Account lockout by strangers.** The first version of the login limit counted failures per login regardless of IP: 5 wrong passwords from anywhere locked the real owner out for 15 minutes, so anyone who knew a login could block that account. The strict limit is now per login + IP pair, so wrong passwords from an attacker's address don't block the owner's address. A softer per-login limit across all IPs (30 per hour) still slows down password guessing from many addresses. A successful login clears only that pair's counter, not the per-login one, so the owner signing in doesn't give a distributed attacker a fresh budget. Remaining trade-off: an attacker with many IP addresses can still exhaust the per-login limit and block that login for up to an hour.
- **Permissive CORS.** The API and Socket.IO accepted any origin. They are now restricted to the configured origins.

### Reporting a vulnerability

Please do not open a public issue for security problems. Contact the repository owner privately on GitHub, describe the issue, and give us time to fix it before disclosing.
