#!/bin/bash
# Captura tráfico de la app MXL (tv-phones.apk) con mitmproxy.
# Uso en el teléfono: WiFi → Proxy manual → IP de este servidor, puerto 8888
# Instalar certificado: /root/.mitmproxy/mitmproxy-ca-cert.cer en el Android

set -euo pipefail
PORT="${CAPTURE_PORT:-8888}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="/tmp/mxl-capture.log"
CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.cer"

echo "=== Captura MXL / ECDF ==="
echo "Proxy escuchando en 0.0.0.0:${PORT}"
echo "Certificado CA: ${CERT}"
echo ""
echo "En tu Android:"
echo "  1. Misma red WiFi que este servidor"
echo "  2. Ajustes WiFi → Proxy manual → IP:$(hostname -I | awk '{print $1}') Puerto:${PORT}"
echo "  3. Abre http://mitm.it en el navegador del teléfono e instala certificado Android"
echo "  4. Abre la app MXL TV y reproduce ECDF"
echo ""
echo "Log: ${LOG}"
echo ""

if ! pgrep -f "mitmdump -p ${PORT}" >/dev/null; then
  mitmdump -p "$PORT" -s "${SCRIPT_DIR}/mxl_capture_addon.py" --set block_global=false >>"$LOG" 2>&1 &
  sleep 2
fi

tail -f "$LOG"
