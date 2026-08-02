import { createSqliteNutzerVerzeichnis } from "../../server/sqliteNutzerVerzeichnis.js";
import { pruefeNutzerVerzeichnisVertrag } from "./nutzerVerzeichnisVertrag.ts";

// Derselbe Vertrag wie im Arbeitsspeicher. Für die Vertragstests genügt eine Datenbank im
// Arbeitsspeicher — sie ist schnell und muss nicht aufgeräumt werden.
pruefeNutzerVerzeichnisVertrag("Nutzerverzeichnis in SQLite", (zugelassene = []) => ({
  verzeichnis: createSqliteNutzerVerzeichnis(":memory:", zugelassene),
}));

// Darüber hinaus das, was nur diese Ausprägung ausmacht: dass sie sich etwas merkt.
function inTempDatenbank(test: (pfad: string) => Promise<void>) {
  return async () => {
    const verzeichnis = Deno.makeTempDirSync();
    try {
      await test(`${verzeichnis}/nutzer.sqlite`);
    } finally {
      Deno.removeSync(verzeichnis, { recursive: true });
    }
  };
}

Deno.test(
  "ein neues Verzeichnis auf derselben Datei kennt die Zugelassenen weiter (simulierter Neustart)",
  inTempDatenbank(async (pfad) => {
    const erstes = createSqliteNutzerVerzeichnis(pfad);
    await erstes.zulassen("a@example.com");
    await erstes.zulassen("b@example.com");

    const zweites = createSqliteNutzerVerzeichnis(pfad);
    if (!(await zweites.istZugelassen("a@example.com"))) throw new Error("die Liste muss den Neustart überstehen");
    if ((await zweites.zugelasseneAuflisten()).length !== 2) throw new Error("erwartet zwei Einträge");
  }),
);

Deno.test(
  "auch ein offener Code übersteht den Neustart",
  inTempDatenbank(async (pfad) => {
    // Genau der Fall, für den es diese Ausprägung gibt: Wer einen Code anfordert und dann den
    // Server neu startet, soll ihn trotzdem noch einlösen können.
    const gueltigBis = new Date(Date.now() + 600_000).toISOString();
    const erstes = createSqliteNutzerVerzeichnis(pfad);
    await erstes.codeHinterlegen({ email: "a@example.com", codeHash: "abc123", gueltigBis });

    const zweites = createSqliteNutzerVerzeichnis(pfad);
    const eintrag: any = await zweites.codeHolen("a@example.com");
    if (eintrag === null || eintrag.codeHash !== "abc123") {
      throw new Error(`der Code muss unverändert wiederkommen, war ${JSON.stringify(eintrag)}`);
    }
  }),
);

Deno.test("das Schema wird beim ersten Start selbst angelegt", inTempDatenbank(async (pfad) => {
  // Kein Migrationsschritt, kein Setup-Befehl — eine leere Datenbank ist einfach ein leeres
  // Verzeichnis.
  const verzeichnis = createSqliteNutzerVerzeichnis(pfad);
  if ((await verzeichnis.zugelasseneAuflisten()).length !== 0) throw new Error("erwartet ein leeres Verzeichnis");
  await verzeichnis.zulassen("a@example.com");
  if ((await verzeichnis.zugelasseneAuflisten()).length !== 1) throw new Error("nach dem Anlegen muss geschrieben werden können");
}));
