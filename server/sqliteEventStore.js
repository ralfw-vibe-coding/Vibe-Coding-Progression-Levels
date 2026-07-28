import { DatabaseSync } from "node:sqlite";

// Ein Event-Store in einer SQLite-Datenbank. Er erfüllt denselben Vertrag wie jede andere
// Ausprägung (siehe den EventStore-Typ in eventStore.js) und ist gegen sie austauschbar — er
// erfährt beim Erzeugen nur auf andere Weise, wo seine Ereignisse liegen: als Verbindungsangabe
// statt als Dateiname oder Anfangsbestand.
//
// Der Unterschied zum Datei-Store ist nicht, *dass* gespeichert wird, sondern *wie*. Bisher
// wurde bei jeder Änderung der komplette Bestand neu geschrieben; jetzt wird genau eine Zeile
// eingefügt. Und Abfragen beantwortet die Datenbank, statt dass wir alles einlesen und in
// JavaScript filtern.
//
// SQLite ist dabei kein Server, sondern eine Datei — man braucht nichts zu installieren oder zu
// starten. Trotzdem ist es eine echte Datenbank mit Transaktionen und Abfragesprache, und der
// Umstieg auf Postgres später (Stufe 11) ändert nur diese Datei.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    seq       INTEGER PRIMARY KEY,
    eventType TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    payload   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_wertpapier
    ON events (json_extract(payload, '$.wertpapierId'));
`;

/**
 * @param {string} verbindung Wo die Datenbank liegt — bei SQLite ein Dateipfad. ":memory:"
 *   erzeugt eine Datenbank, die nur im Arbeitsspeicher existiert (praktisch für Tests).
 * @returns {import("./eventStore.js").EventStore}
 */
export function createSqliteEventStore(verbindung) {
  if (verbindung !== ":memory:") {
    const verzeichnis = verbindung.slice(0, verbindung.lastIndexOf("/"));
    if (verzeichnis) Deno.mkdirSync(verzeichnis, { recursive: true });
  }

  const db = new DatabaseSync(verbindung);

  // Zwei Einstellungen, die aus "es liegt in einer Datenbank" erst "mehrere dürfen gleichzeitig
  // ran" machen. Ohne sie scheitert der zweite Schreiber sofort, statt kurz zu warten — und
  // genau das ist der Unterschied zwischen einer Datei und einer Datenbank.
  //
  //   journal_mode = WAL  Leser blockieren Schreiber nicht mehr und umgekehrt. Ein zweiter
  //                       Tab oder ein curl-Skript kann lesen, während erfasst wird.
  //   busy_timeout        Trifft ein Schreiber auf einen anderen, wartet er bis zu 5 Sekunden,
  //                       statt aufzugeben. Für eine Anwendung dieser Größe reicht das weit.
  //
  // Bei einer Datenbank im Arbeitsspeicher gibt es keine zweite Verbindung — dort läuft WAL
  // ins Leere, was SQLite stillschweigend hinnimmt.
  // Die Reihenfolge ist wichtig: busy_timeout zuerst. Das Umschalten auf WAL braucht selbst
  // kurz eine Sperre — ohne vorher gesetzte Wartezeit scheitert schon dieser Aufruf, wenn
  // gerade jemand anderes die Datenbank öffnet.
  db.exec("PRAGMA busy_timeout = 5000");
  if (verbindung !== ":memory:") db.exec("PRAGMA journal_mode = WAL");

  db.exec(SCHEMA);

  // Aus einer Zeile wird wieder ein Ereignis. Die payload liegt als JSON-Text in der Spalte —
  // die Datenbank kennt ihre Struktur nicht und muss sie auch nicht kennen: Was fachlich in
  // einem Ereignis steht, bleibt Sache der Domäne.
  function zuEreignis(zeile) {
    return {
      seq: Number(zeile.seq),
      eventType: zeile.eventType,
      timestamp: zeile.timestamp,
      payload: JSON.parse(zeile.payload),
    };
  }

  // Die nächste seq wird innerhalb desselben INSERT ermittelt, nicht vorher ausgelesen. So kann
  // zwischen "höchste Nummer holen" und "Zeile schreiben" nichts dazwischenkommen.
  const einfuegen = db.prepare(`
    INSERT INTO events (seq, eventType, timestamp, payload)
    VALUES ((SELECT COALESCE(MAX(seq), 0) + 1 FROM events), ?, ?, ?)
  `);
  const alleLesen = db.prepare("SELECT seq, eventType, timestamp, payload FROM events ORDER BY seq");
  const nachWertpapierLesen = db.prepare(`
    SELECT seq, eventType, timestamp, payload FROM events
    WHERE json_extract(payload, '$.wertpapierId') = ?
    ORDER BY seq
  `);
  const einzelnLesen = db.prepare("SELECT seq, eventType, timestamp, payload FROM events WHERE seq = ?");
  const alleLoeschen = db.prepare("DELETE FROM events");
  const mitSeqEinfuegen = db.prepare("INSERT INTO events (seq, eventType, timestamp, payload) VALUES (?, ?, ?, ?)");

  function append(eventType, payload) {
    const timestamp = new Date().toISOString(); // rein technisch, keine fachliche Bedeutung
    const { lastInsertRowid } = einfuegen.run(eventType, timestamp, JSON.stringify(payload));
    return zuEreignis(einzelnLesen.get(Number(lastInsertRowid)));
  }

  // Gefiltert wird jetzt in der Datenbank statt in JavaScript — der eigentliche Gewinn dieser
  // Stufe. Bei einem Verlauf werden nur noch die Zeilen gelesen, die auch gebraucht werden,
  // statt jedes Mal den gesamten Bestand.
  function query(filter) {
    const zeilen = !filter || filter.wertpapierId == null
      ? alleLesen.all()
      : nachWertpapierLesen.all(filter.wertpapierId);
    return zeilen.map(zuEreignis);
  }

  // Ersetzt den gesamten Bestand. seq und timestamp der übergebenen Ereignisse bleiben
  // unverändert — sie wurden früher schon einmal vergeben und sollen es bleiben. Löschen und
  // Neuschreiben laufen in einer Transaktion: Entweder gilt der neue Bestand ganz, oder es
  // bleibt beim alten. Ein halb ersetztes Depot kann es nicht geben.
  function restore(neueEvents) {
    db.exec("BEGIN");
    try {
      alleLoeschen.run();
      for (const e of neueEvents) {
        mitSeqEinfuegen.run(e.seq, e.eventType, e.timestamp, JSON.stringify(e.payload));
      }
      db.exec("COMMIT");
    } catch (fehler) {
      db.exec("ROLLBACK");
      throw fehler;
    }
  }

  return { append, query, restore };
}
