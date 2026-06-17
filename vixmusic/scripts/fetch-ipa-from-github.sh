#!/usr/bin/env bash
set -euo pipefail
WEB="/var/www/html/vixmusic"
REPO="elvixalarcon/xupertv"
TAG="${1:-vixmusic-ios-v1.3.0}"

if [[ -z "${GITHUB_TOKEN:-}" && -f /root/.config/vixmusic/github.env ]]; then
  GITHUB_TOKEN=$(grep GITHUB_TOKEN /root/.config/vixmusic/github.env | cut -d= -f2-)
  export GITHUB_TOKEN
fi

URL="https://github.com/$REPO/releases/download/$TAG/VixMusic-unsigned.ipa"
echo "→ Descargando $URL"
CURL_OPTS=(-fsSL)
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CURL_OPTS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
fi
curl "${CURL_OPTS[@]}" "$URL" -o "$WEB/VixMusic.ipa"
ls -lh "$WEB/VixMusic.ipa"
echo "✓ IPA publicada ($TAG)"
