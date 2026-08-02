import { createPostgresNutzerVerzeichnis } from "../../server/postgresNutzerVerzeichnis.js";
import { pruefeNutzerVerzeichnisVertrag } from "./nutzerVerzeichnisVertrag.ts";

// Derselbe Vertrag wie bei den anderen beiden Ausprägungen. Wie bei den Postgres-Tests des
// Event-Store brauchen diese eine Zugangsangabe; fehlt sie, laufen sie nicht. Ein frischer Klon
// ohne .env soll eine grüne Suite sehen und keine Hausaufgabe.
const DATENBANK_URL = Deno.env.get("DATABASE_URL");
const UEBERSPRINGEN = !DATENBANK_URL;

if (UEBERSPRINGEN) {
  console.log("Postgres-Tests des Nutzerverzeichnisses übersprungen: DATABASE_URL ist nicht gesetzt (vor dem Testlauf: set -a; . ./.env; set +a).");
}

// Eigene Tabellen, nicht die des Betriebs. Die Vertragstests leeren ihr Verzeichnis zu Beginn
// jedes Falls — täten sie das in "nutzer", wäre die Zugangsliste weg und niemand käme mehr
// herein. Der Präfix ist deshalb kein Komfort, sondern die Trennlinie zwischen Prüfen und
// Aussperren.
const TESTPRAEFIX = "nutzer_test";

async function testVerzeichnis(zugelassene: string[] = []) {
  const verzeichnis = await createPostgresNutzerVerzeichnis(DATENBANK_URL!, { tabellenPraefix: TESTPRAEFIX });
  await leeren(verzeichnis);
  for (const email of zugelassene) await verzeichnis.zulassen(email);
  return {
    verzeichnis,
    // Anders als bei den lokalen Ausprägungen muss hier wirklich aufgeräumt werden: Eine offene
    // Netzwerkverbindung überlebt den Test und lässt ihn als undicht auffallen. Und die Tabellen
    // bleiben leer zurück — sie liegen in derselben Datenbank wie der Betrieb.
    async aufraeumen() {
      await leeren(verzeichnis);
      await verzeichnis.schliessen();
    },
  };
}

// Über den Vertrag selbst leeren, statt eine eigene SQL-Anweisung danebenzustellen: So bleibt
// dieser Test frei von Wissen über das Schema, das er gar nicht prüfen will.
async function leeren(verzeichnis: any) {
  for (const { email } of await verzeichnis.zugelasseneAuflisten()) await verzeichnis.sperren(email);
  await verzeichnis.abgelaufeneCodesEntfernen(new Date(Date.now() + 3_600_000).toISOString());
}

pruefeNutzerVerzeichnisVertrag("Nutzerverzeichnis in Postgres", testVerzeichnis, { ignore: UEBERSPRINGEN });

// Darüber hinaus das, was nur diese Ausprägung ausmacht.
Deno.test({
  name: "zwei Verbindungen sehen dieselbe Liste (simulierte zweite Instanz)",
  ignore: UEBERSPRINGEN,
  async fn() {
    // Genau der Fall, wegen dem diese Ausprägung existiert: Auf einer Deploy-Plattform kann die
    // Anwendung mehrfach laufen. Wer bei der einen Instanz einen Code anfordert, muss ihn bei
    // der anderen einlösen können.
    const { verzeichnis: eine, aufraeumen } = await testVerzeichnis();
    const andere = await createPostgresNutzerVerzeichnis(DATENBANK_URL!, { tabellenPraefix: TESTPRAEFIX });
    try {
      const gueltigBis = new Date(Date.now() + 600_000).toISOString();
      await eine.codeHinterlegen({ email: "a@example.com", codeHash: "abc123", gueltigBis });

      const eintrag: any = await andere.codeHolen("a@example.com");
      if (eintrag === null || eintrag.codeHash !== "abc123") {
        throw new Error(`die zweite Verbindung muss denselben Code sehen, war ${JSON.stringify(eintrag)}`);
      }
    } finally {
      await andere.schliessen();
      await aufraeumen();
    }
  },
});

Deno.test({
  name: "der Versuchszähler geht bei gleichzeitigem Zählen nicht verloren",
  ignore: UEBERSPRINGEN,
  async fn() {
    // Zehn Versuche gleichzeitig. Würde der Zähler gelesen und dann geschrieben, gingen einige
    // verloren — und die Versuchsgrenze wäre löchrig. Deshalb zählt die Datenbank selbst.
    const { verzeichnis, aufraeumen } = await testVerzeichnis();
    try {
      const gueltigBis = new Date(Date.now() + 600_000).toISOString();
      await verzeichnis.codeHinterlegen({ email: "a@example.com", codeHash: "abc", gueltigBis });
      await Promise.all(
        Array.from({ length: 10 }, () => verzeichnis.versuchZaehlen("a@example.com", gueltigBis)),
      );

      const eintrag: any = await verzeichnis.codeHolen("a@example.com");
      if (eintrag.versuche !== 10) throw new Error(`erwartet 10 Versuche, war ${eintrag.versuche}`);
    } finally {
      await aufraeumen();
    }
  },
});
