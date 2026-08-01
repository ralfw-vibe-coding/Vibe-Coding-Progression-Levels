// Der Vertrag jedes Event-Store — als Testsuite, nicht als Prosa. Jede Ausprägung (im
// Arbeitsspeicher, in einer Datei, in SQLite, in Postgres) ruft diese Funktion auf und muss
// sie bestehen. Damit ist "alle haben dasselbe Interface" keine Absichtserklärung, sondern
// nachprüfbar: Wer den Vertrag bricht, bekommt einen roten Test, egal welche Ausprägung.
//
// Die Ausprägungen unterscheiden sich nur darin, woher sie ihren Anfangsbestand beziehen —
// direkt, aus einer Datei, aus einer Datenbank. Genau das kapselt die übergebene
// Erzeugerfunktion, alles andere muss gleich sein.
//
// Seit Stufe 11 ist der Vertrag async: append/query/restore geben Promises zurück. Der Grund
// steht nicht hier, sondern in postgresEventStore.js — eine Datenbank am anderen Ende einer
// Leitung kann nicht synchron antworten, und der Vertrag richtet sich nach der anspruchsvollsten
// Ausprägung, nicht nach der bequemsten. Für die drei lokalen Ausprägungen kostet das nur ein
// Schlüsselwort; für den Vertrag bedeutet es, dass hier überall await steht.

export type StoreErzeuger = (initialeEvents?: any[]) =>
  | { store: any; aufraeumen?: () => void | Promise<void> }
  | Promise<{ store: any; aufraeumen?: () => void | Promise<void> }>;

export function pruefeEventStoreVertrag(
  bezeichnung: string,
  erzeugeStore: StoreErzeuger,
  optionen: { ignore?: boolean } = {},
) {
  const ignore = optionen.ignore ?? false;

  function vertragstest(name: string, fn: (store: any) => Promise<void>) {
    Deno.test({
      name: `${bezeichnung} — ${name}`,
      ignore,
      async fn() {
        const { store, aufraeumen } = await erzeugeStore();
        try {
          await fn(store);
        } finally {
          await aufraeumen?.();
        }
      },
    });
  }

  function vertragstestMitBestand(name: string, initialeEvents: any[], fn: (store: any) => Promise<void>) {
    Deno.test({
      name: `${bezeichnung} — ${name}`,
      ignore,
      async fn() {
        const { store, aufraeumen } = await erzeugeStore(initialeEvents);
        try {
          await fn(store);
        } finally {
          await aufraeumen?.();
        }
      },
    });
  }

  vertragstest("ein Store ohne Anfangsbestand ist leer", async (store) => {
    if ((await store.query()).length !== 0) throw new Error("erwartet einen leeren Store");
  });

  vertragstest("append vergibt aufsteigende seq-Nummern", async (store) => {
    const e1 = await store.append("kauf", { wertpapierId: "A" });
    const e2 = await store.append("kauf", { wertpapierId: "B" });
    if (e1.seq !== 1 || e2.seq !== 2) {
      throw new Error(`erwartet seq 1 und 2, war ${e1.seq} und ${e2.seq}`);
    }
  });

  vertragstest("append setzt einen technischen timestamp", async (store) => {
    const event = await store.append("kauf", { wertpapierId: "A" });
    if (!event.timestamp || Number.isNaN(Date.parse(event.timestamp))) {
      throw new Error(`erwartet einen gültigen timestamp, war ${event.timestamp}`);
    }
  });

  vertragstest("append gibt das angelegte Ereignis vollständig zurück", async (store) => {
    const event = await store.append("kauf", { wertpapierId: "A", stueck: 3 });
    if (event.eventType !== "kauf") throw new Error(`erwartet eventType "kauf", war ${event.eventType}`);
    if (event.payload.stueck !== 3) throw new Error("die payload muss unverändert zurückkommen");
  });

  vertragstest("query ohne Filter liefert alle Ereignisse in Aufzeichnungsreihenfolge", async (store) => {
    await store.append("kauf", { wertpapierId: "A" });
    await store.append("kursupdate", { wertpapierId: "B" });
    const alle = await store.query();
    if (alle.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${alle.length}`);
    if (alle[0].payload.wertpapierId !== "A") throw new Error("die Reihenfolge muss der Aufzeichnung entsprechen");
  });

  vertragstest("query mit wertpapierId filtert", async (store) => {
    await store.append("kauf", { wertpapierId: "A" });
    await store.append("kauf", { wertpapierId: "B" });
    await store.append("kursupdate", { wertpapierId: "A" });
    const nurA = await store.query({ wertpapierId: "A" });
    if (nurA.length !== 2) throw new Error(`erwartet 2 Ereignisse für A, war ${nurA.length}`);
  });

  vertragstest("query mit unbekannter wertpapierId liefert ein leeres Array", async (store) => {
    await store.append("kauf", { wertpapierId: "A" });
    if ((await store.query({ wertpapierId: "UNBEKANNT" })).length !== 0) {
      throw new Error("erwartet ein leeres Array");
    }
  });

  vertragstest("query gibt eine Kopie heraus, keinen Zugriff auf den Bestand", async (store) => {
    await store.append("kauf", { wertpapierId: "A" });
    (await store.query()).push({ seq: 99 });
    if ((await store.query()).length !== 1) throw new Error("der Bestand darf sich von außen nicht verändern lassen");
  });

  vertragstestMitBestand(
    "ein übergebener Anfangsbestand ist sofort abfragbar",
    [
      { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
      { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ],
    async (store) => {
      const alle = await store.query();
      if (alle.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${alle.length}`);
      if (alle[0].payload.wertpapierId !== "A") throw new Error("der Anfangsbestand muss unverändert übernommen werden");
    },
  );

  vertragstestMitBestand(
    "seq und timestamp eines Anfangsbestands bleiben unverändert",
    [{ seq: 42, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } }],
    async (store) => {
      const event = (await store.query())[0];
      if (event.seq !== 42) throw new Error(`erwartet seq 42, war ${event.seq}`);
      if (event.timestamp !== "2020-01-01T00:00:00.000Z") throw new Error("der timestamp wurde einmal vergeben und muss bleiben");
    },
  );

  vertragstestMitBestand(
    "append knüpft nahtlos an einen Anfangsbestand an",
    [{ seq: 7, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } }],
    async (store) => {
      const neues = await store.append("kauf", { wertpapierId: "B" });
      if (neues.seq !== 8) throw new Error(`erwartet seq 8, war ${neues.seq}`);
    },
  );

  vertragstest("restore ersetzt den bisherigen Bestand vollständig, hängt nicht an", async (store) => {
    await store.append("kauf", { wertpapierId: "ALT" });
    await store.restore([
      { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "NEU" } },
    ]);
    const alle = await store.query();
    if (alle.length !== 1 || alle[0].payload.wertpapierId !== "NEU") {
      throw new Error("restore muss den alten Bestand ersetzen");
    }
  });

  vertragstest("restore übernimmt seq und timestamp unverändert", async (store) => {
    const vorhanden = [
      { seq: 5, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ];
    await store.restore(vorhanden);
    if (JSON.stringify(await store.query()) !== JSON.stringify(vorhanden)) {
      throw new Error("restore muss inklusive seq und timestamp identisch übernehmen");
    }
  });

  vertragstest("nach restore ist die nächste seq max(seq)+1", async (store) => {
    await store.restore([
      { seq: 3, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ]);
    const neues = await store.append("kauf", { wertpapierId: "B" });
    if (neues.seq !== 4) throw new Error(`erwartet seq 4, war ${neues.seq}`);
  });

  vertragstest("restore mit einer leeren Liste leert den Store", async (store) => {
    await store.append("kauf", { wertpapierId: "A" });
    await store.restore([]);
    if ((await store.query()).length !== 0) throw new Error("erwartet einen leeren Store");
  });
}
