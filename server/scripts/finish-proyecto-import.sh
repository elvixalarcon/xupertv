#!/bin/sh
# Espera la descarga y registra la película en Vix TV
LOG=/app/data/winscp/import-proyecto.log
FILE=""
for i in $(seq 1 720); do
  for f in /app/data/movies/Proyecto_Fin_del_Mundo_2026.mkv /app/data/movies/Proyecto_Fin_del_Mundo_2026.mp4; do
    if [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -gt 500000000 ]; then
      FILE="$f"
      break 2
    fi
  done
  sleep 60
done
if [ -z "$FILE" ]; then
  echo "[finish] Descarga no completada. Ver $LOG"
  exit 1
fi
node /app/server/scripts/register-local-movie.js "$FILE" "Proyecto Fin del Mundo" 2026
echo "[finish] Listo: $FILE"
