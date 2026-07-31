import { createFinnhubSymbolSuche } from "../../server/finnhubProvider.js";
import { createVerketteteSymbolSuche, createSimulierteSymbolSuche, istDeutscheBoerse, namenPassenZusammen } from "../../server/symbolSuche.js";

Deno.test("die Suche führt Treffer aller Quellen zusammen, statt bei der ersten aufzuhören", async () => {
  // Der Unterschied zur Kurskette: Dort genügt der erste Treffer. Hier ist gerade die Auswahl
  // über mehrere Handelsplätze hinweg der Zweck.
  const suche = createVerketteteSymbolSuche(
    createSimulierteSymbolSuche({ gold: [{ symbol: "EWG2.SG" }] }, { name: "eins" }),
    createSimulierteSymbolSuche({ gold: [{ symbol: "EWG2.SG" }, { symbol: "EWG2.F" }] }, { name: "zwei" }),
  );
  const treffer: any = await suche.symboleSuchen("gold");
  if (treffer.length !== 2) throw new Error(`erwartet 2 Treffer, war ${treffer.length}`);
  if (treffer[0].quelle !== "eins") throw new Error("bei doppelten Symbolen gewinnt die erste Nennung");
});

Deno.test("eine ausgefallene Quelle reißt die Suche nicht mit", async () => {
  const suche = createVerketteteSymbolSuche(
    createSimulierteSymbolSuche({}, { name: "kaputt", fehlerText: "Netz weg" }),
    createSimulierteSymbolSuche({ x: [{ symbol: "X.DE" }] }, { name: "heil" }),
  );
  const treffer: any = await suche.symboleSuchen("x");
  if (treffer.length !== 1) throw new Error("die heile Quelle muss trotzdem liefern");
});

Deno.test("nichts gefunden ist ein leeres Ergebnis, kein Fehler", async () => {
  const suche = createVerketteteSymbolSuche(createSimulierteSymbolSuche({}));
  const treffer: any = await suche.symboleSuchen("gibtsnicht");
  if (!Array.isArray(treffer) || treffer.length !== 0) throw new Error("erwartet ein leeres Array");
});

Deno.test("deutsche Handelsplätze werden erkannt", () => {
  for (const b of ["XETR", "GER", "STU", "xham", "MUN"]) {
    if (!istDeutscheBoerse(b)) throw new Error(`${b} sollte als deutsch gelten`);
  }
  for (const b of ["NASDAQ", "NYSE", "LSE", "", null]) {
    if (istDeutscheBoerse(b as any)) throw new Error(`${b} sollte nicht als deutsch gelten`);
  }
});

Deno.test("Namen werden auf Plausibilität geprüft, bevor automatisch zugeordnet wird", () => {
  // Der reale Fehlgriff, der zu dieser Prüfung geführt hat: Für einen iShares-ETF wurde über
  // eine falsch abgeleitete ISIN Adidas gefunden.
  if (namenPassenZusammen("iShares Core MSCI World", "adidas AG")) {
    throw new Error("Adidas darf nicht als iShares-ETF durchgehen");
  }
  // Was durchgehen muss, weil es dasselbe Papier ist:
  const passend: [string, string][] = [
    ["Boerse Stuttg. Euwax-Gold", "Euwax Gold II"],
    ["Arero-Der Weltfonds Inh.", "Arero – Der Weltfonds"],
    ["Apple Inc", "Apple Inc."],
    ["ISVP.-IS.M.EES EOA", "ISVP iShares MSCI EES"],
  ];
  for (const [a, b] of passend) {
    if (!namenPassenZusammen(a, b)) throw new Error(`"${a}" und "${b}" sollten zusammenpassen`);
  }
});

Deno.test("nichtssagende Wörter allein genügen nicht", () => {
  // Sonst gälten zwei beliebige Fonds als dasselbe Papier.
  if (namenPassenZusammen("Deka Fonds Index", "Union Fonds Index")) {
    throw new Error("Allerweltswörter dürfen keine Übereinstimmung begründen");
  }
});

Deno.test("Finnhub liest den Handelsplatz aus der Symbolendung", async () => {
  // Finnhub nennt den Handelsplatz nicht eigens — er steckt in EWG2.SG bzw. fehlt bei
  // US-Notierungen.
  const suche = createFinnhubSymbolSuche("k", {
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({
      result: [{ symbol: "EWG2.SG", description: "EUWAX GOLD II" }, { symbol: "AAPL", description: "APPLE INC" }],
    }))),
  });
  const treffer: any = await suche.symboleSuchen("DE000EWG2LD7");
  if (treffer[0].boerse !== "SG") throw new Error(`erwartet SG, war ${treffer[0].boerse}`);
  if (treffer[1].boerse !== "US") throw new Error(`ohne Endung erwartet US, war ${treffer[1].boerse}`);
});

Deno.test("kurze Firmennamen bestehen die Prüfung", () => {
  // Bei einer Untergrenze von vier Zeichen war die Wortmenge von "SAP SE" leer — damit
  // scheiterte die Prüfung immer, und SAP bekam nie ein Symbol zugeordnet.
  for (const [a, b] of [["SAP SE", "SAP SE"], ["BMW AG", "BMW AG Stammaktie"]] as [string, string][]) {
    if (!namenPassenZusammen(a, b)) throw new Error(`"${a}" und "${b}" sollten zusammenpassen`);
  }
});

Deno.test("Rechtsformen allein begründen keine Übereinstimmung", () => {
  if (namenPassenZusammen("Muster AG", "Anders AG")) throw new Error("nur die Rechtsform ist keine Übereinstimmung");
});
