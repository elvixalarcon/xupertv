#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="$ROOT/public/logo.svg"
TMP="/tmp/vixmusic-icon"

rsvg-convert -w 1024 -h 1024 "$LOGO" -o "$TMP-1024.png"

# iOS
cp "$TMP-1024.png" "$ROOT/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"

# Android mipmaps
gen() {
  local size=$1 dir=$2
  rsvg-convert -w "$size" -h "$size" "$LOGO" -o "$ROOT/android/app/src/main/res/$dir/ic_launcher.png"
  cp "$ROOT/android/app/src/main/res/$dir/ic_launcher.png" "$ROOT/android/app/src/main/res/$dir/ic_launcher_round.png"
}

gen 48 mipmap-mdpi
gen 72 mipmap-hdpi
gen 96 mipmap-xhdpi
gen 144 mipmap-xxhdpi
gen 192 mipmap-xxxhdpi

# Web / PWA
cp "$TMP-1024.png" "$ROOT/public/icon-512.png"
rsvg-convert -w 192 -h 192 "$LOGO" -o "$ROOT/public/icon-192.png"

echo "✓ Iconos VixMusic generados"
