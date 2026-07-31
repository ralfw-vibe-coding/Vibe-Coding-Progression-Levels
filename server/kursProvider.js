import { istDeutscheBoerse } from "./symbolSuche.js";

// xProvider: kapselt die Ressource "Kursquelle". Es wird davon mehrere Ausprägungen geben —
// ein Dienst mit Schlüssel, einer ohne, ein simulierter für Tests. Sie unterscheiden sich nur
// darin, *wen* sie fragen, und erfahren das bei ihrer Erzeugung.
//
// Anders als beim Event-Store ist hier von vornherein klar, dass keine Quelle alles kennt:
// Zertifikate einzelner Emittenten, kleine Nebenwerte und manche Fonds fehlen überall. Deshalb
// ist "nicht gefunden" kein Ausnahmefall, sondern ein reguläres Ergebnis — pro Symbol, nicht
// pro Aufruf.

/**
 * Der Vertrag jeder Kursquelle. Geprüft wird er für alle Ausprägungen gemeinsam in
 * tests/server/kursProviderVertrag.ts.
 *
 * @typedef {object} KursProvider
 * @property {string} name
 *   Zur Anzeige und für Protokolle — welche Quelle einen Kurs geliefert hat.
 * @property {(symbole: string[]) => Promise<Map<string, KursErgebnis>>} kurseAbrufen
 *   Liefert zu jedem angefragten Symbol genau einen Eintrag. Ein Symbol, das die Quelle nicht
 *   kennt, bekommt ein Ergebnis mit `fehler` — es fehlt nie einfach.
 * @property {number} [verlaesslichkeit]
 *   Wie oft diese Quelle auf eine Anfrage hin wirklich einen Kurs liefert — gemessen an einer
 *   Stichprobe echter Papiere, nicht geschätzt. Die Zahl ordnet Kandidaten vor: Wer eher
 *   liefert, wird eher gefragt.
 * @property {(treffer: import("./symbolSuche.js").SymbolTreffer) => boolean} [kannLiefern]
 *   Sagt *vor* dem Abruf, ob dieser Kandidat überhaupt im Tarif liegt. Was hier durchfällt,
 *   kostet keine Anfrage und taucht in keiner Auswahl auf. Ohne diese Auskunft muss jeder
 *   Kandidat einzeln erprobt werden — bei zwanzig Treffern zwanzig Anfragen für ein Ergebnis,
 *   das die Quelle vorher wusste.
 *
 *   Beide Angaben sind freiwillig: Wer schweigt, wird mittelmäßig eingeschätzt und darf jeden
 *   Kandidaten versuchen. Eine simulierte Quelle im Test muss so nicht mehr behaupten, als
 *   der Test wissen will.
 */

/**
 * @typedef {{ kurs: number, waehrung: string, quelle: string }
 *          | { fehler: string, quelle: string }} KursErgebnis
 */

// Absichtlich mehrere Symbole auf einmal: Kursquellen begrenzen die Zahl der Anfragen pro
// Minute, nicht die Zahl der Kurse. Ein Aufruf für zwölf Positionen ist damit etwas völlig
// anderes als zwölf Aufrufe.
export function fehler(symbol, text, quelle) {
  return [symbol, { fehler: text, quelle }];
}

export function treffer(symbol, kurs, waehrung, quelle) {
  return [symbol, { kurs, waehrung, quelle }];
}

// US-Handelsplätze, wie die Anbieter sie benennen. Mehrere kostenlose Tarife geben genau diese
// frei und sonst nichts — die Liste ist deshalb keine Marotte eines Anbieters, sondern die
// Grenze, an der die kostenlosen Zugänge durchweg enden.
const US_BOERSEN = ["US", "NASDAQ", "NYSE", "NYSE ARCA", "NYSE AMERICAN", "AMEX", "BATS", "OTC", "CBOE US"];

export function istUsBoerse(boerse) {
  return US_BOERSEN.includes(String(boerse ?? "").toUpperCase());
}

// Bewertet Kandidaten aus einer Symbolsuche danach, wie aussichtsreich ein Kursabruf ist, und
// wirft aussortierte weg. Dahinter steht eine Erfahrung aus dem Betrieb: Eine Suche findet, was
// ein Anbieter *kennt*; abrufen darf man nur, was der Tarif *freigibt*. Zwischen beidem liegen
// bei kostenlosen Zugängen Welten, und wer den Unterschied erst beim Abruf bemerkt, hat dem
// Nutzer vorher eine Liste hingelegt, die zu drei Vierteln aus Sackgassen besteht.
//
// Zurück kommt nur, wofür es überhaupt eine eingerichtete Quelle gibt, die den Handelsplatz
// bedienen darf — sortiert, die aussichtsreichsten zuerst.
/**
 * @param {import("./symbolSuche.js").SymbolTreffer[]} kandidaten
 * @param {Record<string, KursProvider>} kursquellen
 */
export function nachAussichtSortiert(kandidaten, kursquellen) {
  return kandidaten
    .map((t) => ({ ...t, aussicht: aussicht(t, kursquellen) }))
    .filter((t) => t.aussicht > 0)
    .sort((a, b) => b.aussicht - a.aussicht);
}

function aussicht(kandidat, kursquellen) {
  const quelle = kursquellen[kandidat.quelle];
  // Gefunden bei einem Anbieter, der hier gar nicht als Kursquelle läuft: Das Symbol gilt in
  // seiner Notation und wäre bei einem anderen Anbieter ein anderes Papier oder keines.
  if (!quelle) return 0;
  if (quelle.kannLiefern && !quelle.kannLiefern(kandidat)) return 0;
  const grund = quelle.verlaesslichkeit ?? 0.5;
  // Euro schlägt Fremdwährung, aber nur knapp: Umrechnen kann die Anwendung, sie hängt dabei
  // allerdings an einem *weiteren* Dienst. Ein Eurokurs ist damit nicht genauer, sondern von
  // weniger abhängig — und genau das ist hier gemeint. Nennt die Suche keine Währung (Finnhub
  // tut das nie), steht der deutsche Handelsplatz als schwächerer Anhaltspunkt dafür ein.
  if (kandidat.waehrung === "EUR") return grund + 0.05;
  if (!kandidat.waehrung && istDeutscheBoerse(kandidat.boerse)) return grund + 0.03;
  return grund;
}

// Verkettet mehrere Quellen: Was die erste nicht kennt, bekommt die zweite vorgelegt, und so
// weiter. Nach außen ist die Kette selbst wieder eine Kursquelle — sie erfüllt denselben
// Vertrag und lässt sich an derselben Stelle einsetzen.
//
// Der Sinn ist nicht Ausfallsicherheit, sondern Abdeckung: Die Quellen kennen jeweils andere
// Papiere. Erst zusammen ergeben sie ein brauchbares Bild.
/** @returns {KursProvider} */
export function createVerketteterKursProvider(...provider) {
  const name = provider.map((p) => p.name).join(" -> ");

  async function kurseAbrufen(symbole) {
    const ergebnisse = new Map();
    let offen = [...symbole];

    for (const quelle of provider) {
      if (offen.length === 0) break;
      let teilergebnis;
      try {
        teilergebnis = await quelle.kurseAbrufen(offen);
      } catch (f) {
        // Fällt eine Quelle komplett aus, ist das kein Grund aufzugeben — die nächste bekommt
        // dieselben Symbole vorgelegt. Nur wenn keine mehr übrig ist, bleibt der Fehler stehen.
        teilergebnis = new Map(offen.map((s) => fehler(s, `${quelle.name} nicht erreichbar: ${f.message}`, quelle.name)));
      }
      const nochOffen = [];
      for (const symbol of offen) {
        const e = teilergebnis.get(symbol) ?? { fehler: `${quelle.name} lieferte kein Ergebnis`, quelle: quelle.name };
        // Ein Treffer beendet die Suche für dieses Symbol. Ein Fehler wird gemerkt, aber die
        // nächste Quelle darf es trotzdem versuchen.
        if (e.fehler === undefined) ergebnisse.set(symbol, e);
        else { ergebnisse.set(symbol, e); nochOffen.push(symbol); }
      }
      offen = nochOffen;
    }

    return ergebnisse;
  }

  return { name, kurseAbrufen };
}
