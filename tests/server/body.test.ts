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
  if (modell.positionen[0].stueck !== 2) throw new Error(`erwartet Stück 2 nach Nachkauf, war ${modell.positionen[0].stueck}`);
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

Deno.test("dump liefert den vollständigen Ereignisbestand", () => {
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "A", name: "Test AG", typ: "Aktie", stueck: 1, kaufkurs: 100, kurs: 100, datum: "2026-07-01" });
  const events = body.dump();
  if (events.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${events.length}`);
  if (events[0].eventType !== "kauf") throw new Error("erwartet zuerst das kauf-Ereignis");
});

Deno.test("restore ersetzt den Zustand und gibt das neue Modell zurück", () => {
  const neueEvents = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Import AG", typ: "Aktie", stueck: 5, kaufkurs: 10, datum: "2026-07-01" } },
    { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", kurs: 20, datum: "2026-07-02" } },
  ];
  const body = neuerBody();
  body.neuePositionErfassen({ wertpapierId: "ALT", name: "Alt AG", typ: "Aktie", stueck: 1, kaufkurs: 1, kurs: 1, datum: "2026-07-01" });

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
