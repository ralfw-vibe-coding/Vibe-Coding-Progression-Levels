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

# Zugangsdaten für externe Dienste stehen in .env — einer Datei, die absichtlich nicht im
# Repository liegt (siehe .gitignore). Sie fehlt also auf einem frischen Klon, und das ist
# kein Fehler: Ohne Schlüssel läuft die Anwendung weiter, nur mit weniger Kursquellen.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Ein belegter Port ist der häufigste Grund, warum der Start scheitert — meist läuft die
# Anwendung noch aus einem früheren Versuch. Deno meldet das nur als nackten Fehler, deshalb
# hier vorab nachsehen und sagen, wer den Port hält und was man tun kann.
if belegt=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null) && [ -n "$belegt" ]; then
  echo "Port $PORT ist belegt:" >&2
  echo "$belegt" | sed 1d | awk '{print "  " $1 " (PID " $2 ")"}' >&2
  echo "" >&2
  echo "Entweder den Prozess beenden:  kill $(echo "$belegt" | sed 1d | awk 'NR==1{print $2}')" >&2
  echo "oder einen anderen Port nehmen: ./run.sh $((PORT + 1))" >&2
  exit 1
fi

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
