#!/usr/bin/env bash
# Firma VixTV.ipa en Linux con zsign + certificado Enterprise.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZSIGN="${ZSIGN:-/usr/local/bin/zsign}"
SIGN_DIR="$ROOT/data/ios-signing"
IPA_DIR="$ROOT/data/ipa"
UNSIGNED="$IPA_DIR/VixTV-unsigned.ipa"
SIGNED="$IPA_DIR/VixTV-signed.ipa"
OUTPUT="$IPA_DIR/VixTV.ipa"
BUNDLE_ID="com.huahaniosenterprisemobileprovision.hh.001"

P12="$SIGN_DIR/cert.p12"
PROV="$SIGN_DIR/profile.mobileprovision"
PASS_FILE="$SIGN_DIR/password.txt"

for f in "$P12" "$PROV" "$PASS_FILE"; do
  [[ -f "$f" ]] || { echo "Falta $f — sube certificado a data/ios-signing/"; exit 1; }
done

if [[ ! -x "$ZSIGN" ]]; then
  echo "Instala zsign en $ZSIGN (ver ios/ESIGN.md)"
  exit 1
fi

SRC="$UNSIGNED"
[[ -f "$SRC" ]] || SRC="$OUTPUT"
[[ -f "$SRC" ]] || { echo "No hay IPA para firmar en $IPA_DIR"; exit 1; }

cp -f "$SRC" "$UNSIGNED"
PASS="$(tr -d '\r\n' < "$PASS_FILE")"

echo "==> Firmando $UNSIGNED"
"$ZSIGN" -k "$P12" -p "$PASS" -m "$PROV" -b "$BUNDLE_ID" -o "$SIGNED" -z 9 "$UNSIGNED"
cp -f "$SIGNED" "$OUTPUT"
echo "✓ IPA firmado: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
