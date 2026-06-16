#!/usr/bin/env bash
# Compila VixMusic iOS (Capacitor) sin firmar → IPA para eSign / AltStore.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_APP="$ROOT/ios/App"
OUT_DIR="$ROOT/data/ipa"
IPA_NAME="VixMusic-unsigned.ipa"
SCHEME="App"
WORKSPACE="$IOS_APP/App.xcworkspace"

echo "==> VixMusic — IPA Capacitor sin firmar"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: este script solo corre en macOS (GitHub Actions macos-latest)."
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "Instala Xcode"; exit 1; }

echo "==> Node build (Capacitor)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi
npm ci
node scripts/copy-config-for-cap.js || true
CAPACITOR=1 npm run build
npx cap sync ios

BUILD_DIR="$IOS_APP/build"
rm -rf "$BUILD_DIR" Payload "$OUT_DIR/$IPA_NAME"
mkdir -p "$OUT_DIR"

echo "==> Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "==> xcodebuild (Release, sin firma)"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  -destination 'generic/platform=iOS' \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build

APP_PATH="$BUILD_DIR/DerivedData/Build/Products/Release-iphoneos/App.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "No se encontró App.app en $APP_PATH"
  find "$BUILD_DIR" -name 'App.app' -type d 2>/dev/null | head -5
  exit 1
fi

STAGE="$BUILD_DIR/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP_PATH" "$STAGE/Payload/"
(cd "$STAGE" && zip -qr "$OUT_DIR/$IPA_NAME" Payload)
rm -rf "$STAGE"

PBX="$IOS_APP/App.xcodeproj/project.pbxproj"
VERSION=$(grep -m1 'MARKETING_VERSION = ' "$PBX" | sed 's/.*= //;s/;//;s/ //g' || echo "1.0.0")
BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PBX" | sed 's/.*= //;s/;//;s/ //g' || echo "1")
cat > "$OUT_DIR/versions.json" <<EOF
{
  "versionName": "$VERSION",
  "versionCode": "$BUILD"
}
EOF

SIZE=$(du -h "$OUT_DIR/$IPA_NAME" | cut -f1)
echo ""
echo "✓ IPA generado: $OUT_DIR/$IPA_NAME ($SIZE) v$VERSION ($BUILD)"
