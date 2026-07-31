import { fehler, istUsBoerse, treffer } from "./kursProvider.js";

// Kursquelle mit API-Schlüssel. Hier wird zum ersten Mal ein Zugang verwaltet, der jemandem
// gehört und Grenzen hat: Der kostenlose Tarif erlaubt acht Anfragen pro Minute. Bei zwölf
// Positionen wäre das mit Einzelabrufen sofort erreicht — deshalb geht alles in *einem* Aufruf
// raus. Die Grenze zählt Anfragen, nicht Kurse.
//
// Der Tarif gibt außerdem nur US-Börsen frei. Deutsche Handelsplätze antworten mit 403 oder
// 404 und einem Hinweis auf kostenpflichtige Tarife. Das ist kein Fehler in dieser Anwendung,
// sondern eine Eigenschaft des Zugangs — und der Grund, warum diese Quelle in der Kette nicht
// allein steht.
const BASIS = "https://api.twelvedata.com/quote";
const SUCHE = "https://api.twelvedata.com/symbol_search";

export function createTwelveDataKursProvider(apiKey, { zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  // Aus einer Antwort für ein einzelnes Symbol wird ein Ergebnis. Twelve Data meldet Probleme
  // nicht über den HTTP-Status, sondern im Rumpf — ein "code" im Objekt bedeutet Fehlschlag.
  function auswerten(symbol, eintrag) {
    if (!eintrag) return fehler(symbol, "Twelve Data lieferte kein Ergebnis", "Twelve Data");
    if (eintrag.code || eintrag.status === "error") {
      const text = String(eintrag.message ?? `Fehler ${eintrag.code}`);
      // Die Hinweise auf Tarif-Upgrades sind lang und werben; für die Anzeige genügt der Kern.
      const gekuerzt = /available (starting with|with your plan)/i.test(text)
        ? "bei Twelve Data nur in kostenpflichtigen Tarifen"
        : text.split(". ")[0];
      return fehler(symbol, gekuerzt, "Twelve Data");
    }
    const kurs = Number(eintrag.close ?? eintrag.price);
    if (!Number.isFinite(kurs)) return fehler(symbol, "Twelve Data lieferte keinen Kurs", "Twelve Data");
    return treffer(symbol, kurs, eintrag.currency ?? "?", "Twelve Data");
  }

  async function kurseAbrufen(symbole) {
    if (symbole.length === 0) return new Map();

    const url = `${BASIS}?symbol=${encodeURIComponent(symbole.join(","))}&apikey=${encodeURIComponent(apiKey)}`;
    let daten;
    try {
      const antwort = await fetchFn(url, { signal: AbortSignal.timeout(zeitlimitMs) });
      // 429 ist die Rate-Limit-Antwort und verdient eine verständliche Meldung — sie sagt dem
      // Nutzer "gleich nochmal", nicht "kaputt".
      if (antwort.status === 429) {
        return new Map(symbole.map((s) => fehler(s, "Anfragelimit erreicht, in einer Minute erneut versuchen", "Twelve Data")));
      }
      if (!antwort.ok) {
        return new Map(symbole.map((s) => fehler(s, `Twelve Data antwortete mit ${antwort.status}`, "Twelve Data")));
      }
      daten = await antwort.json();
    } catch (f) {
      const text = f.name === "TimeoutError" ? "Twelve Data antwortete nicht rechtzeitig" : f.message;
      return new Map(symbole.map((s) => fehler(s, text, "Twelve Data")));
    }

    // Bei einem einzelnen Symbol liefert der Dienst das Ergebnis direkt, bei mehreren einen
    // Verbund mit dem Symbol als Schlüssel. Beides auf dieselbe Form bringen.
    const einzeln = symbole.length === 1;
    return new Map(symbole.map((s) => auswerten(s, einzeln ? daten : daten?.[s])));
  }


  // In der Messung lieferte der Dienst außerhalb der US-Börsen für kein einziges Papier einen
  // Kurs — XETRA, London, Mailand, CBOE Europe antworteten durchweg mit 404. Für US-Papiere
  // stimmten seine Kurse dagegen auf die Nachkommastelle mit Yahoo überein.
  const verlaesslichkeit = 0.5;

  // Die Absage ist hier nicht der einzige Grund für die Vorabprüfung. Twelve Data führt
  // Symbole *ohne* Handelsplatz-Endung: In der Suche steht SAP an der XETRA, beim Abruf
  // liefert dasselbe Kürzel den New Yorker Zweitlisting-Kurs — 180,88 USD statt 155,64 EUR,
  // ohne jeden Hinweis. Wer nur den 404 abfangen wollte, hätte diesen Fall nicht bemerkt:
  // Er kommt als Erfolg zurück. Deshalb bleiben nur die Handelsplätze übrig, für die das
  // Kürzel eindeutig ist.
  const kannLiefern = (t) => istUsBoerse(t.boerse);

  return { name: "Twelve Data", kurseAbrufen, verlaesslichkeit, kannLiefern };
}

// Die Suche zeigt die ganze Datenbank, auch Papiere, die der eigene Tarif später nicht abrufen
// darf. Das ist kein Widerspruch: Gefunden heißt hier "existiert", nicht "verfügbar" — und
// genau deshalb ist die Suche ein eigener Baustein mit eigenem Vertrag.
/** @returns {import("./symbolSuche.js").SymbolSuche} */
export function createTwelveDataSymbolSuche(apiKey, { zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function symboleSuchen(begriff) {
    try {
      const antwort = await fetchFn(`${SUCHE}?symbol=${encodeURIComponent(begriff)}&outputsize=8&apikey=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(zeitlimitMs),
      });
      if (!antwort.ok) return [];
      const daten = await antwort.json();
      return (daten?.data ?? [])
        .filter((t) => t.symbol)
        .map((t) => ({
          symbol: t.symbol,
          name: t.instrument_name ?? "",
          boerse: t.exchange ?? "",
          waehrung: t.currency ?? null,
          quelle: "Twelve Data",
        }));
    } catch {
      return [];
    }
  }
  return { name: "Twelve Data", symboleSuchen };
}
