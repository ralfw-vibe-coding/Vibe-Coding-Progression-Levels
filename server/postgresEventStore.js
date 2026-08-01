import postgres from "npm:postgres@3";

// Ein Event-Store in einer Postgres-Datenbank. Er erfüllt denselben Vertrag wie jede andere
// Ausprägung (siehe den EventStore-Typ in eventStore.js) und ist gegen sie austauschbar — er
// erfährt beim Erzeugen nur auf andere Weise, wo seine Ereignisse liegen: als Verbindungsangabe
// zu einem Server statt als Dateipfad.
//
// Der Unterschied zu SQLite ist nicht die Abfragesprache, sondern die Entfernung. SQLite ist
// eingebettet: Der Aufruf springt in eine Bibliothek und kommt mit dem Ergebnis zurück. Postgres
// steht woanders — jede Abfrage geht über eine Leitung, und über eine Leitung kann man nicht
// synchron sprechen. Deshalb ist der Vertrag mit dieser Ausprägung async geworden, für alle
// Ausprägungen gemeinsam. Das ist der eigentliche Preis dieser Stufe, und er ist einmalig: Was
// jetzt async ist, bleibt es, egal welche Datenbank später dazukommt.
//
// Was man dafür bekommt: eine Datenbank, die nicht auf demselben Rechner liegen muss. Damit wird
// aus "der Server hat seine Daten" ein "die Daten haben ihren eigenen Ort" — Voraussetzung
// dafür, den Server irgendwo hinzustellen, wo es keine Platte gibt, die einem gehört.

/**
 * @param {string} verbindung Wo die Datenbank liegt — bei Postgres ein Connection String
 *   (postgres://benutzer:passwort@host/datenbank).
 * @param {{ tabelle?: string }} [optionen] Der Tabellenname ist einstellbar, damit Tests in
 *   einer eigenen Tabelle arbeiten können. Der Betrieb nutzt die Vorgabe.
 * @returns {Promise<import("./eventStore.js").EventStore & { schliessen: () => Promise<void> }>}
 *
 * Anders als bei den drei anderen Ausprägungen ist schon die Erzeugerfunktion async: Das Schema
 * anzulegen ist selbst eine Abfrage über die Leitung, auf die gewartet werden muss. Der Store
 * ist also erst nach einem await benutzbar — dafür gilt danach dieselbe Zusicherung wie überall
 * sonst: Er kennt seinen Bestand und ist einsatzbereit.
 */
export async function createPostgresEventStore(verbindung, { tabelle = "events" } = {}) {
  const sequenz = `${tabelle}_seq`;
  // onnotice stillgelegt: Die "IF NOT EXISTS"-Anweisungen unten melden bei jedem Start brav,
  // dass es Tabelle, Sequenz und Index schon gibt. Das ist die Normalität und keine Nachricht
  // wert — sonst beginnt jeder Serverstart mit drei Meldungen, die niemand liest.
  const sql = postgres(verbindung, { onnotice: () => {} });

  // Das Schema legt der Store selbst an, wie bei SQLite: Eine leere Datenbank ist einfach ein
  // leeres Depot, kein Setup-Schritt, den man vergessen könnte. "IF NOT EXISTS" macht das
  // wiederholbar — jeder Serverstart darf das gefahrlos versuchen.
  //
  // Die seq-Vergabe läuft über eine eigene Sequenz statt über COALESCE(MAX(seq))+1 wie bei
  // SQLite. Bei SQLite genügte das Muster, weil dort immer nur ein Schreiber zugleich in der
  // Datenbank ist. Postgres bedient dagegen viele Verbindungen gleichzeitig, und unter seinem
  // üblichen Isolationsgrad sehen zwei parallele Transaktionen jeweils denselben Höchstwert —
  // beide würden dieselbe Nummer vergeben, und eine von beiden verlöre ihr Ereignis am
  // Primärschlüssel. Eine Sequenz zählt außerhalb der Transaktionen und gibt jede Nummer nur
  // einmal heraus; das ist genau die Zusicherung, die eine fortlaufende seq braucht.
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(tabelle)} (
      seq         BIGINT PRIMARY KEY,
      "eventType" TEXT NOT NULL,
      "timestamp" TEXT NOT NULL,
      payload     JSONB NOT NULL
    )
  `;
  await sql`CREATE SEQUENCE IF NOT EXISTS ${sql(sequenz)}`;
  // Das Gegenstück zum json_extract-Index bei SQLite: Gefiltert wird nach einem Feld *in* der
  // payload, und ein Ausdrucksindex macht daraus eine Suche statt eines Durchlaufs.
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql(`idx_${tabelle}_wertpapier`)}
      ON ${sql(tabelle)} ((payload->>'wertpapierId'))
  `;

  // Aus einer Zeile wird wieder ein Ereignis. Die payload liegt als JSONB in der Spalte und
  // kommt vom Treiber bereits als JavaScript-Objekt zurück — die Datenbank kennt ihre Struktur
  // trotzdem nicht: Was fachlich in einem Ereignis steht, bleibt Sache der Domäne.
  //
  // Ein Unterschied zu SQLite, wo die payload als Text lag: JSONB speichert kein JSON, sondern
  // dessen Bedeutung. Werte und Verschachtelung kommen unverändert zurück, die Reihenfolge der
  // Schlüssel aber nicht — Postgres sortiert sie. Fachlich ist das belanglos, ein Objekt hat
  // keine Reihenfolge; wer Ereignisse zeichenweise vergleicht, muss es trotzdem wissen.
  //
  // seq wird ausdrücklich zu Number gemacht: BIGINT liefert der Treiber als Zeichenkette,
  // damit sehr große Werte nicht ungenau werden. Für ein Depot ist das keine Sorge, aber
  // "3" > "10" wäre eine — Sortierungen und Vergleiche brauchen eine Zahl.
  function zuEreignis(zeile) {
    return {
      seq: Number(zeile.seq),
      eventType: zeile.eventType,
      timestamp: zeile.timestamp,
      payload: zeile.payload,
    };
  }

  async function append(eventType, payload) {
    const timestamp = new Date().toISOString(); // rein technisch, keine fachliche Bedeutung
    const [zeile] = await sql`
      INSERT INTO ${sql(tabelle)} (seq, "eventType", "timestamp", payload)
      VALUES (nextval(${sequenz}::regclass), ${eventType}, ${timestamp}, ${sql.json(payload)})
      RETURNING *
    `;
    return zuEreignis(zeile);
  }

  // Gefiltert wird in der Datenbank, nicht in JavaScript — genau wie bei SQLite. Neu ist nur,
  // dass die Zeilen dabei über ein Netz kommen: Umso mehr lohnt es sich, nur die zu holen, die
  // auch gebraucht werden.
  async function query(filter) {
    const zeilen = !filter || filter.wertpapierId == null
      ? await sql`SELECT * FROM ${sql(tabelle)} ORDER BY seq`
      : await sql`
          SELECT * FROM ${sql(tabelle)}
          WHERE payload->>'wertpapierId' = ${filter.wertpapierId}
          ORDER BY seq
        `;
    // Array.from statt .map, weil der Treiber eine eigene Array-Abart zurückgibt — sie kann
    // alles, was ein Array kann, schleppt aber Treiber-Innereien mit. Was den Store verlässt,
    // soll ein gewöhnliches Array sein: Sonst reicht diese Ausprägung ein Detail nach oben
    // durch, das die anderen drei nicht haben.
    return Array.from(zeilen, zuEreignis);
  }

  // Ersetzt den gesamten Bestand. seq und timestamp der übergebenen Ereignisse bleiben
  // unverändert — sie wurden früher schon einmal vergeben und sollen es bleiben. Alles läuft in
  // einer Transaktion: Entweder gilt der neue Bestand ganz, oder es bleibt beim alten. Ein halb
  // ersetztes Depot kann es nicht geben. Wirft innerhalb von sql.begin etwas, rollt der Treiber
  // von sich aus zurück — man muss den Fehlerfall nicht selbst verdrahten.
  //
  // Zum Schluss wird die Sequenz nachgezogen, sonst gäbe der Zähler nach einem Import wieder
  // Nummern aus, die es längst gibt. Der dritte Parameter false heißt: Der gesetzte Wert wurde
  // noch nicht vergeben — das nächste nextval liefert genau ihn. Deshalb steht dort MAX+1 und
  // nicht MAX; und weil so nie 0 gesetzt wird, funktioniert es auch für einen leeren Bestand.
  async function restore(neueEvents) {
    await sql.begin(async (sql) => {
      await sql`DELETE FROM ${sql(tabelle)}`;
      for (const e of neueEvents) {
        await sql`
          INSERT INTO ${sql(tabelle)} (seq, "eventType", "timestamp", payload)
          VALUES (${e.seq}, ${e.eventType}, ${e.timestamp}, ${sql.json(e.payload)})
        `;
      }
      await sql`
        SELECT setval(
          ${sequenz}::regclass,
          COALESCE((SELECT MAX(seq) FROM ${sql(tabelle)}), 0) + 1,
          false
        )
      `;
    });
  }

  // Über den Vertrag hinaus, und nur hier: Eine Netzwerkverbindung muss man wieder loslassen.
  // Die anderen Ausprägungen haben nichts, was offen bleiben könnte. Im Betrieb braucht es das
  // nicht — der Server hält die Verbindung, solange er läuft —, wohl aber in Tests und in
  // kurzlebigen Skripten wie der Migration.
  async function schliessen() {
    await sql.end();
  }

  return { append, query, restore, schliessen };
}
