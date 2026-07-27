// Provider: kapselt die Ressource "Append-only Event-Log". Kennt weder Domäne noch UI, und
// nichts darüber, woher sein Anfangsbestand kommt oder wohin Events am Ende gehen — das ist
// Sache des Aufrufers. Nach der Konstruktion lässt er sich nur noch erweitern, nie ersetzen.
function createEventStore(initialEvents = []) {
  const events = [...initialEvents];
  let naechsteSeq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;

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

  return { append, query };
}

if (typeof module !== "undefined") {
  module.exports = { createEventStore };
}
