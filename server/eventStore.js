// dProvider (Domain-Provider): das Medium, in dem der Zustand als Ereignisse aufgezeichnet
// wird. Nur die Domäne kennt ihn.
//
// Von diesem Medium wird es mehrere Ausprägungen geben — im Arbeitsspeicher (hier), in einer
// Datei (dateiEventStore.js), später in einer Datenbank. Sie unterscheiden sich ausschließlich
// darin, *wo* die Ereignisse liegen, und das erfährt jede Ausprägung bei ihrer Erzeugung: hier
// ein Anfangsbestand, dort ein Dateiname, später ein Connection String. Nach außen sind sie
// austauschbar, denn sie erfüllen alle denselben Vertrag:

/**
 * Der Vertrag jedes Event-Store. Wer ihn erfüllt, kann jeden anderen ersetzen — die Domäne
 * merkt keinen Unterschied. Geprüft wird er für alle Ausprägungen gemeinsam in
 * tests/server/eventStoreVertrag.ts.
 *
 * @typedef {object} EventStore
 * @property {(eventType: string, payload: any) => any} append
 *   Hängt ein Ereignis an, vergibt seq und timestamp und gibt es zurück.
 * @property {(filter?: { wertpapierId?: string }) => any[]} query
 *   Liefert die Ereignisse in Aufzeichnungsreihenfolge, wahlweise nach Wertpapier gefiltert.
 * @property {(events: any[]) => void} overwrite
 *   Ersetzt den gesamten Bestand; seq und timestamp der übergebenen Ereignisse bleiben.
 */

/**
 * Event-Store im Arbeitsspeicher: schnell, ohne Abhängigkeiten — und ohne Gedächtnis über das
 * Programmende hinaus. Für den Betrieb wird deshalb der Datei-Store benutzt; hier ist die Basis
 * für dessen Innenleben und für Tests der Domäne.
 *
 * @param {any[]} initialeEvents Der Bestand, mit dem der Store startet.
 * @returns {EventStore}
 */
export function createEventStore(initialeEvents = []) {
  let events = [];
  let naechsteSeq = 1;

  function append(eventType, payload) {
    const event = {
      seq: naechsteSeq++,
      eventType,
      timestamp: new Date().toISOString(), // rein technisch, keine fachliche Bedeutung
      payload,
    };
    events.push(event);
    return event;
  }

  function query(filter) {
    if (!filter || filter.wertpapierId == null) return events.slice();
    return events.filter((e) => e.payload.wertpapierId === filter.wertpapierId);
  }

  // Ersetzt den gesamten Bestand. seq und timestamp der übergebenen Ereignisse bleiben
  // unverändert — sie wurden früher schon einmal vergeben und sollen es bleiben.
  function overwrite(neueEvents) {
    events = neueEvents.slice();
    naechsteSeq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  }

  overwrite(initialeEvents);

  return { append, query, overwrite };
}
