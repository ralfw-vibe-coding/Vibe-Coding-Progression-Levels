import * as domain from "../../client/domain.js";

// Positionen sehen hier so aus, wie der Server sie liefert — die Client-Domäne rechnet sie
// nicht aus, sie arbeitet nur damit.
function position(werte: any) {
  return { wertpapierId: "X", name: "Test", typ: "Aktie", broker: null, wert: 0, kaufwert: 0, diffPct: null, anteilAmDepot: 0, ...werte };
}

function modell(positionen: any[]) {
  const depotwert = positionen.reduce((s, p) => s + p.wert, 0);
  return { depotwert, kaufwertGesamt: 0, veraenderungAbs: 0, veraenderungPct: 0, positionen, bekannteBroker: ["comdirect"] };
}

const beispiel = modell([
  position({ wertpapierId: "A", name: "Apfel AG", typ: "Aktie", broker: "comdirect", wert: 200, kaufwert: 100, diffPct: 100, anteilAmDepot: 50 }),
  position({ wertpapierId: "B", name: "Bank-ETF", typ: "ETF", broker: "Interactive Brokers", wert: 100, kaufwert: 100, diffPct: 0, anteilAmDepot: 25 }),
  position({ wertpapierId: "C", name: "Citrus Zertifikat", typ: "Zertifikat", broker: "comdirect", wert: 100, kaufwert: 200, diffPct: -50, anteilAmDepot: 25 }),
]);

Deno.test("filtern ohne Filter liefert das Modell unverändert", () => {
  if (domain.filtern(beispiel, null) !== beispiel) throw new Error("erwartet dasselbe Modell");
});

Deno.test("filtern nach Suchbegriff prüft den Namen, Groß-/Kleinschreibung egal", () => {
  const gefiltert = domain.filtern(beispiel, { suchbegriff: "apfel" });
  if (gefiltert.positionen.length !== 1) throw new Error(`erwartet 1 Treffer, war ${gefiltert.positionen.length}`);
  if (gefiltert.positionen[0].wertpapierId !== "A") throw new Error("erwartet Treffer A");
});

Deno.test("filtern nach Typ erlaubt Mehrfachauswahl", () => {
  const gefiltert = domain.filtern(beispiel, { typen: ["ETF", "Zertifikat"] });
  const ids = gefiltert.positionen.map((p: any) => p.wertpapierId).sort();
  if (ids.join(",") !== "B,C") throw new Error(`erwartet [B, C], war [${ids.join(", ")}]`);
});

Deno.test("filtern nach Broker erlaubt Mehrfachauswahl", () => {
  const einer = domain.filtern(beispiel, { broker: ["comdirect"] });
  if (einer.positionen.length !== 2) throw new Error(`erwartet 2 Treffer, war ${einer.positionen.length}`);
  const beide = domain.filtern(beispiel, { broker: ["comdirect", "Interactive Brokers"] });
  if (beide.positionen.length !== 3) throw new Error(`erwartet 3 Treffer, war ${beide.positionen.length}`);
});

Deno.test("filtern kombiniert Suchbegriff und Typ", () => {
  const gefiltert = domain.filtern(beispiel, { suchbegriff: "zertifikat", typen: ["ETF"] });
  if (gefiltert.positionen.length !== 0) throw new Error("erwartet keinen Treffer bei widersprüchlichem Filter");
});

Deno.test("filtern lässt Depotwert und bekannteBroker unangetastet", () => {
  const gefiltert = domain.filtern(beispiel, { suchbegriff: "apfel" });
  if (gefiltert.depotwert !== beispiel.depotwert) throw new Error("Depotwert darf sich durch Filtern nicht ändern");
  if (JSON.stringify(gefiltert.bekannteBroker) !== JSON.stringify(beispiel.bekannteBroker)) {
    throw new Error("bekannteBroker darf sich durch Filtern nicht ändern — sonst verschwände die eigene Auswahl");
  }
});

Deno.test("zusammensetzungNachTyp gruppiert, summiert und sortiert absteigend nach Wert", () => {
  const gruppen = domain.zusammensetzungNachTyp(beispiel.positionen);
  if (gruppen.length !== 3) throw new Error(`erwartet 3 Gruppen, war ${gruppen.length}`);
  if (gruppen[0].label !== "Aktie" || gruppen[0].wert !== 200) {
    throw new Error(`erwartet Aktie mit 200 an erster Stelle, war ${gruppen[0].label} mit ${gruppen[0].wert}`);
  }
});

Deno.test("zusammensetzungNachTyp rechnet die Gewinn/Verlust-Quote je Gruppe aus", () => {
  const gruppen = domain.zusammensetzungNachTyp(beispiel.positionen);
  const aktie = gruppen.find((g: any) => g.label === "Aktie")!;
  if (aktie.diffPct !== 100) throw new Error(`erwartet +100 % für Aktie (200 gegen 100 Kaufwert), war ${aktie.diffPct}`);
  const zertifikat = gruppen.find((g: any) => g.label === "Zertifikat")!;
  if (zertifikat.diffPct !== -50) throw new Error(`erwartet -50 % für Zertifikat, war ${zertifikat.diffPct}`);
});

Deno.test("eine Gruppe ganz ohne bekannten Kaufwert hat keine Quote statt einer erfundenen", () => {
  const gruppen = domain.zusammensetzungNachTyp([
    position({ typ: "Aktie", wert: 100, kaufwert: null }),
  ]);
  if (gruppen[0].diffPct !== null) throw new Error(`erwartet null, war ${gruppen[0].diffPct}`);
});

Deno.test("zusammensetzungNachBroker fasst Positionen ohne Broker unter einem Sammelnamen", () => {
  const gruppen = domain.zusammensetzungNachBroker([
    position({ broker: null, wert: 50, kaufwert: 50 }),
    position({ broker: "comdirect", wert: 100, kaufwert: 50 }),
  ]);
  const labels = gruppen.map((g: any) => g.label);
  if (!labels.includes("Ohne Broker")) throw new Error(`erwartet "Ohne Broker", war ${JSON.stringify(labels)}`);
});

Deno.test("gewinnerUndVerlierer sortiert absteigend und lässt unbewertete Positionen weg", () => {
  const sortiert = domain.gewinnerUndVerlierer([
    ...beispiel.positionen,
    position({ wertpapierId: "D", name: "Wertlos AG", diffPct: null }),
  ]);
  if (sortiert.length !== 3) throw new Error(`erwartet 3 bewertete Positionen, war ${sortiert.length}`);
  if (sortiert[0].diffPct !== 100 || sortiert[2].diffPct !== -50) {
    throw new Error(`erwartet Reihenfolge 100, 0, -50, war ${sortiert.map((p: any) => p.diffPct).join(", ")}`);
  }
});

Deno.test("konzentration sortiert absteigend nach Anteil am Depot, ohne das Original zu verändern", () => {
  const original = beispiel.positionen;
  const sortiert = domain.konzentration(original);
  if (sortiert[0].anteilAmDepot !== 50) throw new Error(`erwartet 50 % an erster Stelle, war ${sortiert[0].anteilAmDepot}`);
  if (original[0].wertpapierId !== "A") throw new Error("die übergebene Liste darf nicht umsortiert werden");
});
