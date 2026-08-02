import { createEventStore } from "../../server/eventStore.js";
import { createDateiEventStore } from "../../server/dateiEventStore.js";
import { createDomain } from "../../server/domain.js";
import { createBody } from "../../server/body.js";
import { createPortal } from "../../server/portal.js";
import { createNutzerVerzeichnis } from "../../server/nutzerVerzeichnis.js";
import { createSimulierterMailProvider } from "../../server/resendMailProvider.js";
import { createSitzungsToken } from "../../server/sitzungsToken.js";
import { createAnmeldung } from "../../server/anmeldung.js";

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

// Bis Stufe 12 stand hier das Gegenteil: dass der Schlüssel beim Ausliefern in die Seite
// geschrieben *wird*. Unter einer öffentlichen Adresse war das ein Leck — jeder Besucher bekam
// vollen Zugriff geschenkt. Der Test hat den Zustand also korrekt beschrieben und ihn dadurch
// festgeschrieben; nur war der Zustand falsch. Jetzt beschreibt er die Umkehrung.
Deno.test("die ausgelieferte Seite enthält kein Geheimnis", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(anfrage("/"));
  if (antwort.status !== 200) throw new Error(`erwartet 200, war ${antwort.status}`);
  const html = await antwort.text();
  if (html.includes(SCHLUESSEL)) throw new Error("der API-Schlüssel darf nicht in der Seite stehen");
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

// --- Anmeldung, Token und Berechtigung ------------------------------------------------------

const ADMIN = "chef@example.com";
const GEHEIMNIS = "u5Hmt2sXhroxzSp3Vl5IuB5XDpQdgd3bgzSlsL3q4dM=";

async function portalMitAnmeldung({ zugelassene = [] as string[] } = {}) {
  const verzeichnis = createNutzerVerzeichnis(zugelassene);
  const mail = createSimulierterMailProvider();
  const token = await createSitzungsToken(GEHEIMNIS);
  const anmeldung = createAnmeldung(verzeichnis, mail, token, { adminEmail: ADMIN });
  const body = createBody(createDomain(createEventStore()));
  return {
    portal: createPortal(body, SCHLUESSEL, `${Deno.cwd()}/client`, anmeldung),
    mail,
    token,
    anmeldung,
  };
}

// Ohne Ausweis, für die offenen Endpunkte.
function offeneAnfrage(pfad: string, daten: unknown) {
  return new Request(`http://localhost${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(daten),
  });
}

function mitToken(pfad: string, token: string, optionen: RequestInit = {}) {
  return new Request(`http://localhost${pfad}`, {
    ...optionen,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
}

async function angemeldetAls(p: any, email: string) {
  await p.portal.behandeln(offeneAnfrage("/api/anmeldung/code", { email }));
  const code = p.mail.gesendet.at(-1).betreff.match(/(\d{6})/)[1];
  const antwort = await p.portal.behandeln(offeneAnfrage("/api/anmeldung/einloesen", { email, code }));
  return (await antwort.json()).token;
}

// Das Tor gegen künftige Endpunkte: Wer einen neuen /api/-Pfad ergänzt, ohne ihn bewusst in die
// Liste der offenen aufzunehmen, bekommt hier einen roten Test statt einer offenen Tür.
Deno.test("jeder Endpunkt außer den Anmeldungen verlangt einen Ausweis", async () => {
  const { portal } = await portalMitAnmeldung();
  const geschuetzt = [
    ["/api/depot", "GET"], ["/api/events", "GET"], ["/api/events", "PUT"],
    ["/api/kauf", "POST"], ["/api/kursupdate", "POST"], ["/api/neue-position", "POST"],
    ["/api/symbol-suche?q=x", "GET"], ["/api/kursbezug", "POST"], ["/api/kursbezug-pruefen", "POST"],
    ["/api/kurse-aktualisieren", "POST"], ["/api/verlauf/A", "GET"], ["/api/ich", "GET"],
    ["/api/nutzer", "GET"], ["/api/nutzer", "POST"], ["/api/nutzer/a@b.de", "DELETE"],
  ];
  for (const [pfad, methode] of geschuetzt) {
    const antwort = await portal.behandeln(
      new Request(`http://localhost${pfad}`, { method: methode, headers: { "content-type": "application/json" }, body: methode === "GET" || methode === "DELETE" ? null : "{}" }),
    );
    await antwort.body?.cancel();
    if (antwort.status !== 401) throw new Error(`${methode} ${pfad}: erwartet 401, war ${antwort.status}`);
  }
});

Deno.test("die beiden Anmeldeendpunkte sind ohne Ausweis erreichbar", async () => {
  const { portal } = await portalMitAnmeldung();
  for (const [pfad, erwartet] of [["/api/anmeldung/code", 404], ["/api/anmeldung/einloesen", 401]]) {
    const antwort = await portal.behandeln(offeneAnfrage(pfad as string, { email: "fremd@example.com", code: "x" }));
    await antwort.body?.cancel();
    // Nicht 401 wegen fehlenden Ausweises, sondern die fachliche Antwort des Endpunkts selbst.
    if (antwort.status !== erwartet) throw new Error(`${pfad}: erwartet ${erwartet}, war ${antwort.status}`);
  }
});

Deno.test("mit gültigem Token liefert /api/depot das Modell", async () => {
  const p = await portalMitAnmeldung();
  const token = await angemeldetAls(p, ADMIN);
  const antwort = await p.portal.behandeln(mitToken("/api/depot", token));
  if (antwort.status !== 200) throw new Error(`erwartet 200, war ${antwort.status}`);
  await antwort.body?.cancel();
});

Deno.test("ein verfälschtes Token wird abgelehnt", async () => {
  const p = await portalMitAnmeldung();
  const token = await angemeldetAls(p, ADMIN);
  const antwort = await p.portal.behandeln(mitToken("/api/depot", `${token}x`));
  await antwort.body?.cancel();
  if (antwort.status !== 401) throw new Error(`erwartet 401, war ${antwort.status}`);
});

Deno.test("/api/ich nennt Adresse und Verwalterstatus", async () => {
  const p = await portalMitAnmeldung({ zugelassene: ["partner@example.com"] });

  const alsAdmin = await p.portal.behandeln(mitToken("/api/ich", await angemeldetAls(p, ADMIN)));
  const ich = await alsAdmin.json();
  if (ich.email !== ADMIN || ich.istAdmin !== true) throw new Error(`unerwartet: ${JSON.stringify(ich)}`);

  const alsPartner = await p.portal.behandeln(mitToken("/api/ich", await angemeldetAls(p, "partner@example.com")));
  const partner = await alsPartner.json();
  if (partner.istAdmin !== false) throw new Error("ein gewöhnlicher Nutzer ist kein Verwalter");
});

// 403 statt 401: erkannt, aber nicht befugt.
Deno.test("die Nutzerverwaltung ist für gewöhnliche Nutzer gesperrt", async () => {
  const p = await portalMitAnmeldung({ zugelassene: ["partner@example.com"] });
  const token = await angemeldetAls(p, "partner@example.com");
  const antwort = await p.portal.behandeln(mitToken("/api/nutzer", token));
  await antwort.body?.cancel();
  if (antwort.status !== 403) throw new Error(`erwartet 403, war ${antwort.status}`);
});

Deno.test("der API-Schlüssel gilt als Verwalter und darf die Liste pflegen", async () => {
  // Wer den Schlüssel hat, betreibt die Anwendung — ihm die Verwaltung zu verweigern hieße,
  // dass sich die Liste per Skript nicht in Gang bringen ließe.
  const { portal } = await portalMitAnmeldung();
  const angelegt = await portal.behandeln(anfrage("/api/nutzer", { method: "POST", body: JSON.stringify({ email: "neu@example.com" }) }));
  const liste = await angelegt.json();
  if (liste.length !== 1 || liste[0].email !== "neu@example.com") throw new Error(`unerwartet: ${JSON.stringify(liste)}`);

  const entfernt = await portal.behandeln(anfrage("/api/nutzer/neu%40example.com", { method: "DELETE" }));
  if ((await entfernt.json()).length !== 0) throw new Error("das Entfernen muss wirken");
});

// Der Grund, warum bei jeder Anfrage geprüft wird, ob die Adresse noch zugelassen ist — und
// nicht nur, ob das Token echt ist.
Deno.test("ein gültiges Token einer gesperrten Adresse verliert sofort seine Wirkung", async () => {
  const p = await portalMitAnmeldung({ zugelassene: ["partner@example.com"] });
  const token = await angemeldetAls(p, "partner@example.com");

  const vorher = await p.portal.behandeln(mitToken("/api/depot", token));
  await vorher.body?.cancel();
  if (vorher.status !== 200) throw new Error("vor dem Sperren muss der Zugriff klappen");

  await p.anmeldung.sperren("partner@example.com");

  const nachher = await p.portal.behandeln(mitToken("/api/depot", token));
  await nachher.body?.cancel();
  if (nachher.status !== 401) throw new Error(`nach dem Sperren erwartet 401, war ${nachher.status}`);
});

Deno.test("ohne eingerichtete Anmeldung antworten die Anmeldeendpunkte mit 503", async () => {
  const portal = neuesPortal();
  const antwort = await portal.behandeln(offeneAnfrage("/api/anmeldung/code", { email: ADMIN }));
  await antwort.body?.cancel();
  if (antwort.status !== 503) throw new Error(`erwartet 503, war ${antwort.status}`);
});
