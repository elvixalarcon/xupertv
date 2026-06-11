#!/usr/bin/env bash
# Compila Vix TV para iOS SIN firmar → IPA listo para eSign / AltStore / Sideloadly.
# Requiere: macOS, Xcode 15+, CocoaPods, Node 18+
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_APP="$ROOT/ios/App"
OUT_DIR="$ROOT/data/ipa"
IPA_NAME="VixTV.ipa"
SCHEME="App"
WORKSPACE="$IOS_APP/App.xcworkspace"

echo "==> Vix TV — IPA sin firmar (para eSign)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: este script solo corre en macOS (o GitHub Actions macos-latest)."
  echo "En Linux usa: .github/workflows/ios-ipa.yml en GitHub Actions."
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "Instala Xcode"; exit 1; }
command -v pod >/dev/null || { echo "Instala CocoaPods: sudo gem install cocoapods"; exit 1; }

echo "==> npm install + cap sync ios"
npm install
npx cap sync ios

echo "==> pod install"
cd "$IOS_APP"
pod install

BUILD_DIR="$IOS_APP/build"
rm -rf "$BUILD_DIR" Payload "$OUT_DIR/$IPA_NAME"

echo "==> xcodebuild (sin firma)"
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
  exit 1
fi

mkdir -p Payload "$OUT_DIR"
cp -R "$APP_PATH" Payload/
(cd "$IOS_APP" && zip -qr "$OUT_DIR/$IPA_NAME" Payload)
rm -rf Payload

SIZE=$(du -h "$OUT_DIR/$IPA_NAME" | cut -f1)
echo ""
echo "✓ IPA generado: $OUT_DIR/$IPA_NAME ($SIZE)"
echo "  Descarga: https://tv.vixred.com/ipa/ios"
echo "  En iPhone: guardar → abrir con eSign → firmar → instalar"
