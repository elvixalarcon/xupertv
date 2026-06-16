#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="$ROOT/public/logo.svg"
LOGO_FG="$ROOT/public/logo-foreground.svg"
SPLASH="$ROOT/public/splash.svg"
TMP="/tmp/vixmusic-icon"

rsvg-convert -w 1024 -h 1024 "$LOGO" -o "$TMP-1024.png"

# iOS app icon
cp "$TMP-1024.png" "$ROOT/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"

# Android legacy launcher icons (pre-adaptive / fallback)
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

# Android adaptive icon foreground (lo que ve el usuario en Android 8+)
fg() {
  local size=$1 dir=$2
  rsvg-convert -w "$size" -h "$size" "$LOGO_FG" -o "$ROOT/android/app/src/main/res/$dir/ic_launcher_foreground.png"
}

fg 108 mipmap-mdpi
fg 162 mipmap-hdpi
fg 216 mipmap-xhdpi
fg 324 mipmap-xxhdpi
fg 432 mipmap-xxxhdpi

# Splash Android
splash() {
  local w=$1 h=$2 out=$3
  rsvg-convert -w "$w" -h "$h" "$SPLASH" -o "$ROOT/android/app/src/main/res/$out/splash.png"
}

rsvg-convert -w 480 -h 480 "$SPLASH" -o "$ROOT/android/app/src/main/res/drawable/splash.png"
splash 320 480 drawable-port-mdpi
splash 480 800 drawable-port-hdpi
splash 720 1280 drawable-port-xhdpi
splash 960 1600 drawable-port-xxhdpi
splash 1280 1920 drawable-port-xxxhdpi
splash 480 320 drawable-land-mdpi
splash 800 480 drawable-land-hdpi
splash 1280 720 drawable-land-xhdpi
splash 1600 960 drawable-land-xxhdpi
splash 1920 1280 drawable-land-xxxhdpi

# Web / PWA
cp "$TMP-1024.png" "$ROOT/public/icon-512.png"
rsvg-convert -w 192 -h 192 "$LOGO" -o "$ROOT/public/icon-192.png"

echo "✓ Iconos VixMusic generados (launcher, adaptive foreground, splash, iOS, web)"
