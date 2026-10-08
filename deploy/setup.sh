#!/usr/bin/env bash
# =====================================================================
#  Nuntius — установка на сервер (VPS с Ubuntu 22.04 / 24.04) одной командой:
#     sudo bash deploy/setup.sh
#  Можно запускать повторно: уже настроенное не ломается, секреты из .env сохраняются.
#  DRY_RUN=1 — только показать, что будет сделано (ничего не меняет).
# =====================================================================
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP/server/.env"
DRY="${DRY_RUN:-0}"

say() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }

# Ввод с клавиатуры даже если скрипт запущен через конвейер
ask() { # ask ПЕРЕМЕННАЯ "Вопрос" [по умолчанию]
  local __var=$1 __q=$2 __def=${3:-} __ans=''
  if [ -n "$__def" ]; then printf '%s [%s]: ' "$__q" "$__def"; else printf '%s: ' "$__q"; fi
  read -r __ans 2>/dev/null </dev/tty || echo
  printf -v "$__var" '%s' "${__ans:-$__def}"
}
ask_secret() { # ask_secret ПЕРЕМЕННАЯ "Вопрос"
  local __var=$1 __q=$2 __ans=''
  printf '%s: ' "$__q"
  read -r -s __ans 2>/dev/null </dev/tty || true
  echo
  printf -v "$__var" '%s' "$__ans"
}

# Значение из существующего .env (чтобы при повторном запуске не терять секреты)
env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed 's/^"\(.*\)"$/\1/' || true; }

render() { # render ШАБЛОН КУДА — подставляет __APP__, __DOMAIN__, __TURN_USER__, __TURN_PASS__
  local out
  out=$(sed -e "s|__APP__|$APP|g" -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__TURN_USER__|$TURN_USER|g" -e "s|__TURN_PASS__|$TURN_PASS|g" "$1")
  if [ "$DRY" = 1 ]; then echo "  [dry-run] записать $2:"; echo "$out" | sed 's/^/      /'; else printf '%s\n' "$out" >"$2"; fi
}

[ "$DRY" = 1 ] || [ "$(id -u)" -eq 0 ] || die "Запусти от root: sudo bash deploy/setup.sh"
[ -f "$APP/package.json" ] || die "Не нашёл Nuntius в $APP — запускай скрипт из папки проекта"

echo
echo "  ✦ Nuntius — установка на сервер"
echo "  Папка приложения: $APP"

# ---------- вопросы ----------

say "Пара вопросов"
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '')
OLD_DOMAIN=$(env_get NUNTIUS_DOMAIN)
DEFAULT_DOMAIN=${OLD_DOMAIN:-}
if [ -z "$DEFAULT_DOMAIN" ] && [ -n "$PUBLIC_IP" ]; then DEFAULT_DOMAIN="$(echo "$PUBLIC_IP" | tr . -).sslip.io"; fi
echo "Адрес сайта. Есть свой домен (например nuntius.ru) — впиши его."
echo "Нет домена — просто нажми Enter: возьмём бесплатный адрес $DEFAULT_DOMAIN"
ask DOMAIN "Домен" "$DEFAULT_DOMAIN"
DOMAIN=$(echo "$DOMAIN" | sed -e 's|^https\?://||' -e 's|/.*$||' | tr '[:upper:]' '[:lower:]')
[ -n "$DOMAIN" ] || die "Без адреса никак"

SMTP_USER=$(env_get SMTP_USER); SMTP_USER=${SMTP_USER:-Nuntiuspilulae@yandex.com}
SMTP_PASS=$(env_get SMTP_PASS)
if [ -z "$SMTP_PASS" ] || [ "$SMTP_PASS" = "сюда_пароль_приложения_из_16_букв" ]; then
  echo "Пароль приложения Яндекс-почты $SMTP_USER (для писем с кодами). Ввод не виден — это нормально."
  ask_secret SMTP_PASS "Пароль приложения"
fi

OWNER=$(env_get NUNTIUS_OWNER)
echo "Логин владельца Nuntius (у него будет админка). Пусто — владельцем станет самый первый зарегистрированный."
ask OWNER "Логин владельца" "$OWNER"

JWT_SECRET=$(env_get JWT_SECRET); [ -n "$JWT_SECRET" ] || JWT_SECRET=$(openssl rand -hex 32)
TURN_USER=$(env_get TURN_USERNAME); TURN_USER=${TURN_USER:-nuntius}
TURN_PASS=$(env_get TURN_CREDENTIAL); [ -n "$TURN_PASS" ] || TURN_PASS=$(openssl rand -hex 16)

# ---------- система ----------

say "Подкачка (сборке интерфейса нужно немного памяти)"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show | grep -q .; then
  run fallocate -l 2G /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || run sh -c "echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  ok "Добавлено 2 ГБ подкачки"
else
  ok "Памяти хватает"
fi

say "Пакеты: Node.js 22, git, Caddy (HTTPS), coturn (голос), ufw (фаервол)"
export DEBIAN_FRONTEND=noninteractive
run apt-get update -y
# coturn и Caddy лежат в разделе universe — на некоторых VPS он выключен
if ! grep -rqs '^[^#].* universe' /etc/apt/sources.list /etc/apt/sources.list.d/ && ! grep -rqs 'Components:.*universe' /etc/apt/sources.list.d/; then
  run apt-get install -y software-properties-common
  run add-apt-repository -y universe
  run apt-get update -y
fi
run apt-get install -y curl ca-certificates gnupg git openssl ufw coturn debian-keyring debian-archive-keyring apt-transport-https
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }
if ! node_ok; then
  # NodeSource; не открылся — ставим через snap
  if run sh -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs'; then :; fi
  if [ "$DRY" != 1 ] && ! node_ok; then
    run snap install node --classic --channel=22
    hash -r
  fi
  [ "$DRY" = 1 ] || node_ok || die "Не получилось поставить Node.js 22 — напиши мне, что выше в выводе"
fi
if ! command -v caddy >/dev/null; then
  # официальный репозиторий Caddy; не вышло — берём из Ubuntu
  if run sh -c "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list && apt-get update -y"; then
    run apt-get install -y caddy
  else
    run apt-get install -y caddy
  fi
fi
ok "Пакеты на месте"

say "Пользователь nuntius (от него работает приложение)"
if ! id nuntius >/dev/null 2>&1; then run useradd --system --home /var/lib/nuntius --create-home --shell /usr/sbin/nologin nuntius; fi
run mkdir -p "$APP/server/data"
run chown -R nuntius:nuntius "$APP/server/data"
ok "Готово"

# ---------- приложение ----------

say "Настройки приложения (server/.env)"
ENV_TEXT="# Создано deploy/setup.sh — НИКОМУ не показывай этот файл
NUNTIUS_DOMAIN=$DOMAIN
PORT=3001
JWT_SECRET=$JWT_SECRET
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=465
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=\"Nuntius <$SMTP_USER>\"
TURN_URL=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
TURN_USERNAME=$TURN_USER
TURN_CREDENTIAL=$TURN_PASS
NUNTIUS_OWNER=$OWNER"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] записать $ENV_FILE (пароли скрыты)"
  echo "$ENV_TEXT" | sed -E 's/^(JWT_SECRET|SMTP_PASS|TURN_CREDENTIAL)=.*/\1=***/' | sed 's/^/      /'
else
  (umask 077 && printf '%s\n' "$ENV_TEXT" >"$ENV_FILE")
  chown nuntius:nuntius "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
ok "Секреты сохранены (только для пользователя nuntius)"

say "Ставлю зависимости и собираю интерфейс (пара минут)"
run sh -c "cd '$APP' && npm ci --no-audit --no-fund && npm run build"
ok "Собрано"

say "Автозапуск (systemd)"
render "$APP/deploy/nuntius.service" /etc/systemd/system/nuntius.service
run systemctl daemon-reload
run systemctl enable nuntius
run systemctl restart nuntius
ok "Nuntius запущен и сам поднимется после перезагрузки"

say "HTTPS (Caddy)"
render "$APP/deploy/Caddyfile.template" /etc/caddy/Caddyfile
run systemctl enable caddy
run systemctl reload-or-restart caddy
ok "Caddy сам получит сертификат для https://$DOMAIN"

say "Голос через сложные сети (coturn)"
render "$APP/deploy/turnserver.conf.template" /etc/turnserver.conf
# Хостинг выдаёт IP через NAT (адреса нет на сетевой карте) — TURN должен знать внешний адрес
LOCAL_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -n1)
if [ -n "$PUBLIC_IP" ] && [ -n "$LOCAL_IP" ] && [ "$PUBLIC_IP" != "$LOCAL_IP" ]; then
  if [ "$DRY" = 1 ]; then echo "  [dry-run] external-ip=$PUBLIC_IP/$LOCAL_IP"; else echo "external-ip=$PUBLIC_IP/$LOCAL_IP" >>/etc/turnserver.conf; fi
fi
[ -f /etc/default/coturn ] && run sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
run systemctl enable coturn
run systemctl restart coturn
ok "TURN работает на порту 3478"

say "Фаервол"
run ufw allow OpenSSH
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw allow 443/udp
run ufw allow 3478/tcp
run ufw allow 3478/udp
run ufw allow 49160:49200/udp
run ufw --force enable
ok "Открыты только нужные порты (сайт, голос, SSH)"

say "Ежедневная копия базы"
run chmod +x "$APP/deploy/backup.sh" "$APP/deploy/update.sh"
CRON_LINE="17 4 * * * root $APP/deploy/backup.sh"
if [ "$DRY" = 1 ]; then echo "  [dry-run] /etc/cron.d/nuntius-backup: $CRON_LINE"; else echo "$CRON_LINE" >/etc/cron.d/nuntius-backup; fi
ok "Копии — в /var/backups/nuntius (14 дней)"

echo
echo "  ✦ Готово! Nuntius: https://$DOMAIN"
echo
echo "  • Первый вход: зарегистрируйся на сайте${OWNER:+ под логином $OWNER} — у тебя будет админка."
echo "  • Если сайт не открылся сразу — подожди минуту: Caddy получает сертификат."
echo "  • Обновить:    sudo bash $APP/deploy/update.sh"
echo "  • Логи:        journalctl -u nuntius -f"
echo "  • Проверить почту: cd $APP && sudo -u nuntius npm run check-mail"
echo
