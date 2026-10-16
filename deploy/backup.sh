#!/usr/bin/env bash
# Ежедневная копия Nuntius, храним 14 дней:
#  - база: /var/backups/nuntius/db-ГГГГ-ММ-ДД.json
#  - файлы (фото, видео, аватарки): /var/backups/nuntius/uploads-ГГГГ-ММ-ДД/
# Файлы под своим именем никогда не меняются (только появляются и удаляются), поэтому копия файлов —
# жёсткие ссылки: места почти не занимает, а удалённое из чата ещё 14 дней лежит в копиях.
# Можно запускать сколько угодно раз: копия за сегодня просто пересоздаётся.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$APP/server/data"
DB="$DATA/db.json"
UPLOADS="$DATA/uploads"
DEST="${NUNTIUS_BACKUP_DIR:-/var/backups/nuntius}"
DAY="$(date +%F)"
mkdir -p "$DEST"
chmod 700 "$DEST"

if [ -f "$DB" ]; then
  cp "$DB" "$DEST/db-$DAY.json"
fi
find "$DEST" -maxdepth 1 -name 'db-*.json' -mtime +14 -delete

if [ -d "$UPLOADS" ]; then
  SNAP="$DEST/uploads-$DAY"
  TMP="$DEST/.uploads-$DAY.tmp"
  rm -rf "$TMP"
  if cp -al "$UPLOADS" "$TMP" 2>/dev/null; then
    KEEP=14
  else
    # копии на другом диске — жёсткие ссылки не получатся: полная копия, но храним только 3 последние
    rm -rf "$TMP"
    cp -a "$UPLOADS" "$TMP"
    KEEP=3
  fi
  rm -rf "$SNAP"
  mv "$TMP" "$SNAP"
  # cp -a сохраняет дату папки — ставим сегодняшнюю, иначе уборка ниже сочла бы копию старой
  touch "$SNAP"
  if [ "$KEEP" = 14 ]; then
    find "$DEST" -maxdepth 1 -name 'uploads-*' -type d -mtime +14 -exec rm -rf {} +
  else
    ls -1d "$DEST"/uploads-* 2>/dev/null | sort | head -n -3 | xargs -r rm -rf
  fi
fi
