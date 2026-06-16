#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Define GITHUB_TOKEN"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${TMPDIR:-/tmp}/xupertv-push-$$"
REPO="https://x-access-token:${GITHUB_TOKEN}@github.com/elvixalarcon/xupertv.git"

rm -rf "$WORKDIR"
git clone --depth 1 "$REPO" "$WORKDIR"

rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude android/app/build \
  --exclude android/.gradle \
  --exclude android/.kotlin \
  --exclude '*.apk' \
  --exclude android/vixmusic-release.keystore \
  --exclude android/keystore.properties \
  --exclude .git \
  "$ROOT/" "$WORKDIR/vixmusic/"

cp "$ROOT/.github/workflows/vixmusic-ios-ipa.yml" "$WORKDIR/.github/workflows/vixmusic-ios-ipa.yml"

cd "$WORKDIR"
git config user.email "deploy@vixmusic.local"
git config user.name "VixMusic"
git add -A
if git diff --staged --quiet; then
  echo "Sin cambios"
else
  git commit -m "VixMusic 1.3.8: fix actualización, favoritos y cierre preview"
  git push origin main
fi

curl -sS -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/elvixalarcon/xupertv/actions/workflows/vixmusic-ios-ipa.yml/dispatches" \
  -d '{"ref":"main"}'

echo "OK: workflow IPA disparado"
