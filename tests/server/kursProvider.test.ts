import { createSimulierterKursProvider } from "../../server/simulierterKursProvider.js";
import { createYahooKursProvider } from "../../server/yahooKursProvider.js";
import { createTwelveDataKursProvider } from "../../server/twelveDataKursProvider.js";
import { createVerketteterKursProvider, nachAussichtSortiert } from "../../server/kursProvider.js";
import { createFinnhubKursProvider, createFinnhubSymbolSuche } from "../../server/finnhubProvider.js";
import { pruefeKursProviderVertrag } from "./kursProviderVertrag.ts";

// --- Alle Ausprägungen am selben Vertrag ---------------------------------------------------

pruefeKursProviderVertrag("Simulierte Kursquelle", ({ treffer }) => createSimulierterKursProvider(treffer));

// Yahoo bekommt ein vorgegebenes fetch untergeschoben: Der Test prüft die Quelle, nicht das Netz.
pruefeKursProviderVertrag("Yahoo", ({ treffer }) =>
  createYahooKursProvider({
    fetchFn: (url: any) => {
      const symbol = decodeURIComponent(String(url).split("/chart/")[1].split("?")[0]);
      if (!(symbol in treffer)) {
        return Promise.resolve(new Response(JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }), { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        chart: { result: [{ meta: { regularMarketPrice: treffer[symbol], currency: "EUR", exchangeName: "GER" } }] },
      })));
    },
  }));

pruefeKursProviderVertrag("Twelve Data", ({ treffer }) =>
  createTwelveDataKursProvider("test-schluessel", {
    fetchFn: (url: any) => {
      const symbole = decodeURIComponent(new URL(String(url)).searchParams.get("symbol") ?? "").split(",");
      const rumpf: Record<string, unknown> = {};
      for (const s of symbole) {
        rumpf[s] = s in treffer
          ? { close: String(treffer[s]), currency: "EUR", exchange: "XETR" }
          : { code: 404, status: "error", message: "**symbol** not found" };
      }
      return Promise.resolve(new Response(JSON.stringify(symbole.length === 1 ? rumpf[symbole[0]] : rumpf)));
    },
  }));

pruefeKursProviderVertrag("Verkettete Quellen", ({ treffer }) =>
  createVerketteterKursProvider(
    createSimulierterKursProvider({}, { name: "leer" }),
    createSimulierterKursProvider(treffer, { name: "voll" }),
  ));

// --- Was nur die Verkettung ausmacht -------------------------------------------------------

Deno.test("die Kette fragt die zweite Quelle nur nach dem, was die erste nicht kannte", async () => {
  const erste = createSimulierterKursProvider({ A: 10 }, { name: "erste" });
  const zweite = createSimulierterKursProvider({ B: 20 }, { name: "zweite" });
  const kette = createVerketteterKursProvider(erste, zweite);

  const ergebnis: any = await kette.kurseAbrufen(["A", "B"]);
  if (ergebnis.get("A").kurs !== 10) throw new Error("A muss von der ersten Quelle kommen");
  if (ergebnis.get("B").kurs !== 20) throw new Error("B muss von der zweiten Quelle kommen");
  // Der eigentliche Punkt: A wird der zweiten Quelle gar nicht erst vorgelegt.
  if (JSON.stringify(zweite.aufrufe) !== JSON.stringify([["B"]])) {
    throw new Error(`die zweite Quelle darf nur B sehen, sah aber ${JSON.stringify(zweite.aufrufe)}`);
  }
});

Deno.test("die Kette nennt bei einem Treffer die Quelle, die ihn geliefert hat", async () => {
  const kette = createVerketteterKursProvider(
    createSimulierterKursProvider({}, { name: "erste" }),
    createSimulierterKursProvider({ A: 10 }, { name: "zweite" }),
  );
  const e: any = (await kette.kurseAbrufen(["A"])).get("A");
  if (e.quelle !== "zweite") throw new Error(`erwartet Quelle "zweite", war ${e.quelle}`);
});

Deno.test("kennt keine Quelle das Symbol, bleibt der Fehler der letzten stehen", async () => {
  const kette = createVerketteterKursProvider(
    createSimulierterKursProvider({}, { name: "erste" }),
    createSimulierterKursProvider({}, { name: "zweite" }),
  );
  const e: any = (await kette.kurseAbrufen(["X"])).get("X");
  if (e.fehler === undefined) throw new Error("erwartet einen Fehler");
  if (e.quelle !== "zweite") throw new Error(`erwartet den Fehler der letzten Quelle, war ${e.quelle}`);
});

Deno.test("fällt eine Quelle ganz aus, übernimmt die nächste", async () => {
  const kaputt = {
    name: "kaputt",
    kurseAbrufen: () => { throw new Error("Netz weg"); },
  };
  const kette = createVerketteterKursProvider(kaputt, createSimulierterKursProvider({ A: 10 }, { name: "heil" }));

  const e: any = (await kette.kurseAbrufen(["A"])).get("A");
  if (e.kurs !== 10) throw new Error("die zweite Quelle muss einspringen, wenn die erste ausfällt");
});

Deno.test("fallen alle Quellen aus, ist das ein Fehler je Symbol und kein Absturz", async () => {
  const kaputt = (name: string) => ({ name, kurseAbrufen: () => { throw new Error("Netz weg"); } });
  const kette = createVerketteterKursProvider(kaputt("eins"), kaputt("zwei"));

  const ergebnis: any = await kette.kurseAbrufen(["A", "B"]);
  if (ergebnis.size !== 2) throw new Error("auch im Totalausfall bekommt jedes Symbol eine Antwort");
  if (!ergebnis.get("A").fehler.includes("nicht erreichbar")) {
    throw new Error(`erwartet einen Hinweis auf die Erreichbarkeit, war ${ergebnis.get("A").fehler}`);
  }
});

// --- Eigenheiten der einzelnen Quellen -----------------------------------------------------

Deno.test("Twelve Data fragt alle Symbole in einem einzigen Aufruf ab", async () => {
  // Der Grund ist das Anfragelimit: Es zählt Aufrufe, nicht Kurse. Zwölf Einzelabrufe wären
  // im kostenlosen Tarif sofort zu viel.
  const aufrufe: string[] = [];
  const quelle = createTwelveDataKursProvider("k", {
    fetchFn: (url: any) => {
      aufrufe.push(String(url));
      const symbole = decodeURIComponent(new URL(String(url)).searchParams.get("symbol") ?? "").split(",");
      const rumpf: Record<string, unknown> = {};
      for (const s of symbole) rumpf[s] = { close: "1", currency: "EUR" };
      return Promise.resolve(new Response(JSON.stringify(rumpf)));
    },
  });

  await quelle.kurseAbrufen(["A", "B", "C", "D"]);
  if (aufrufe.length !== 1) throw new Error(`erwartet 1 Aufruf, waren ${aufrufe.length}`);
});

Deno.test("Twelve Data macht aus dem Anfragelimit eine verständliche Meldung", async () => {
  const quelle = createTwelveDataKursProvider("k", {
    fetchFn: () => Promise.resolve(new Response("", { status: 429 })),
  });
  const e: any = (await quelle.kurseAbrufen(["A"])).get("A");
  if (!e.fehler.includes("Anfragelimit")) throw new Error(`erwartet einen Hinweis aufs Limit, war ${e.fehler}`);
});

Deno.test("Twelve Data kürzt den Werbetext für kostenpflichtige Tarife ein", async () => {
  const quelle = createTwelveDataKursProvider("k", {
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({
      code: 404, status: "error",
      message: "**symbol** EWG2 is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing",
    }))),
  });
  const e: any = (await quelle.kurseAbrufen(["EWG2"])).get("EWG2");
  if (e.fehler.includes("http")) throw new Error(`die Meldung soll keinen Werbelink enthalten: ${e.fehler}`);
  if (!e.fehler.includes("kostenpflichtig")) throw new Error(`erwartet einen verständlichen Hinweis, war ${e.fehler}`);
});

Deno.test("Yahoo reicht die Währung durch, statt Euro anzunehmen", async () => {
  const quelle = createYahooKursProvider({
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({
      chart: { result: [{ meta: { regularMarketPrice: 336.91, currency: "USD", exchangeName: "NMS" } }] },
    }))),
  });
  const e: any = (await quelle.kurseAbrufen(["AAPL"])).get("AAPL");
  if (e.waehrung !== "USD") throw new Error(`erwartet USD, war ${e.waehrung}`);
});



// --- Finnhub: getrennte Fähigkeiten -------------------------------------------------------

pruefeKursProviderVertrag("Finnhub", ({ treffer }) =>
  createFinnhubKursProvider("k", {
    fetchFn: (url: any) => {
      const symbol = decodeURIComponent(new URL(String(url)).searchParams.get("symbol") ?? "");
      // Finnhub meldet Unbekanntes nicht als Fehler, sondern mit lauter Nullen.
      return Promise.resolve(new Response(JSON.stringify(symbol in treffer ? { c: treffer[symbol] } : { c: 0, d: null })));
    },
  }));

Deno.test("Finnhub macht aus dem 403 eine Aussage über den Tarif, nicht über die App", async () => {
  // 403 heißt hier "dieser Handelsplatz ist nicht im Tarif" — nicht "Schlüssel falsch".
  const quelle = createFinnhubKursProvider("k", {
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({ error: "You don't have access to this resource." }), { status: 403 })),
  });
  const e: any = (await quelle.kurseAbrufen(["SAP.DE"])).get("SAP.DE");
  if (!e.fehler.includes("US-Börsen")) throw new Error(`erwartet einen Hinweis auf den Tarif, war ${e.fehler}`);
});

Deno.test("ein Kurs von 0 gilt bei Finnhub als 'nicht gefunden'", async () => {
  const quelle = createFinnhubKursProvider("k", {
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({ c: 0, h: 0, l: 0 }))),
  });
  const e: any = (await quelle.kurseAbrufen(["GIBTSNICHT"])).get("GIBTSNICHT");
  if (e.fehler === undefined) throw new Error("lauter Nullen sind kein gültiger Kurs");
});

// --- Vorauswahl der Kandidaten --------------------------------------------------------------
//
// Diese Tests halten fest, was die Anwendung über die Grenzen ihrer Zugänge weiß. Wird ein
// Tarif erweitert oder ein Anbieter ausgetauscht, schlagen sie fehl — und genau das sollen sie:
// Das Wissen ist gemessen, nicht ewig gültig.

const quellen: any = {
  Yahoo: createYahooKursProvider(),
  Finnhub: createFinnhubKursProvider("k"),
  "Twelve Data": createTwelveDataKursProvider("k"),
};

function symbole(kandidaten: any[]) {
  return nachAussichtSortiert(kandidaten, quellen).map((t: any) => t.symbol);
}

Deno.test("Kandidaten, deren Quelle den Handelsplatz nicht bedienen darf, fallen weg", () => {
  const uebrig = symbole([
    { symbol: "ESIE", boerse: "XETR", waehrung: "EUR", quelle: "Twelve Data" },
    { symbol: "ESIE.DE", boerse: "DE", waehrung: null, quelle: "Finnhub" },
    { symbol: "ESIE.DE", boerse: "GER", waehrung: "EUR", quelle: "Yahoo" },
  ]);
  // Twelve Data und Finnhub geben außerhalb der US-Börsen nichts frei — das steht vorher fest
  // und kostet deshalb keine Anfrage.
  if (uebrig.length !== 1 || uebrig[0] !== "ESIE.DE") {
    throw new Error(`erwartet nur den Yahoo-Kandidaten, war ${JSON.stringify(uebrig)}`);
  }
});

Deno.test("bei US-Papieren bleiben alle drei, Yahoo zuerst", () => {
  const uebrig = symbole([
    { symbol: "MSTR", boerse: "NASDAQ", waehrung: "USD", quelle: "Twelve Data" },
    { symbol: "MSTR", boerse: "US", waehrung: null, quelle: "Finnhub" },
    { symbol: "MSTR", boerse: "NMS", waehrung: "USD", quelle: "Yahoo" },
  ]);
  if (uebrig.length !== 3) throw new Error("an US-Börsen liefern alle drei");
  if (uebrig[0] !== "MSTR") throw new Error("Yahoo hat die höchste gemessene Verlässlichkeit");
  if (nachAussichtSortiert(
    [{ symbol: "MSTR", boerse: "NMS", waehrung: "USD", quelle: "Yahoo" } as any], quellen,
  )[0].quelle !== "Yahoo") throw new Error("Vorsortierung darf die Quelle nicht verlieren");
});

Deno.test("ein Treffer ohne eingerichtete Kursquelle taucht nicht auf", () => {
  // Sein Symbol gilt in der Notation seines Anbieters; woanders wäre es ein anderes Papier.
  const uebrig = symbole([{ symbol: "CHKP", boerse: "US", waehrung: "USD", quelle: "Irgendwer" }]);
  if (uebrig.length !== 0) throw new Error("ohne Quelle ist ein Kandidat wertlos");
});

Deno.test("Euro schlägt Fremdwährung bei gleicher Quelle", () => {
  const uebrig = symbole([
    { symbol: "CHKP", boerse: "NMS", waehrung: "USD", quelle: "Yahoo" },
    { symbol: "CHKP.SG", boerse: "STU", waehrung: "EUR", quelle: "Yahoo" },
  ]);
  if (uebrig[0] !== "CHKP.SG") throw new Error("der Eurokurs erspart die Abhängigkeit vom Wechselkursdienst");
});
