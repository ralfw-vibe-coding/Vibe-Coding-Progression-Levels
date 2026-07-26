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

## Die Stufen — was für den Entwickler jeweils neu ist

1. **Statische Seite** — Daten rein, HTML raus: eine App ganz ohne Laufzeit-Logik und ohne Server.
2. **Interaktive Seite** — erste Interaktivität im Browser; Zustand existiert nur im Speicher des
   offenen Tabs.
3. **Persistenz mit localStorage** — Zustand übersteht erstmals einen Reload, bleibt aber an ein
   Gerät gebunden.
4. **Zustand laden/speichern (JSON)** — das Datenmodell wird als Append-only Event-Log explizit
   fassbar, exportier- und importierbar als Datei.
5. **Mehrere Seiten/Views** — erste Strukturentscheidung jenseits einer einzelnen Seite
   (clientseitiges Routing).
6. **Deno-Server mit eigener API** — erste Trennung von Frontend und Backend; dieselbe
   Funktionalität wird zusätzlich über eine API nutzbar.
7. **Echte Datenbank: SQLite** — erste "richtige" Datenbank, Grundlage für parallele Zugriffe
   mehrerer Tabs/Skripte.
8. **Externer HTTP-Service** — Umgang mit externen Abhängigkeiten, Fehlerbehandlung und
   Rate Limits.
9. **Git lokal** — Versionskontrolle als stille Vorbereitung, die sich erst später (Stufe 13)
   sichtbar auszahlt.
10. **Postgres statt SQLite** — Umgang mit Connection Strings und Secrets für eine
    Cloud-Datenbank; der Server selbst läuft noch lokal.
11. **Deployment ins Web** — erster echter Web-Deploy, Umgang mit einer Deploy-CLI und
    Env-Variablen im Cloud-Kontext.
12. **Auth mit OTP + Multi-User** — erster Auth-Layer; das Datenmodell bleibt unverändert, nur
    wer reinkommt ändert sich.
13. **GitHub-Repo + automatisches Deployment** — Deployment wird reproduzierbar, Team-Arbeit am
    Code wird möglich.
14. **Umgebungen trennen (lokal SQLite / Production Postgres)** — eine Codebasis mit zwei
    Backends je nach Umgebung, über eine DB-Abstraktionsschicht.
15. **Multi-Tenant** — aus einem geteilten Datenpool wird echte Daten-Isolation; neues
    Sicherheitsthema, z. B. eine vergessene `tenant_id`-Klausel als Datenleck zwischen Nutzern.
