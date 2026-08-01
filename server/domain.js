// Domäne: kennt den Event-Store, kapselt den App-State. Commands erzeugen Events,
// Queries projizieren Events zu einem Modell. Keine Formatierung, keine Darstellung.
//
// Seit Stufe 11 ist hier alles async. Nicht, weil die Domäne selbst etwas zu warten hätte —
// sie rechnet nur —, sondern weil der Event-Store es sein kann: Liegt er in einer Datenbank am
// anderen Ende einer Leitung, dauert jede Abfrage. Wer wartet, muss warten dürfen, und das
// zieht sich vom Store durch die Domäne bis ins Portal.
//
// Das ist der Preis für Austauschbarkeit, und er ist einmalig: Ob die Ereignisse im
// Arbeitsspeicher, in einer Datei, in SQLite oder in Postgres liegen, ändert von hier an
// wieder gar nichts.
export function createDomain(eventStore) {
  // name, typ und broker beschreiben die Position und kommen nur beim ersten Kauf mit — ein
  // Nachkauf lässt sie weg, seine Position steht ja schon. kaufkurs fehlt, wo er unbekannt
  // ist (dann bleibt die Position ohne Kaufwert, statt einen erfundenen zu bekommen).
  /**
   * @param {{ wertpapierId: string, name?: string, typ?: string, broker?: string | null,
   *           stueck: number, kaufkurs?: number | null, datum: string }} kauf
   */
  async function kaufErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, datum }) {
    await eventStore.append("kauf", { wertpapierId, name, typ, broker, stueck, kaufkurs, datum });
  }

  /** @param {{ wertpapierId: string, kurs: number, datum: string }} kursupdate */
  async function kursupdateErfassen({ wertpapierId, kurs, datum }) {
    await eventStore.append("kursupdate", { wertpapierId, kurs, datum });
  }

  // Woher der Kurs dieses Papiers bezogen wird — festgelegt als Ganzes, nicht als loses Symbol.
  //
  // Ein Symbol allein genügt nicht: Ein Kurs gehört immer zu einem Handelsplatz, und derselbe
  // Titel notiert an Xetra in Euro und an der NASDAQ in Dollar. Und dasselbe Kürzel kann bei
  // verschiedenen Anbietern verschiedene Papiere meinen. Deshalb gehören Quelle, Symbol,
  // Handelsplatz und Währung zusammen — sie sind erst gemeinsam eine eindeutige Auskunft.
  //
  // Der Bezug gehört zum Wertpapier, nicht zur Position: Dasselbe Papier bei zwei Brokern hat
  // denselben Kurs. Deshalb ohne broker — anders als beim Kauf.
  //
  // Ein eigenes Ereignis, weil die Zuordnung nachträglich entsteht und sich ändern darf: Man
  // trägt sie ein, wenn man sie kennt, und korrigiert sie, wenn sie falsch war. Das jüngste
  // Ereignis gilt.
  /**
   * @param {{ wertpapierId: string, quelle: string, symbol: string,
   *           boerse?: string | null, waehrung?: string | null }} bezug
   */
  async function kursbezugZuordnen({ wertpapierId, quelle, symbol, boerse, waehrung }) {
    await eventStore.append("kursbezugZugeordnet", {
      wertpapierId,
      art: "automatisch",
      quelle: quelle || null,
      symbol: symbol || null,
      boerse: boerse || null,
      waehrung: waehrung || null,
    });
  }

  // Bewusst ohne Quelle: Für manche Papiere — Emittenten-Zertifikate, sehr kleine Werte —
  // gibt es schlicht keine. Diese Entscheidung festzuhalten ist etwas anderes als "noch nicht
  // eingerichtet": Das eine ist erledigt, das andere eine offene Aufgabe. Ohne diesen
  // Unterschied stünde jede solche Position dauerhaft als Mangel da.
  //
  // Dazu gehört, wo man den Kurs stattdessen nachschlägt. Ohne diese Angabe müsste man bei
  // jeder Pflege neu suchen — und genau das ist die Arbeit, die hier vermieden werden soll.
  async function alsManuellMarkieren({ wertpapierId, nachschlagenUnter }) {
    await eventStore.append("kursbezugZugeordnet", {
      wertpapierId, art: "manuell",
      nachschlagenUnter: nachschlagenUnter || null,
      quelle: null, symbol: null, boerse: null, waehrung: null,
    });
  }

  /** Setzt zurück auf "offen" — weder eingerichtet noch bewusst manuell. */
  async function kursbezugEntfernen({ wertpapierId }) {
    await eventStore.append("kursbezugZugeordnet", { wertpapierId, art: null, quelle: null, symbol: null, boerse: null, waehrung: null });
  }

  async function positionenAbfragen() {
    // Mehrere "kauf"-Events zu selber wertpapierId UND selbem Broker sind Nachkäufe und
    // werden addiert: Stück summiert sich, Kaufwert ist die Summe der einzelnen
    // Stück×Kaufkurs-Anteile. Derselbe Titel bei verschiedenen Brokern ist dagegen eine
    // eigenständige Position — der Broker gehört zur Identität, nicht nur zur Beschriftung.
    const kaeufe = new Map();
    const kurse = new Map();
    const kursbezuege = new Map(); // wertpapierId -> Bezug; das jüngste Ereignis gilt
    for (const e of await eventStore.query()) {
      if (e.eventType === "kursbezugZugeordnet") {
        const b = e.payload;
        // Drei Zustände, aus einem Ereignisstrom: eingerichtet, bewusst manuell, oder offen.
        if (b.art === "manuell") kursbezuege.set(b.wertpapierId, { art: "manuell", nachschlagenUnter: b.nachschlagenUnter ?? null });
        else if (b.symbol) kursbezuege.set(b.wertpapierId, { art: "automatisch", quelle: b.quelle, symbol: b.symbol, boerse: b.boerse, waehrung: b.waehrung });
        else kursbezuege.set(b.wertpapierId, null);
      }
      // Aus der Zeit, als nur ein Symbol festgehalten wurde. Die Ereignisse bleiben gültig —
      // nur fehlt ihnen die Quelle, weshalb sie für den Abruf nicht genügen und der Nutzer
      // die Zuordnung erneuern muss.
      if (e.eventType === "symbolZugeordnet") {
        const b = e.payload;
        kursbezuege.set(b.wertpapierId, b.symbol ? { art: "automatisch", quelle: null, symbol: b.symbol, boerse: null, waehrung: null } : null);
      }
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
        kursbezug: kursbezuege.get(agg.wertpapierId) ?? null,
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
  async function positionsverlaufAbfragen({ wertpapierId, broker }) {
    // Umgekehrt chronologisch: neuestes Ereignis zuerst (nach fachlichem Datum, bei
    // Gleichstand nach Erfassungsreihenfolge). Kauf-Ereignisse gehören nur zum Verlauf, wenn
    // ihr Broker zur angefragten Position passt — Kursupdates gelten titelweit für alle
    // Broker, da der Kurs nicht vom Broker abhängt.
    return (await eventStore.query({ wertpapierId }))
      // Eine Symbol-Zuordnung ist Zubehör für den Kursabruf, kein Vorgang am Depot — sie
      // gehört nicht in die Geschichte einer Position.
      .filter((e) => e.eventType !== "symbolZugeordnet" && e.eventType !== "kursbezugZugeordnet")
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
  async function restore(events) {
    await eventStore.restore(events);
  }

  async function dump() {
    return await eventStore.query();
  }

  return {
    kaufErfassen, kursupdateErfassen, kursbezugZuordnen, alsManuellMarkieren, kursbezugEntfernen,
    positionenAbfragen, positionsverlaufAbfragen,
    restore, dump,
  };
}
