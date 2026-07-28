# Mein Depot

Voraussetzung: [Deno](https://deno.com) installiert. Deno ist ab Stufe 7 die Laufzeitumgebung der
ganzen Anwendung, nicht mehr nur der Tests.

## App starten

```bash
deno task serve
```

Dann `http://localhost:8000` im Browser öffnen. Beim ersten Start wird ein API-Schlüssel erzeugt
und auf der Konsole ausgegeben; er bleibt über Neustarts hinweg derselbe.

## App über den API benutzen

Die Oberfläche im Browser ist nur einer von mehreren möglichen Clients — mit dem API-Schlüssel
lässt sich dasselbe direkt vom Terminal aus tun:

```bash
curl -H "X-API-Key: DEIN-SCHLUESSEL" http://localhost:8000/api/depot
```

Eine neue Position erfassen:

```bash
curl -X POST -H "X-API-Key: DEIN-SCHLUESSEL" -H "Content-Type: application/json" -d '{"wertpapierId":"A1B2C3","name":"Beispiel AG","typ":"Aktie","broker":"comdirect","stueck":10,"kaufkurs":100,"kurs":120,"datum":"2026-07-27"}' http://localhost:8000/api/neue-position
```

| Zweck | Aufruf |
|---|---|
| Depot mit allen Positionen | `GET /api/depot` |
| Nachkauf zu einer Position | `POST /api/kauf` |
| Kurs aktualisieren | `POST /api/kursupdate` |
| Neue Position (Kauf + Kurs) | `POST /api/neue-position` |
| Verlauf einer Position | `GET /api/verlauf/{wertpapierId}?broker={broker}` |
| Alle Ereignisse auslesen | `GET /api/events` |
| Alle Ereignisse ersetzen | `PUT /api/events` |

## Tests ausführen

```bash
deno task test
```

Mit Testabdeckung:

```bash
deno task coverage
```

## Aufbau

```
server/    Body, Domäne, Event-Store, Persistenz — und das Portal, das den API bereitstellt
           und die Client-Dateien ausliefert.
client/    Portal (alles DOM), Body, eine dünne Domäne für Filter und Auswertungen sowie der
           Proxy, der den API des Servers kapselt.
tests/     Getrennt nach server/ und client/.
```

Der Zustand liegt als Ereignisliste in der SQLite-Datenbank `server/data/depot.sqlite` und wird
bei jeder Erfassung fortgeschrieben — ein Export ist dafür nicht mehr nötig. Der Datei-Export
bleibt trotzdem: für Backups, den Umzug auf ein anderes Gerät und die Weitergabe (siehe
`Verlauf/Stufe 05.md`). `startbestand.json` im Wurzelverzeichnis ist ein Beispielbestand zum
Importieren.

Wer noch einen Bestand aus der Zeit vor der Datenbank hat (`server/data/depot-events.json`),
holt ihn einmalig herüber:

```bash
deno task migriere
```
