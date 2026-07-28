// Domäne: kennt den Event-Store, kapselt den App-State. Commands erzeugen Events,
// Queries projizieren Events zu einem Modell. Keine Formatierung, keine Darstellung.
export function createDomain(eventStore) {
  // name, typ und broker beschreiben die Position und kommen nur beim ersten Kauf mit — ein
  // Nachkauf lässt sie weg, seine Position steht ja schon. kaufkurs fehlt, wo er unbekannt
  // ist (dann bleibt die Position ohne Kaufwert, statt einen erfundenen zu bekommen).
  /**
   * @param {{ wertpapierId: string, name?: string, typ?: string, broker?: string | null,
   *           stueck: number, kaufkurs?: number | null, datum: string }} kauf
   */
  function kaufErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, datum }) {
    eventStore.append("kauf", { wertpapierId, name, typ, broker, stueck, kaufkurs, datum });
  }

  /** @param {{ wertpapierId: string, kurs: number, datum: string }} kursupdate */
  function kursupdateErfassen({ wertpapierId, kurs, datum }) {
    eventStore.append("kursupdate", { wertpapierId, kurs, datum });
  }

  function positionenAbfragen() {
    // Mehrere "kauf"-Events zu selber wertpapierId UND selbem Broker sind Nachkäufe und
    // werden addiert: Stück summiert sich, Kaufwert ist die Summe der einzelnen
    // Stück×Kaufkurs-Anteile. Derselbe Titel bei verschiedenen Brokern ist dagegen eine
    // eigenständige Position — der Broker gehört zur Identität, nicht nur zur Beschriftung.
    const kaeufe = new Map();
    const kurse = new Map();
    for (const e of eventStore.query()) {
      if (e.eventType === "kauf") {
        const p = e.payload;
        const broker = p.broker || null;
        const schluessel = `${p.wertpapierId}::${broker || ""}`;
        let agg = kaeufe.get(schluessel);
        if (!agg) {
          agg = { wertpapierId: p.wertpapierId, name: p.name, typ: p.typ, broker, stueck: 0, kaufwertSumme: 0, kaufwertBekannt: false };
          kaeufe.set(schluessel, agg);
        }
        agg.stueck += p.stueck;
        if (p.kaufkurs != null) {
          agg.kaufwertSumme += p.stueck * p.kaufkurs;
          agg.kaufwertBekannt = true;
        }
      }
      if (e.eventType === "kursupdate") {
        // Gleichstand beim Datum (Tagesgenauigkeit) wird per seq aufgelöst — sonst gewinnt
        // bei zwei Kursupdates am selben Tag immer das zuerst erfasste statt das neueste,
        // dieselbe Regel wie in positionsverlaufAbfragen().
        const bisher = kurse.get(e.payload.wertpapierId);
        const neuer = !bisher
          || e.payload.datum > bisher.payload.datum
          || (e.payload.datum === bisher.payload.datum && e.seq > bisher.seq);
        if (neuer) kurse.set(e.payload.wertpapierId, e);
      }
    }

    const positionen = [];
    let depotwert = 0;
    let kaufwertGesamt = 0;
    for (const agg of kaeufe.values()) {
      const kursupdate = kurse.get(agg.wertpapierId);
      const kurs = kursupdate ? kursupdate.payload.kurs : null;
      const kursDatum = kursupdate ? kursupdate.payload.datum : null;
      const wert = kurs != null ? agg.stueck * kurs : 0;
      const kaufwert = agg.kaufwertBekannt ? agg.kaufwertSumme : null;
      const kaufkurs = kaufwert != null ? kaufwert / agg.stueck : null; // Ø über alle Käufe
      const diffAbs = kaufwert != null ? wert - kaufwert : null;
      const diffPct = kaufwert ? (diffAbs / kaufwert) * 100 : null;
      positionen.push({
        wertpapierId: agg.wertpapierId, name: agg.name, typ: agg.typ, broker: agg.broker, stueck: agg.stueck,
        wert, kurs, kursDatum, kaufwert, kaufkurs, diffAbs, diffPct,
        anteilAmDepot: 0, // steht erst fest, wenn der Depotwert komplett ist (siehe unten)
      });
      depotwert += wert;
      kaufwertGesamt += kaufwert ?? 0;
    }

    for (const p of positionen) {
      p.anteilAmDepot = depotwert ? (p.wert / depotwert) * 100 : 0;
    }

    const veraenderungAbs = depotwert - kaufwertGesamt;
    const veraenderungPct = kaufwertGesamt ? (veraenderungAbs / kaufwertGesamt) * 100 : 0;

    // Alle im Bestand tatsächlich vorkommenden Broker, für Auswahl-/Filterlisten im Frontend.
    const bekannteBroker = [...new Set(positionen.map((p) => p.broker).filter(Boolean))].sort();

    return { depotwert, kaufwertGesamt, veraenderungAbs, veraenderungPct, positionen, bekannteBroker };
  }

  /** @param {{ wertpapierId: string, broker?: string | null }} position */
  function positionsverlaufAbfragen({ wertpapierId, broker }) {
    // Umgekehrt chronologisch: neuestes Ereignis zuerst (nach fachlichem Datum, bei
    // Gleichstand nach Erfassungsreihenfolge). Kauf-Ereignisse gehören nur zum Verlauf, wenn
    // ihr Broker zur angefragten Position passt — Kursupdates gelten titelweit für alle
    // Broker, da der Kurs nicht vom Broker abhängt.
    return eventStore
      .query({ wertpapierId })
      .filter((e) => e.eventType === "kursupdate" || (e.payload.broker || null) === (broker || null))
      .sort((a, b) => {
        if (a.payload.datum !== b.payload.datum) return a.payload.datum > b.payload.datum ? -1 : 1;
        return b.seq - a.seq;
      })
      .map((e) => ({ eventType: e.eventType, ...e.payload }));
  }

  // Die Domäne verantwortet Änderung und Auslesen des Zustands — also auch den Extremfall:
  // einen kompletten Bestand einspielen bzw. ihn vollständig herausgeben. Beides gehört zum
  // Im- und Export und kommt im laufenden Betrieb nicht vor; dort werden nur Ereignisse
  // angehängt. Ob dabei etwas gespeichert wird, ist Sache des Event-Store; die Domäne
  // erfährt davon nichts.
  function restore(events) {
    eventStore.restore(events);
  }

  function dump() {
    return eventStore.query();
  }

  return {
    kaufErfassen, kursupdateErfassen, positionenAbfragen, positionsverlaufAbfragen,
    restore, dump,
  };
}
