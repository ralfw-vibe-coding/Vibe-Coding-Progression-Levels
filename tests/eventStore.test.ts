import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createEventStore } = require("../eventStore.js");

Deno.test("append vergibt aufsteigende seq-Nummern", () => {
  const store = createEventStore();
  const e1 = store.append("kauf", { wertpapierId: "A" });
  const e2 = store.append("kauf", { wertpapierId: "B" });
  if (e1.seq !== 1 || e2.seq !== 2) {
    throw new Error(`erwartet seq 1 und 2, war ${e1.seq} und ${e2.seq}`);
  }
});

Deno.test("append setzt einen technischen timestamp", () => {
  const store = createEventStore();
  const e = store.append("kauf", { wertpapierId: "A" });
  if (typeof e.timestamp !== "string" || e.timestamp.length === 0) {
    throw new Error("erwartet einen nicht-leeren timestamp-String");
  }
});

Deno.test("query ohne Filter liefert alle Events in Erfassungsreihenfolge", () => {
  const store = createEventStore();
  store.append("kauf", { wertpapierId: "A" });
  store.append("kauf", { wertpapierId: "B" });
  store.append("kursupdate", { wertpapierId: "A" });
  const alle = store.query();
  if (alle.length !== 3) throw new Error(`erwartet 3 Events, war ${alle.length}`);
  if (alle[0].payload.wertpapierId !== "A" || alle[2].eventType !== "kursupdate") {
    throw new Error("Reihenfolge stimmt nicht mit der Erfassung überein");
  }
});

Deno.test("query mit wertpapierId filtert korrekt", () => {
  const store = createEventStore();
  store.append("kauf", { wertpapierId: "A" });
  store.append("kauf", { wertpapierId: "B" });
  store.append("kursupdate", { wertpapierId: "A" });
  const nurA = store.query({ wertpapierId: "A" });
  if (nurA.length !== 2) throw new Error(`erwartet 2 Events zu A, war ${nurA.length}`);
  if (!nurA.every((e: any) => e.payload.wertpapierId === "A")) {
    throw new Error("query lieferte ein Event einer anderen wertpapierId");
  }
});

Deno.test("query mit unbekannter wertpapierId liefert leeres Array", () => {
  const store = createEventStore();
  store.append("kauf", { wertpapierId: "A" });
  const nichts = store.query({ wertpapierId: "UNBEKANNT" });
  if (nichts.length !== 0) throw new Error(`erwartet 0 Events, war ${nichts.length}`);
});

Deno.test("initialEvents bei der Konstruktion werden unverändert übernommen (seq/timestamp bleiben)", () => {
  const vorhanden = [
    { seq: 5, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    { seq: 9, eventType: "kursupdate", timestamp: "2020-01-02T00:00:00.000Z", payload: { wertpapierId: "A" } },
  ];
  const store = createEventStore(vorhanden);
  const alle = store.query();
  if (JSON.stringify(alle) !== JSON.stringify(vorhanden)) {
    throw new Error("initialEvents müssen inklusive seq/timestamp identisch übernommen werden");
  }
});

Deno.test("nächste seq nach initialEvents ist max(seq)+1, append() knüpft nahtlos an", () => {
  const store = createEventStore([
    { seq: 5, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
  ]);
  const neues = store.append("kursupdate", { wertpapierId: "A" });
  if (neues.seq !== 6) throw new Error(`erwartet seq 6, war ${neues.seq}`);
});

Deno.test("ohne initialEvents beginnt seq bei 1", () => {
  const store = createEventStore();
  const e = store.append("kauf", { wertpapierId: "A" });
  if (e.seq !== 1) throw new Error(`erwartet seq 1, war ${e.seq}`);
});
