// dProvider (Domain-Provider): das Medium, in dem der Zustand als Ereignisse aufgezeichnet
// wird. Nur die Domäne kennt ihn. Er weiß nichts darüber, woher Ereignisse kommen oder wohin
// sie gehen — nur, wie man sie festhält, ausliest und im Ganzen ersetzt.
function createEventStore() {
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

  // Der vollständige Bestand, roh und in Aufzeichnungsreihenfolge.
  function replayAll() {
    return events.slice();
  }

  return { append, query, overwrite, replayAll };
}

if (typeof module !== "undefined") {
  module.exports = { createEventStore };
}
