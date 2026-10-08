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
npm run build
echo "→ Перезапускаю…"
systemctl restart nuntius
sleep 2
systemctl --no-pager --lines=5 status nuntius || true
echo "✓ Готово"
