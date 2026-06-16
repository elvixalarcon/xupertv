#!/usr/bin/env bash
set -euo pipefail
WEB="/var/www/html/vixmusic"
REPO="elvixalarcon/xupertv"
TAG="${1:-vixmusic-ios-v1.3.0}"

URL="https://github.com/$REPO/releases/download/$TAG/VixMusic-unsigned.ipa"
echo "→ Descargando $URL"
curl -fsSL "$URL" -o "$WEB/VixMusic.ipa"
ls -lh "$WEB/VixMusic.ipa"
echo "✓ IPA publicada ($TAG)"
