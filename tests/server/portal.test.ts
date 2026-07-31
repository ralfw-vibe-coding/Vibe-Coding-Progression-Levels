import { createEventStore } from "../../server/eventStore.js";
import { createDateiEventStore } from "../../server/dateiEventStore.js";
import { createDomain } from "../../server/domain.js";
import { createBody } from "../../server/body.js";
import { createPortal } from "../../server/portal.js";

const SCHLUESSEL = "test-schluessel";

// Das Portal wird direkt aufgerufen, ohne echten Deno.serve-Listener: eine Request geht rein,
// eine Response kommt raus. Kein Port, keine Wartezeiten, keine Portkonflikte zwischen parallel
// laufenden Tests — und geprüft wird trotzdem genau das, was auch im Betrieb läuft.
function neuesPortal(eventStore: any = createEventStore()) {
  const body = createBody(createDomain(eventStore));
  return createPortal(body, SCHLUESSEL, `${Deno.cwd()}/client`);
}

function anfrage(pfad: string, optionen: RequestInit & { schluessel?: string | null } = {}) {
  const { schluessel = SCHLUESSEL, ...rest } = optionen;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (schluessel !== null) headers["x-api-key"] = schluessel;
  return new Request(`http://localhost/${pfad.replace(/^\//, "")}`, { ...rest, headers });
}

Deno.test("ohne API-Schlüssel antwortet der API mit 401", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/api/depot", { schluessel: null }));
  if (antwort.status !== 401) throw new Error(`erwartet 401, war ${antwort.status}`);
  await antwort.body?.cancel();
});

Deno.test("mit falschem API-Schlüssel antwortet der API mit 401", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/api/depot", { schluessel: "falsch" }));
  if (antwort.status !== 401) throw new Error(`erwartet 401, war ${antwort.status}`);
  await antwort.body?.cancel();
});

Deno.test("mit gültigem Schlüssel liefert /api/depot das Modell", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/api/depot"));
  if (antwort.status !== 200) throw new Error(`erwartet 200, war ${antwort.status}`);
  const modell = await antwort.json();
  if (!Array.isArray(modell.positionen)) throw new Error("erwartet ein Modell mit positionen");
  if (modell.depotwert !== 0) throw new Error(`erwartet depotwert 0, war ${modell.depotwert}`);
});

Deno.test("ein Kauf über den API landet im Bestand und wird persistiert", async () => {
  // Hier ausnahmsweise der echte Datei-Store: "wird persistiert" lässt sich nur belegen, wenn
  // hinterher etwas auf der Platte steht.
  const verzeichnis = Deno.makeTempDirSync();
  const pfad = `${verzeichnis}/depot-events.json`;
  const portal = neuesPortal(createDateiEventStore(pfad));
  const antwort = await portal.behandeln(anfrage("/api/neue-position", {
    method: "POST",
    body: JSON.stringify({
      wertpapierId: "A", name: "Test AG", typ: "Aktie", broker: "comdirect",
      stueck: 2, kaufkurs: 100, kurs: 110, datum: "2026-07-26",
    }),
  }));
  if (antwort.status !== 200) throw new Error(`erwartet 200, war ${antwort.status}`);
  const { modell } = await antwort.json();
  if (modell.positionen.length !== 1) throw new Error(`erwartet 1 Position, war ${modell.positionen.length}`);
  if (modell.depotwert !== 220) throw new Error(`erwartet depotwert 220, war ${modell.depotwert}`);
  // Der eigentliche Punkt dieser Stufe: nach dem Aufruf steht es auf der Platte, ohne dass
  // jemand exportieren musste.
  const aufDerPlatte = JSON.parse(Deno.readTextFileSync(pfad));
  // Kauf + Kursupdate + Kennzeichnung als manuell (dieser Server hat keine Kursquelle).
  if (aufDerPlatte.length !== 3) throw new Error(`erwartet 3 persistierte Ereignisse, war ${aufDerPlatte.length}`);
  Deno.removeSync(verzeichnis, { recursive: true });
});

Deno.test("GET /api/events liefert die rohen Ereignisse, PUT ersetzt sie", async () => {
  const portal = neuesPortal();
  await portal.behandeln(anfrage("/api/neue-position", {
    method: "POST",
    body: JSON.stringify({ wertpapierId: "ALT", name: "Alt AG", typ: "Aktie", stueck: 1, kaufkurs: 1, kurs: 1, datum: "2026-07-01" }),
  }));

  const neueEvents = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", name: "Neu AG", typ: "Aktie", stueck: 5, kaufkurs: 10, datum: "2026-07-01" } },
    { seq: 2, eventType: "kursupdate", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "X", kurs: 20, datum: "2026-07-02" } },
  ];
  const ersetzt = await portal.behandeln(anfrage("/api/events", { method: "PUT", body: JSON.stringify(neueEvents) }));
  if (ersetzt.status !== 200) throw new Error(`erwartet 200, war ${ersetzt.status}`);
  const modell = await ersetzt.json();
  if (modell.positionen[0].wertpapierId !== "X") throw new Error("alter Bestand darf nicht überleben");

  const gelesen = await portal.behandeln(anfrage("/api/events"));
  const events = await gelesen.json();
  if (events.length !== 2) throw new Error(`erwartet 2 Ereignisse, war ${events.length}`);
});

Deno.test("PUT /api/events lehnt etwas anderes als eine Liste mit 400 ab", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/api/events", { method: "PUT", body: JSON.stringify({ kein: "array" }) }));
  if (antwort.status !== 400) throw new Error(`erwartet 400, war ${antwort.status}`);
  await antwort.body?.cancel();
});

Deno.test("der Verlauf einer Position ist über den API abrufbar, gefiltert nach Broker", async () => {
  const portal = neuesPortal();
  for (const broker of ["comdirect", "Interactive Brokers"]) {
    await portal.behandeln(anfrage("/api/neue-position", {
      method: "POST",
      body: JSON.stringify({ wertpapierId: "A", name: "Test AG", typ: "Aktie", broker, stueck: 1, kaufkurs: 100, kurs: 110, datum: "2026-07-01" }),
    }));
  }
  const antwort = await portal.behandeln(anfrage("/api/verlauf/A?broker=comdirect"));
  const verlauf = await antwort.json();
  const kaeufe = verlauf.filter((e: any) => e.eventType === "kauf");
  if (kaeufe.length !== 1) throw new Error(`erwartet 1 Kauf für comdirect, war ${kaeufe.length}`);
  if (kaeufe[0].broker !== "comdirect") throw new Error(`erwartet comdirect, war ${kaeufe[0].broker}`);
});

Deno.test("ein unbekannter API-Endpunkt antwortet mit 404", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/api/gibtsnicht"));
  if (antwort.status !== 404) throw new Error(`erwartet 404, war ${antwort.status}`);
  await antwort.body?.cancel();
});

Deno.test("die ausgelieferte Seite bekommt den API-Schlüssel mitgegeben", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/"));
  if (antwort.status !== 200) throw new Error(`erwartet 200, war ${antwort.status}`);
  const html = await antwort.text();
  if (!html.includes(`window.__API_KEY__ = "${SCHLUESSEL}"`)) {
    throw new Error("der Schlüssel muss beim Ausliefern in die Seite geschrieben werden");
  }
});

Deno.test("Client-Dateien werden ausgeliefert, aber nichts außerhalb des Verzeichnisses", async () => {
  const portal = neuesPortal();
  const modul = await portal.behandeln(anfrage("/body.js"));
  if (modul.status !== 200) throw new Error(`erwartet 200 für /body.js, war ${modul.status}`);
  if (!modul.headers.get("content-type")?.includes("javascript")) {
    throw new Error(`erwartet einen JavaScript-Content-Type, war ${modul.headers.get("content-type")}`);
  }
  await modul.body?.cancel();

  const ausbruch = await portal.behandeln(anfrage("/../server/main.js"));
  if (ausbruch.status !== 404) throw new Error(`erwartet 404 für einen Ausbruchsversuch, war ${ausbruch.status}`);
  await ausbruch.body?.cancel();
});
