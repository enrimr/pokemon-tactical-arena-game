#!/usr/bin/env bash
# Genera un ZIP reproducible del proyecto sin node_modules, cachés ni secretos.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="pokemon-tactical-arena.zip"
rm -f "$OUT"
zip -r "$OUT" . \
  -x "node_modules/*" \
  -x "*/node_modules/*" \
  -x "dist/*" \
  -x "*/dist/*" \
  -x "apps/server/dist/*" \
  -x "apps/client/dist/*" \
  -x "coverage/*" \
  -x ".DS_Store" -x "*/.DS_Store" \
  -x "$OUT" \
  -x "tools/_*.mjs" \
  > /dev/null
echo "Creado $OUT ($(du -h "$OUT" | cut -f1))"
