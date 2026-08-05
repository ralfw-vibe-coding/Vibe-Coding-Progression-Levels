# Stufe 14 — Automatisches Deployment aus GitHub

Übergeordneter Kontext: [Projekt.md](Projekt.md).

## Ziel dieser Stufe

Seit Stufe 12 läuft die Anwendung im Web, veröffentlicht mit einem Befehl von Hand. Seit Stufe 10
liegt der Code in Git. Beides lief nebeneinander her. Jetzt wird es zusammengeführt: Die
Deploy-Plattform hängt am GitHub-Repository und baut bei jedem Push auf `main` von selbst.

Der Befehl zum Veröffentlichen entfällt damit nicht — er wird überflüssig. Das ist ein
Unterschied, und die Stufe handelt davon, was dieser Unterschied für die tägliche Arbeit bedeutet.

## Was jetzt möglich ist

### Es gibt nur noch einen Weg in die Produktion

Vorher waren es drei Schritte: committen, pushen, deployen. Drei Schritte, die auseinanderlaufen
können — und regelmäßig auseinanderliefen. Man deployt einen Stand, den man noch nicht committet
hat. Man committet einen Stand, den man vergisst zu deployen. Wochen später fragt man sich, warum
die laufende Anwendung etwas tut, das im Code nicht steht.

Jetzt ist das ausgeschlossen, nicht durch Disziplin, sondern durch Bauart: Veröffentlicht wird
**ausschließlich, was im Repository steht**. Der Arbeitsstand auf dem eigenen Rechner kann gar
nicht mehr in die Produktion geraten.

### Was läuft, ist nachvollziehbar

Jede laufende Fassung hängt an einem Commit. Damit sind Fragen beantwortbar, die vorher
Rekonstruktionsarbeit waren: Seit wann ist das so? Was genau ist mit der letzten Veröffentlichung
hineingekommen? Welcher Stand lief, als der Fehler auftrat?

Und das Zurückrollen ist keine eigene Kunst mehr, sondern dieselbe Handbewegung wie das
Veröffentlichen: einen Commit zurück, pushen.

### Der eigene Rechner ist nicht mehr Teil der Infrastruktur

Bisher konnte nur ein einziger Rechner veröffentlichen — der, auf dem die Deploy-CLI eingerichtet
war, mit dem Zugangstoken und der richtigen lokalen Konfiguration. Wer daran nicht saß, konnte
nichts live bringen. Ein Festplattenschaden hätte nicht den Code gekostet (der lag in Git), aber
die Fähigkeit, ihn auszuliefern.

Jetzt liegt diese Fähigkeit im Repository. Ein frischer Klon auf einem beliebigen Rechner genügt.

### Zusammenarbeit ohne Schlüsselübergabe

Das ist der Punkt, auf den Stufe 10 hingearbeitet hat. Bisher hätte ein zweiter Mensch am Projekt
alles gebraucht, was zum Veröffentlichen nötig ist: Zugang zur Deploy-Plattform, ein eigenes
Token, die Zugangsdaten zur Datenbank. Man hätte ihm die Geheimnisse des Betriebs aushändigen
müssen, nur damit er eine Codezeile ausliefern kann.

Jetzt braucht er genau eines: Schreibrecht auf das Repository. Die Geheimnisse bleiben, wo sie
hingehören — bei der Plattform, in keinem Repository, auf keinem fremden Rechner.

### Veröffentlichen wird billig, und das ändert das Verhalten

Der unterschätzte Effekt. Solange ein Deploy Aufmerksamkeit kostet, sammelt man Änderungen an:
„das mache ich fertig, dann deploye ich alles zusammen". Große Veröffentlichungen mit vielen
Änderungen auf einmal — und wenn danach etwas nicht stimmt, weiß niemand, welche davon schuld ist.

Kostet das Veröffentlichen nichts, verschwindet der Anreiz zum Sammeln. Man liefert kleine
Schritte aus. Und wenn einer davon etwas bricht, ist der Verursacher nicht zu übersehen, weil es
nur einer war.

## Die Kehrseite

Ehrlichkeit gehört dazu, und hier gibt es zwei Dinge.

**Die letzte Bremse fällt weg.** Zwischen einem kaputten Stand und der Produktion lag bisher die
bewusste Entscheidung „jetzt veröffentliche ich". Die gibt es nicht mehr. Was bleibt, ist der
Pre-Commit-Hook aus Stufe 10 — der läuft jetzt nicht mehr nur zur Selbstdisziplin, sondern ist
das Einzige, was einen roten Stand aufhält. Genau so war es im Stufenplan angekündigt: eine stille
Vorbereitung, die sich erst später auszahlt.

**Das Repository ist die Quelle des laufenden Systems.** Vorher war es eine Ablage; man konnte
nachlässig damit sein, ohne dass es Folgen hatte. Jetzt geht alles, was darin liegt, in die Welt —
und in diesem Projekt ist es zusätzlich öffentlich einsehbar.

Damit wird eine Frage, die nach Ordnungsliebe klingt, zu einer Sicherheitsfrage: *Was liegt
eigentlich alles im Repository?* In diesem Projekt lautete die Antwort beim Nachsehen: zwei echte
Zugangsgeheimnisse, aus der Konfigurationsdatei in Testdateien kopiert, seit Tagen für jeden
lesbar. Beide sind ausgetauscht; die alten wirken nachweislich nicht mehr.

Die Konsequenz steckt jetzt im Hook. Er prüft vor jedem Commit, ob ein Wert aus der eigenen
Konfigurationsdatei in den vorgemerkten Dateien auftaucht, und bricht ab, wenn ja — mit dem Namen
der Variablen, nie mit ihrem Wert. Kein Mustererkenner, der rät, was nach einem Schlüssel aussieht,
sondern ein Abgleich mit den tatsächlichen Werten: Er findet genau diesen Fehler und meldet nie
etwas Falsches. Was er nicht sieht, ist alles, was nicht in der Konfigurationsdatei steht.

Eine Bremse, kein Tor. Er wirkt nur auf Rechnern, auf denen er eingerichtet wurde, und lässt sich
umgehen. Das ist der Preis dafür, dass er nichts kostet.

## Was noch nicht geht

- **Die Tests laufen nicht auf der Plattform.** Geprüft wird vor dem Commit auf dem eigenen
  Rechner. Wer die Prüfung umgeht, veröffentlicht ungeprüft.
- **Vorschau und Produktion teilen sich die Datenbank.** Jeder Push erzeugt eine lauffähige
  Fassung, und alle greifen auf denselben Datenbestand zu. Zum Ausprobieren auf einem Seitenzweig
  ist das ungeeignet. Genau das trennt Stufe 15.

## Was es gekostet hat

Wenig — und die eine Stelle, an der es hakte, ist lehrreich: Die Datei mit den
Deploy-Einstellungen war von der Versionskontrolle ausgenommen, weil darin steht, wessen
Deployment gemeint ist. Solange von Hand deployt wurde, war das richtig; der Befehl las die Datei
ja vom eigenen Rechner. Beim Bauen in der Cloud existiert sie schlicht nicht.

Also musste die Angabe, *was* gestartet werden soll, ins Repository — sie ist kein Geheimnis. Die
Angabe, *wohin*, blieb draußen; die kennt die Plattform aus der Verknüpfung.

## Ergebnis

Der erste Build lief ohne Zutun an und ging beim ersten Versuch durch:

| Prüfung | Ergebnis |
|---|---|
| Push löst einen Build aus, ohne dass jemand ihn anstößt | ja |
| Neue Fassung wird zur Produktion | Revision gewechselt |
| Anwendung erreichbar, Depot ohne Ausweis abgewiesen | 200 / 401 |
| Maschinenzugang per Schlüssel weiterhin möglich | 200 |
| Geheimnisse in der ausgelieferten Seite | keine |
| Hook gegen eine Datei mit echtem Geheimnis | Commit abgebrochen |
| Hook gegen die tatsächlichen Änderungen | durchgelassen |

295 Tests laufen durch.

## Mitgenommene Lektionen

- Automatisierung beseitigt keine Verantwortung, sie verschiebt sie. Wer den letzten manuellen
  Schritt streicht, muss vorher etwas hinstellen, das dessen Prüfblick ersetzt — sonst hat er
  nicht die Arbeit wegautomatisiert, sondern die Vorsicht.
- Was in der Cloud gebaut wird, sieht nur das Repository. Konfiguration auf dem eigenen Rechner
  existiert für den Build nicht — auch die, die dort jahrelang selbstverständlich war.
- Ein Geheimnis, das einmal öffentlich stand, ist verbrannt. Die Historie umzuschreiben holt es
  nicht zurück; der einzige wirksame Schritt ist, es auszutauschen. Deshalb zählt jede Schranke
  *vor* dem Commit mehr als jede Reparatur danach.
- Testdaten müssen erfunden sein. Ein echter Wert ist in einer Testdatei nicht bequemer, sondern
  nur unauffälliger — und Tests wandern ins Repository wie jede andere Datei auch.
- Prüfe auf den Wert, nicht auf seinen Namen. Eine Suche nach dem Namen eines Geheimnisses schlägt
  auch bei dem Kommentar an, der erklärt, warum dort keines mehr steht. Die belastbare Frage
  lautet nicht „steht hier etwas über einen Schlüssel", sondern „steht hier dieser Schlüssel".
- Ein Deploy, der nichts kostet, wird kleiner — und kleine Deploys sind leichter zu verstehen,
  wenn etwas schiefgeht. Der Gewinn liegt weniger in der gesparten Zeit als in der geänderten
  Gewohnheit.
