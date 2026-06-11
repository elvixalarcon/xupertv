#!/bin/sh
# Cola de descargas Cuevana (una película a la vez si ya hay yt-dlp activo).
# Uso: ./server/scripts/run-cuevana-downloads.sh 5
LIMIT="${1:-3}"
exec docker exec xupertv node /app/server/scripts/import-cuevana-download-queue.js --limit "$LIMIT"
