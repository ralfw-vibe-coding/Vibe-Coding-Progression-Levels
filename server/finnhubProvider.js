import { fehler, istUsBoerse, treffer } from "./kursProvider.js";

// Finnhub — der erste Anbieter, bei dem sich Suche und Kursabruf deutlich unterscheiden:
//
//   Suche:  kennt ISINs, auch deutsche. DE000EWG2LD7 -> EWG2.SG, DE0007164600 -> SAP.DE.
//           Damit schließt er die Lücke, die WKN und ISIN bisher offenließen.
//   Kurse:  im kostenlosen Tarif nur US-Börsen. Deutsche Handelsplätze antworten mit 403.
//
// Dass beides in getrennten Bausteinen steckt, zahlt sich hier zum ersten Mal aus: Man kann
// den einen Teil eines Anbieters nutzen und den anderen weglassen, ohne etwas zu verbiegen.
// Hätte ein Anbieter beides in einem Vertrag erfüllen müssen, wäre Finnhub entweder ganz
// draußen oder als halb kaputte Kursquelle drin.
const BASIS = "https://finnhub.io/api/v1";

/** @returns {import("./kursProvider.js").KursProvider} */
export function createFinnhubKursProvider(apiKey, { zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function einzelAbruf(symbol) {
    const antwort = await fetchFn(`${BASIS}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(zeitlimitMs),
    });
    // 403 heißt hier nicht "falscher Schlüssel", sondern "dieser Handelsplatz ist im Tarif
    // nicht enthalten" — eine Aussage über den Zugang, keine über die Anwendung.
    if (antwort.status === 403) return fehler(symbol, "bei Finnhub nur US-Börsen im kostenlosen Tarif", "Finnhub");
    if (antwort.status === 429) return fehler(symbol, "Anfragelimit erreicht, gleich erneut versuchen", "Finnhub");
    if (!antwort.ok) return fehler(symbol, `Finnhub antwortete mit ${antwort.status}`, "Finnhub");

    const daten = await antwort.json();
    // Finnhub liefert bei unbekannten Symbolen 200 mit lauter Nullen statt eines Fehlers.
    const kurs = daten?.c;
    if (typeof kurs !== "number" || kurs === 0) return fehler(symbol, "Finnhub kennt kein Papier zu diesem Symbol", "Finnhub");
    // Der Quote-Endpunkt nennt keine Währung. Da der Tarif nur US-Börsen freigibt, ist es
    // Dollar — aber geraten wird das nicht: Die erwartete Währung steht im Kursbezug, und der
    // Body vergleicht sie mit dieser Angabe.
    return treffer(symbol, kurs, "USD", "Finnhub");
  }

  async function kurseAbrufen(symbole) {
    const ergebnisse = new Map();
    for (const symbol of symbole) {
      try {
        const [s, e] = await einzelAbruf(symbol);
        ergebnisse.set(s, e);
      } catch (f) {
        const [s, e] = fehler(symbol, f.name === "TimeoutError" ? "Finnhub antwortete nicht rechtzeitig" : f.message, "Finnhub");
        ergebnisse.set(s, e);
      }
    }
    return ergebnisse;
  }

  // Innerhalb der US-Börsen zuverlässig, außerhalb chancenlos. Der Abschlag gegenüber Yahoo
  // hat einen zweiten Grund: Der Dienst antwortete in der Messung mehrfach gar nicht mehr,
  // nachdem einige Abrufe hintereinander gelaufen waren.
  const verlaesslichkeit = 0.6;

  // Was hier durchfällt, würde mit 403 beantwortet. Diese Absage lässt sich vorhersagen, also
  // wird sie nicht erst eingeholt: Der Handelsplatz steht in der Endung des Symbols, und alles
  // ohne Endung ist bei Finnhub eine US-Notierung.
  const kannLiefern = (t) => istUsBoerse(t.boerse) || !String(t.symbol ?? "").includes(".");

  return { name: "Finnhub", kurseAbrufen, verlaesslichkeit, kannLiefern };
}

/** @returns {import("./symbolSuche.js").SymbolSuche} */
export function createFinnhubSymbolSuche(apiKey, { zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function symboleSuchen(begriff) {
    try {
      const antwort = await fetchFn(`${BASIS}/search?q=${encodeURIComponent(begriff)}&token=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(zeitlimitMs),
      });
      if (!antwort.ok) return [];
      const daten = await antwort.json();
      return (daten?.result ?? [])
        .filter((t) => t.symbol)
        .map((t) => ({
          symbol: t.symbol,
          name: t.description ?? "",
          // Der Handelsplatz steckt in der Endung des Symbols (EWG2.SG, SAP.DE); ohne Endung
          // ist es eine US-Notierung. Eine eigene Angabe dafür liefert Finnhub nicht.
          boerse: t.symbol.includes(".") ? t.symbol.slice(t.symbol.lastIndexOf(".") + 1) : "US",
          waehrung: null, // die Suche nennt keine Währung — sie steht erst beim Zuordnen fest
          quelle: "Finnhub",
        }));
    } catch {
      return [];
    }
  }

  return { name: "Finnhub", symboleSuchen };
}
