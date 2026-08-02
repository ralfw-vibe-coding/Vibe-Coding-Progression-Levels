import { createBackendProxyProvider } from "../../client/backendProxyProvider.js";

// fetchFn wird eingespeist — kein DOM, kein Server. Erst dadurch ist dieses Modul überhaupt
// prüfbar; bis Stufe 12 hing es fest am globalen fetch.
function fakeFetch(antworten: Response[] | (() => Response)) {
  const aufrufe: { url: string; optionen: any }[] = [];
  let i = 0;
  const fn = (url: any, optionen: any) => {
    aufrufe.push({ url: String(url), optionen });
    const antwort = typeof antworten === "function" ? antworten() : antworten[Math.min(i++, antworten.length - 1)];
    return Promise.resolve(antwort);
  };
  return { fn, aufrufe };
}

const ok = (daten: unknown = {}) => new Response(JSON.stringify(daten), { status: 200 });

Deno.test("ohne Token geht kein Ausweis mit", async () => {
  const { fn, aufrufe } = fakeFetch([ok({ versendet: true })]);
  const backend = createBackendProxyProvider("", { fetchFn: fn as any });

  await backend.codeAnfordern("a@example.com");
  if (aufrufe[0].optionen.headers.authorization !== undefined) {
    throw new Error("vor der Anmeldung darf kein Ausweis mitgehen");
  }
});

Deno.test("nach tokenSetzen steht der Ausweis in jeder Anfrage", async () => {
  const { fn, aufrufe } = fakeFetch(() => ok({}));
  const backend = createBackendProxyProvider("", { fetchFn: fn as any });
  backend.tokenSetzen("abc.def.ghi");

  await backend.depotAbfragen();
  await backend.kurseAktualisieren();

  for (const { optionen } of aufrufe) {
    if (optionen.headers.authorization !== "Bearer abc.def.ghi") {
      throw new Error(`erwartet den Ausweis in jeder Anfrage, war ${optionen.headers.authorization}`);
    }
  }
});

// Der einzige Statuscode mit eigener Bedeutung: Die Sitzung ist weg. Das Token wegzuwerfen ist
// wichtiger als die Meldung — sonst versuchte es der nächste Aufruf mit demselben untauglichen
// Ausweis noch einmal.
Deno.test("bei 401 wird das Token verworfen und der Rückruf ausgelöst", async () => {
  let gerufen = 0;
  const { fn, aufrufe } = fakeFetch(() => new Response(JSON.stringify({ fehler: "weg" }), { status: 401 }));
  const backend = createBackendProxyProvider("", { fetchFn: fn as any, beiAbgelaufenerSitzung: () => gerufen++ });
  backend.tokenSetzen("abc.def.ghi");

  const fehler = await backend.depotAbfragen().then(() => null, (f: Error) => f);
  if (fehler === null) throw new Error("ein 401 muss auffallen");
  if (!fehler.message.includes("Sitzung")) throw new Error(`unerwartete Meldung: ${fehler.message}`);
  if (gerufen !== 1) throw new Error(`erwartet einen Rückruf, war ${gerufen}`);

  await backend.depotAbfragen().catch(() => {});
  if (aufrufe[1].optionen.headers.authorization !== undefined) {
    throw new Error("das untaugliche Token muss verworfen sein");
  }
});

Deno.test("die Fehlermeldung des Servers wird durchgereicht", async () => {
  const { fn } = fakeFetch([new Response(JSON.stringify({ fehler: "Diese Adresse ist nicht freigeschaltet." }), { status: 404 })]);
  const backend = createBackendProxyProvider("", { fetchFn: fn as any });

  const fehler = await backend.codeAnfordern("fremd@example.com").then(() => null, (f: Error) => f);
  if (fehler?.message !== "Diese Adresse ist nicht freigeschaltet.") {
    throw new Error(`erwartet den Klartext des Servers, war: ${fehler?.message}`);
  }
});

Deno.test("die Anmeldeaufrufe treffen die richtigen Pfade", async () => {
  const { fn, aufrufe } = fakeFetch(() => ok({ token: "t" }));
  const backend = createBackendProxyProvider("", { fetchFn: fn as any });

  await backend.codeAnfordern("a@example.com");
  await backend.codeEinloesen("a@example.com", "123456");
  await backend.ichAbfragen();

  if (!aufrufe[0].url.endsWith("/api/anmeldung/code")) throw new Error(`unerwartet: ${aufrufe[0].url}`);
  if (!aufrufe[1].url.endsWith("/api/anmeldung/einloesen")) throw new Error(`unerwartet: ${aufrufe[1].url}`);
  if (!aufrufe[2].url.endsWith("/api/ich")) throw new Error(`unerwartet: ${aufrufe[2].url}`);
  if (JSON.parse(aufrufe[1].optionen.body).code !== "123456") throw new Error("der Code muss mitgehen");
});

Deno.test("eine Adresse mit Sonderzeichen wird beim Sperren kodiert", async () => {
  const { fn, aufrufe } = fakeFetch(() => ok([]));
  const backend = createBackendProxyProvider("", { fetchFn: fn as any });

  await backend.nutzerSperren("a+b@example.com");
  if (!aufrufe[0].url.endsWith("/api/nutzer/a%2Bb%40example.com")) throw new Error(`unerwartet: ${aufrufe[0].url}`);
  if (aufrufe[0].optionen.method !== "DELETE") throw new Error("erwartet DELETE");
});
