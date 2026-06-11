#!/bin/sh
# Cron de respaldo (el servidor ya programa a las 2:00 AM Ecuador).
# Instalar: crontab -e y añadir la línea que imprime este script.
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LINE="0 7 * * * docker exec xupertv node /app/server/scripts/run-vod-nightly.js >> $DIR/data/winscp/vod-nightly-cron.log 2>&1"
echo "# Vix TV — 2:00 AM Ecuador ≈ 07:00 UTC (sin horario de verano en Ecuador)"
echo "$LINE"
