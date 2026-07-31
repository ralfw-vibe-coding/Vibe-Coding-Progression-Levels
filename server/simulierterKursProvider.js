import { fehler, treffer } from "./kursProvider.js";

// Kursquelle ohne Netz: liefert, was man ihr vorgibt. Sie ist keine Notlösung für Tests,
// sondern der einzige Weg, die interessanten Fälle überhaupt zuverlässig herzustellen —
// Symbol unbekannt, Dienst antwortet nicht, Anfragelimit erreicht, Kurs in fremder Währung.
// Bei einem echten Dienst kann man auf solche Zustände nur warten.
//
// `kurse` ordnet Symbolen zu, was zurückkommen soll: eine Zahl (Euro), ein Objekt mit Währung,
// oder ein Text als Fehlermeldung.
/**
 * @param {Record<string, any>} [kurse]
 * @param {{ name?: string, verzoegerungMs?: number, verlaesslichkeit?: number,
 *           kannLiefern?: (treffer: any) => boolean }} [optionen]
 */
export function createSimulierterKursProvider(kurse = {}, { name = "Simulation", verzoegerungMs = 0, verlaesslichkeit = 0.5, kannLiefern = () => true } = {}) {
  const aufrufe = [];

  async function kurseAbrufen(symbole) {
    aufrufe.push([...symbole]);
    if (verzoegerungMs > 0) await new Promise((r) => setTimeout(r, verzoegerungMs));

    return new Map(symbole.map((symbol) => {
      const vorgabe = kurse[symbol];
      if (vorgabe === undefined) return fehler(symbol, `Symbol ${symbol} unbekannt`, name);
      if (typeof vorgabe === "string") return fehler(symbol, vorgabe, name);
      if (typeof vorgabe === "number") return treffer(symbol, vorgabe, "EUR", name);
      return treffer(symbol, vorgabe.kurs, vorgabe.waehrung ?? "EUR", name);
    }));
  }

  // Für Tests einsehbar: womit wurde die Quelle aufgerufen? Damit lässt sich prüfen, dass
  // gebündelt statt einzeln gefragt wird und dass die Kette nur Offenes weiterreicht.
  return { name, kurseAbrufen, aufrufe, verlaesslichkeit, kannLiefern };
}
