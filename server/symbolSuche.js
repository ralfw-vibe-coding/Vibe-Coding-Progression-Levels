// xProvider: kapselt die Ressource "Wertpapiersuche" — etwas anderes als eine Kursquelle,
// auch wenn dieselben Anbieter beides können.
//
// Zuerst steckte das Suchen im Kursprovider. Dass es dort nicht hingehört, hat sich an einer
// Stelle gezeigt: Die verkettete Fassung brauchte zwei *verschiedene* Regeln. Kurse werden
// gesucht, bis einer gefunden ist — mehr braucht niemand. Bei der Suche ist es umgekehrt, da
// will man alles, was mehrere Quellen kennen, denn erst die Auswahl über Handelsplätze hinweg
// macht sie brauchbar. Zwei Kompositionsregeln in einer Schnittstelle heißt: es sind zwei.
//
// Auch die Betriebsfragen sind andere. Eine Kursabfrage läuft oft und muss sparsam mit
// Anfragelimits umgehen; eine Suche läuft selten, dafür interaktiv, und darf nie den Vorgang
// aufhalten, an dem sie hängt.

/**
 * @typedef {object} SymbolSuche
 * @property {string} name
 * @property {(begriff: string) => Promise<SymbolTreffer[]>} symboleSuchen
 *   Findet die Suche nichts, ist das ein leeres Ergebnis — kein Fehler. "Nicht gefunden" ist
 *   hier der Normalfall, nicht die Ausnahme.
 */

/**
 * Ein Suchtreffer ist alles, was man braucht, um später eindeutig einen Kurs zu holen:
 * bei *wem* (quelle), *was* (symbol), *wo* (boerse) und in *welcher Währung*.
 * @typedef {{ symbol: string, name: string, boerse: string, waehrung: string | null, quelle: string }} SymbolTreffer
 */

// Deutsche Handelsplätze, wie die Quellen sie benennen. Sie werden bevorzugt, wenn die App
// selbst ein Symbol auswählen muss: Das Depot rechnet in Euro, und ein hier gehandeltes Papier
// erspart die Umrechnung samt ihrer Ungenauigkeit.
const DEUTSCHE_BOERSEN = ["XETR", "GER", "XSTU", "STU", "FSX", "FRA", "XHAM", "HAM", "XMUN", "MUN", "XBER", "BER", "XDUS", "DUS", "HAN", "SG"];

export function istDeutscheBoerse(boerse) {
  return DEUTSCHE_BOERSEN.includes(String(boerse ?? "").toUpperCase());
}

// Wörter, die in Wertpapiernamen so häufig vorkommen, dass eine Übereinstimmung nichts
// bedeutet. Ohne diese Liste würden zwei beliebige Fonds als "derselbe" durchgehen.
const NICHTSSAGEND = new Set([
  "aktie", "inhaber", "inhaberaktie", "namens", "stueck", "stück", "index", "fund", "fonds",
  "trust", "group", "holding", "holdings", "corporation", "company", "limited", "shares",
  "class", "acc", "dist", "eur", "usd", "der", "die", "das", "und", "the", "core", "ucits",
  // Rechtsformen: Sie stehen in fast jedem Namen und sagen über die Identität nichts aus.
  "ag", "se", "kgaa", "gmbh", "nv", "sa", "spa", "plc", "ltd", "llc", "co", "corp", "inc",
]);

function woerter(name) {
  return new Set(
    String(name ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      // Ab drei Zeichen: Kurze Firmennamen wie SAP oder BMW sind aussagekräftig, und bei
      // einer Untergrenze von vier fielen sie durchs Raster — dann wäre die Wortmenge leer
      // und jede Prüfung schlüge fehl.
      .filter((w) => w.length >= 3 && !NICHTSSAGEND.has(w)),
  );
}

// Prüft, ob ein gefundenes Papier plausibel das gesuchte ist.
//
// Der Anlass ist ein realer Fehlgriff: Für "iShares Core MSCI World" wurde über eine falsch
// abgeleitete ISIN "ADS" — Adidas — gefunden und beinahe zugeordnet. Ab dem nächsten Abruf
// hätte ein Adidas-Kurs im Depot gestanden, ohne dass irgendetwas darauf hingewiesen hätte.
//
// Eine stillschweigend falsche Zuordnung ist schlimmer als gar keine: Sie sieht richtig aus.
// Deshalb wird eine Übereinstimmung im Namen verlangt, bevor die Anwendung von sich aus
// zuordnet. Im Zweifel ordnet sie nicht zu und sagt das.
export function namenPassenZusammen(gesucht, gefunden) {
  const a = woerter(gesucht);
  const b = woerter(gefunden);
  if (a.size === 0 || b.size === 0) return false;
  for (const wort of a) {
    if (b.has(wort)) return true;
    // Auch Teilwörter zählen: "Weltfonds" zu "Weltfonds ESG", "Euwax" zu "Euwax-Gold".
    for (const anderes of b) {
      if (anderes.startsWith(wort) || wort.startsWith(anderes)) return true;
    }
  }
  return false;
}

// Sammelt statt abzubrechen: Verschiedene Quellen kennen dasselbe Papier an verschiedenen
// Handelsplätzen. Doppelte Symbole fallen weg, die erste Nennung gewinnt.
/** @returns {SymbolSuche} */
export function createVerketteteSymbolSuche(...quellen) {
  const name = quellen.map((q) => q.name).join(" + ");

  async function symboleSuchen(begriff) {
    const gesehen = new Set();
    const treffer = [];
    for (const quelle of quellen) {
      let teil = [];
      try {
        teil = await quelle.symboleSuchen(begriff);
      } catch {
        teil = []; // eine ausgefallene Quelle liefert eben nichts; die anderen genügen
      }
      for (const t of teil) {
        if (gesehen.has(t.symbol)) continue;
        gesehen.add(t.symbol);
        treffer.push(t);
      }
    }
    return treffer;
  }

  return { name, symboleSuchen };
}

// Ohne Netz, für Tests: `treffer` ordnet Suchbegriffen ihre Ergebnisse zu.
/**
 * @param {Record<string, any[]>} [treffer]
 * @param {{ name?: string, fehlerText?: string | null }} [optionen]
 *   fehlerText lässt die Suche scheitern — der Fall, den man bei einem echten Dienst nicht
 *   herstellen kann.
 */
export function createSimulierteSymbolSuche(treffer = {}, { name = "Simulation", fehlerText = null } = {}) {
  const aufrufe = [];
  function symboleSuchen(begriff) {
    aufrufe.push(begriff);
    if (fehlerText) return Promise.reject(new Error(fehlerText));
    return Promise.resolve((treffer[begriff] ?? []).map((t) => ({ name: "", boerse: "", waehrung: null, quelle: name, ...t })));
  }
  return { name, symboleSuchen, aufrufe };
}
