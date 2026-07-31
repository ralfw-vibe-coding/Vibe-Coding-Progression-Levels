# Stufe 10 — Git lokal

Übergeordneter Kontext: [Projekt.md](Projekt.md).

## Eine Prämisse, die nicht mehr stimmte

Der Stufenplan sagt: „Git lokal — Versionskontrolle als stille Vorbereitung." Nur lief das Repo
zu diesem Zeitpunkt längst unter Git — seit dem allerersten Commit in Stufe 1, mit einem Tag am
Ende jeder abgeschlossenen Stufe:

```
$ git log --oneline --reverse | head -3
90793c8 Stufe 01: Statische Depotübersicht als reine HTML-Seite
9746306 Stufe 02, Inkrement 1: Depotdaten aus Event-Store statt fest im HTML
3b82e46 Stufe 02: Interaktive Erfassung von Käufen und Kursupdates

$ git tag
stufe-01  stufe-02  stufe-03  stufe-04  stufe-05  stufe-06  stufe-07  stufe-08  stufe-09
```

„Git wird jetzt eingeführt" war also keine ehrliche Überschrift mehr. Statt die Fiktion
aufrechtzuerhalten, zwei andere Fragen: Was zeigt sich, wenn man die vorhandene Historie mit dem
Blick dieses Kurses anschaut? Und was an Git wurde bisher tatsächlich noch nicht benutzt?

## Warum Git nützlich ist — auch allein

Zwei Gründe fallen als Erstes ein: Änderungen zurückrollen, wenn etwas schiefgeht. Und Branches,
um eine Idee auszuprobieren, ohne den funktionierenden Stand zu gefährden. Beide stimmen — aber
sie beschreiben, was Git für *Programmieren* tut. Das ist zu eng. Keiner der Vorteile hängt an
Quellcode; sie hängen daran, dass etwas **klartextbasiert und zeilenweise versionierbar** ist.
Code ist dafür nur ein Sonderfall. Ein Buchmanuskript in Markdown, eine Abschlussarbeit in LaTeX,
Meeting-Notizen — alles profitiert identisch. Der Beweis liegt im selben Repository: Die zehn
`Verlauf/Stufe NN.md`-Dateien sind reine Prosa, versioniert wie der Code daneben, mit denselben
Werkzeugen nutzbar.

Was sich daraus zusätzlich ergibt, sobald man nicht mehr nur an "Code" denkt:

- **Bisektion.** `git bisect` sucht per Halbierung den Commit, der einen Fehler eingeführt hat.
  Konkret an diesem Projekt: Die sauberen Stufen-Commits machen "ab welcher Stufe war der
  Depotwert falsch?" tatsächlich durchsuchbar, nicht nur theoretisch möglich.
- **Tags als reproduzierbare Referenzpunkte.** Genau das, was hier längst passiert
  (`stufe-01` … `stufe-09`): Jederzeit lässt sich exakt der Stand von vor drei Stufen
  wiederherstellen, um zu vergleichen oder eine Regression einzugrenzen.
- **Diff als Gedächtnisstütze.** Vor dem Commit oder Tage später zeigt `git diff` präzise, was
  sich wirklich geändert hat — nicht, was man *meint* geändert zu haben. Bei generiertem Text
  (Code wie Prosa) ein eigener Wert.
- **Stash für Kontextwechsel ohne Verlust.** Mitten in einer Änderung kurz etwas anderes prüfen,
  ohne einen halbfertigen Stand festzuschreiben.
- **Commit-Nachrichten als dauerhaftes "Warum", getrennt vom Inhalt.** Dieselbe Trennung, die für
  Code-Kommentare in diesem Projekt gilt — nur das nicht Offensichtliche festhalten —, gilt für
  Commit-Nachrichten in die andere Richtung: Die Begründung *dieser einen Änderung* gehört nicht
  in die Datei, sondern in die Historie daneben.

Was lokales Git *nicht* leistet: Schutz vor einem verlorenen oder defekten Rechner. Die gesamte
Historie liegt im selben `.git`-Verzeichnis wie alles andere — ein Diebstahl oder ein Festplatten-
Crash nimmt beides gleichzeitig mit. Das ist erst der Übergang zu einem entfernten Repository
wert (siehe unten).

## Einstieg in Git

Für alles, was heute noch nicht unter Versionskontrolle steht, sind es drei Schritte:

```bash
mkdir mein-projekt && cd mein-projekt
git init
# arbeiten, dann:
git add .
git commit -m "erster Stand"
```

Und danach: **immer wieder committen.** Nicht erst, wenn etwas fertig ist, sondern nach jedem
Schritt, der für sich Sinn ergibt — das ist die eigentliche Gewohnheit, alles andere in diesem
Kapitel baut darauf auf.

Liegt zusätzlich ein Repository bei GitHub oder GitLab, kommt **push** dazu:

```bash
git remote add origin <URL des Repos>
git push -u origin main
```

Das ist der Unterschied zwischen "meine Änderungen sind nachvollziehbar" und "meine Änderungen
sind sicher": Erst ein entferntes Repository ist ein echtes Backup, weil es nicht auf demselben
Gerät liegt wie der Rest. Ein regelmäßiges `git push` ist dafür genauso wichtig wie das Committen
selbst — ein Stand, der nur lokal committet, aber nie gepusht ist, geht mit dem Rechner unter.

Git selbst gibt es kostenlos unter [git-scm.com](https://git-scm.com) für alle gängigen
Betriebssysteme. Wer die Kommandozeile scheut, findet mit
[GitHub Desktop](https://desktop.github.com) eine grafische Oberfläche für dieselben Vorgänge —
Commit, Push, Verlauf ansehen, ohne einen einzigen Befehl zu tippen.

Und: KI hilft beim Umgang mit Git. Ob ein Merge-Konflikt entschlüsselt, der richtige Befehl für
eine ungewöhnliche Situation gefunden oder — wie in diesem Projekt durchgehend — eine
Commit-Nachricht formuliert werden muss, die den Grund einer Änderung trägt statt nur ihren
Inhalt: Das gehört zu den Aufgaben, bei denen ein Sparringspartner den Unterschied macht zwischen
einer Historie, die man später versteht, und einer, die nur "update" sagt.

## Der Commit-Log ist selbst ein Append-only-Log

Das gesamte Projekt handelt von einer Idee: Zustand nicht als aktuellen Wert speichern, sondern
als Folge von Ereignissen, aus denen sich der Zustand ableiten lässt. Genau das tut Git mit dem
eigenen Quellcode, nur dass hier niemand `append()` aufruft, sondern `git commit`:

| Event-Store der Anwendung | Git-Historie des Projekts |
|---|---|
| Ereignis (`kauf`, `kursupdate`, …) | Commit |
| `seq`, fortlaufend, nie geändert | Commit-Hash, Elternverweis, nie geändert |
| `query({ wertpapierId })` | `git log -- pfad/datei.js` |
| `restore(events)` | `git checkout <hash>` |
| Projektion „aktueller Depotwert" | Projektion „aktueller Stand der Datei" |

Ein Blick in die eigene Historie bestätigt das nicht nur behauptet, sondern zeigt es: Jede Datei
lässt sich bis zu dem Commit zurückverfolgen, der sie erzeugt hat, ohne dass irgendwo ein
Änderungsprotokoll separat gepflegt worden wäre — das Protokoll *ist* das Repository.

```bash
git log --follow --oneline -- server/kursProvider.js
```

Das ist keine zufällige Ähnlichkeit. Beides sind Antworten auf dieselbe Frage: Wie hält man
etwas nachvollziehbar veränderlich, ohne die Vergangenheit zu überschreiben? Ein Event-Store
macht es für Fachdaten explizit; Git macht es für Quellcode, meist ohne dass jemand die Analogie
zieht.

## .gitignore — was bewusst draußen bleibt

`.gitignore` wuchs bisher beiläufig mit, eine Zeile pro Anlass:

```
requirements     Stufe 3 — Testabdeckungsberichte, reproduzierbar erzeugt
coverage         Stufe 3 — dito
server/data      Stufe 7 — Ereignisse und API-Schlüssel, Laufzeitzustand
.env             Stufe 9 — Zugangsdaten für Yahoo, Finnhub, Twelve Data
```

Das gemeinsame Muster: Alles, was hier steht, lässt sich entweder aus dem Rest des Repos neu
erzeugen (`requirements`, `coverage`) oder ist personen- und maschinengebunden und darf gerade
*nicht* geteilt werden (`server/data`, `.env`). Beides sind Gründe, etwas auszuschließen — sie
verlangen aber entgegengesetzte Konsequenzen. Was erzeugbar ist, braucht nur die Ausschlusszeile.
Was ein Geheimnis ist, braucht zusätzlich einen Beleg, dass es nie versehentlich hineinrutschte:

```bash
$ git log --all --full-history -- .env
(keine Ausgabe — die Datei war nie Teil eines Commits)
```

`.env` wurde in Stufe 9 an dem Tag ausgeschlossen, an dem der erste API-Schlüssel entstand — nicht
vorsorglich früher, aber auch nicht zu spät. `.env.example` liegt stattdessen im Repo, mit den
Variablennamen ohne Werte, damit ein frischer Klon weiß, was er braucht, ohne je zu sehen, was
darin stehen könnte.

## Was tatsächlich neu ist: ein Pre-Commit-Hook

Ein Mechanismus, den Git von Anfang an anbietet, aber bisher nirgends im Projekt zum Einsatz kam:
Hooks — Skripte, die Git bei bestimmten Anlässen selbst aufruft. `pre-commit` läuft, bevor ein
Commit entsteht, und kann ihn verhindern.

```bash
$ ls .git/hooks/ | grep -v sample
(leer)
```

Das ist der eine neue Baustein dieser Stufe: **Die Testsuite läuft ab jetzt automatisch vor jedem
Commit, und ein rotes Ergebnis verhindert ihn.**

```bash
# .githooks/pre-commit
deno task test || { echo "Tests schlagen fehl — Commit abgebrochen." >&2; exit 1; }
```

Zwei Details machen daraus mehr als eine Zeile Bash:

**Der Hook liegt im Repository, nicht nur auf einer Maschine.** `.git/hooks/` selbst wird von Git
nie versioniert — jeder Klon bekommt nur die mitgelieferten `.sample`-Dateien, nichts Aktives.
Ein Hook, der dort abgelegt würde, wäre unsichtbares lokales Wissen, das beim nächsten Klon
verloren ginge. Deshalb liegt das Skript unter `.githooks/`, einem ganz normalen, versionierten
Verzeichnis, und ein einziger Konfigurationsbefehl sagt Git, dort zu suchen:

```bash
git config core.hooksPath .githooks
```

Verpackt als `deno task hooks-einrichten`, damit die Einrichtung ein dokumentierter Befehl ist
und keine Zeile, die man aus einer Anleitung abtippt und danach vergisst, wo sie stand.

**Der Hook lässt sich bewusst umgehen.** `git commit --no-verify` überspringt ihn. Das ist keine
Lücke, sondern Absicht: Ein Qualitätstor, das sich in einer echten Ausnahmesituation nicht
umgehen lässt, wird irgendwann selbst zum Ausnahmefall — an dem dann alle vorbeimüssen.

## Verifikation

Ein absichtlich scheiternder Test zeigt, dass der Hook wirklich greift, bevor der Commit
entsteht — nicht erst danach, als Korrektur:

```bash
$ echo 'Deno.test("kaputt", () => { throw new Error("Probe"); });' >> tests/server/wertpapierKennung.test.ts
$ git add tests/server/wertpapierKennung.test.ts
$ git commit -m "Probe: sollte scheitern"
pre-commit: Testsuite läuft …
FAILED | 209 passed | 1 failed | 22 ignored
pre-commit: Tests schlagen fehl — Commit abgebrochen.
Mit 'git commit --no-verify' lässt sich das im Notfall umgehen.
$ echo $?
1
$ git log --oneline -1
bdb4926 Stufe 09: Externer HTTP-Service für Kursabruf   ← unverändert, kein neuer Commit
```

Die Probe zurückgenommen, ein echter Commit läuft anschließend durch die volle Suite und landet
regulär in der Historie.

## Ergebnis

Kein neues Bild der Oberfläche — diese Stufe hat keine. Sichtbar wird sie erst im nächsten
`git commit`, wenn die Testsuite kurz mitläuft, bevor der Editor sich öffnet.

`.githooks/pre-commit` ist eingerichtet und per `deno task hooks-einrichten` aktivierbar,
dokumentiert in `README.md`. `.gitignore` ist unverändert in der Funktion, aber jetzt mit
Begründung je Zeile nachvollziehbar. Die Historie selbst — 9 Stufen, 9 Tags, durchgehend seit dem
ersten Commit — bleibt, was sie schon war, nur jetzt mit dem Vokabular des Projekts benannt: ein
Append-only-Log über den eigenen Quellcode.

## Mitgenommene Lektionen

- Ein Plan, der vor dem Projekt geschrieben wurde, kann von der Realität überholt werden, die er
  selbst erzeugt hat. Die richtige Reaktion ist nicht, die Fiktion aufrechtzuerhalten, sondern zu
  fragen, was an der ursprünglichen Absicht noch trägt.
- Git-Vorteile sind Text-Vorteile, nicht Code-Vorteile. Wer nur an Programmieren denkt, verkauft
  sich zu billig — dasselbe Werkzeug trägt jedes klartextbasierte Dokument, das sich
  weiterentwickelt.
- Lokale Versionierung schützt vor eigenen Fehlern (kaputte Bearbeitung, verlorene Zwischenstände),
  nicht vor Totalverlust. Das echte Backup entsteht erst mit `git push` auf ein entferntes
  Repository.
- Der Einstieg ist absichtlich niedrigschwellig: ein Verzeichnis, `git init`, und die Gewohnheit
  zu committen. Alles andere — Branches, Tags, Hooks — kommt später und aus einem konkreten
  Anlass, nicht am ersten Tag.
- Ein Append-only-Log für Quellcode existiert oft schon lange, bevor jemand es so nennt. Git und
  ein Event-Store lösen dasselbe Problem für unterschiedliche Daten — die Analogie zu ziehen
  macht beide verständlicher.
- `.gitignore`-Zeilen zerfallen in zwei Sorten mit unterschiedlichen Pflichten: Erzeugbares
  braucht nur den Ausschluss, ein Geheimnis zusätzlich den Beleg, dass es nie versehentlich
  committet wurde.
- Ein Hook, der nicht im Repository liegt, existiert nur so lange wie die eine Maschine, auf der
  er angelegt wurde. Er gehört versioniert, mit einem dokumentierten Einrichtungsschritt — sonst
  ist er unsichtbares lokales Wissen.
- Ein Qualitätstor, das sich nicht umgehen lässt, wird irgendwann selbst zur Ausnahme, an der
  alle vorbeimüssen. `--no-verify` ist deshalb kein Mangel des Hooks, sondern Teil seines
  Entwurfs.
