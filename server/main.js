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

const apiKeys = createApiKeyProvider(`${DATEN}/api-key.txt`);
const apiKey = await apiKeys.holenOderErzeugen();
const portal = createPortal(body, apiKey, CLIENT);

console.log(`Mein Depot läuft auf http://localhost:${PORT}`);
// Woher die Ereignisse kommen, ist die folgenreichste Entscheidung beim Start — sie gehört
// sichtbar in die erste Zeile. Die Verbindungsangabe selbst nicht: Sie enthält ein Passwort.
console.log(`Speicher:     ${datenbankUrl ? "Postgres (DATABASE_URL)" : `SQLite (${DATEN}/depot.sqlite)`}`);
console.log(`Kursquellen:  ${Object.keys(kursquellen).join(', ')}`);
console.log(`Symbolsuche:  ${symbolSuche.name}`);
for (const [name, variable] of [["Twelve Data", "TWELVE_DATA_API_KEY"], ["Finnhub", "FINNHUB_API_KEY"]]) {
  if (!Deno.env.get(variable)) console.log(`  (${name} fehlt: ${variable} nicht gesetzt)`);
}
console.log(`API-Schlüssel: ${apiKey}`);
console.log(`Beispiel: curl -H "X-API-Key: ${apiKey}" http://localhost:${PORT}/api/depot`);

Deno.serve({ port: PORT }, (request) => portal.behandeln(request));
