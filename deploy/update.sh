#!/usr/bin/env bash
# Обновить Nuntius до свежей версии из GitHub: sudo bash deploy/update.sh
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
[ "$(id -u)" -eq 0 ] || { echo "Запусти через sudo: sudo bash deploy/update.sh"; exit 1; }

echo "→ Забираю обновления…"
git pull --ff-only
echo "→ Ставлю зависимости…"
npm ci --no-audit --no-fund
echo "→ Собираю интерфейс…"
# Собираем рядом и подменяем папку разом: пока идёт сборка, сайт раздаёт прежнюю версию целиком
# (иначе телефон мог получить новую страницу без её скриптов и запомнить ошибку)
rm -rf client/dist.next client/dist.prev
(cd client && npx tsc --noEmit && npx vite build --outDir dist.next --emptyOutDir)
[ -d client/dist ] && mv client/dist client/dist.prev
mv client/dist.next client/dist
rm -rf client/dist.prev
echo "→ Перезапускаю…"
systemctl restart nuntius
sleep 2
systemctl --no-pager --lines=5 status nuntius || true
echo "✓ Готово"
