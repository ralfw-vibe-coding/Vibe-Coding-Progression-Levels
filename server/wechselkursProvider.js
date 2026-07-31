// xProvider: kapselt die Ressource "Wechselkurse". Nötig geworden, weil eine Kursquelle nicht
// zwingend in der Währung antwortet, in der das Depot rechnet — Apple kostet an der NASDAQ
// Dollar und auf XETRA Euro, und es ist dasselbe Papier.
//
// Einen Dollarkurs unverändert als Euro einzutragen wäre die stillste Art, ein Depot falsch
// zu machen: Es fällt nicht auf, weil die Zahl plausibel aussieht.
//
// Quelle sind die Referenzkurse der Europäischen Zentralbank über frankfurter.dev — kostenlos,
// ohne Schlüssel, und für unseren Zweck genau richtig: Wir brauchen keinen Devisenhandel,
// sondern eine nachvollziehbare Umrechnung.
const BASIS = "https://api.frankfurter.dev/v1/latest";

export function createWechselkursProvider({ zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  // Innerhalb eines Aktualisierungslaufs ändert sich der Wechselkurs nicht — er wird deshalb
  // je Währung nur einmal geholt, egal wie viele Positionen ihn brauchen.
  const zwischenspeicher = new Map();

  async function kursNach(waehrung, zielwaehrung = "EUR") {
    if (waehrung === zielwaehrung) return 1;
    const schluessel = `${waehrung}->${zielwaehrung}`;
    if (zwischenspeicher.has(schluessel)) return zwischenspeicher.get(schluessel);

    const antwort = await fetchFn(`${BASIS}?base=${encodeURIComponent(waehrung)}&symbols=${encodeURIComponent(zielwaehrung)}`, {
      signal: AbortSignal.timeout(zeitlimitMs),
    });
    if (!antwort.ok) throw new Error(`Wechselkursdienst antwortete mit ${antwort.status}`);

    const daten = await antwort.json();
    const faktor = daten?.rates?.[zielwaehrung];
    if (typeof faktor !== "number") throw new Error(`kein Wechselkurs ${waehrung} nach ${zielwaehrung} verfügbar`);

    zwischenspeicher.set(schluessel, faktor);
    return faktor;
  }

  return { name: "EZB (frankfurter.dev)", kursNach };
}

// Ohne Netz, für Tests: feste Faktoren, und alles Unbekannte scheitert wie im Ernstfall.
export function createSimulierterWechselkursProvider(faktoren = {}, { name = "Simulation" } = {}) {
  function kursNach(waehrung, zielwaehrung = "EUR") {
    if (waehrung === zielwaehrung) return Promise.resolve(1);
    const faktor = faktoren[`${waehrung}->${zielwaehrung}`] ?? faktoren[waehrung];
    if (typeof faktor !== "number") {
      return Promise.reject(new Error(`kein Wechselkurs ${waehrung} nach ${zielwaehrung} verfügbar`));
    }
    return Promise.resolve(faktor);
  }
  return { name, kursNach };
}
