import postgres from "npm:postgres@3";

// Nutzerverzeichnis in einer Postgres-Datenbank. Erfüllt denselben Vertrag wie jede andere
// Ausprägung (siehe nutzerVerzeichnis.js) und ist gegen sie austauschbar.
//
// Das ist die Ausprägung für den Betrieb, und zwar aus einem Grund, der erst mit Stufe 12
// entstanden ist: Auf einer Deploy-Plattform kann die Anwendung in mehreren Instanzen laufen.
// Wer einen Code anfordert, spricht dann womöglich mit einer anderen Instanz als der, bei der
// er ihn einlöst. Ein Code im Arbeitsspeicher wäre dort schlicht verschwunden — und der Fehler
// sähe aus wie ein falsch eingegebener Code, nicht wie das, was er ist.

/**
 * @param {string} verbindung Connection String (postgres://benutzer:passwort@host/datenbank).
 * @param {{ tabellenPraefix?: string }} [optionen] Der Präfix ist einstellbar, damit Tests in
 *   eigenen Tabellen arbeiten. Das ist kein Komfort, sondern die Trennlinie zwischen Prüfen und
 *   Zerstören: Die Vertragstests leeren ihr Verzeichnis, und das darf nie die echte Nutzerliste
 *   treffen.
 * @returns {Promise<import("./nutzerVerzeichnis.js").NutzerVerzeichnis & { schliessen: () => Promise<void> }>}
 *
 * Async wie beim Postgres-Event-Store: Das Anlegen des Schemas ist selbst eine Abfrage über die
 * Leitung, auf die gewartet werden muss.
 */
export async function createPostgresNutzerVerzeichnis(verbindung, { tabellenPraefix = "nutzer" } = {}) {
  const tabelleNutzer = tabellenPraefix;
  const tabelleCodes = `${tabellenPraefix}_codes`;
  const sql = postgres(verbindung, { onnotice: () => {} });

  // Zwei Tabellen, beide mit der Adresse als Primärschlüssel. Bei den Codes ist das die
  // eigentliche Zusicherung: Es kann gar nicht zwei offene Codes für dieselbe Adresse geben,
  // ohne dass jemand daran denken müsste.
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(tabelleNutzer)} (
      email        TEXT PRIMARY KEY,
      "angelegtAm" TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql(tabelleCodes)} (
      email        TEXT PRIMARY KEY,
      "codeHash"   TEXT,
      "gueltigBis" TEXT NOT NULL,
      versuche     INTEGER NOT NULL DEFAULT 0
    )
  `;

  async function zugelasseneAuflisten() {
    const zeilen = await sql`
      SELECT email, "angelegtAm" FROM ${sql(tabelleNutzer)} ORDER BY "angelegtAm", email
    `;
    // Array.from statt .map: Der Treiber gibt eine eigene Array-Abart zurück, die Innereien
    // mitschleppt. Was den Provider verlässt, soll ein gewöhnliches Array sein.
    return Array.from(zeilen, (z) => ({ email: z.email, angelegtAm: z.angelegtAm }));
  }

  // DO NOTHING statt DO UPDATE: Wer schon draufsteht, behält sein ursprüngliches Aufnahmedatum.
  async function zulassen(email) {
    await sql`
      INSERT INTO ${sql(tabelleNutzer)} (email, "angelegtAm")
      VALUES (${email}, ${new Date().toISOString()})
      ON CONFLICT (email) DO NOTHING
    `;
  }

  async function sperren(email) {
    await sql`DELETE FROM ${sql(tabelleNutzer)} WHERE email = ${email}`;
    await sql`DELETE FROM ${sql(tabelleCodes)} WHERE email = ${email}`;
  }

  async function istZugelassen(email) {
    const zeilen = await sql`SELECT 1 FROM ${sql(tabelleNutzer)} WHERE email = ${email}`;
    return zeilen.length > 0;
  }

  // Ein neuer Code ersetzt den vorherigen samt Versuchszähler — wer einen frischen anfordert,
  // soll nicht an der Grenze des alten scheitern.
  async function codeHinterlegen({ email, codeHash, gueltigBis }) {
    await sql`
      INSERT INTO ${sql(tabelleCodes)} (email, "codeHash", "gueltigBis", versuche)
      VALUES (${email}, ${codeHash}, ${gueltigBis}, 0)
      ON CONFLICT (email) DO UPDATE
        SET "codeHash" = ${codeHash}, "gueltigBis" = ${gueltigBis}, versuche = 0
    `;
  }

  async function codeHolen(email) {
    const zeilen = await sql`
      SELECT "codeHash", "gueltigBis", versuche FROM ${sql(tabelleCodes)} WHERE email = ${email}
    `;
    if (zeilen.length === 0) return null;
    const z = zeilen[0];
    return { codeHash: z.codeHash ?? null, gueltigBis: z.gueltigBis, versuche: Number(z.versuche) };
  }

  // Zählen und Anlegen in einer Anweisung, mit RETURNING: Zwischen "nachsehen" und "erhöhen"
  // könnte sonst eine zweite Instanz dazwischenkommen und ein Versuch verlorengehen — genau die
  // Nebenläufigkeit, wegen der diese Ausprägung überhaupt existiert.
  async function versuchZaehlen(email, gueltigBis) {
    const zeilen = await sql`
      INSERT INTO ${sql(tabelleCodes)} (email, "codeHash", "gueltigBis", versuche)
      VALUES (${email}, NULL, ${gueltigBis}, 1)
      ON CONFLICT (email) DO UPDATE SET versuche = ${sql(tabelleCodes)}.versuche + 1
      RETURNING versuche
    `;
    return Number(zeilen[0].versuche);
  }

  async function codeVerbrauchen(email) {
    await sql`DELETE FROM ${sql(tabelleCodes)} WHERE email = ${email}`;
  }

  async function abgelaufeneCodesEntfernen(jetztIso) {
    await sql`DELETE FROM ${sql(tabelleCodes)} WHERE "gueltigBis" < ${jetztIso}`;
  }

  // Über den Vertrag hinaus, und nur hier: Eine Netzwerkverbindung muss man wieder loslassen.
  async function schliessen() {
    await sql.end();
  }

  return {
    zugelasseneAuflisten, zulassen, sperren, istZugelassen,
    codeHinterlegen, codeHolen, versuchZaehlen, codeVerbrauchen, abgelaufeneCodesEntfernen,
    schliessen,
  };
}
