import { createPostgresEventStore } from "../../server/postgresEventStore.js";
import { pruefeEventStoreVertrag } from "./eventStoreVertrag.ts";

// Derselbe Vertrag wie bei den anderen drei Ausprägungen — und diesmal ist er es, der die
// eigentliche Aussage trägt: Eine Datenbank, die über ein Netz antwortet, verhält sich in jeder
// geprüften Hinsicht wie ein Array im Arbeitsspeicher. Nur eben async, und das gilt seit dieser
// Stufe für alle.
//
// Diese Tests brauchen als einzige der Suite eine Zugangsangabe. Fehlt sie, laufen sie nicht —
// genauso wie der Server ohne Kursquellen-Schlüssel weiterläuft, nur mit weniger Quellen. Ein
// frischer Klon ohne .env soll eine grüne Suite sehen und keine Hausaufgabe.
const DATENBANK_URL = Deno.env.get("DATABASE_URL");
const UEBERSPRINGEN = !DATENBANK_URL;

if (UEBERSPRINGEN) {
  console.log("Postgres-Tests übersprungen: DATABASE_URL ist nicht gesetzt (vor dem Testlauf: set -a; . ./.env; set +a).");
}

// Eine eigene Tabelle, nicht die des Betriebs. Die Vertragstests leeren ihren Store zu Beginn
// jedes Tests vollständig — täten sie das in "events", wäre ein Depot weg. Der Tabellenname ist
// deshalb kein Komfort-Parameter, sondern die Trennlinie zwischen Prüfen und Zerstören.
const TESTTABELLE = "events_test";

async function testStore(initialeEvents: any[] = []) {
  const store = await createPostgresEventStore(DATENBANK_URL!, { tabelle: TESTTABELLE });
  // restore ersetzt den gesamten Bestand — mit einer leeren Liste ist das genau das Leeren,
  // mit der es jeder Test frisch beginnen soll. Und es zieht die Sequenz mit zurück, was ein
  // bloßes TRUNCATE nicht täte: Sonst finge der zweite Testlauf bei seq 21 an.
  await store.restore(initialeEvents);
  return {
    store,
    // Anders als bei den lokalen Ausprägungen muss hier wirklich aufgeräumt werden: Eine offene
    // Netzwerkverbindung überlebt den Test und lässt ihn als undicht auffallen. Und die Tabelle
    // bleibt leer zurück — sie liegt in derselben Datenbank wie der Betrieb, da soll nichts
    // herumstehen, was aussieht, als gehörte es dorthin.
    async aufraeumen() {
      await store.restore([]);
      await store.schliessen();
    },
  };
}

pruefeEventStoreVertrag("Event-Store in Postgres", testStore, { ignore: UEBERSPRINGEN });

// Darüber hinaus das, was nur diese Ausprägung ausmacht.
function postgresTest(name: string, fn: (store: any) => Promise<void>) {
  Deno.test({
    name,
    ignore: UEBERSPRINGEN,
    async fn() {
      const { store, aufraeumen } = await testStore();
      try {
        await fn(store);
      } finally {
        await aufraeumen();
      }
    },
  });
}

postgresTest("die payload überlebt den Weg durch die Datenbank unverändert", async (store) => {
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
  // Verglichen wird Feld für Feld, nicht als Zeichenkette wie beim SQLite-Store. JSONB speichert
  // kein JSON, sondern dessen Bedeutung — die Schlüssel kommen in Postgres' eigener Reihenfolge
  // zurück. Was zählt, sind die Werte; die Reihenfolge von Objektschlüsseln hat noch nie etwas
  // bedeutet.
  for (const [feld, wert] of Object.entries(payload)) {
    if (gelesen[feld] !== wert) throw new Error(`${feld}: erwartet ${wert}, war ${gelesen[feld]}`);
  }
  if (Object.keys(gelesen).length !== Object.keys(payload).length) {
    throw new Error(`erwartet ${Object.keys(payload).length} Felder, war ${Object.keys(gelesen).length}`);
  }
  // Kommazahlen und null sind die üblichen Stolperstellen beim Weg durch eine Datenbank.
  if (gelesen.stueck !== 68.476) throw new Error("Nachkommastellen müssen erhalten bleiben");
  if (gelesen.kaufwert !== null) throw new Error("null muss null bleiben, nicht undefined werden");
});

postgresTest("query nach wertpapierId filtert in der Datenbank, nicht in JavaScript", async (store) => {
  await store.append("kauf", { wertpapierId: "A" });
  await store.append("kauf", { wertpapierId: "B" });
  await store.append("kursupdate", { wertpapierId: "A" });

  // Gefiltert wird über einen Ausdruck auf der payload — dass das überhaupt geht, ohne die
  // Struktur der Ereignisse in Spalten zu gießen, ist der Grund für JSONB.
  const nurA = await store.query({ wertpapierId: "A" });
  if (nurA.length !== 2) throw new Error(`erwartet 2 Ereignisse für A, war ${nurA.length}`);
  if (nurA.some((e: any) => e.payload.wertpapierId !== "A")) {
    throw new Error("es dürfen nur Ereignisse des angefragten Wertpapiers zurückkommen");
  }
});

postgresTest("ein fehlgeschlagenes restore lässt den bisherigen Bestand unangetastet", async (store) => {
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
  // Das ist der Gewinn der Transaktion: kein halb ersetztes Depot. Beim Löschen war der alte
  // Bestand schon fort — nur eben nicht endgültig, bis die Transaktion durch ist.
  const bestand = await store.query();
  if (bestand.length !== 1 || bestand[0].payload.wertpapierId !== "ALT") {
    throw new Error(`der alte Bestand muss vollständig erhalten bleiben, war ${JSON.stringify(bestand)}`);
  }
});

postgresTest("zwei Verbindungen auf dieselbe Datenbank vergeben keine Nummer doppelt", async (store) => {
  // Der Fall, für den es die Sequenz gibt: zwei Schreiber gleichzeitig, wie sie entstehen, wenn
  // neben dem Server noch ein Skript auf dieselbe Datenbank schaut. Hier sogar wirklich
  // gleichzeitig — bei einer Datenbank hinter einer Leitung ist das kein Kunststück mehr,
  // sondern der Normalfall.
  const zweiter = await createPostgresEventStore(DATENBANK_URL!, { tabelle: TESTTABELLE });
  try {
    const geschrieben = await Promise.all(
      Array.from({ length: 10 }, (_, i) => [
        store.append("kauf", { wertpapierId: `A${i}` }),
        zweiter.append("kauf", { wertpapierId: `B${i}` }),
      ]).flat(),
    );

    const nummern = new Set(geschrieben.map((e: any) => e.seq));
    if (nummern.size !== 20) throw new Error(`erwartet 20 verschiedene seq, war ${nummern.size}`);
    if ((await store.query()).length !== 20) throw new Error("beide Schreiber müssen vollständig angekommen sein");
  } finally {
    await zweiter.schliessen();
  }
});
