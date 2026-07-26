// Provider: kapselt die Ressource "Append-only Event-Log". Kennt weder Domäne noch UI.
function createEventStore() {
  const events = [];
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

  return { append, query };
}

if (typeof module !== "undefined") {
  module.exports = { createEventStore };
}
