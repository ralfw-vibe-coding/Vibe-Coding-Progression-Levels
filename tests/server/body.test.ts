import { createEventStore } from "../../server/eventStore.js";
import { createDomain } from "../../server/domain.js";
import { createBody } from "../../server/body.js";

// Der Body braucht keinen Speicher mehr: der Event-Store hält seine Ereignisse selbst dauerhaft.
// Für Tests genügt deshalb der Store im Arbeitsspeicher — dieselben Funktionen, nur ohne Datei.
// Dass wirklich gespeichert wird, prüft dateiEventStore.test.ts an genau einer Stelle, statt es
// hier bei jedem Command mitzuprüfen.
//
// Spiegelt die Komposition in server/main.js.
function neuerBody() {
  return createBody(createDomain(createEventStore()));
}

Deno.test("neuePositionErfassen legt Kauf und Kursupdate zusammen an", async () => {
  const body = neuerBody();
  const { modell } = await body.neuePositionErfassen({
    wertpapierId: "A", name: "Test AG", typ: "Aktie",
    stueck: 2, kaufkurs: 100, kurs: 110, datum: "2026-07-26",
  });
  const p = modell.positionen[0];
  if (p.wert !== 220) throw new Error(`erwartet wert 220, war ${p.wert}`);
  if (p.diffPct == null) throw new Error("Position darf nach neuePositionErfassen nicht 'wertlos' sein");
});

Deno.test("neuePositionErfassen reicht broker bis ins Modell durch", async () => {
  const body = neuerBody();
  const { modell } = await body.neuePositionErfassen({
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

Deno.test("kaufErfassen gibt aktualisiertes Modell zurück", async () => {
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const modell = body.kaufErfassen({ wertpapierId: "A", stueck: 1, kaufkurs: 300, datum: "2026-07-10" });
  if (modell.positionen[0].stueck !== 2) throw new Error(`erwartet Stück 2 nach Nachkauf, war ${modell.positionen[0].stueck}`);
});

Deno.test("kursupdateErfassen aktualisiert den Kurs einer bestehenden Position", async () => {
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const modell = body.kursupdateErfassen({ wertpapierId: "A", kurs: 150, datum: "2026-07-24" });
  if (modell.positionen[0].kurs !== 150) throw new Error(`erwartet Kurs 150, war ${modell.positionen[0].kurs}`);
});

Deno.test("positionsverlaufAbfragen reicht bis zur Domäne durch", async () => {
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const verlauf = body.positionsverlaufAbfragen({ wertpapierId: "A" });
  if (verlauf.length !== 2) throw new Error(`erwartet 2 Ereignisse (Kauf + Kursupdate), war ${verlauf.length}`);
});

Deno.test("neuePositionErfassen bei unterschiedlichem Broker legt zusätzliche Position an, statt zu addieren", async () => {
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const { modell } = await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "Interactive Brokers", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  if (modell.positionen.length !== 2) throw new Error(`erwartet 2 Positionen, war ${modell.positionen.length}`);
});

Deno.test("depotAbfragen liefert das Gesamtmodell ohne vorherige Erfassung leer", () => {
  const body = neuerBody();
  const modell = body.depotAbfragen();
  if (modell.positionen.length !== 0) throw new Error("erwartet keine Positionen in einem leeren Depot");
  if (modell.depotwert !== 0) throw new Error(`erwartet depotwert 0, war ${modell.depotwert}`);
});

Deno.test("dump liefert den vollständigen Ereignisbestand", async () => {
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const events = body.dump();
  // Kauf + Kursupdate + die Kennzeichnung als manuell (es gibt hier keine Kursquelle).
  if (events.length !== 3) throw new Error(`erwartet 3 Ereignisse, war ${events.length}`);
  if (events[0].eventType !== "kauf") throw new Error("erwartet zuerst das kauf-Ereignis");
});

Deno.test("restore ersetzt den Zustand und gibt das neue Modell zurück", async () => {
  const neueEvents = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Import AG", typ: "Aktie", stueck: 5, kaufkurs: 10, datum: "2026-07-01" } },
    { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", kurs: 20, datum: "2026-07-02" } },
  ];
  const body = neuerBody();
  await body.neuePositionErfassen({ wertpapierId: "ALT", name: "Alt AG", typ: "Aktie", stueck: 1, kaufkurs: 1, kurs: 1, datum: "2026-07-01" });

  const modell = body.restore(neueEvents);
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 Position, war ${modell.positionen.length}`);
  if (modell.positionen[0].wertpapierId !== "X") throw new Error("alter Bestand darf nicht überleben");
  if (modell.depotwert !== 100) throw new Error(`erwartet depotwert 100, war ${modell.depotwert}`);
});

Deno.test("nach restore erfasste Ereignisse knüpfen an den übernommenen Bestand an", () => {
  const body = neuerBody();
  body.restore([
    { seq: 7, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Import AG", typ: "Aktie", stueck: 1, kaufkurs: 10, datum: "2026-07-01" } },
  ]);
  body.kursupdateErfassen({ wertpapierId: "X", kurs: 30, datum: "2026-07-02" });

  const events = body.dump();
  if (events.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${events.length}`);
  if (events[1].seq !== 8) throw new Error(`erwartet seq 8 nach übernommener seq 7, war ${events[1].seq}`);
});

// --- Kursaktualisierung über einen externen Dienst ------------------------------------------
import { createSimulierterKursProvider } from "../../server/simulierterKursProvider.js";
import { createSimulierteSymbolSuche } from "../../server/symbolSuche.js";
import { createSimulierterWechselkursProvider } from "../../server/wechselkursProvider.js";

// Eine benannte Kursquelle im Verzeichnis — genau so, wie der Server sie einrichtet.
function bodyMitKursquelle(kurse: any = {}, faktoren: any = { USD: 0.9 }, suche: any = null) {
  return createBody(
    createDomain(createEventStore()),
    { Testquelle: createSimulierterKursProvider(kurse) },
    createSimulierterWechselkursProvider(faktoren),
    suche,
  );
}
// Positionen brauchen jetzt einen vollständigen Bezug: Quelle, Symbol, Handelsplatz, Währung.
function bezug(symbol: string, waehrung = "EUR", quelle = "Testquelle") {
  return { quelle, symbol, boerse: "XETR", waehrung };
}
function eintrag(bericht: any[], wertpapierId: string) {
  return bericht.find((b) => b.wertpapierId === wertpapierId);
}

Deno.test("ein abgerufener Kurs wird als Kursupdate eingetragen", async () => {
  const body = bodyMitKursquelle({ "APC.DE": 297.6 });
  await body.neuePositionErfassen({ wertpapierId: "US0378331005", name: "Apple", typ: "Aktie", stueck: 3, kaufkurs: 296.8, kurs: 296.8, datum: "2026-07-27" });
  body.kursbezugZuordnen({ wertpapierId: "US0378331005", ...bezug("APC.DE") });

  const { modell, bericht } = await body.kurseAktualisieren();
  if (modell.positionen[0].kurs !== 297.6) throw new Error(`erwartet Kurs 297.6, war ${modell.positionen[0].kurs}`);
  if (!eintrag(bericht, "US0378331005").erfolg) throw new Error("der Abruf muss als Erfolg gemeldet werden");
});

Deno.test("eine Position, für die nichts gefunden wurde, gilt als manuell — nicht als offene Aufgabe", async () => {
  // Sie taucht im Bericht gar nicht mehr auf: Sie jedes Mal als Fehlschlag zu melden wäre
  // Lärm über eine Entscheidung, die längst getroffen ist.
  const body = bodyMitKursquelle({});
  const { modell } = await body.neuePositionErfassen({ wertpapierId: "DE000LS9KF55", name: "Zertifikat", typ: "Zertifikat", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  if (modell.positionen[0].kursbezug?.art !== "manuell") {
    throw new Error(`erwartet "manuell", war ${JSON.stringify(modell.positionen[0].kursbezug)}`);
  }

  const { bericht } = await body.kurseAktualisieren();
  if (eintrag(bericht, "DE000LS9KF55")) throw new Error("manuelle Positionen gehören nicht in den Bericht");
});

Deno.test("eine Position aus der Zeit vor dem Kursabruf gilt als offen, nicht als manuell", async () => {
  // Altbestand: nie eine Entscheidung getroffen. Das ist eine Aufgabe, kein erledigter Fall.
  const body = bodyMitKursquelle({});
  body.kaufErfassen({ wertpapierId: "DE000LS9KF55", name: "Zertifikat", typ: "Zertifikat", stueck: 1, kaufkurs: 100, datum: "2026-07-01" });

  const { bericht } = await body.kurseAktualisieren();
  const e = eintrag(bericht, "DE000LS9KF55");
  if (!e || !e.grund.includes("fehlen noch")) throw new Error(`erwartet einen Hinweis auf fehlende Angaben, war ${e?.grund}`);
});

Deno.test("ein Fehlschlag bei einem Papier lässt die anderen unberührt", async () => {
  const body = bodyMitKursquelle({ "APC.DE": 297.6 });
  for (const [id, sym] of [["US0378331005", "APC.DE"], ["DE000EWG2LD7", "EWG2.SG"]]) {
    await body.neuePositionErfassen({ wertpapierId: id, name: id, typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
    body.kursbezugZuordnen({ wertpapierId: id, ...bezug(sym) });
  }

  const { modell, bericht } = await body.kurseAktualisieren();
  if (!eintrag(bericht, "US0378331005").erfolg) throw new Error("das bekannte Papier muss aktualisiert werden");
  if (eintrag(bericht, "DE000EWG2LD7").erfolg) throw new Error("das unbekannte Papier darf nicht als Erfolg gelten");
  if (modell.positionen.find((p: any) => p.wertpapierId === "US0378331005")?.kurs !== 297.6) {
    throw new Error("der erfolgreiche Abruf muss trotzdem angekommen sein");
  }
});

Deno.test("ein Kurs in Fremdwährung wird umgerechnet", async () => {
  const body = bodyMitKursquelle({ AAPL: { kurs: 100, waehrung: "USD" } }, { USD: 0.9 });
  await body.neuePositionErfassen({ wertpapierId: "US0378331005", name: "Apple", typ: "Aktie", stueck: 1, kaufkurs: 80, kurs: 80, datum: "2026-07-01" });
  body.kursbezugZuordnen({ wertpapierId: "US0378331005", ...bezug("AAPL", "USD") });

  const { modell, bericht } = await body.kurseAktualisieren();
  if (modell.positionen[0].kurs !== 90) throw new Error(`erwartet 100 USD * 0.9 = 90 EUR, war ${modell.positionen[0].kurs}`);
  if (eintrag(bericht, "US0378331005").umgerechnetAus !== "USD") throw new Error("der Bericht muss die Umrechnung ausweisen");
});

Deno.test("scheitert die Umrechnung, wird kein Kurs eingetragen", async () => {
  // Lieber kein Kurs als ein Dollarbetrag, der als Euro im Depot steht.
  const body = bodyMitKursquelle({ AAPL: { kurs: 100, waehrung: "USD" } }, {});
  await body.neuePositionErfassen({ wertpapierId: "US0378331005", name: "Apple", typ: "Aktie", stueck: 1, kaufkurs: 80, kurs: 80, datum: "2026-07-01" });
  body.kursbezugZuordnen({ wertpapierId: "US0378331005", ...bezug("AAPL", "USD") });

  const { modell, bericht } = await body.kurseAktualisieren();
  if (modell.positionen[0].kurs !== 80) throw new Error(`der alte Kurs muss stehen bleiben, war ${modell.positionen[0].kurs}`);
  if (eintrag(bericht, "US0378331005").erfolg) throw new Error("eine gescheiterte Umrechnung ist kein Erfolg");
});

Deno.test("dasselbe Wertpapier bei zwei Brokern wird nur einmal abgefragt", async () => {
  const quelle = createSimulierterKursProvider({ "APC.DE": 297.6 });
  const body = createBody(createDomain(createEventStore()), { Testquelle: quelle }, createSimulierterWechselkursProvider());
  for (const broker of ["comdirect", "onvista"]) {
    await body.neuePositionErfassen({ wertpapierId: "US0378331005", name: "Apple", typ: "Aktie", broker, stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  }
  body.kursbezugZuordnen({ wertpapierId: "US0378331005", ...bezug("APC.DE") });

  const { modell } = await body.kurseAktualisieren();
  if (JSON.stringify(quelle.aufrufe) !== JSON.stringify([["APC.DE"]])) {
    throw new Error(`erwartet genau eine Abfrage von APC.DE, war ${JSON.stringify(quelle.aufrufe)}`);
  }
  // Beide Positionen bekommen den Kurs, weil er am Wertpapier hängt.
  if (modell.positionen.some((p: any) => p.kurs !== 297.6)) throw new Error("beide Broker-Positionen müssen den neuen Kurs zeigen");
});


Deno.test("bei einer WKN sucht der Body zusätzlich mit der abgeleiteten ISIN", async () => {
  const suche = createSimulierteSymbolSuche({ "DE000EWG2LD7": [{ symbol: "EWG2.SG" }] });
  const body = createBody(createDomain(createEventStore()), { Simulation: willigeQuelle }, null, suche);

  const { begriff, treffer } = await body.symboleSuchen("EWG2LD");
  if (treffer.length !== 1) throw new Error(`erwartet 1 Treffer, war ${treffer.length}`);
  // Der Bericht nennt den Begriff, der tatsächlich gefunden hat — sonst wäre unklar, warum
  // eine Eingabe plötzlich funktioniert.
  if (begriff !== "DE000EWG2LD7") throw new Error(`erwartet die ISIN als Suchbegriff, war ${begriff}`);
});

// Die Suche liefert nicht mehr, was gefunden wurde, sondern was davon abrufbar ist. Der
// Unterschied ist der Kern dieser Stufe: Ein Anbieter *kennt* weit mehr Papiere, als sein
// kostenloser Tarif *herausgibt* — und eine Liste voller Sackgassen ist schlimmer als eine
// kurze, weil man jede einzeln durchprobieren muss, um das zu merken.
Deno.test("Treffer ohne bedienbare Kursquelle werden aussortiert und gezählt", async () => {
  const suche = createSimulierteSymbolSuche({
    "DE000EWG2LD7": [
      { symbol: "EWG2", boerse: "XSTU", waehrung: "EUR", quelle: "NurUS" },
      { symbol: "EWG2.SG", boerse: "STU", waehrung: "EUR", quelle: "Simulation" },
    ],
  });
  const nurUS = createSimulierterKursProvider({}, { name: "NurUS", kannLiefern: (t: any) => t.boerse === "US" });
  const body = createBody(createDomain(createEventStore()), { Simulation: willigeQuelle, NurUS: nurUS }, null, suche);

  const { treffer, ohneKursquelle } = await body.symboleSuchen("EWG2LD");
  if (treffer.length !== 1 || treffer[0].symbol !== "EWG2.SG") {
    throw new Error(`erwartet nur den abrufbaren Kandidaten, war ${JSON.stringify(treffer.map((t: any) => t.symbol))}`);
  }
  // Verschwiegen sähe das aus wie ein schlechtes Suchergebnis. Der Nutzer soll wissen, dass
  // etwas gefunden wurde — nur eben nichts, was ihm nützt.
  if (ohneKursquelle !== 1) throw new Error(`erwartet 1 ausgeblendeten Treffer, war ${ohneKursquelle}`);
});

Deno.test("findet nichts, kommt eine leere Liste statt eines Fehlers", async () => {
  const body = createBody(createDomain(createEventStore()), {}, null, createSimulierteSymbolSuche({}));
  const { treffer } = await body.symboleSuchen("LS9KF5");
  if (treffer.length !== 0) throw new Error("erwartet keine Treffer");
});

// --- Symbol beim Erfassen automatisch ermitteln ---------------------------------------------

// Eine Quelle, die für jedes Symbol einen Kurs liefert. Seit dem Probeabruf beim Zuordnen
// braucht jeder Test eine — ohne belegten Kurs wird nichts zugeordnet, und genau das ist der
// Sinn der Sache.
const willigeQuelle = {
  name: "Simulation",
  kurseAbrufen: (symbole: string[]) =>
    Promise.resolve(new Map(symbole.map((s) => [s, { kurs: 100, waehrung: "EUR", quelle: "Simulation" }]))),
};

function bodyMitSuche(treffer: any = {}, optionen: any = {}, quellen: any = { Simulation: willigeQuelle }) {
  const suche = createSimulierteSymbolSuche(treffer, optionen);
  const body = createBody(createDomain(createEventStore()), quellen, null, suche);
  return { body, suche };
}
const kaufDaten = { wertpapierId: "DE000EWG2LD7", name: "Euwax Gold", typ: "Zertifikat", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-28" };

Deno.test("beim Erfassen wird das Symbol über die abgeleitete ISIN gefunden und zugeordnet", async () => {
  const { body } = bodyMitSuche({ "DE000EWG2LD7": [{ symbol: "EWG2.SG", name: "Euwax Gold II", boerse: "STU" }] });
  const { modell, symbol } = await body.neuePositionErfassen(kaufDaten);

  if (symbol.symbol !== "EWG2.SG") throw new Error(`erwartet EWG2.SG, war ${symbol.symbol}`);
  if (symbol.herkunft !== "gefunden") throw new Error("die Herkunft muss ausgewiesen sein");
  if (symbol.ueber !== "DE000EWG2LD7") throw new Error("es muss nachvollziehbar sein, womit gefunden wurde");
  if (modell.positionen[0].kursbezug.symbol !== "EWG2.SG") throw new Error("das Symbol muss am Wertpapier hängen");
});

Deno.test("findet die Kennung nichts, wird über den Namen gesucht", async () => {
  const { body, suche } = bodyMitSuche({ "Euwax Gold": [{ symbol: "EWG2.SG", name: "Euwax Gold II", boerse: "STU" }] });
  const { symbol } = await body.neuePositionErfassen(kaufDaten);
  if (symbol.symbol !== "EWG2.SG") throw new Error("der Name muss als zweiter Weg dienen");
  // Erst die eindeutige Kennung, dann der ungenaue Name.
  if (suche.aufrufe[0] !== "DE000EWG2LD7") throw new Error(`erwartet zuerst die ISIN, war ${suche.aufrufe[0]}`);
});

Deno.test("ein deutscher Handelsplatz wird bevorzugt", async () => {
  // Sonst käme ein Dollarkurs ins Depot, der erst umgerechnet werden müsste.
  const { body } = bodyMitSuche({
    "DE000EWG2LD7": [
      { symbol: "EWG2.NY", name: "Euwax Gold II", boerse: "NYSE" },
      { symbol: "EWG2.SG", name: "Euwax Gold II", boerse: "STU" },
    ],
  });
  const { symbol } = await body.neuePositionErfassen(kaufDaten);
  if (symbol.symbol !== "EWG2.SG") throw new Error(`erwartet den deutschen Handelsplatz, war ${symbol.symbol}`);
  if (symbol.weitere !== 1) throw new Error("es muss ersichtlich sein, dass es Alternativen gab");
});

Deno.test("ein eingegebenes Symbol wird nicht überschrieben", async () => {
  const { body, suche } = bodyMitSuche({ "DE000EWG2LD7": [{ symbol: "GEFUNDEN", name: "Euwax Gold II" }] });
  const { symbol } = await body.neuePositionErfassen({ ...kaufDaten, kursbezug: { quelle: "Eigene", symbol: "MEINS.DE" } });
  if (symbol.symbol !== "MEINS.DE") throw new Error("die Eingabe des Nutzers hat Vorrang");
  if (suche.aufrufe.length !== 0) throw new Error("bei eigener Eingabe braucht es keine Suche");
});

Deno.test("wird nichts gefunden, ist der Kauf trotzdem erfasst — mit Begründung", async () => {
  const { body } = bodyMitSuche({});
  const { modell, symbol } = await body.neuePositionErfassen(kaufDaten);

  if (modell.positionen.length !== 1) throw new Error("der Kauf muss auf jeden Fall erfasst sein");
  if (symbol.symbol !== null) throw new Error("erwartet kein Symbol");
  if (!symbol.grund?.includes("kein Kurssymbol")) throw new Error(`erwartet eine Begründung, war ${symbol.grund}`);
});

Deno.test("fällt die Symbolsuche aus, ist der Kauf trotzdem erfasst", async () => {
  // Der wichtigste Fall: Ein getätigter Kauf darf nicht daran scheitern, dass ein fremder
  // Dienst gerade nicht erreichbar ist.
  const { body } = bodyMitSuche({}, { fehlerText: "Netz weg" });
  const { modell, symbol } = await body.neuePositionErfassen(kaufDaten);

  if (modell.positionen.length !== 1) throw new Error("der Kauf muss trotz Ausfall erfasst sein");
  if (modell.depotwert !== 100) throw new Error("und vollständig sein");
  if (!symbol.grund?.includes("nicht möglich")) throw new Error(`erwartet einen Hinweis auf den Ausfall, war ${symbol.grund}`);
});

Deno.test("ohne eingerichtete Symbolsuche wird der Kauf ganz normal erfasst", async () => {
  const body = createBody(createDomain(createEventStore()));
  const { modell, symbol } = await body.neuePositionErfassen(kaufDaten);
  if (modell.positionen.length !== 1) throw new Error("ohne Suche muss Erfassen weiter funktionieren");
  if (symbol.symbol !== null) throw new Error("erwartet kein Symbol");
});

Deno.test("ein Treffer, der nicht zum Namen passt, wird nicht zugeordnet", async () => {
  // Der reale Fehlgriff: Über eine falsch abgeleitete ISIN wurde Adidas gefunden. Lieber kein
  // Symbol als eines, das ab dem nächsten Abruf fremde Kurse ins Depot holt.
  const { body } = bodyMitSuche({ "IE00B4L5Y983": [{ symbol: "ADS", name: "adidas AG", boerse: "XETR" }] });
  const { modell, symbol } = await body.neuePositionErfassen({
    ...kaufDaten, wertpapierId: "IE00B4L5Y983", name: "iShares Core MSCI World",
  });

  if (symbol.symbol !== null) throw new Error(`nichts hätte zugeordnet werden dürfen, war ${symbol.symbol}`);
  // Kein fremdes Symbol — und weil nichts Passendes gefunden wurde, gilt sie als manuell.
  if (modell.positionen[0].kursbezug?.symbol) throw new Error("die Position darf kein fremdes Symbol tragen");
  if (modell.positionen[0].kursbezug?.art !== "manuell") throw new Error("erwartet die Kennzeichnung als manuell");
  if (!symbol.grund?.includes("passt")) throw new Error(`erwartet einen Hinweis auf die Namensprüfung, war ${symbol.grund}`);
  if (!symbol.unsicher?.length) throw new Error("die verworfenen Treffer sollen einsehbar bleiben");
});

Deno.test("eine neue Position mit WKN wird abgelehnt, nicht stillschweigend angelegt", async () => {
  const { body } = bodyMitSuche({});
  let gemeldet = "";
  try {
    await body.neuePositionErfassen({ ...kaufDaten, wertpapierId: "865985" });
  } catch (f) {
    gemeldet = (f as Error).message;
  }
  if (!gemeldet.includes("WKN")) throw new Error(`erwartet eine Ablehnung mit Begründung, war "${gemeldet}"`);
  // Und nichts darf angelegt worden sein — auch kein halber Kauf.
  if (body.depotAbfragen().positionen.length !== 0) throw new Error("bei abgelehnter Kennung darf nichts entstehen");
});

Deno.test("zur manuellen Kennzeichnung gehört, wo man den Kurs nachschlägt", async () => {
  const { body } = bodyMitSuche({});
  await body.neuePositionErfassen(kaufDaten);
  const modell = body.kursbezugZuordnen({
    wertpapierId: kaufDaten.wertpapierId, art: "manuell",
    nachschlagenUnter: "https://www.finanzen.net/zertifikate/auf-wikifolio-index/ls9kf5",
  });
  const bezug = modell.positionen[0].kursbezug;
  if (bezug.art !== "manuell") throw new Error("erwartet die Kennzeichnung als manuell");
  if (!bezug.nachschlagenUnter?.includes("finanzen.net")) throw new Error("die Adresse muss erhalten bleiben");
});

Deno.test("als Nachschlage-Adresse wird nur http(s) übernommen", () => {
  // Der Wert landet als Link in der Oberfläche — ein "javascript:"-Eintrag wäre dort eine
  // Einladung.
  const { body } = bodyMitSuche({});
  for (const boese of ["javascript:alert(1)", "data:text/html,<script>", "kein link"]) {
    let gemeldet = false;
    try {
      body.kursbezugZuordnen({ wertpapierId: "X", art: "manuell", nachschlagenUnter: boese });
    } catch { gemeldet = true; }
    if (!gemeldet) throw new Error(`"${boese}" hätte abgelehnt werden müssen`);
  }
});

// --- Zuordnen erst nach belegtem Kurs -------------------------------------------------------

Deno.test("ein Kandidat wird nur zugeordnet, wenn dafür wirklich ein Kurs kommt", async () => {
  // Der reale Fall: Twelve Data führt "CPW" an Stuttgart in seiner Datenbank, liefert dafür
  // im kostenlosen Tarif aber 404. Yahoo kennt dasselbe Papier als "CPW.SG" und liefert.
  const body = createBody(
    createDomain(createEventStore()),
    {
      "Twelve Data": createSimulierterKursProvider({}),                    // findet nichts
      Yahoo: createSimulierterKursProvider({ "CPW.SG": { kurs: 119.4, waehrung: "EUR" } }),
    },
    createSimulierterWechselkursProvider(),
    createSimulierteSymbolSuche({
      "IL0010824113": [
        { symbol: "CPW", name: "Check Point Software", boerse: "XSTU", quelle: "Twelve Data" },
        { symbol: "CPW.SG", name: "Check Point Software", boerse: "STU", quelle: "Yahoo" },
      ],
    }),
  );

  const { symbol } = await body.neuePositionErfassen({
    wertpapierId: "IL0010824113", name: "Check Point Software Ltd.", typ: "Aktie",
    stueck: 2, kaufkurs: 140.7, kurs: 140.7, datum: "2026-07-29",
  });

  if (symbol.symbol !== "CPW.SG") throw new Error(`erwartet den belegbaren Kandidaten, war ${symbol.symbol}`);
  if (symbol.kurs !== 119.4) throw new Error("der Probeabruf muss den Kurs mitliefern");
  if (symbol.waehrung !== "EUR") throw new Error("die Währung stammt aus dem Abruf, nicht aus der Suche");
});

Deno.test("liefert kein Kandidat einen Kurs, wird nichts zugeordnet", async () => {
  const body = createBody(
    createDomain(createEventStore()),
    { Yahoo: createSimulierterKursProvider({}) },
    null,
    createSimulierteSymbolSuche({ "IL0010824113": [{ symbol: "CPW.SG", name: "Check Point Software", quelle: "Yahoo" }] }),
  );

  const { modell, symbol } = await body.neuePositionErfassen({
    wertpapierId: "IL0010824113", name: "Check Point Software Ltd.", typ: "Aktie",
    stueck: 2, kaufkurs: 140.7, kurs: 140.7, datum: "2026-07-29",
  });

  if (symbol.symbol !== null) throw new Error("ohne belegten Kurs darf nichts zugeordnet werden");
  if (!symbol.grund?.includes("keine Quelle liefert")) throw new Error(`erwartet eine klare Begründung, war ${symbol.grund}`);
  // Und die Position gilt als manuell — nicht als offene Aufgabe.
  if (modell.positionen[0].kursbezug?.art !== "manuell") throw new Error("erwartet die Kennzeichnung als manuell");
});
