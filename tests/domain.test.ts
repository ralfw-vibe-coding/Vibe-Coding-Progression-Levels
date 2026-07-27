import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createEventStore } = require("../eventStore.js");
const { createDomain } = require("../domain.js");

function neueDomaene() {
  return createDomain(createEventStore());
}

Deno.test("gleicher Titel bei unterschiedlichem Broker ergibt zwei eigenständige Positionen", () => {
  // Broker gehört zur Identität einer Position, nicht nur zur Beschriftung: derselbe Titel
  // lässt sich bei mehreren Brokern gleichzeitig halten.
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "Interactive Brokers", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });

  const { positionen } = domain.positionenAbfragen();
  if (positionen.length !== 2) throw new Error(`erwartet 2 Positionen, war ${positionen.length}`);
  const broker = positionen.map((p: any) => p.broker).sort();
  if (JSON.stringify(broker) !== JSON.stringify(["Interactive Brokers", "comdirect"])) {
    throw new Error(`erwartet beide Broker vertreten, war ${JSON.stringify(broker)}`);
  }
});

Deno.test("Nachkauf mit gleichem Broker wird zur selben Position addiert", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "A", broker: "comdirect", stueck: 1, kaufkurs: 110, datum: "2026-07-10" });

  const { positionen } = domain.positionenAbfragen();
  if (positionen.length !== 1) throw new Error(`erwartet 1 Position, war ${positionen.length}`);
  if (positionen[0].stueck !== 2) throw new Error(`erwartet Stück 2, war ${positionen[0].stueck}`);
  if (positionen[0].broker !== "comdirect") throw new Error(`erwartet broker "comdirect", war ${positionen[0].broker}`);
});

Deno.test("broker ist optional und wird als null geführt, wenn nicht angegeben", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  const { positionen } = domain.positionenAbfragen();
  if (positionen[0].broker !== null) throw new Error(`erwartet broker null, war ${positionen[0].broker}`);
});

Deno.test("bekannteBroker listet jeden vorkommenden Broker genau einmal, sortiert", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "A", typ: "Aktie", broker: "Interactive Brokers", stueck: 1, kaufkurs: 10, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "B", name: "B", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 10, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "C", name: "C", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 10, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "D", name: "D", typ: "Aktie", stueck: 1, kaufkurs: 10, datum: "2026-07-01" }); // ohne broker

  const { bekannteBroker } = domain.positionenAbfragen();
  if (JSON.stringify(bekannteBroker) !== JSON.stringify(["Interactive Brokers", "comdirect"])) {
    throw new Error(`erwartet ["Interactive Brokers","comdirect"] sortiert, war ${JSON.stringify(bekannteBroker)}`);
  }
});

Deno.test("kauf + kursupdate ergeben Wert, Kaufwert und Veränderung einer Position", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 10, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 120, datum: "2026-07-24" });

  const { depotwert, kaufwertGesamt, positionen } = domain.positionenAbfragen();
  const p = positionen[0];

  if (p.wert !== 1200) throw new Error(`erwartet wert 1200, war ${p.wert}`);
  if (p.kaufwert !== 1000) throw new Error(`erwartet kaufwert 1000, war ${p.kaufwert}`);
  if (p.diffAbs !== 200) throw new Error(`erwartet diffAbs 200, war ${p.diffAbs}`);
  if (Math.abs(p.diffPct - 20) > 1e-9) throw new Error(`erwartet diffPct 20, war ${p.diffPct}`);
  if (depotwert !== 1200) throw new Error(`erwartet depotwert 1200, war ${depotwert}`);
  if (kaufwertGesamt !== 1000) throw new Error(`erwartet kaufwertGesamt 1000, war ${kaufwertGesamt}`);
});

Deno.test("anteilAmDepot mehrerer Positionen summiert sich zu 100 Prozent", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "A", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 100, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "B", name: "B", typ: "Aktie", stueck: 1, kaufkurs: 300, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "B", kurs: 300, datum: "2026-07-01" });

  const { positionen } = domain.positionenAbfragen();
  const summe = positionen.reduce((s: number, p: any) => s + p.anteilAmDepot, 0);
  if (Math.abs(summe - 100) > 1e-9) throw new Error(`erwartet Summe 100, war ${summe}`);

  const a = positionen.find((p: any) => p.wertpapierId === "A");
  if (Math.abs(a.anteilAmDepot - 25) > 1e-9) throw new Error(`erwartet 25% für A, war ${a.anteilAmDepot}`);
});

Deno.test("mehrere kauf-Events derselben wertpapierId addieren sich (Nachkauf)", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "A", stueck: 1, kaufkurs: 300, datum: "2026-07-10" }); // Nachkauf, kein name/typ nötig
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 500, datum: "2026-07-24" });

  const { positionen } = domain.positionenAbfragen();
  const p = positionen[0];

  if (p.stueck !== 2) throw new Error(`erwartet Stück 2, war ${p.stueck}`);
  if (p.kaufwert !== 400) throw new Error(`erwartet Kaufwert 400, war ${p.kaufwert}`);
  if (p.kaufkurs !== 200) throw new Error(`erwartet Ø-Kaufkurs 200, war ${p.kaufkurs}`);
  if (p.name !== "Test AG") throw new Error("Name muss vom ersten Kauf-Event übernommen werden");
});

Deno.test("ein Kursupdate mit früherem Datum überschreibt nicht das spätere", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 500, datum: "2026-07-24T11:12:25" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 1, datum: "2020-01-01" }); // absichtlich früher

  const { positionen } = domain.positionenAbfragen();
  const p = positionen[0];
  if (p.kurs !== 500) throw new Error(`erwartet weiterhin Kurs 500, war ${p.kurs}`);
});

Deno.test("bei zwei Kursupdates mit gleichem Datum gewinnt das zuletzt erfasste (per seq)", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-27" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 292.55, datum: "2026-07-27" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 297, datum: "2026-07-27" }); // gleicher Tag, später erfasst

  const { positionen } = domain.positionenAbfragen();
  const p = positionen[0];
  if (p.kurs !== 297) throw new Error(`erwartet Kurs 297 (zuletzt erfasst), war ${p.kurs}`);
});

Deno.test("unbekannter Kaufkurs führt zu kaufwert=null statt einer erfundenen Zahl", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Wertloses Papier", typ: "Aktie", stueck: 1, kaufkurs: null, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 0, datum: "2026-07-01" });

  const { positionen } = domain.positionenAbfragen();
  const p = positionen[0];
  if (p.kaufwert !== null) throw new Error(`erwartet kaufwert null, war ${p.kaufwert}`);
  if (p.diffPct !== null) throw new Error(`erwartet diffPct null, war ${p.diffPct}`);
  if (p.wert !== 0) throw new Error(`erwartet wert 0, war ${p.wert}`);
});

Deno.test("ohne Kursupdate ist der Wert 0", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 5, kaufkurs: 100, datum: "2026-07-01" });

  const { positionen } = domain.positionenAbfragen();
  if (positionen[0].wert !== 0) throw new Error(`erwartet wert 0, war ${positionen[0].wert}`);
});

Deno.test("positionsverlaufAbfragen liefert Events neueste zuerst", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 110, datum: "2026-07-10" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 120, datum: "2026-07-24" });

  const verlauf = domain.positionsverlaufAbfragen({ wertpapierId: "A" });
  if (verlauf.length !== 3) throw new Error(`erwartet 3 Ereignisse, war ${verlauf.length}`);
  if (verlauf[0].datum !== "2026-07-24") throw new Error("neuestes Ereignis muss zuerst stehen");
  if (verlauf[2].datum !== "2026-07-01") throw new Error("ältestes Ereignis muss zuletzt stehen");
});

Deno.test("positionsverlaufAbfragen für unbekannte wertpapierId liefert leeres Array", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  const verlauf = domain.positionsverlaufAbfragen({ wertpapierId: "UNBEKANNT" });
  if (verlauf.length !== 0) throw new Error(`erwartet leeres Array, war ${verlauf.length} Einträge`);
});

Deno.test("positionsverlaufAbfragen zeigt nur Käufe des angefragten Brokers, Kursupdates aber titelweit", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "Interactive Brokers", stueck: 1, kaufkurs: 105, datum: "2026-07-02" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 110, datum: "2026-07-10" });

  const verlauf = domain.positionsverlaufAbfragen({ wertpapierId: "A", broker: "comdirect" });
  const kaeufe = verlauf.filter((e: any) => e.eventType === "kauf");
  if (kaeufe.length !== 1) throw new Error(`erwartet 1 Kauf-Ereignis für comdirect, war ${kaeufe.length}`);
  if (kaeufe[0].broker !== "comdirect") throw new Error(`erwartet Kauf bei comdirect, war ${kaeufe[0].broker}`);
  const kursupdates = verlauf.filter((e: any) => e.eventType === "kursupdate");
  if (kursupdates.length !== 1) throw new Error(`erwartet 1 Kursupdate (titelweit, unabhängig vom Broker), war ${kursupdates.length}`);
});

Deno.test("dump liefert die rohen Ereignisse unverändert", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 110, datum: "2026-07-10" });
  const events = domain.dump();
  if (events.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${events.length}`);
  if (events[0].eventType !== "kauf" || events[1].eventType !== "kursupdate") {
    throw new Error("Reihenfolge/Typ der ausgelesenen Ereignisse stimmt nicht");
  }
});

Deno.test("initialize übernimmt einen zuvor per dump ausgelesenen Bestand identisch", () => {
  const quelle = neueDomaene();
  quelle.kaufErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 3, kaufkurs: 100, datum: "2026-07-01" });
  quelle.kursupdateErfassen({ wertpapierId: "A", kurs: 150, datum: "2026-07-10" });
  const ausgelesen = quelle.dump();

  const ziel = neueDomaene();
  ziel.initialize(ausgelesen);
  const { positionen } = ziel.positionenAbfragen();
  if (positionen.length !== 1) throw new Error(`erwartet 1 Position, war ${positionen.length}`);
  if (positionen[0].wert !== 450) throw new Error(`erwartet wert 450, war ${positionen[0].wert}`);
  if (JSON.stringify(ziel.dump()) !== JSON.stringify(ausgelesen)) {
    throw new Error("dump nach initialize muss dem übernommenen Bestand entsprechen");
  }
});

Deno.test("initialize verwirft den bisherigen Zustand vollständig", () => {
  const domain = neueDomaene();
  domain.kaufErfassen({ wertpapierId: "ALT", name: "Alt AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });
  domain.kursupdateErfassen({ wertpapierId: "ALT", kurs: 100, datum: "2026-07-01" });

  domain.initialize([
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "NEU", name: "Neu AG", typ: "Aktie", stueck: 2, kaufkurs: 10, datum: "2026-07-01" } },
    { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "NEU", kurs: 20, datum: "2026-07-02" } },
  ]);

  const { positionen, depotwert } = domain.positionenAbfragen();
  if (positionen.length !== 1) throw new Error(`erwartet nur die neue Position, war ${positionen.length}`);
  if (positionen[0].wertpapierId !== "NEU") throw new Error("alte Position darf nicht überleben");
  if (depotwert !== 40) throw new Error(`erwartet depotwert 40, war ${depotwert}`);
});

Deno.test("nach initialize erfasste Ereignisse knüpfen an den importierten Bestand an", () => {
  const domain = neueDomaene();
  domain.initialize([
    { seq: 7, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, datum: "2026-07-01" } },
  ]);
  domain.kursupdateErfassen({ wertpapierId: "A", kurs: 200, datum: "2026-07-10" });

  const events = domain.dump();
  if (events.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${events.length}`);
  if (events[1].seq !== 8) throw new Error(`erwartet seq 8 für das neue Ereignis, war ${events[1].seq}`);
});
