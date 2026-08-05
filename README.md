# Mein Depot

Läuft ab Stufe 12 im Web — bei Deno Deploy unter einer Adresse der Form
`https://<app>.<org>.deno.net` (siehe `Verlauf/Stufe 12.md`).

Voraussetzung fürs lokale Arbeiten: [Deno](https://deno.com) installiert. Deno ist ab Stufe 7 die
Laufzeitumgebung der ganzen Anwendung, nicht mehr nur der Tests.

## App starten

```bash
deno task serve
```

Dann `http://localhost:8000` im Browser öffnen.

## Anmelden

Seit Stufe 13 verlangt die Anwendung einen Ausweis. Es gibt zwei Wege hinein, und beide führen
zum selben Depot — es gibt ja nur eines:

**Für Menschen: Einmalcode per E-Mail.** Man gibt seine Adresse ein und bekommt einen
sechsstelligen Code zugeschickt, der zehn Minuten und nur einmal gilt. Danach hält ein Token die
Sitzung sieben Tage lang offen.

Anmelden darf nur, wer freigeschaltet ist. Die Liste pflegt der Verwalter (`ADMIN_EMAIL`) über den
Personen-Knopf in der Kopfzeile — er selbst steht nicht darin, sein Zugang kommt aus der
Konfiguration. Wer jemanden entfernt, sperrt ihn sofort aus: Auch ein noch gültiges Token verliert
augenblicklich seine Wirkung.

`AUTH_SECRET_OTP` ist ein Code, der immer gilt — der Weg hinein, wenn der Mailversand hakt. Er ist
kein Bequemlichkeitscode, sondern ein zweiter Generalschlüssel: lang und zufällig wählen, nie in
einer Nachricht weitergeben. Er hebelt die Zugangsliste **nicht** aus.

Läuft der Server ohne `RESEND_API_KEY`, landen die Codes auf der Konsole — praktisch beim
Entwickeln. Deployt gibt es dann keine Anmeldung per Code, weil Anmeldecodes sonst im Protokoll
stünden.

**Für Maschinen: der API-Schlüssel.** Ein Skript kann keinen Code aus einem Postfach holen, also
bleibt `BACKEND_API_KEY` bestehen (siehe unten). Wer ihn hat, gilt als Verwalter.

## Ins Web deployen

```bash
deno task deploy
```

Ziel, Entrypoint und Runtime-Modus stehen in `deploy.json` (Vorlage: `deploy.json.example`). Die
Zugangsdaten liegen nicht im Repository, sondern einmalig bei der Plattform:

```bash
deno deploy env add DATABASE_URL "postgres://…" --secret
deno deploy env list        # Werte bleiben verborgen (value: null)
```

Ohne `--secret` wäre der Wert später wieder auslesbar. Zu setzen sind `DATABASE_URL`,
`BACKEND_API_KEY`, `ADMIN_EMAIL`, `AUTH_SESSION_SECRET`, `JWT_TTL_SECONDS`, `RESEND_API_KEY`,
`AUTH_FROM_EMAIL`, `AUTH_SECRET_OTP`, `TWELVE_DATA_API_KEY` und `FINNHUB_API_KEY`.

Immer nur **einen** Deploy anstoßen und durchlaufen lassen — ein zweiter bricht den ersten ab.

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
| Wer bin ich? | `GET /api/ich` |
| Zugangsliste lesen / ergänzen | `GET` bzw. `POST /api/nutzer` |
| Zugang entziehen | `DELETE /api/nutzer/{email}` |

Statt des Schlüssels geht auch ein Sitzungstoken: `-H "Authorization: Bearer DEIN-TOKEN"`. Die
beiden Anmeldeendpunkte brauchen naturgemäß keinen Ausweis:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"email":"du@beispiel.de"}' \
  http://localhost:8000/api/anmeldung/code
curl -X POST -H "Content-Type: application/json" -d '{"email":"du@beispiel.de","code":"123456"}' \
  http://localhost:8000/api/anmeldung/einloesen
```

## Tests ausführen

```bash
deno task test
```

Mit Testabdeckung:

```bash
deno task coverage
```

## Pre-Commit-Hook einrichten (einmalig)

```bash
deno task hooks-einrichten
```

Danach prüft Git vor jedem `git commit` zweierlei — beides verhindert den Commit, statt das
Problem in der Historie zu verstecken:

1. **Kein Geheimnis geht mit.** Der Hook vergleicht die vorgemerkten Dateien mit den Werten aus
   der eigenen `.env`; taucht einer davon auf, bricht er ab und nennt die Variable (nie den
   Wert). Auch `.env` selbst lässt sich so nicht versehentlich committen. Das ist keine
   Mustererkennung, sondern ein Abgleich mit den tatsächlichen Werten: Es findet genau den
   Fehler, um den es geht — einen echten Wert, in eine Testdatei kopiert —, sieht aber nichts,
   was nicht in `.env` steht.
2. **Die Testsuite läuft durch.**

Der Hook liegt unter `.githooks/` im Repository (Git kennt diesen Pfad erst nach der
Einrichtung, siehe `Verlauf/Stufe 10.md`) und lässt sich im Notfall mit `git commit --no-verify`
umgehen. Er wirkt nur auf dem Rechner, auf dem er eingerichtet wurde — ein frischer Klon ist
ungeschützt, bis `deno task hooks-einrichten` gelaufen ist.

## Aufbau

```
server/    Body, Domäne, Event-Store, Persistenz — und das Portal, das den API bereitstellt
           und die Client-Dateien ausliefert.
client/    Portal (alles DOM), Body, eine dünne Domäne für Filter und Auswertungen sowie der
           Proxy, der den API des Servers kapselt.
tests/     Getrennt nach server/ und client/.
```

Der Zustand liegt als Ereignisliste in einer Datenbank und wird bei jeder Erfassung
fortgeschrieben — ein Export ist dafür nicht mehr nötig. Welche Datenbank das ist, entscheidet
eine einzige Umgebungsvariable:

- **Ohne `DATABASE_URL`** (Vorgabe): SQLite in `server/data/depot.sqlite`. Läuft ohne jede
  Einrichtung, auch offline.
- **Mit `DATABASE_URL`** (Connection String, z. B. von [Neon](https://neon.tech), in `.env`):
  Postgres. Server und Client bleiben dieselben — nur die Ereignisse liegen jetzt woanders (siehe
  `Verlauf/Stufe 11.md`).

Der Datei-Export bleibt in beiden Fällen sinnvoll: für Backups, den Umzug auf ein anderes Gerät
und die Weitergabe (siehe `Verlauf/Stufe 05.md`). `startbestand.json` im Wurzelverzeichnis ist ein
Beispielbestand zum Importieren.

Umzüge zwischen den Speicherarten sind je ein eigener, expliziter Schritt:

```bash
deno task migriere            # JSON-Datei (vor Stufe 8) -> SQLite
deno task migriere-postgres   # SQLite -> Postgres, braucht DATABASE_URL in .env
```

Beide brechen ab, statt einen bereits gefüllten Zielspeicher zu überschreiben (`--ueberschreiben`
erzwingt es); die jeweilige Quelle bleibt unangetastet liegen.
