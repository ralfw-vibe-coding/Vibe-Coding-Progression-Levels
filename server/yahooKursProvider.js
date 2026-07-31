import { fehler, treffer } from "./kursProvider.js";

// Kursquelle ohne Schlüssel. Yahoo betreibt diese Schnittstelle nicht als offizielles Angebot —
// sie kann sich ändern oder wegfallen. Deshalb steht sie in der Kette nicht allein, und deshalb
// ist jeder Fehler hier ein erwarteter Betriebszustand, kein Sonderfall.
//
// Der Vorteil gegenüber dem Anbieter mit Schlüssel: Yahoo kennt die deutschen Handelsplätze und
// liefert dort Euro-Kurse. Ein Symbol trägt den Handelsplatz als Endung — APC.DE ist Apple auf
// XETRA, EWG2.SG dasselbe Papier in Stuttgart. Ohne Endung landet man an einer US-Börse, was
// beim selben Kürzel ein ganz anderes Unternehmen sein kann.
const BASIS = "https://query1.finance.yahoo.com/v8/finance/chart";
const SUCHE = "https://query1.finance.yahoo.com/v1/finance/search";

export function createYahooKursProvider({ zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function einzelAbruf(symbol) {
    const antwort = await fetchFn(`${BASIS}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(zeitlimitMs),
    });
    if (!antwort.ok) return fehler(symbol, `Yahoo antwortete mit ${antwort.status}`, "Yahoo");

    const daten = await antwort.json();
    const meta = daten?.chart?.result?.[0]?.meta;
    if (!meta) {
      return fehler(symbol, daten?.chart?.error?.description ?? "Symbol bei Yahoo unbekannt", "Yahoo");
    }
    const kurs = meta.regularMarketPrice;
    if (typeof kurs !== "number") return fehler(symbol, "Yahoo lieferte keinen Kurs", "Yahoo");
    return treffer(symbol, kurs, meta.currency ?? "?", "Yahoo");
  }

  // Yahoo kennt keine Sammelabfrage für diesen Endpunkt, also nacheinander. Bewusst nicht
  // parallel: Eine inoffizielle Schnittstelle mit einem Schwall Anfragen zu belegen, ist der
  // sicherste Weg, ausgesperrt zu werden.
  async function kurseAbrufen(symbole) {
    const ergebnisse = new Map();
    for (const symbol of symbole) {
      try {
        const [s, e] = await einzelAbruf(symbol);
        ergebnisse.set(s, e);
      } catch (f) {
        const [s, e] = fehler(symbol, f.name === "TimeoutError" ? "Yahoo antwortete nicht rechtzeitig" : f.message, "Yahoo");
        ergebnisse.set(s, e);
      }
    }
    return ergebnisse;
  }


  // Gemessen an einer Stichprobe über acht Handelsplätze (US, XETRA, Stuttgart, Hamburg,
  // London, Mailand): Yahoo lieferte überall einen Kurs. Keine andere hier eingebundene Quelle
  // kommt über die US-Börsen hinaus — deshalb steht Yahoo vorn, obwohl es der Anbieter ohne
  // Vertrag und ohne Zusage ist. Verlässlichkeit heißt hier "liefert tatsächlich", nicht
  // "hat es zugesichert".
  const verlaesslichkeit = 0.9;

  // Yahoo trägt den Handelsplatz in der Endung des Symbols und ist damit für jedes Papier
  // zuständig, das seine eigene Suche gefunden hat.
  const kannLiefern = () => true;

  return { name: "Yahoo", kurseAbrufen, verlaesslichkeit, kannLiefern };
}

// Die Suche desselben Anbieters — eigener Baustein, weil sie einen anderen Vertrag erfüllt
// (siehe symbolSuche.js). Zusammen in dieser Datei bleibt nur, was zum Anbieter gehört:
// seine Adressen und die Eigenheiten seiner Antworten.
/** @returns {import("./symbolSuche.js").SymbolSuche} */
export function createYahooSymbolSuche({ zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function symboleSuchen(begriff) {
    try {
      const antwort = await fetchFn(`${SUCHE}?q=${encodeURIComponent(begriff)}&quotesCount=8&newsCount=0`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(zeitlimitMs),
      });
      if (!antwort.ok) return [];
      const daten = await antwort.json();
      return (daten?.quotes ?? [])
        .filter((q) => q.symbol)
        .map((q) => ({
          symbol: q.symbol,
          name: q.shortname ?? q.longname ?? "",
          boerse: q.exchange ?? "",
          waehrung: q.currency ?? null,
          quelle: "Yahoo",
        }));
    } catch {
      return [];
    }
  }
  return { name: "Yahoo", symboleSuchen };
}
