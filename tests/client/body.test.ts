import { createBody } from "../../client/body.js";
import * as domain from "../../client/domain.js";

// Der Backend-Proxy kapselt das Netzwerk und wird als Ganzes gefaked — genau wie früher der
// Browser-Speicher. Er zählt zusätzlich seine Aufrufe mit: an mehreren Stellen ist gerade
// interessant, dass *nicht* mit dem Server gesprochen wird.
function fakeBackend(startModell: any = leeresModell()) {
  const aufrufe: string[] = [];
  let modell = startModell;
  return {
    aufrufe,
    setzeModell(neu: any) { modell = neu; },
    depotAbfragen() { aufrufe.push("depotAbfragen"); return Promise.resolve(modell); },
    kaufErfassen(daten: any) { aufrufe.push("kaufErfassen"); return Promise.resolve({ ...modell, letzterKauf: daten }); },
    kursupdateErfassen(daten: any) { aufrufe.push("kursupdateErfassen"); return Promise.resolve({ ...modell, letztesUpdate: daten }); },
    neuePositionErfassen(daten: any) { aufrufe.push("neuePositionErfassen"); return Promise.resolve({ ...modell, letztePosition: daten }); },
    positionsverlaufAbfragen(daten: any) { aufrufe.push("positionsverlaufAbfragen"); return Promise.resolve([{ eventType: "kauf", ...daten }]); },
    dump() { aufrufe.push("dump"); return Promise.resolve([{ seq: 1 }]); },
    restore(events: any) { aufrufe.push("restore"); modell = { ...leeresModell(), importiert: events }; return Promise.resolve(modell); },
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

function leeresModell() {
  return { depotwert: 0, kaufwertGesamt: 0, veraenderungAbs: 0, veraenderungPct: 0, positionen: [], bekannteBroker: [] };
}

function beispielModell() {
  return {
    depotwert: 300, kaufwertGesamt: 300, veraenderungAbs: 0, veraenderungPct: 0,
    bekannteBroker: ["comdirect"],
    positionen: [
      { wertpapierId: "A", name: "Apfel AG", typ: "Aktie", broker: "comdirect", wert: 200, kaufwert: 100, diffPct: 100, anteilAmDepot: 66.7 },
      { wertpapierId: "B", name: "Bank-ETF", typ: "ETF", broker: null, wert: 100, kaufwert: 200, diffPct: -50, anteilAmDepot: 33.3 },
    ],
  };
}

// Spiegelt die Komposition in client/index.html.
async function neuerBody(backend: any = fakeBackend(), imExport: any = fakeImExport()) {
  const body = createBody(backend, imExport, domain);
  await body.initialisieren();
  return body;
}

Deno.test("initialisieren holt den Bestand einmal vom Backend", async () => {
  const backend = fakeBackend(beispielModell());
  const body = await neuerBody(backend);
  if (backend.aufrufe.join(",") !== "depotAbfragen") {
    throw new Error(`erwartet genau einen depotAbfragen-Aufruf, war [${backend.aufrufe.join(", ")}]`);
  }
  if (body.depotAbfragen().depotwert !== 300) throw new Error("das geholte Modell muss verfügbar sein");
});

Deno.test("depotAbfragen filtert lokal und fragt dafür nicht das Backend", async () => {
  const backend = fakeBackend(beispielModell());
  const body = await neuerBody(backend);
  backend.aufrufe.length = 0;

  const gefiltert = body.depotAbfragen({ suchbegriff: "apfel" });
  if (gefiltert.positionen.length !== 1) throw new Error(`erwartet 1 Treffer, war ${gefiltert.positionen.length}`);
  // Der eigentliche Grund für die gehaltene Kopie: sonst ginge pro Tastenanschlag in der
  // Suche eine Anfrage über die Leitung.
  if (backend.aufrufe.length !== 0) {
    throw new Error(`Filtern darf das Backend nicht befragen, war [${backend.aufrufe.join(", ")}]`);
  }
});

Deno.test("dashboardAbfragen rechnet lokal aus der gehaltenen Kopie", async () => {
  const backend = fakeBackend(beispielModell());
  const body = await neuerBody(backend);
  backend.aufrufe.length = 0;

  const dashboard = body.dashboardAbfragen();
  if (dashboard.nachTyp.length !== 2) throw new Error(`erwartet 2 Typ-Gruppen, war ${dashboard.nachTyp.length}`);
  if (dashboard.gewinnerUndVerlierer[0].wertpapierId !== "A") throw new Error("erwartet A als besten Wert");
  if (dashboard.konzentration[0].wertpapierId !== "A") throw new Error("erwartet A als größte Position");
  if (backend.aufrufe.length !== 0) {
    throw new Error(`das Dashboard darf das Backend nicht befragen, war [${backend.aufrufe.join(", ")}]`);
  }
});

Deno.test("das Dashboard sieht immer den ganzen Bestand, unabhängig vom Filter", async () => {
  const body = await neuerBody(fakeBackend(beispielModell()));
  body.depotAbfragen({ suchbegriff: "apfel" });
  const dashboard = body.dashboardAbfragen();
  if (dashboard.konzentration.length !== 2) {
    throw new Error(`erwartet alle 2 Positionen im Dashboard, war ${dashboard.konzentration.length}`);
  }
});

Deno.test("kaufErfassen reicht an das Backend durch und übernimmt dessen Antwort", async () => {
  const backend = fakeBackend(beispielModell());
  const body = await neuerBody(backend);
  const modell: any = await body.kaufErfassen({ wertpapierId: "A", stueck: 1, kaufkurs: 10, datum: "2026-07-01" });
  if (!backend.aufrufe.includes("kaufErfassen")) throw new Error("erwartet einen kaufErfassen-Aufruf");
  if (modell.letzterKauf.wertpapierId !== "A") throw new Error("die Antwort des Backends muss zurückkommen");
  // Und sie muss die gehaltene Kopie ersetzt haben, sonst zeigte die Oberfläche alte Daten.
  if ((body.depotAbfragen() as any).letzterKauf == null) throw new Error("die gehaltene Kopie muss aktualisiert sein");
});

Deno.test("neuePositionErfassen geht als ein einziger Aufruf ans Backend", async () => {
  const backend = fakeBackend();
  const body = await neuerBody(backend);
  backend.aufrufe.length = 0;
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  // Kauf und Kursupdate zusammen sind ein Workflow des Server-Body — der Client zerlegt ihn
  // nicht in zwei Anfragen, von denen die zweite scheitern könnte.
  if (backend.aufrufe.join(",") !== "neuePositionErfassen") {
    throw new Error(`erwartet genau einen Aufruf, war [${backend.aufrufe.join(", ")}]`);
  }
});

Deno.test("positionsverlaufAbfragen reicht bis zum Backend durch", async () => {
  const backend = fakeBackend();
  const body = await neuerBody(backend);
  const verlauf: any = await body.positionsverlaufAbfragen({ wertpapierId: "A", broker: "comdirect" });
  if (verlauf[0].wertpapierId !== "A" || verlauf[0].broker !== "comdirect") {
    throw new Error("Wertpapier und Broker müssen beim Backend ankommen");
  }
});

Deno.test("exportieren holt den Bestand vom Backend und gibt ihn an den ImExport-Provider", async () => {
  const imExport = fakeImExport();
  const backend = fakeBackend();
  const body = await neuerBody(backend, imExport);
  await body.exportieren();
  if (!backend.aufrufe.includes("dump")) throw new Error("der Export muss den Bestand beim Backend holen");
  if (imExport.exportiert.length !== 1) throw new Error("erwartet genau einen Export-Aufruf");
});

Deno.test("importieren schickt die Datei ans Backend und übernimmt das neue Modell", async () => {
  const events = [{ seq: 1, eventType: "kauf", payload: { wertpapierId: "X" } }];
  const backend = fakeBackend();
  const body = await neuerBody(backend, fakeImExport(events));
  const modell: any = await body.importieren();
  if (!backend.aufrufe.includes("restore")) throw new Error("der Import muss das Backend ersetzen lassen");
  if (JSON.stringify(modell.importiert) !== JSON.stringify(events)) {
    throw new Error("das Backend muss die importierten Ereignisse bekommen haben");
  }
});

Deno.test("ein abgebrochener Dateidialog lässt den Zustand unangetastet", async () => {
  const backend = fakeBackend(beispielModell());
  const body = await neuerBody(backend, fakeImExport(null));
  backend.aufrufe.length = 0;

  const ergebnis = await body.importieren();
  if (ergebnis !== null) throw new Error("erwartet null bei abgebrochenem Dialog");
  if (backend.aufrufe.length !== 0) throw new Error("ein Abbruch darf das Backend gar nicht erst erreichen");
  if (body.depotAbfragen().depotwert !== 300) throw new Error("der bisherige Bestand muss erhalten bleiben");
});
