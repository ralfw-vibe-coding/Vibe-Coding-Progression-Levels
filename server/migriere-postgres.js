// Einmaliger Umzug: übernimmt einen vorhandenen Ereignisbestand aus der lokalen
// SQLite-Datenbank von Stufe 8 in die Postgres-Datenbank dieser Stufe.
//
// Warum ein eigenes Skript und nicht automatisch beim Serverstart? Weil Daten umziehen etwas
// anderes ist als Daten benutzen. Ein Server, der beim Hochfahren stillschweigend Bestände
// verschiebt, tut zu viel — und man merkt es erst, wenn etwas schiefgegangen ist. Hier ist es
// ein sichtbarer Schritt, den man bewusst auslöst und dessen Ergebnis man abliest.
//
// Der Vorgang ist derselbe wie beim Umzug von JSON nach SQLite (migriere.js) — und das ist die
// eigentliche Pointe: Weil beide Seiten denselben Vertrag erfüllen, ist ein Umzug nichts
// weiter als das query der einen und das restore der anderen Ausprägung. Ob dazwischen ein
// Dateisystem oder ein Netz liegt, spielt keine Rolle.
//
// Aufruf: deno task migriere-postgres
import { fileURLToPath } from "node:url";
import { createSqliteEventStore } from "./sqliteEventStore.js";
import { createPostgresEventStore } from "./postgresEventStore.js";

// fileURLToPath statt .pathname, weil letzteres Sonderzeichen im Pfad kodiert lässt —
// ein Leerzeichen käme sonst als "%20" an und keine Datei würde gefunden.
const DATEN = fileURLToPath(new URL("./data", import.meta.url));
const DATENBANK = `${DATEN}/depot.sqlite`;

const datenbankUrl = Deno.env.get("DATABASE_URL");
if (!datenbankUrl) {
  console.error("Abbruch: DATABASE_URL ist nicht gesetzt.");
  console.error("Vorher: set -a; . ./.env; set +a");
  Deno.exit(1);
}

const quelle = createSqliteEventStore(DATENBANK);
const events = await quelle.query();
if (events.length === 0) {
  console.log(`Nichts zu tun: ${DATENBANK} enthält keine Ereignisse.`);
  Deno.exit(0);
}

const ziel = await createPostgresEventStore(datenbankUrl);
const vorhanden = await ziel.query();

// Einen vorhandenen Bestand zu überschreiben wäre der einzige Weg, hier Daten zu verlieren —
// also passiert es nicht ohne ausdrückliche Ansage.
if (vorhanden.length > 0 && !Deno.args.includes("--ueberschreiben")) {
  console.error(`Abbruch: Die Postgres-Datenbank enthält bereits ${vorhanden.length} Ereignisse.`);
  console.error("Zum Ersetzen: deno task migriere-postgres --ueberschreiben");
  await ziel.schliessen();
  Deno.exit(1);
}

await ziel.restore(events);

const danach = await ziel.query();
console.log(`${danach.length} Ereignisse übernommen: ${DATENBANK} -> Postgres`);
console.log("Die SQLite-Datenbank bleibt unangetastet und kann als Sicherung liegen bleiben.");
await ziel.schliessen();
