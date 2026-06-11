#!/usr/bin/env bash
# Compila APK móvil y TV con Docker (no requiere Android Studio en el host).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

IMAGE="${ANDROID_BUILD_IMAGE:-vixtv-android-builder}"
OUT="$ROOT/app/build/outputs/apk"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Construyendo imagen Android SDK (solo la primera vez)..."
  docker build -t "$IMAGE" -f "$ROOT/Dockerfile" "$ROOT"
fi

echo "==> Compilando APKs Vix TV"
docker run --rm \
  -v "$ROOT:/project" \
  -w /project \
  "$IMAGE" \
  bash -lc '
    if [ ! -x gradlew ]; then chmod +x gradlew; fi
    ./gradlew assembleMobileRelease assembleTvRelease --no-daemon
  '

echo ""
echo "APKs generados:"
find "$OUT" -name "*.apk" -type f 2>/dev/null | sort || echo "(revisa logs arriba si falló la compilación)"
echo ""
echo "  Móvil: $OUT/mobile/release/"
echo "  TV:    $OUT/tv/release/"

APK_DEST="$(cd "$ROOT/.." && pwd)/data/apk"
mkdir -p "$APK_DEST"
MOBILE_APK="$(find "$OUT/mobile/release" -name "*.apk" -type f 2>/dev/null | head -1)"
TV_APK="$(find "$OUT/tv/release" -name "*.apk" -type f 2>/dev/null | head -1)"
if [ -n "$MOBILE_APK" ]; then
  cp -f "$MOBILE_APK" "$APK_DEST/VixTV-mobile.apk"
  echo "  → Copiado a $APK_DEST/VixTV-mobile.apk"
fi
if [ -n "$TV_APK" ]; then
  cp -f "$TV_APK" "$APK_DEST/VixTV-tv.apk"
  echo "  → Copiado a $APK_DEST/VixTV-tv.apk"
fi

VERSIONS_JSON="$APK_DEST/versions.json"
MOBILE_META="$OUT/mobile/release/output-metadata.json"
TV_META="$OUT/tv/release/output-metadata.json"
if [ -f "$MOBILE_META" ] || [ -f "$TV_META" ]; then
  python3 - "$VERSIONS_JSON" "$MOBILE_META" "$TV_META" <<'PY'
import json, sys, datetime
out, mobile_meta, tv_meta = sys.argv[1:4]
def read_meta(path):
    if not path:
        return None
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        el = (data.get('elements') or [None])[0] or {}
        code = int(el.get('versionCode') or 0)
        name = str(el.get('versionName') or '').strip()
        return {'versionCode': code, 'versionName': name} if code > 0 else None
    except Exception:
        return None
payload = {
    'mobile': read_meta(mobile_meta),
    'tv': read_meta(tv_meta),
    'published_at': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
}
with open(out, 'w', encoding='utf-8') as f:
    json.dump(payload, f, indent=2)
    f.write('\n')
print(f"  → Versiones OTA: {out}")
PY
fi

PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"
if [ -f "$PROJECT_ROOT/server/scripts/sync-apk-versions.js" ]; then
  echo ""
  echo "==> Sincronizando versiones OTA en el servidor..."
  if docker compose -f "$PROJECT_ROOT/docker-compose.yml" ps -q xupertv 2>/dev/null | grep -q .; then
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T xupertv node server/scripts/sync-apk-versions.js
  elif command -v node >/dev/null 2>&1; then
    (cd "$PROJECT_ROOT" && node server/scripts/sync-apk-versions.js) || true
  else
    echo "  (omite sync: inicia el contenedor xupertv o ejecuta node server/scripts/sync-apk-versions.js)"
  fi
fi
