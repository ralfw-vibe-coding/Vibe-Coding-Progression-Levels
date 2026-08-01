# Stufe 11 — Postgres statt SQLite

Übergeordneter Kontext: [Projekt.md](Projekt.md).

## Ziel dieser Stufe

Die Ereignisse liegen nicht mehr in einer SQLite-Datei auf der eigenen Platte, sondern in einer
Postgres-Datenbank in der Cloud ([Neon](https://neon.tech)). Der Server läuft weiterhin lokal —
nur die Daten sind umgezogen. Nach außen ändert sich nichts: gleicher Depotwert, gleiche
Positionen, gleiche Bedienung. Genau wie in Stufe 8 ist das Ergebnis unsichtbar, und das ist der
Punkt. Diese Stufe handelt davon, warum man das trotzdem tut.

## Der Preis war diesmal nicht eine Zeile

Stufe 8 (SQLite) war ein Umbau aus einer neuen Datei und einer geänderten Zeile in `main.js` —
weil `node:sqlite` eingebettet und synchron ist, genau wie die vorherige Datei-Lösung. Ein Aufruf
sprang in eine Bibliothek und kam mit dem Ergebnis zurück, ohne dass irgendwer warten musste.

Ein echter Postgres-Treiber übers Netz kann das nicht. Jede Abfrage geht über eine Leitung, und
über eine Leitung lässt sich nicht synchron sprechen — jeder Aufruf braucht `await`. Das hätte
harmlos bleiben können, wäre es auf den Event-Store beschränkt gewesen. War es nicht: `domain.js`
und weite Teile von `body.js` riefen den Event-Store bisher komplett synchron auf, ohne ein
einziges `await`. Der Umstieg zog sich deshalb durch die ganze Aufrufkette — Domäne, Body, Portal,
alle betroffenen Tests.

Die Lösung: Der `EventStore`-Vertrag selbst wurde async. Die drei bestehenden Ausprägungen
(Arbeitsspeicher, Datei, SQLite) blieben *intern* unverändert synchron — sie bekamen nur ein
`async` vor ihre drei Methoden und erfüllen damit denselben Vertrag wie Postgres, ohne dass sich
an ihrer Logik etwas geändert hätte. Was jetzt async ist, bleibt es, gleich welche Datenbank
später noch dazukommt — der Preis war einmalig.

## Was eine entfernte Datenbank tatsächlich bringt

Das ist die eigentliche Frage dieser Stufe, und die Antwort liegt nicht im Betrieb von heute,
sondern in dem, was sie erst möglich macht.

**Die Daten lösen sich vom Rechner des Servers.** Bisher galt: der Server *hat* seine Daten — sie
liegen auf derselben Platte, im selben Prozessraum. Mit einer entfernten Datenbank gilt: die Daten
*haben ihren eigenen Ort*, unabhängig davon, wo der Server gerade läuft. Das ist keine
Kleinigkeit, sondern die Voraussetzung für Stufe 12: Ein Server, der irgendwo in der Cloud
deployt wird, hat oft gar keine Platte, die ihm allein gehört und die einen Neustart übersteht.
SQLite bräuchte genau das. Postgres nicht.

**Der Server selbst wird austauschbar, nicht nur sein Code.** Das ist dieselbe Idee, die seit
Stufe 7 durchs Projekt läuft — Ausprägungen hinter einem Vertrag lassen sich ersetzen, ohne dass
der Rest etwas merkt —, nur eine Ebene höher angewendet. Bisher war *der Code* austauschbar (SQLite
gegen Postgres, eine Zeile in `main.js`). Jetzt ist *die Maschine* austauschbar: Der Server darf
abstürzen, neu gestartet, auf einen anderen Rechner verschoben oder mehrfach gleichzeitig
betrieben werden — die Daten sind davon unberührt, weil sie nie dort lagen.

**Man kommt an die Daten heran, von überall.** Schon Stufe 8 hat festgehalten: Mit einer
Datenbank lassen sich Fragen wie "wie viele Käufe pro Broker?" per Abfrage beantworten, ohne die
Anwendung zu starten. Das galt bisher nur auf dem einen Rechner, auf dem die Datei lag. Mit einer
entfernten Datenbank gilt es von jedem Rechner mit dem Connection String — `psql`, ein
Datenbank-Tool, ein zweites Skript, alles ohne SSH-Zugriff auf eine bestimmte Platte.

**Backup wird zur Aufgabe des Anbieters.** Dieselbe Lektion wie in Stufe 10, nur auf Daten statt
Code angewendet: Lokal committen schützt vor eigenen Fehlern, aber nur ein `git push` auf ein
entferntes Repository ist ein echtes Backup, weil es nicht auf demselben Gerät liegt wie der Rest.
Eine SQLite-Datei ist einen Festplattendefekt oder einen verlorenen Laptop von "weg" entfernt.
Eine verwaltete Postgres-Datenbank hat ihre eigene Redundanz, unabhängig vom eigenen Rechner.

## Was noch nicht gewonnen ist — solange der Server lokal bleibt

Der ehrliche Teil dieser Stufe, im selben Geist wie Stufe 8s "Zuerst ein Argument, das nicht
zählt": Nichts von alledem zahlt sich *heute* aus. Der Server läuft noch auf demselben Rechner wie
bisher, nur die Datenbank ist jetzt einen Kontinent-Bruchteil entfernt statt im selben
Verzeichnis. Nachgemessen mit demselben Store-Interface, derselben einzelnen Abfrage:

| | eine `query()` im Schnitt (30 Aufrufe, warmgelaufen) |
|---|---:|
| SQLite (Arbeitsspeicher) | **0,00 ms** |
| Postgres (Neon, eu-central-1) | **64,68 ms** |

Kein Tippfehler: eine eingebettete Datenbank ist praktisch kostenlos, eine entfernte kostet auf
jeden einzelnen Aufruf eine Netzwerk-Runde. Für diese Stufe ist das reiner Nachteil — mehr
Latenz, ein weiterer Dienst, der ausfallen kann (dieselbe Lektion wie bei den externen
Kursquellen aus Stufe 9: jede zusätzliche Abhängigkeit ist eine weitere Sache, die scheitern
kann). Der ganze Nutzen dieser Stufe ist auf Stufe 12 vertagt. Wer nur auf die Zahlen von heute
schaut, würde diesen Umbau nicht machen — er lohnt sich erst im Licht dessen, was er vorbereitet.

## Umwege

- **Zwei CLIs für Deno Deploy, nur eine funktioniert noch.** `deployctl` (das separate npm/jsr-
  Paket) spricht mit "Deno Deploy Classic", dessen v1-API laut Deno-Doku zum 20.07.2026 abgeschaltet
  wird — ein frisch erzeugter Zugangstoken wurde dort mit "bearer token is invalid" abgelehnt,
  nicht wegen eines Fehlers, sondern weil das Tool die falsche, auslaufende Plattform ansprach. Die
  in Deno selbst eingebaute `deno deploy`-CLI (`deno deploy whoami`) sprach denselben Token
  klaglos an.
- **Prisma Postgres über `deno deploy database provision` verworfen.** Technisch sofort verfügbar,
  aber die Zugangsdaten werden nur in die Deploy-Runtime injiziert — für einen lokal laufenden
  Server (genau das, was diese Stufe will) gibt es dort keinen abrufbaren Connection String, nur
  einen speziellen Tunnel-Modus. Neon liefert dagegen sofort einen gewöhnlichen
  `postgres://…`-String, verwendbar überall, mit jedem Treiber — das passt zum Rest des Projekts,
  das durchgehend ohne Framework auskommt.
- **`server/migriere.js` (Stufe 8) hätte beim async-Umbau still Daten verloren.** Die Schutzabfrage
  `vorhanden.length > 0` prüfte `store.query()` ohne `await` — mit dem neuen async-Vertrag wäre das
  ein `Promise`-Objekt gewesen, `.length` also `undefined`, die Abfrage `undefined > 0` immer
  `false`. Ein vorhandener Bestand wäre kommentarlos überschrieben worden. Beim Nachziehen des
  async-Umbaus aufgefallen und behoben, bevor es zum Problem wurde.
- **JSONB sortiert Objektschlüssel um.** Ein reiner `JSON.stringify`-Vergleich zwischen dem
  SQLite- und dem Postgres-Bestand nach der Migration schlug fehl — nicht wegen unterschiedlicher
  Daten, sondern weil Postgres beim Speichern als `JSONB` die Schlüsselreihenfolge nicht erhält.
  Ein schlüsselunabhängiger Vergleich bestätigte: inhaltlich identisch, alle 91 Ereignisse.

## Ergebnis

`server/postgresEventStore.js` ist die vierte Ausprägung des Event-Store-Vertrags, verifiziert
über dieselbe gemeinsame Testsuite wie die anderen drei. Die Seq-Vergabe läuft über eine echte
Postgres-Sequenz statt über das COALESCE(MAX)-Muster von SQLite — SQLite hat nie mehr als einen
Schreiber gleichzeitig, Postgres schon, und unter dessen Isolationsgrad wäre COALESCE(MAX)+1 in
einer einzelnen Anweisung eine echte Race Condition zwischen zwei Verbindungen.

`server/main.js` wählt Postgres, sobald `DATABASE_URL` gesetzt ist, sonst SQLite wie bisher — kein
Bruch für einen frischen Klon ohne eigene Datenbank. `server/migriere-postgres.js` hat den echten
Bestand übertragen: 91 von 91 Ereignissen, inhaltlich identisch, der Server meldet danach denselben
Depotwert wie zuvor — 20.031,85 € über 12 Positionen. Die SQLite-Datei bleibt als Backup liegen.

228 Tests laufen durch (209 wie zuvor plus 19 neue für die Postgres-Ausprägung), die bei fehlender
`DATABASE_URL` übersprungen statt fehlschlagen — ein frischer Klon ohne eigene Datenbank bleibt
grün.

## Mitgenommene Lektionen

- Nicht jeder Vertragswechsel ist ein Dateitausch. Ob eine Ausprägung synchron oder asynchron
  arbeiten *muss*, ist eine Eigenschaft der Ressource dahinter (eingebettet vs. übers Netz) — und
  wenn sich das ändert, ändert sich der Vertrag für alle, nicht nur für die neue Ausprägung.
- Austauschbarkeit lässt sich stapeln. Erst war der Code austauschbar (Provider hinter einem
  Vertrag), jetzt ist die Maschine austauschbar (Daten unabhängig vom Server-Rechner) — dieselbe
  Idee, eine Ebene höher.
- Der Nutzen einer entfernten Datenbank zeigt sich nicht im aktuellen Betrieb, sondern in dem, was
  sie für die *nächste* Stufe vorbereitet. Gemessen an heute ist sie nur langsamer und ein
  Ausfallrisiko mehr — genau wie Git lokal in Stufe 10 erst durch den späteren `push` zum echten
  Backup wurde.
- Dieselbe Lektion wie bei jedem externen Dienst (Stufe 9): eine Netzwerk-Abfrage ist niemals
  "genauso schnell, nur woanders". Nachmessen zeigt es sofort — 0 ms gegen 65 ms für denselben
  Aufruf.
- Ein Tool, das plötzlich einen validen Token ablehnt, muss nicht kaputt sein — es kann auch das
  falsche, auslaufende Tool für die aktuelle Plattform sein. Zwei CLIs mit ähnlichem Namen für
  denselben Anbieter war hier der eigentliche Fehler, nicht der Token.
- Bequem verfügbar (Prisma Postgres direkt über die schon authentifizierte Deno-CLI) schlägt nicht
  automatisch passend. Ein Connection String, der überall gleich funktioniert, war hier wichtiger
  als ein Weg ohne zusätzlichen Anbieter.
