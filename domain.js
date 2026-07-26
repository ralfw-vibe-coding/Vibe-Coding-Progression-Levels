// Domäne: kennt den Event-Store, kapselt den App-State. Commands erzeugen Events,
// Queries projizieren Events zu einem Modell. Keine Formatierung, keine Darstellung.
function createDomain(eventStore) {
  function kaufErfassen({ wertpapierId, name, typ, stueck, kaufkurs, datum }) {
    eventStore.append("kauf", { wertpapierId, name, typ, stueck, kaufkurs, datum });
  }

  function kursupdateErfassen({ wertpapierId, kurs, datum }) {
    eventStore.append("kursupdate", { wertpapierId, kurs, datum });
  }

  function positionenAbfragen() {
    // Mehrere "kauf"-Events zur selben wertpapierId sind Nachkäufe und werden addiert:
    // Stück summiert sich, Kaufwert ist die Summe der einzelnen Stück×Kaufkurs-Anteile.
    // Name/Typ kommen vom ersten "kauf"-Event (der Position ihre Identität gibt).
    const kaeufe = new Map();
    const kurse = new Map();
    for (const e of eventStore.query()) {
      if (e.eventType === "kauf") {
        const p = e.payload;
        let agg = kaeufe.get(p.wertpapierId);
        if (!agg) {
          agg = { name: p.name, typ: p.typ, stueck: 0, kaufwertSumme: 0, kaufwertBekannt: false };
          kaeufe.set(p.wertpapierId, agg);
        }
        agg.stueck += p.stueck;
        if (p.kaufkurs != null) {
          agg.kaufwertSumme += p.stueck * p.kaufkurs;
          agg.kaufwertBekannt = true;
        }
      }
      if (e.eventType === "kursupdate") {
        const bisher = kurse.get(e.payload.wertpapierId);
        if (!bisher || e.payload.datum > bisher.datum) kurse.set(e.payload.wertpapierId, e.payload);
      }
    }

    const positionen = [];
    let depotwert = 0;
    let kaufwertGesamt = 0;
    for (const [wertpapierId, agg] of kaeufe) {
      const kursupdate = kurse.get(wertpapierId);
      const kurs = kursupdate ? kursupdate.kurs : null;
      const kursDatum = kursupdate ? kursupdate.datum : null;
      const wert = kurs != null ? agg.stueck * kurs : 0;
      const kaufwert = agg.kaufwertBekannt ? agg.kaufwertSumme : null;
      const kaufkurs = kaufwert != null ? kaufwert / agg.stueck : null; // Ø über alle Käufe
      const diffAbs = kaufwert != null ? wert - kaufwert : null;
      const diffPct = kaufwert ? (diffAbs / kaufwert) * 100 : null;
      positionen.push({
        wertpapierId, name: agg.name, typ: agg.typ, stueck: agg.stueck,
        wert, kurs, kursDatum, kaufwert, kaufkurs, diffAbs, diffPct,
      });
      depotwert += wert;
      kaufwertGesamt += kaufwert ?? 0;
    }

    for (const p of positionen) {
      p.anteilAmDepot = depotwert ? (p.wert / depotwert) * 100 : 0;
    }

    const veraenderungAbs = depotwert - kaufwertGesamt;
    const veraenderungPct = kaufwertGesamt ? (veraenderungAbs / kaufwertGesamt) * 100 : 0;

    return { depotwert, kaufwertGesamt, veraenderungAbs, veraenderungPct, positionen };
  }

  function positionsverlaufAbfragen(wertpapierId) {
    // Umgekehrt chronologisch: neuestes Ereignis zuerst (nach fachlichem Datum, bei
    // Gleichstand nach Erfassungsreihenfolge).
    return eventStore
      .query({ wertpapierId })
      .slice()
      .sort((a, b) => {
        if (a.payload.datum !== b.payload.datum) return a.payload.datum > b.payload.datum ? -1 : 1;
        return b.seq - a.seq;
      })
      .map((e) => ({ eventType: e.eventType, ...e.payload }));
  }

  return { kaufErfassen, kursupdateErfassen, positionenAbfragen, positionsverlaufAbfragen };
}

if (typeof module !== "undefined") {
  module.exports = { createDomain };
}
