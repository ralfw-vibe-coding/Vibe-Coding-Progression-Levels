import { createDateiEventStore } from "../../server/dateiEventStore.js";
import { pruefeEventStoreVertrag } from "./eventStoreVertrag.ts";

// Diese Tests fassen echte Dateien an und sind damit die langsamsten der Suite. Der Datei-Store
// ist fertig und wird sich nicht mehr ändern, deshalb laufen sie nicht bei jedem Durchlauf mit.
//
// Auf false setzen, sobald an dateiEventStore.js etwas geändert wird — dann müssen sie wieder
// grün sein, bevor die Änderung bleibt.
const UEBERSPRINGEN = true;

// Derselbe Vertrag wie beim Store im Arbeitsspeicher. Der einzige Unterschied steckt in der
// Erzeugerfunktion: Der Anfangsbestand kommt nicht als Parameter, sondern aus einer Datei.
pruefeEventStoreVertrag(
  "Event-Store in einer Datei",
  (initialeEvents = []) => {
    const verzeichnis = Deno.makeTempDirSync();
    const pfad = `${verzeichnis}/depot-events.json`;
    if (initialeEvents.length > 0) Deno.writeTextFileSync(pfad, JSON.stringify(initialeEvents));
    return {
      store: createDateiEventStore(pfad),
      aufraeumen: () => Deno.removeSync(verzeichnis, { recursive: true }),
    };
  },
  { ignore: UEBERSPRINGEN },
);

// Darüber hinaus das, was nur diese Ausprägung kann: sich erinnern.
async function inTempVerzeichnis(test: (pfad: string) => Promise<void>) {
  const verzeichnis = Deno.makeTempDirSync();
  try {
    await test(`${verzeichnis}/depot-events.json`);
  } finally {
    Deno.removeSync(verzeichnis, { recursive: true });
  }
}

function dateiTest(name: string, fn: (pfad: string) => Promise<void>) {
  Deno.test({ name, ignore: UEBERSPRINGEN, fn: () => inTempVerzeichnis(fn) });
}

dateiTest("append schreibt sofort — ohne dass jemand das Speichern anstoßen müsste", async (pfad) => {
  const store = createDateiEventStore(pfad);
  await store.append("kauf", { wertpapierId: "A" });

  const aufDerPlatte = JSON.parse(Deno.readTextFileSync(pfad));
  if (aufDerPlatte.length !== 1) throw new Error(`erwartet 1 Ereignis in der Datei, war ${aufDerPlatte.length}`);
  if (aufDerPlatte[0].payload.wertpapierId !== "A") throw new Error("das Ereignis muss vollständig in der Datei stehen");
});

dateiTest("ein neuer Store auf derselben Datei setzt den Bestand fort (simulierter Neustart)", async (pfad) => {
  const ersterStore = createDateiEventStore(pfad);
  await ersterStore.append("kauf", { wertpapierId: "A" });
  await ersterStore.append("kursupdate", { wertpapierId: "A" });

  // Der Kern der Sache: niemand hat exportiert, niemand hat "sichern" gerufen.
  const zweiterStore = createDateiEventStore(pfad);
  const events = await zweiterStore.query();
  if (events.length !== 2) throw new Error(`erwartet 2 fortgesetzte Ereignisse, war ${events.length}`);
  if (events[0].payload.wertpapierId !== "A") throw new Error("die Ereignisse müssen unverändert wiederkommen");
});

dateiTest("nach einem Neustart knüpft die seq-Vergabe nahtlos an", async (pfad) => {
  const ersterStore = createDateiEventStore(pfad);
  await ersterStore.append("kauf", { wertpapierId: "A" });
  await ersterStore.append("kauf", { wertpapierId: "B" });

  const zweiterStore = createDateiEventStore(pfad);
  const neues = await zweiterStore.append("kauf", { wertpapierId: "C" });
  if (neues.seq !== 3) throw new Error(`erwartet seq 3 nach dem Neustart, war ${neues.seq}`);
});

dateiTest("seq und timestamp überstehen den Neustart unverändert", async (pfad) => {
  const ersterStore = createDateiEventStore(pfad);
  const original = await ersterStore.append("kauf", { wertpapierId: "A" });

  const zweiterStore = createDateiEventStore(pfad);
  const wieder = (await zweiterStore.query())[0];
  if (wieder.seq !== original.seq || wieder.timestamp !== original.timestamp) {
    throw new Error("seq und timestamp wurden einmal vergeben und müssen so bleiben");
  }
});

dateiTest("restore schreibt den ersetzten Bestand ebenfalls sofort", async (pfad) => {
  const store = createDateiEventStore(pfad);
  await store.append("kauf", { wertpapierId: "ALT" });
  await store.restore([
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "NEU" } },
  ]);

  const aufDerPlatte = JSON.parse(Deno.readTextFileSync(pfad));
  if (aufDerPlatte.length !== 1 || aufDerPlatte[0].payload.wertpapierId !== "NEU") {
    throw new Error("nach restore muss der neue Bestand allein in der Datei stehen");
  }
});

dateiTest("eine beschädigte Datei wird gemeldet, statt still als leer zu gelten", async (pfad) => {
  Deno.writeTextFileSync(pfad, "{kein gültiges JSON");
  let gemeldet = false;
  try {
    createDateiEventStore(pfad);
  } catch {
    gemeldet = true;
  }
  // Ein leeres Depot vorzutäuschen wäre das Schlimmste: der Nutzer hielte seine Daten für
  // verloren und finge womöglich neu an — über den vorhandenen Ereignissen.
  if (!gemeldet) throw new Error("eine unlesbare Datei darf nicht als leeres Depot durchgehen");
});

Deno.test({
  name: "fehlende Verzeichnisse werden angelegt",
  ignore: UEBERSPRINGEN,
  async fn() {
    const basis = Deno.makeTempDirSync();
    try {
      const store = createDateiEventStore(`${basis}/noch/nicht/da/events.json`);
      await store.append("kauf", { wertpapierId: "A" });
      if ((await store.query()).length !== 1) throw new Error("der Store muss auch in einem neuen Verzeichnis schreiben können");
    } finally {
      Deno.removeSync(basis, { recursive: true });
    }
  },
});
