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
 * Alle drei Operationen sind async — auch bei den Ausprägungen, die gar nicht warten müssen.
 * Den Ausschlag gibt die anspruchsvollste: Eine Datenbank am anderen Ende einer Leitung
 * (postgresEventStore.js) kann nicht synchron antworten. Der Vertrag richtet sich nach ihr,
 * damit weiterhin *alle* Ausprägungen austauschbar bleiben — sonst wäre eine von ihnen nur
 * fast austauschbar, und das ist dasselbe wie gar nicht.
 *
 * @typedef {object} EventStore
 * @property {(eventType: string, payload: any) => Promise<any>} append
 *   Hängt ein Ereignis an, vergibt seq und timestamp und gibt es zurück.
 * @property {(filter?: { wertpapierId?: string }) => Promise<any[]>} query
 *   Liefert die Ereignisse in Aufzeichnungsreihenfolge, wahlweise nach Wertpapier gefiltert.
 * @property {(events: any[]) => Promise<void>} restore
 *   Setzt den gesamten Bestand auf die übergebenen Ereignisse; seq und timestamp bleiben
 *   dabei unverändert. Das ist keine Änderung von Ereignissen — im laufenden Betrieb wird
 *   nur angehängt. Es ist dieselbe Operation, die auch beim Erzeugen passiert, nur später:
 *   einen kompletten Bestand einspielen, wie beim Import einer Sicherung.
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

  // async, obwohl hier nichts zu warten ist: Das ist der Preis dafür, dass alle Ausprägungen
  // denselben Vertrag erfüllen (siehe oben). Am Innenleben ändert es nichts.
  async function append(eventType, payload) {
    const event = {
      seq: naechsteSeq++,
      eventType,
      timestamp: new Date().toISOString(), // rein technisch, keine fachliche Bedeutung
      payload,
    };
    events.push(event);
    return event;
  }

  async function query(filter) {
    if (!filter || filter.wertpapierId == null) return events.slice();
    return events.filter((e) => e.payload.wertpapierId === filter.wertpapierId);
  }

  // seq und timestamp der übergebenen Ereignisse bleiben unverändert — sie wurden früher
  // schon einmal vergeben und sollen es bleiben.
  async function restore(neueEvents) {
    uebernehmen(neueEvents);
  }

  function uebernehmen(neueEvents) {
    events = neueEvents.slice();
    naechsteSeq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
  }

  // Der Anfangsbestand geht am async restore vorbei: Wer den Store erzeugt, soll ihn danach
  // sofort benutzen können, ohne auf ein Versprechen zu warten, das schon eingelöst ist.
  uebernehmen(initialeEvents);

  return { append, query, restore };
}
