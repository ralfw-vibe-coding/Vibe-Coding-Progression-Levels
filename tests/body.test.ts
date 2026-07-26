import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createEventStore } = require("../eventStore.js");
const { createDomain } = require("../domain.js");
const { createBody } = require("../body.js");

function neuerBody() {
  return createBody(createDomain(createEventStore()));
}

Deno.test("neuePositionErfassen legt Kauf und Kursupdate zusammen an", () => {
  const body = neuerBody();
  const modell = body.neuePositionErfassen({
    wertpapierId: "A", name: "Test AG", typ: "Aktie",
    stueck: 2, kaufkurs: 100, kurs: 110, datum: "2026-07-26",
  });
  const p = modell.positionen[0];
  if (p.wert !== 220) throw new Error(`erwartet wert 220, war ${p.wert}`);
  if (p.diffPct == null) throw new Error("Position darf nach neuePositionErfassen nicht 'wertlos' sein");
});

Deno.test("kaufErfassen gibt aktualisiertes Modell zurück", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const modell = body.kaufErfassen({ wertpapierId: "A", stueck: 1, kaufkurs: 300, datum: "2026-07-10" });
  const p = modell.positionen[0];
  if (p.stueck !== 2) throw new Error(`erwartet Stück 2 nach Nachkauf, war ${p.stueck}`);
});

Deno.test("kursupdateErfassen aktualisiert den Kurs einer bestehenden Position", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const modell = body.kursupdateErfassen({ wertpapierId: "A", kurs: 150, datum: "2026-07-24" });
  if (modell.positionen[0].kurs !== 150) throw new Error(`erwartet Kurs 150, war ${modell.positionen[0].kurs}`);
});

Deno.test("positionsverlaufAbfragen reicht bis zur Domäne durch", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const verlauf = body.positionsverlaufAbfragen("A");
  if (verlauf.length !== 2) throw new Error(`erwartet 2 Ereignisse (Kauf + Kursupdate), war ${verlauf.length}`);
});

Deno.test("depotAbfragen liefert das Gesamtmodell ohne vorherige Erfassung leer", () => {
  const body = neuerBody();
  const modell = body.depotAbfragen();
  if (modell.positionen.length !== 0) throw new Error("erwartet keine Positionen in einem leeren Depot");
  if (modell.depotwert !== 0) throw new Error(`erwartet depotwert 0, war ${modell.depotwert}`);
});

function beispielDepot() {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Apfel AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 200, datum: "2026-07-01" });
  body.neuePositionErfassen({ wertpapierId: "B", name: "Bank-ETF", typ: "ETF", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  body.neuePositionErfassen({ wertpapierId: "C", name: "Citrus Zertifikat", typ: "Zertifikat", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  return body;
}

Deno.test("depotAbfragen ohne Filter zeigt alle Positionen", () => {
  const modell = beispielDepot().depotAbfragen();
  if (modell.positionen.length !== 3) throw new Error(`erwartet 3 Positionen, war ${modell.positionen.length}`);
});

Deno.test("depotAbfragen filtert nach Suchbegriff im Namen, Groß-/Kleinschreibung egal", () => {
  const modell = beispielDepot().depotAbfragen({ suchbegriff: "apfel" });
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 Treffer, war ${modell.positionen.length}`);
  if (modell.positionen[0].wertpapierId !== "A") throw new Error("erwartet Treffer A");
});

Deno.test("depotAbfragen filtert nach Typ", () => {
  const modell = beispielDepot().depotAbfragen({ typen: ["ETF", "Zertifikat"] });
  const ids = modell.positionen.map((p: any) => p.wertpapierId).sort();
  if (ids.length !== 2 || ids[0] !== "B" || ids[1] !== "C") {
    throw new Error(`erwartet [B, C], war [${ids.join(", ")}]`);
  }
});

Deno.test("depotAbfragen kombiniert Suchbegriff und Typ", () => {
  const modell = beispielDepot().depotAbfragen({ suchbegriff: "zertifikat", typen: ["ETF"] });
  if (modell.positionen.length !== 0) throw new Error("erwartet keinen Treffer bei widersprüchlichem Filter");
});

Deno.test("Filter verändert Depotwert, Kaufwert, Veränderung und anteilAmDepot nicht", () => {
  const body = beispielDepot();
  const ungefiltert = body.depotAbfragen();
  const gefiltert = body.depotAbfragen({ suchbegriff: "apfel" });

  if (gefiltert.depotwert !== ungefiltert.depotwert) throw new Error("Depotwert darf sich durch Filter nicht ändern");
  if (gefiltert.kaufwertGesamt !== ungefiltert.kaufwertGesamt) throw new Error("Kaufwert darf sich durch Filter nicht ändern");
  if (gefiltert.veraenderungAbs !== ungefiltert.veraenderungAbs) throw new Error("Veränderung darf sich durch Filter nicht ändern");

  const apfelUngefiltert = ungefiltert.positionen.find((p: any) => p.wertpapierId === "A");
  const apfelGefiltert = gefiltert.positionen.find((p: any) => p.wertpapierId === "A");
  if (apfelGefiltert.anteilAmDepot !== apfelUngefiltert.anteilAmDepot) {
    throw new Error("anteilAmDepot muss depot-weit bleiben, unabhängig vom Filter");
  }
});
