#!/usr/bin/env bash
# Compila Vix TV iOS nativo SIN firmar → IPA para eSign.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_APP="$ROOT/ios/App"
OUT_DIR="$ROOT/data/ipa"
IPA_NAME="VixTV.ipa"
SCHEME="App"
PROJECT="$IOS_APP/App.xcodeproj"

echo "==> Vix TV — IPA nativo sin firmar (eSign)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: este script solo corre en macOS (o GitHub Actions macos-latest)."
  exit 1
fi

command -v xcodebuild >/dev/null || { echo "Instala Xcode"; exit 1; }

BUILD_DIR="$IOS_APP/build"
rm -rf "$BUILD_DIR" Payload "$OUT_DIR/$IPA_NAME"

echo "==> Xcode: $(xcodebuild -version | tr '\n' ' ')"
echo "==> xcodebuild (SwiftUI nativo, sin Capacitor, weak SwiftUICore para iOS 17)"
xcodebuild \
  -project "$PROJECT" \
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

STAGE="$BUILD_DIR/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload" "$OUT_DIR"
cp -R "$APP_PATH" "$STAGE/Payload/"
(cd "$STAGE" && zip -qr "$OUT_DIR/$IPA_NAME" Payload)
rm -rf "$STAGE"

VERSION=$(grep -m1 'MARKETING_VERSION = ' "$PROJECT/project.pbxproj" | sed 's/.*= //;s/;//;s/ //g')
BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PROJECT/project.pbxproj" | sed 's/.*= //;s/;//;s/ //g')
cat > "$OUT_DIR/versions.json" <<EOF
{
  "versionName": "$VERSION",
  "versionCode": "$BUILD"
}
EOF

SIZE=$(du -h "$OUT_DIR/$IPA_NAME" | cut -f1)
echo ""
echo "✓ IPA generado: $OUT_DIR/$IPA_NAME ($SIZE) v$VERSION ($BUILD)"
echo "  Descarga: https://tv.vixred.com/ipa/ios"
