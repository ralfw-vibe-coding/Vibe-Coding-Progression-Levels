import { createSqliteEventStore } from "../../server/sqliteEventStore.js";
import { pruefeEventStoreVertrag } from "./eventStoreVertrag.ts";

// Derselbe Vertrag wie bei den anderen Ausprägungen. Dass diese Suite ohne eine einzige
// Änderung auch für die Datenbank läuft, ist der Beleg dafür, dass der Umbau wirklich nur
// "unter der Haube" stattfand: Domäne und Body merken keinen Unterschied.
//
// Für die Vertragstests genügt eine Datenbank im Arbeitsspeicher — sie ist schnell und muss
// nicht aufgeräumt werden. Der Anfangsbestand kommt hier weder als Parameter noch aus einer
// Datei, sondern wird in die Datenbank geschrieben, bevor der Store sie zu sehen bekommt.
pruefeEventStoreVertrag("Event-Store in SQLite", async (initialeEvents = []) => {
  const store = createSqliteEventStore(":memory:");
  if (initialeEvents.length > 0) await store.restore(initialeEvents);
  return { store };
});

// Darüber hinaus das, was nur diese Ausprägung ausmacht.
async function inTempDatenbank(test: (pfad: string) => Promise<void>) {
  const verzeichnis = Deno.makeTempDirSync();
  try {
    await test(`${verzeichnis}/depot.sqlite`);
  } finally {
    Deno.removeSync(verzeichnis, { recursive: true });
  }
}

Deno.test("eine neue Datenbank auf derselben Datei setzt den Bestand fort (simulierter Neustart)", async () => {
  await inTempDatenbank(async (pfad) => {
    const ersterStore = createSqliteEventStore(pfad);
    await ersterStore.append("kauf", { wertpapierId: "A" });
    await ersterStore.append("kursupdate", { wertpapierId: "A" });

    const zweiterStore = createSqliteEventStore(pfad);
    const events = await zweiterStore.query();
    if (events.length !== 2) throw new Error(`erwartet 2 fortgesetzte Ereignisse, war ${events.length}`);
    if (events[0].payload.wertpapierId !== "A") throw new Error("die Ereignisse müssen unverändert wiederkommen");
  });
});

Deno.test("nach einem Neustart knüpft die seq-Vergabe nahtlos an", async () => {
  await inTempDatenbank(async (pfad) => {
    const ersterStore = createSqliteEventStore(pfad);
    await ersterStore.append("kauf", { wertpapierId: "A" });
    await ersterStore.append("kauf", { wertpapierId: "B" });

    const zweiterStore = createSqliteEventStore(pfad);
    const neues = await zweiterStore.append("kauf", { wertpapierId: "C" });
    if (neues.seq !== 3) throw new Error(`erwartet seq 3 nach dem Neustart, war ${neues.seq}`);
  });
});

Deno.test("das Schema wird beim ersten Start selbst angelegt", async () => {
  await inTempDatenbank(async (pfad) => {
    // Kein Migrationsschritt, kein Setup-Befehl: Der Store sorgt selbst dafür, dass die Tabelle
    // existiert. Eine leere Datenbank ist einfach ein leeres Depot.
    const store = createSqliteEventStore(pfad);
    if ((await store.query()).length !== 0) throw new Error("erwartet ein leeres Depot");
    await store.append("kauf", { wertpapierId: "A" });
    if ((await store.query()).length !== 1) throw new Error("nach dem Anlegen muss geschrieben werden können");
  });
});

Deno.test("die payload überlebt den Weg durch die Datenbank unverändert", async () => {
  const store = createSqliteEventStore(":memory:");
  const payload = {
    wertpapierId: "A2QBZ1",
    name: "ISVP.-IS.M.EES EOA",
    typ: "ETF",
    broker: "comdirect",
    stueck: 68.476,
    kaufkurs: 11.1479,
    kaufwert: null,
    datum: "2026-07-01",
  };
  await store.append("kauf", payload);

  const gelesen = (await store.query())[0].payload;
  if (JSON.stringify(gelesen) !== JSON.stringify(payload)) {
    throw new Error(`payload verändert: ${JSON.stringify(gelesen)}`);
  }
  // Kommazahlen und null sind die üblichen Stolperstellen beim Weg durch eine Datenbank.
  if (gelesen.stueck !== 68.476) throw new Error("Nachkommastellen müssen erhalten bleiben");
  if (gelesen.kaufwert !== null) throw new Error("null muss null bleiben, nicht undefined werden");
});

Deno.test("query nach wertpapierId filtert in der Datenbank, nicht in JavaScript", async () => {
  const store = createSqliteEventStore(":memory:");
  await store.append("kauf", { wertpapierId: "A" });
  await store.append("kauf", { wertpapierId: "B" });
  await store.append("kursupdate", { wertpapierId: "A" });

  const nurA = await store.query({ wertpapierId: "A" });
  if (nurA.length !== 2) throw new Error(`erwartet 2 Ereignisse für A, war ${nurA.length}`);
  if (nurA.some((e: any) => e.payload.wertpapierId !== "A")) {
    throw new Error("es dürfen nur Ereignisse des angefragten Wertpapiers zurückkommen");
  }
});

Deno.test("zwei Verbindungen auf dieselbe Datenbank kommen sich nicht ins Gehege", async () => {
  await inTempDatenbank(async (pfad) => {
    // Zwei getrennte Verbindungen, wie sie entstehen, wenn neben dem Server noch ein Skript
    // auf dieselbe Datenbank schaut. Abwechselnd schreiben ist der harte Fall.
    const einer = createSqliteEventStore(pfad);
    const anderer = createSqliteEventStore(pfad);
    for (let i = 0; i < 10; i++) {
      await einer.append("kauf", { wertpapierId: `A${i}` });
      await anderer.append("kauf", { wertpapierId: `B${i}` });
    }

    const alle = await einer.query();
    if (alle.length !== 20) throw new Error(`erwartet 20 Ereignisse, war ${alle.length}`);
    // Keine doppelt vergebene Nummer: Beide Verbindungen haben sich auf dieselbe Reihenfolge
    // geeinigt, statt jede für sich zu zählen.
    const nummern = new Set(alle.map((e: any) => e.seq));
    if (nummern.size !== 20) throw new Error(`erwartet 20 verschiedene seq, war ${nummern.size}`);
    // Und beide Schreiber sind vollständig angekommen.
    const vonB = alle.filter((e: any) => e.payload.wertpapierId.startsWith("B"));
    if (vonB.length !== 10) throw new Error(`erwartet 10 Ereignisse der zweiten Verbindung, war ${vonB.length}`);
  });
});

Deno.test("ein fehlgeschlagenes restore lässt den bisherigen Bestand unangetastet", async () => {
  const store = createSqliteEventStore(":memory:");
  await store.append("kauf", { wertpapierId: "ALT" });

  // Zwei Ereignisse mit derselben seq verletzen den Primärschlüssel — der zweite INSERT
  // scheitert, wenn der erste schon geschrieben ist.
  const kaputt = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X" } },
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "Y" } },
  ];
  let gescheitert = false;
  try {
    await store.restore(kaputt);
  } catch {
    gescheitert = true;
  }

  if (!gescheitert) throw new Error("ein doppelter Primärschlüssel muss auffallen");
  // Das ist der Gewinn der Transaktion: kein halb ersetztes Depot.
  const bestand = await store.query();
  if (bestand.length !== 1 || bestand[0].payload.wertpapierId !== "ALT") {
    throw new Error(`der alte Bestand muss vollständig erhalten bleiben, war ${JSON.stringify(bestand)}`);
  }
});
