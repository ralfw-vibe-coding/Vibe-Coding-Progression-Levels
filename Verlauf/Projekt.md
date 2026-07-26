# Projekt: Vibe Coding in Stufen

## Thema

Leitprojekt ist ein persönlicher Investment-Portfolio-Tracker: Käufe, Verkäufe, Dividenden und
Kursaktualisierungen werden als Einträge in einem Append-only Event-Log erfasst. Aus diesem Log
lassen sich Depotwert, Positionen und Entwicklung ableiten und anzeigen — angelehnt an das, was
man von der Oberfläche eines Online-Brokers kennt, aber bewusst eigenständig gestaltet statt
nachgebaut.

## Konzept

Das Datenmodell bleibt über den gesamten Verlauf gleich. Was wächst, ist ausschließlich die
Infrastruktur drumherum: von einer einzelnen HTML-Datei ohne jede Laufzeit-Logik bis zu einem
mehrbenutzerfähigen, in der Cloud deployten Multi-Tenant-Dienst mit eigener Datenbank, Auth und
CI/CD. Jede Stufe führt genau ein neues technisches Konzept ein und baut auf der vorherigen auf.
Nicht jede Stufe wirkt sich sichtbar auf die Nutzung aus — manche bereiten nur eine spätere,
sichtbare Verbesserung vor. Das ist Teil der Lektion, nicht ein Mangel.

Jede Stufe wird in einer eigenen Datei in diesem Verzeichnis dokumentiert (`Stufe ##.md`) — nicht
nur das Ergebnis, sondern auch der Weg dorthin, inklusive Umwegen und Korrekturen.

![Vibe Coding – Die 16 Stufen: von der Datei zur sicheren Mehrkundenplattform](assets/vibe%20coding%20-%20die%2016%20stufen.png)

## Die Stufen — was für den Entwickler jeweils neu ist

1. **Statische Seite** — Daten rein, HTML raus: eine App ganz ohne Laufzeit-Logik und ohne Server.
2. **Interaktive Seite** — erste Interaktivität im Browser; Zustand existiert nur im Speicher des
   offenen Tabs.
3. **Automatisierte Tests** — Domänenlogik und weitere Komponenten automatisiert testen und
   Testabdeckung messen; setzt eine Refaktorisierung der bis dahin einzelnen HTML-Datei voraus.
4. **Persistenz mit localStorage** — Zustand übersteht erstmals einen Reload, bleibt aber an ein
   Gerät gebunden.
5. **Zustand laden/speichern (JSON)** — das Datenmodell wird als Append-only Event-Log explizit
   fassbar, exportier- und importierbar als Datei.
6. **Mehrere Seiten/Views** — erste Strukturentscheidung jenseits einer einzelnen Seite
   (clientseitiges Routing).
7. **Deno-Server mit eigener API** — erste Trennung von Frontend und Backend; dieselbe
   Funktionalität wird zusätzlich über eine API nutzbar.
8. **Echte Datenbank: SQLite** — erste "richtige" Datenbank, Grundlage für parallele Zugriffe
   mehrerer Tabs/Skripte.
9. **Externer HTTP-Service** — Umgang mit externen Abhängigkeiten, Fehlerbehandlung und
   Rate Limits.
10. **Git lokal** — Versionskontrolle als stille Vorbereitung, die sich erst später (Stufe 14)
    sichtbar auszahlt.
11. **Postgres statt SQLite** — Umgang mit Connection Strings und Secrets für eine
    Cloud-Datenbank; der Server selbst läuft noch lokal.
12. **Deployment ins Web** — erster echter Web-Deploy, Umgang mit einer Deploy-CLI und
    Env-Variablen im Cloud-Kontext.
13. **Auth mit OTP + Multi-User** — erster Auth-Layer; das Datenmodell bleibt unverändert, nur
    wer reinkommt ändert sich.
14. **GitHub-Repo + automatisches Deployment** — Deployment wird reproduzierbar, Team-Arbeit am
    Code wird möglich.
15. **Umgebungen trennen (lokal SQLite / Production Postgres)** — eine Codebasis mit zwei
    Backends je nach Umgebung, über eine DB-Abstraktionsschicht.
16. **Multi-Tenant** — aus einem geteilten Datenpool wird echte Daten-Isolation; neues
    Sicherheitsthema, z. B. eine vergessene `tenant_id`-Klausel als Datenleck zwischen Nutzern.
