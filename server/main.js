// Kompositionswurzel des Servers: der einzige Ort, an dem die Server-Module zusammengesteckt
// werden — das Gegenstück zum Kompositionsskript, das bisher in der index.html stand.
import { fileURLToPath } from "node:url";
import { createSqliteEventStore } from "./sqliteEventStore.js";
import { createPostgresEventStore } from "./postgresEventStore.js";
import { createDomain } from "./domain.js";
import { createApiKeyProvider } from "./apiKeyProvider.js";
import { createBody } from "./body.js";
import { createPortal } from "./portal.js";
import { createYahooKursProvider, createYahooSymbolSuche } from "./yahooKursProvider.js";
import { createTwelveDataKursProvider, createTwelveDataSymbolSuche } from "./twelveDataKursProvider.js";
import { createFinnhubKursProvider, createFinnhubSymbolSuche } from "./finnhubProvider.js";
import { createVerketteteSymbolSuche } from "./symbolSuche.js";
import { createWechselkursProvider } from "./wechselkursProvider.js";
import { createSqliteNutzerVerzeichnis } from "./sqliteNutzerVerzeichnis.js";
import { createPostgresNutzerVerzeichnis } from "./postgresNutzerVerzeichnis.js";
import { createSitzungsToken } from "./sitzungsToken.js";
import { createResendMailProvider, createKonsolenMailProvider } from "./resendMailProvider.js";
import { createAnmeldung } from "./anmeldung.js";

// Pfade relativ zu dieser Datei statt zum Arbeitsverzeichnis: der Server läuft dann von
// überall aus. fileURLToPath statt .pathname, weil letzteres Sonderzeichen im Pfad
// (z. B. Leerzeichen) kodiert lässt und daraus echte Verzeichnisnamen würden.
const DATEN = fileURLToPath(new URL("./data", import.meta.url));
const CLIENT = fileURLToPath(new URL("../client", import.meta.url));
const PORT = Number(Deno.env.get("PORT") ?? 8000);

// Der Event-Store bringt seinen bisherigen Bestand schon mit, sobald er erzeugt ist — es gibt
// keinen zusätzlichen Ladeschritt mehr, den man vergessen könnte.
//
// Wo die Ereignisse liegen, entscheidet sich hier und nur hier: Ist eine Postgres-Datenbank
// eingerichtet, wird sie benutzt, sonst die SQLite-Datei nebenan. Dasselbe Muster wie bei den
// Kursquellen weiter unten — was fehlt, fehlt eben, und die Anwendung läuft trotzdem. Ein
// frischer Klon ohne .env bekommt weiterhin ein Depot, das ohne jede Einrichtung funktioniert.
const datenbankUrl = Deno.env.get("DATABASE_URL");
const eventStore = datenbankUrl
  ? await createPostgresEventStore(datenbankUrl)
  : createSqliteEventStore(`${DATEN}/depot.sqlite`);
const domain = createDomain(eventStore);

// Die eingerichteten Kursquellen, unter ihrem Namen ansprechbar. Jede Position merkt sich,
// bei welcher sie abgefragt werden will — reihum probieren gibt es nicht mehr: Ein Kurs
// gehört zu einem Handelsplatz, und wer ihn woanders herholt, bekommt eine andere Zahl.
const twelveDataSchluessel = Deno.env.get("TWELVE_DATA_API_KEY");
const finnhubSchluessel = Deno.env.get("FINNHUB_API_KEY");
const kursquellen = Object.fromEntries([
  twelveDataSchluessel ? ["Twelve Data", createTwelveDataKursProvider(twelveDataSchluessel)] : null,
  finnhubSchluessel ? ["Finnhub", createFinnhubKursProvider(finnhubSchluessel)] : null,
  ["Yahoo", createYahooKursProvider()],
].filter(Boolean));

// Die Symbolsuche ist ein eigener Baustein mit eigenem Vertrag: Sie wird nicht verkettet,
// sondern zusammengeführt — mehrere Quellen kennen dasselbe Papier an verschiedenen
// Handelsplätzen, und erst diese Auswahl macht die Suche brauchbar.
//
// Finnhub steht hier vorn, weil es als einziges auch deutsche ISINs auflöst. Als *Kursquelle*
// taugt es dagegen nur für US-Börsen — dass beides getrennt ist, macht genau diese Mischung
// erst möglich: den einen Teil eines Anbieters nutzen, den anderen weglassen.
const symbolSuche = createVerketteteSymbolSuche(...[
  finnhubSchluessel ? createFinnhubSymbolSuche(finnhubSchluessel) : null,
  twelveDataSchluessel ? createTwelveDataSymbolSuche(twelveDataSchluessel) : null,
  createYahooSymbolSuche(),
].filter(Boolean));

const wechselkurse = createWechselkursProvider();

const body = createBody(domain, kursquellen, wechselkurse, symbolSuche);

// Der Datei-Provider setzt eine eigene, dauerhafte Platte voraus — genau die Annahme, die
// Stufe 11 für die Ereignisse schon aufgegeben hat. Ein deployter Server hat keine: Jeder
// Neustart bekäme einen neuen Schlüssel, jeder gespeicherte curl-Aufruf bräche. Deshalb dasselbe
// Muster wie bei DATABASE_URL — ist BACKEND_API_KEY gesetzt, gilt er, ohne dass je eine Datei
// angefasst wird. Lokal ohne diese Variable bleibt der bisherige Weg bestehen: einmal erzeugen,
// in server/data/api-key.txt ablegen, bei jedem Start wiederverwenden.
const vorgegebenerApiKey = Deno.env.get("BACKEND_API_KEY");
const apiKey = vorgegebenerApiKey ?? await createApiKeyProvider(`${DATEN}/api-key.txt`).holenOderErzeugen();

// Die Nutzerliste liegt neben dem Depot, nicht darin — dieselbe Wahl wie beim Event-Store, aus
// demselben Grund: Auf einer Deploy-Plattform gibt es keine eigene Platte, und ein Einmalcode
// im Arbeitsspeicher wäre bei der Einlösung womöglich bei einer anderen Instanz.
const nutzerVerzeichnis = datenbankUrl
  ? await createPostgresNutzerVerzeichnis(datenbankUrl)
  : createSqliteNutzerVerzeichnis(`${DATEN}/nutzer.sqlite`);

// Ohne Resend-Schlüssel wird lokal auf die Konsole verschickt — praktisch, um den Code beim
// Entwickeln abzulesen. Deployt wäre das gefährlich: Anmeldecodes stünden dann im Protokoll,
// das mehr Leute sehen als das Postfach des Empfängers. Dort gibt es deshalb lieber keinen
// Versand, und man kommt über den Dauer-Einmalcode oder den API-Schlüssel herein.
const resendSchluessel = Deno.env.get("RESEND_API_KEY");
const aufDeploy = Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
const mail = resendSchluessel
  ? createResendMailProvider(resendSchluessel, { absender: Deno.env.get("AUTH_FROM_EMAIL") })
  : (aufDeploy ? null : createKonsolenMailProvider());

// Ohne Sitzungsgeheimnis lässt sich kein Ausweis ausstellen. Eines zu würfeln wäre schlimmer als
// keines: Bei mehreren Instanzen hätte jede ein anderes, und jeder Neustart entwertete alle
// Sitzungen — ein Fehler, der wie ein Zufall aussieht.
const sitzungsGeheimnis = Deno.env.get("AUTH_SESSION_SECRET");
const sitzungsToken = sitzungsGeheimnis
  ? await createSitzungsToken(sitzungsGeheimnis, { gueltigkeitSekunden: Number(Deno.env.get("JWT_TTL_SECONDS") ?? 604_800) })
  : null;

const anmeldung = sitzungsToken
  ? createAnmeldung(nutzerVerzeichnis, mail, sitzungsToken, {
    adminEmail: Deno.env.get("ADMIN_EMAIL"),
    dauerOtp: Deno.env.get("AUTH_SECRET_OTP"),
  })
  : null;

const portal = createPortal(body, apiKey, CLIENT, anmeldung);

console.log(`Mein Depot läuft auf http://localhost:${PORT}`);
// Woher die Ereignisse kommen, ist die folgenreichste Entscheidung beim Start — sie gehört
// sichtbar in die erste Zeile. Die Verbindungsangabe selbst nicht: Sie enthält ein Passwort.
console.log(`Speicher:     ${datenbankUrl ? "Postgres (DATABASE_URL)" : `SQLite (${DATEN}/depot.sqlite)`}`);
console.log(`Kursquellen:  ${Object.keys(kursquellen).join(', ')}`);
console.log(`Symbolsuche:  ${symbolSuche.name}`);
for (const [name, variable] of [["Twelve Data", "TWELVE_DATA_API_KEY"], ["Finnhub", "FINNHUB_API_KEY"]]) {
  if (!Deno.env.get(variable)) console.log(`  (${name} fehlt: ${variable} nicht gesetzt)`);
}
console.log(`Nutzerliste:  ${datenbankUrl ? "Postgres (DATABASE_URL)" : `SQLite (${DATEN}/nutzer.sqlite)`}`);
console.log(`Verwalter:    ${Deno.env.get("ADMIN_EMAIL") ?? "— (ADMIN_EMAIL nicht gesetzt)"}`);
console.log(`Anmeldung:    ${
  !sitzungsToken
    ? "aus (AUTH_SESSION_SECRET nicht gesetzt)"
    : `per Einmalcode über ${mail ? mail.name : "— kein Versand"}, Sitzung ${
      Math.round(Number(Deno.env.get("JWT_TTL_SECONDS") ?? 604_800) / 86_400)
    } Tage`
}`);
// Ob ein Dauer-Einmalcode eingerichtet ist, gehört in die Startmeldung — sein Wert nicht. Anders
// als der API-Schlüssel, der ausgedruckt wird, weil er zum Weitergeben an curl gedacht ist, ist
// dieser ein Generalschlüssel, den niemand aus einem Protokoll ablesen können soll.
if (sitzungsToken && !Deno.env.get("AUTH_SECRET_OTP")) console.log("  (kein Dauer-Einmalcode: AUTH_SECRET_OTP nicht gesetzt)");
if (sitzungsToken && !mail) console.log("  (kein Mailversand — Anmeldung nur über den Dauer-Einmalcode möglich)");
console.log(`API-Schlüssel: ${apiKey}${vorgegebenerApiKey ? " (BACKEND_API_KEY)" : ` (${DATEN}/api-key.txt)`}`);
console.log(`Beispiel: curl -H "X-API-Key: ${apiKey}" http://localhost:${PORT}/api/depot`);

Deno.serve({ port: PORT }, (request) => portal.behandeln(request));
