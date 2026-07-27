// Kompositionswurzel des Servers: der einzige Ort, an dem die Server-Module zusammengesteckt
// werden — das Gegenstück zum Kompositionsskript, das bisher in der index.html stand.
import { fileURLToPath } from "node:url";
import { createDateiEventStore } from "./dateiEventStore.js";
import { createDomain } from "./domain.js";
import { createApiKeyProvider } from "./apiKeyProvider.js";
import { createBody } from "./body.js";
import { createPortal } from "./portal.js";

// Pfade relativ zu dieser Datei statt zum Arbeitsverzeichnis: der Server läuft dann von
// überall aus. fileURLToPath statt .pathname, weil letzteres Sonderzeichen im Pfad
// (z. B. Leerzeichen) kodiert lässt und daraus echte Verzeichnisnamen würden.
const DATEN = fileURLToPath(new URL("./data", import.meta.url));
const CLIENT = fileURLToPath(new URL("../client", import.meta.url));
const PORT = Number(Deno.env.get("PORT") ?? 8000);

// Der Event-Store bringt seinen bisherigen Bestand schon mit, sobald er erzeugt ist — es gibt
// keinen zusätzlichen Ladeschritt mehr, den man vergessen könnte.
const eventStore = createDateiEventStore(`${DATEN}/depot-events.json`);
const domain = createDomain(eventStore);
const body = createBody(domain);

const apiKeys = createApiKeyProvider(`${DATEN}/api-key.txt`);
const apiKey = await apiKeys.holenOderErzeugen();
const portal = createPortal(body, apiKey, CLIENT);

console.log(`Mein Depot läuft auf http://localhost:${PORT}`);
console.log(`API-Schlüssel: ${apiKey}`);
console.log(`Beispiel: curl -H "X-API-Key: ${apiKey}" http://localhost:${PORT}/api/depot`);

Deno.serve({ port: PORT }, (request) => portal.behandeln(request));
