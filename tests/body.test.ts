import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createEventStore } = require("../eventStore.js");
const { createDomain } = require("../domain.js");
const { createLocalStorageProvider } = require("../localStorageProvider.js");
const { createBody } = require("../body.js");

// Fake statt echtem localStorage: hält Tests unabhängig vom Browser und voneinander isoliert.
function fakeStorage() {
  const daten = new Map<string, string>();
  return {
    getItem: (schluessel: string) => (daten.has(schluessel) ? daten.get(schluessel)! : null),
    setItem: (schluessel: string, wert: string) => { daten.set(schluessel, wert); },
  };
}

// Der ImExport-Provider kapselt Browser-Technologie (Dateidialog, Download) und wird
// deshalb als Ganzes gemockt — nicht seine Innereien.
function fakeImExport(zuImportieren: any = null) {
  const exportiert: any[] = [];
  return {
    import: () => Promise.resolve(zuImportieren),
    export: (events: any) => { exportiert.push(events); },
    exportiert,
  };
}

// Spiegelt die Komposition in index.html.
function neuerBody(storage = fakeStorage(), imExport: any = fakeImExport()) {
  const speicher = createLocalStorageProvider(storage, "depot-events");
  const body = createBody(createDomain(createEventStore()), speicher, imExport);
  body.initialisieren();
  return body;
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

Deno.test("neuePositionErfassen reicht broker bis ins Modell durch", () => {
  const body = neuerBody();
  const modell = body.neuePositionErfassen({
    wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect",
    stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-26",
  });
  if (modell.positionen[0].broker !== "comdirect") {
    throw new Error(`erwartet broker "comdirect", war ${modell.positionen[0].broker}`);
  }
  if (JSON.stringify(modell.bekannteBroker) !== JSON.stringify(["comdirect"])) {
    throw new Error(`erwartet bekannteBroker ["comdirect"], war ${JSON.stringify(modell.bekannteBroker)}`);
  }
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
  const verlauf = body.positionsverlaufAbfragen({ wertpapierId: "A" });
  if (verlauf.length !== 2) throw new Error(`erwartet 2 Ereignisse (Kauf + Kursupdate), war ${verlauf.length}`);
});

Deno.test("neuePositionErfassen bei unterschiedlichem Broker legt zusätzliche Position an, statt zu addieren", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const modell = body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "Interactive Brokers", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  if (modell.positionen.length !== 2) throw new Error(`erwartet 2 Positionen, war ${modell.positionen.length}`);
});

Deno.test("depotAbfragen liefert das Gesamtmodell ohne vorherige Erfassung leer", () => {
  const body = neuerBody();
  const modell = body.depotAbfragen();
  if (modell.positionen.length !== 0) throw new Error("erwartet keine Positionen in einem leeren Depot");
  if (modell.depotwert !== 0) throw new Error(`erwartet depotwert 0, war ${modell.depotwert}`);
});

Deno.test("jede Erfassung speichert den aktuellen Bestand im Provider", () => {
  const storage = fakeStorage();
  const body = neuerBody(storage);
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const gespeichert = JSON.parse(storage.getItem("depot-events")!);
  if (gespeichert.length !== 2) throw new Error(`erwartet 2 gespeicherte Events, war ${gespeichert.length}`);
});

Deno.test("ein neu konstruierter Body mit demselben Speicher setzt den Bestand fort (simulierter Neustart)", () => {
  const storage = fakeStorage();
  const ersterBody = neuerBody(storage);
  ersterBody.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 4, kaufkurs: 50, kurs: 60, datum: "2026-07-01" });

  // Neue Konstruktion mit demselben Speicher simuliert einen Neustart der Seite.
  const zweiterBody = neuerBody(storage);
  const modell = zweiterBody.depotAbfragen();
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 wiederhergestellte Position, war ${modell.positionen.length}`);
  if (modell.depotwert !== 240) throw new Error(`erwartet depotwert 240, war ${modell.depotwert}`);
});

Deno.test("exportieren reicht den vollständigen Bestand an den ImExport-Provider", () => {
  const imExport = fakeImExport();
  const body = neuerBody(fakeStorage(), imExport);
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });

  body.exportieren();
  if (imExport.exportiert.length !== 1) throw new Error("erwartet genau einen Export-Aufruf");
  if (imExport.exportiert[0].length !== 2) {
    throw new Error(`erwartet 2 exportierte Ereignisse, war ${imExport.exportiert[0].length}`);
  }
});

Deno.test("importieren ersetzt den Zustand und gibt das neue Modell zurück", async () => {
  const importierteEvents = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Import AG", typ: "Aktie", stueck: 5, kaufkurs: 10, datum: "2026-07-01" } },
    { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", kurs: 20, datum: "2026-07-02" } },
  ];
  const body = neuerBody(fakeStorage(), fakeImExport(importierteEvents));
  body.neuePositionErfassen({ wertpapierId: "ALT", name: "Alt AG", typ: "Aktie", stueck: 1, kaufkurs: 1, kurs: 1, datum: "2026-07-01" });

  const modell = await body.importieren();
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 Position, war ${modell.positionen.length}`);
  if (modell.positionen[0].wertpapierId !== "X") throw new Error("alter Bestand darf nicht überleben");
  if (modell.depotwert !== 100) throw new Error(`erwartet depotwert 100, war ${modell.depotwert}`);
});

Deno.test("importieren schreibt die neuen Ereignisse auch in den Browser-Speicher", async () => {
  const storage = fakeStorage();
  const importierteEvents = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Import AG", typ: "Aktie", stueck: 5, kaufkurs: 10, datum: "2026-07-01" } },
  ];
  const body = neuerBody(storage, fakeImExport(importierteEvents));
  await body.importieren();

  const gespeichert = JSON.parse(storage.getItem("depot-events")!);
  if (JSON.stringify(gespeichert) !== JSON.stringify(importierteEvents)) {
    throw new Error("Browser-Speicher muss nach dem Import den importierten Bestand enthalten");
  }
});

Deno.test("ein abgebrochener Dateidialog lässt den Zustand unangetastet", async () => {
  const body = neuerBody(fakeStorage(), fakeImExport(null));
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });

  const ergebnis = await body.importieren();
  if (ergebnis !== null) throw new Error("erwartet null bei abgebrochenem Dialog");
  if (body.depotAbfragen().positionen.length !== 1) throw new Error("bisheriger Bestand muss erhalten bleiben");
});

Deno.test("ohne gespeicherte Daten beginnt ein neu konstruierter Body leer", () => {
  const body = neuerBody();
  if (body.depotAbfragen().positionen.length !== 0) throw new Error("erwartet leeres Depot");
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

Deno.test("depotAbfragen filtert nach Broker", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Apfel AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  body.neuePositionErfassen({ wertpapierId: "B", name: "Bank-ETF", typ: "ETF", broker: "Interactive Brokers", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });

  const modell = body.depotAbfragen({ broker: ["comdirect"] });
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 Treffer, war ${modell.positionen.length}`);
  if (modell.positionen[0].wertpapierId !== "A") throw new Error("erwartet Treffer A");
});

Deno.test("depotAbfragen erlaubt Mehrfachauswahl beim Broker-Filter", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Apfel AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  body.neuePositionErfassen({ wertpapierId: "B", name: "Bank-ETF", typ: "ETF", broker: "Interactive Brokers", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  body.neuePositionErfassen({ wertpapierId: "C", name: "Citrus Zertifikat", typ: "Zertifikat", broker: "Trade Republic", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });

  const modell = body.depotAbfragen({ broker: ["comdirect", "Interactive Brokers"] });
  const ids = modell.positionen.map((p: any) => p.wertpapierId).sort();
  if (ids.length !== 2 || ids[0] !== "A" || ids[1] !== "B") {
    throw new Error(`erwartet [A, B], war [${ids.join(", ")}]`);
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
