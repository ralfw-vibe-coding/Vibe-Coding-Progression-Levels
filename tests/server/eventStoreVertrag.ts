// Der Vertrag jedes Event-Store — als Testsuite, nicht als Prosa. Jede Ausprägung (im
// Arbeitsspeicher, in einer Datei, später in einer Datenbank) ruft diese Funktion auf und muss
// sie bestehen. Damit ist "alle haben dasselbe Interface" keine Absichtserklärung, sondern
// nachprüfbar: Wer den Vertrag bricht, bekommt einen roten Test, egal welche Ausprägung.
//
// Die Ausprägungen unterscheiden sich nur darin, woher sie ihren Anfangsbestand beziehen —
// direkt, aus einer Datei, später aus einer Datenbank. Genau das kapselt die übergebene
// Erzeugerfunktion, alles andere muss gleich sein.

export type StoreErzeuger = (initialeEvents?: any[]) => {
  store: any;
  aufraeumen?: () => void;
};

export function pruefeEventStoreVertrag(
  bezeichnung: string,
  erzeugeStore: StoreErzeuger,
  optionen: { ignore?: boolean } = {},
) {
  const ignore = optionen.ignore ?? false;

  function vertragstest(name: string, fn: (store: any) => void) {
    Deno.test({
      name: `${bezeichnung} — ${name}`,
      ignore,
      fn() {
        const { store, aufraeumen } = erzeugeStore();
        try {
          fn(store);
        } finally {
          aufraeumen?.();
        }
      },
    });
  }

  function vertragstestMitBestand(name: string, initialeEvents: any[], fn: (store: any) => void) {
    Deno.test({
      name: `${bezeichnung} — ${name}`,
      ignore,
      fn() {
        const { store, aufraeumen } = erzeugeStore(initialeEvents);
        try {
          fn(store);
        } finally {
          aufraeumen?.();
        }
      },
    });
  }

  vertragstest("ein Store ohne Anfangsbestand ist leer", (store) => {
    if (store.query().length !== 0) throw new Error("erwartet einen leeren Store");
  });

  vertragstest("append vergibt aufsteigende seq-Nummern", (store) => {
    const e1 = store.append("kauf", { wertpapierId: "A" });
    const e2 = store.append("kauf", { wertpapierId: "B" });
    if (e1.seq !== 1 || e2.seq !== 2) {
      throw new Error(`erwartet seq 1 und 2, war ${e1.seq} und ${e2.seq}`);
    }
  });

  vertragstest("append setzt einen technischen timestamp", (store) => {
    const event = store.append("kauf", { wertpapierId: "A" });
    if (!event.timestamp || Number.isNaN(Date.parse(event.timestamp))) {
      throw new Error(`erwartet einen gültigen timestamp, war ${event.timestamp}`);
    }
  });

  vertragstest("append gibt das angelegte Ereignis vollständig zurück", (store) => {
    const event = store.append("kauf", { wertpapierId: "A", stueck: 3 });
    if (event.eventType !== "kauf") throw new Error(`erwartet eventType "kauf", war ${event.eventType}`);
    if (event.payload.stueck !== 3) throw new Error("die payload muss unverändert zurückkommen");
  });

  vertragstest("query ohne Filter liefert alle Ereignisse in Aufzeichnungsreihenfolge", (store) => {
    store.append("kauf", { wertpapierId: "A" });
    store.append("kursupdate", { wertpapierId: "B" });
    const alle = store.query();
    if (alle.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${alle.length}`);
    if (alle[0].payload.wertpapierId !== "A") throw new Error("die Reihenfolge muss der Aufzeichnung entsprechen");
  });

  vertragstest("query mit wertpapierId filtert", (store) => {
    store.append("kauf", { wertpapierId: "A" });
    store.append("kauf", { wertpapierId: "B" });
    store.append("kursupdate", { wertpapierId: "A" });
    const nurA = store.query({ wertpapierId: "A" });
    if (nurA.length !== 2) throw new Error(`erwartet 2 Ereignisse für A, war ${nurA.length}`);
  });

  vertragstest("query mit unbekannter wertpapierId liefert ein leeres Array", (store) => {
    store.append("kauf", { wertpapierId: "A" });
    if (store.query({ wertpapierId: "UNBEKANNT" }).length !== 0) {
      throw new Error("erwartet ein leeres Array");
    }
  });

  vertragstest("query gibt eine Kopie heraus, keinen Zugriff auf den Bestand", (store) => {
    store.append("kauf", { wertpapierId: "A" });
    store.query().push({ seq: 99 });
    if (store.query().length !== 1) throw new Error("der Bestand darf sich von außen nicht verändern lassen");
  });

  vertragstestMitBestand(
    "ein übergebener Anfangsbestand ist sofort abfragbar",
    [
      { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
      { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ],
    (store) => {
      const alle = store.query();
      if (alle.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${alle.length}`);
      if (alle[0].payload.wertpapierId !== "A") throw new Error("der Anfangsbestand muss unverändert übernommen werden");
    },
  );

  vertragstestMitBestand(
    "seq und timestamp eines Anfangsbestands bleiben unverändert",
    [{ seq: 42, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } }],
    (store) => {
      const event = store.query()[0];
      if (event.seq !== 42) throw new Error(`erwartet seq 42, war ${event.seq}`);
      if (event.timestamp !== "2020-01-01T00:00:00.000Z") throw new Error("der timestamp wurde einmal vergeben und muss bleiben");
    },
  );

  vertragstestMitBestand(
    "append knüpft nahtlos an einen Anfangsbestand an",
    [{ seq: 7, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } }],
    (store) => {
      const neues = store.append("kauf", { wertpapierId: "B" });
      if (neues.seq !== 8) throw new Error(`erwartet seq 8, war ${neues.seq}`);
    },
  );

  vertragstest("restore ersetzt den bisherigen Bestand vollständig, hängt nicht an", (store) => {
    store.append("kauf", { wertpapierId: "ALT" });
    store.restore([
      { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "NEU" } },
    ]);
    const alle = store.query();
    if (alle.length !== 1 || alle[0].payload.wertpapierId !== "NEU") {
      throw new Error("restore muss den alten Bestand ersetzen");
    }
  });

  vertragstest("restore übernimmt seq und timestamp unverändert", (store) => {
    const vorhanden = [
      { seq: 5, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ];
    store.restore(vorhanden);
    if (JSON.stringify(store.query()) !== JSON.stringify(vorhanden)) {
      throw new Error("restore muss inklusive seq und timestamp identisch übernehmen");
    }
  });

  vertragstest("nach restore ist die nächste seq max(seq)+1", (store) => {
    store.restore([
      { seq: 3, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
    ]);
    const neues = store.append("kauf", { wertpapierId: "B" });
    if (neues.seq !== 4) throw new Error(`erwartet seq 4, war ${neues.seq}`);
  });

  vertragstest("restore mit einer leeren Liste leert den Store", (store) => {
    store.append("kauf", { wertpapierId: "A" });
    store.restore([]);
    if (store.query().length !== 0) throw new Error("erwartet einen leeren Store");
  });
}
