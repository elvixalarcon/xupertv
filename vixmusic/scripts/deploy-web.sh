#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="/var/www/html/vixmusic"
rsync -a --delete --exclude api --exclude private --exclude 'VixMusic*.apk' --exclude 'VixMusic*.ipa' "$ROOT/dist/" "$WEB/"
rsync -a "$ROOT/api/" "$WEB/api/"
[[ -d "$ROOT/private" ]] && rsync -a "$ROOT/private/" "$WEB/private/"
cp "$ROOT/public/versions.json" "$ROOT/public/app-config.json" "$WEB/" 2>/dev/null || true
[[ -f "$ROOT/public/descargar.html" ]] && cp "$ROOT/public/descargar.html" "$WEB/"
chown -R www-data:www-data "$WEB/api" "$WEB/private" 2>/dev/null || true
echo "✓ Desplegado en $WEB"
