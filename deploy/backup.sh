#!/usr/bin/env bash
# Ежедневная копия базы Nuntius: /var/backups/nuntius/db-ГГГГ-ММ-ДД.json, храним 14 дней
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
DB="$APP/server/data/db.json"
DEST=/var/backups/nuntius
mkdir -p "$DEST"
chmod 700 "$DEST"
[ -f "$DB" ] || exit 0
cp "$DB" "$DEST/db-$(date +%F).json"
find "$DEST" -name 'db-*.json' -mtime +14 -delete
