// Einmaliger Umzug: übernimmt einen vorhandenen Ereignisbestand aus der JSON-Datei von Stufe 7
// in die SQLite-Datenbank dieser Stufe.
//
// Warum ein eigenes Skript und nicht automatisch beim Serverstart? Weil Daten umziehen etwas
// anderes ist als Daten benutzen. Ein Server, der beim Hochfahren stillschweigend Bestände
// verschiebt, tut zu viel — und man merkt es erst, wenn etwas schiefgegangen ist. Hier ist es
// ein sichtbarer Schritt, den man bewusst auslöst und dessen Ergebnis man abliest.
//
// Aufruf: deno task migriere
import { fileURLToPath } from "node:url";
import { createSqliteEventStore } from "./sqliteEventStore.js";

// fileURLToPath statt .pathname, weil letzteres Sonderzeichen im Pfad kodiert lässt —
// ein Leerzeichen käme sonst als "%20" an und keine Datei würde gefunden.
const DATEN = fileURLToPath(new URL("./data", import.meta.url));
const JSON_DATEI = `${DATEN}/depot-events.json`;
const DATENBANK = `${DATEN}/depot.sqlite`;

function lesen(pfad) {
  try {
    return JSON.parse(Deno.readTextFileSync(pfad));
  } catch (fehler) {
    if (fehler instanceof Deno.errors.NotFound) return null;
    throw fehler;
  }
}

const events = lesen(JSON_DATEI);
if (events === null) {
  console.log(`Nichts zu tun: ${JSON_DATEI} gibt es nicht.`);
  Deno.exit(0);
}
if (!Array.isArray(events)) {
  console.error(`Abbruch: ${JSON_DATEI} enthält keine Ereignisliste.`);
  Deno.exit(1);
}

const store = createSqliteEventStore(DATENBANK);
const vorhanden = await store.query();

// Einen vorhandenen Bestand zu überschreiben wäre der einzige Weg, hier Daten zu verlieren —
// also passiert es nicht ohne ausdrückliche Ansage.
if (vorhanden.length > 0 && !Deno.args.includes("--ueberschreiben")) {
  console.error(`Abbruch: Die Datenbank enthält bereits ${vorhanden.length} Ereignisse.`);
  console.error("Zum Ersetzen: deno task migriere --ueberschreiben");
  Deno.exit(1);
}

await store.restore(events);

const danach = await store.query();
console.log(`${danach.length} Ereignisse übernommen: ${JSON_DATEI} -> ${DATENBANK}`);
console.log(`Die JSON-Datei bleibt unangetastet und kann als Sicherung liegen bleiben.`);
