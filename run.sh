#!/usr/bin/env bash
#
# Startet "Mein Depot". Aufruf:
#
#   ./run.sh          startet auf Port 8000
#   ./run.sh 8080     startet auf Port 8080
#
set -euo pipefail

# Ins Projektverzeichnis wechseln, damit das Skript von überall aus aufgerufen werden kann.
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v deno > /dev/null 2>&1; then
  echo "Deno ist nicht installiert. Installation: https://deno.com" >&2
  exit 1
fi

export PORT="${1:-${PORT:-8000}}"

# Deno erlaubt standardmäßig gar nichts — jedes Recht muss einzeln erteilt werden. Diese vier
# braucht der Server, mehr nicht:
#   --allow-net     auf dem Port lauschen und Anfragen beantworten
#   --allow-read    Client-Dateien ausliefern, Ereignisse und API-Schlüssel lesen
#   --allow-write   Ereignisse und API-Schlüssel nach server/data/ schreiben
#   --allow-env     die PORT-Variable auslesen
exec deno run \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  server/main.js
