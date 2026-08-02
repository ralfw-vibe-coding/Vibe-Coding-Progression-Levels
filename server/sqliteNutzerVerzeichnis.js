import { DatabaseSync } from "node:sqlite";

// Nutzerverzeichnis in einer SQLite-Datenbank. Erfüllt denselben Vertrag wie jede andere
// Ausprägung (siehe nutzerVerzeichnis.js) und ist gegen sie austauschbar.
//
// Diese Ausprägung existiert für den lokalen Betrieb ohne DATABASE_URL. Sie hält dasselbe
// Versprechen, das der Event-Store seit Stufe 8 gibt: Ein frischer Klon läuft ohne jede
// Einrichtung, und was er dabei einträgt, ist nach dem Neustart noch da.
//
// Eine eigene Datei, nicht die des Depots: Das Löschen von depot.sqlite ist der übliche Weg,
// einen Bestand wegzuwerfen und neu anzufangen. Läge die Nutzerliste darin, sperrte man sich
// dabei versehentlich selbst aus.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS nutzer (
    email      TEXT PRIMARY KEY,
    angelegtAm TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS nutzer_codes (
    email      TEXT PRIMARY KEY,
    codeHash   TEXT,
    gueltigBis TEXT NOT NULL,
    versuche   INTEGER NOT NULL DEFAULT 0
  );
`;

/**
 * @param {string} verbindung Dateipfad; ":memory:" für eine Datenbank, die nur im
 *   Arbeitsspeicher existiert (praktisch für Tests).
 * @param {string[]} [zugelassene] Adressen, mit denen ein noch leeres Verzeichnis startet.
 * @returns {import("./nutzerVerzeichnis.js").NutzerVerzeichnis}
 */
export function createSqliteNutzerVerzeichnis(verbindung, zugelassene = []) {
  if (verbindung !== ":memory:") {
    const verzeichnis = verbindung.slice(0, verbindung.lastIndexOf("/"));
    if (verzeichnis) Deno.mkdirSync(verzeichnis, { recursive: true });
  }

  const db = new DatabaseSync(verbindung);
  // Dieselben zwei Einstellungen wie beim Event-Store, in derselben Reihenfolge: busy_timeout
  // zuerst, weil das Umschalten auf WAL selbst kurz eine Sperre braucht.
  db.exec("PRAGMA busy_timeout = 5000");
  if (verbindung !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const listeLesen = db.prepare("SELECT email, angelegtAm FROM nutzer ORDER BY angelegtAm, email");
  // "OR IGNORE": Wer schon draufsteht, behält sein ursprüngliches Aufnahmedatum. Ein zweiter
  // Eintrag mit neuem Datum wäre eine Falschaussage darüber, seit wann jemand dabei ist.
  const eintragen = db.prepare("INSERT OR IGNORE INTO nutzer (email, angelegtAm) VALUES (?, ?)");
  const austragen = db.prepare("DELETE FROM nutzer WHERE email = ?");
  const einzelnLesen = db.prepare("SELECT 1 FROM nutzer WHERE email = ?");

  // "REPLACE": Ein neuer Code ersetzt den vorherigen samt Versuchszähler. Es gibt nie zwei
  // offene Codes für dieselbe Adresse.
  const codeSetzen = db.prepare(
    "INSERT OR REPLACE INTO nutzer_codes (email, codeHash, gueltigBis, versuche) VALUES (?, ?, ?, 0)",
  );
  const codeLesen = db.prepare("SELECT codeHash, gueltigBis, versuche FROM nutzer_codes WHERE email = ?");
  const codeLoeschen = db.prepare("DELETE FROM nutzer_codes WHERE email = ?");
  // Zählen und Anlegen in einer Anweisung: Zwischen "nachsehen, ob es den Satz gibt" und
  // "erhöhen" könnte sonst ein zweiter Zugriff dazwischenkommen und ein Versuch verlorengehen.
  const versuchErhoehen = db.prepare(`
    INSERT INTO nutzer_codes (email, codeHash, gueltigBis, versuche) VALUES (?, NULL, ?, 1)
    ON CONFLICT(email) DO UPDATE SET versuche = versuche + 1
  `);
  const abgelaufeneLoeschen = db.prepare("DELETE FROM nutzer_codes WHERE gueltigBis < ?");

  async function zugelasseneAuflisten() {
    return listeLesen.all().map((z) => ({ email: z.email, angelegtAm: z.angelegtAm }));
  }

  async function zulassen(email) {
    eintragen.run(email, new Date().toISOString());
  }

  async function sperren(email) {
    austragen.run(email);
    codeLoeschen.run(email);
  }

  async function istZugelassen(email) {
    return einzelnLesen.get(email) !== undefined;
  }

  async function codeHinterlegen({ email, codeHash, gueltigBis }) {
    codeSetzen.run(email, codeHash, gueltigBis);
  }

  async function codeHolen(email) {
    const zeile = codeLesen.get(email);
    if (!zeile) return null;
    return {
      codeHash: zeile.codeHash ?? null,
      gueltigBis: zeile.gueltigBis,
      versuche: Number(zeile.versuche),
    };
  }

  async function versuchZaehlen(email, gueltigBis) {
    versuchErhoehen.run(email, gueltigBis);
    return Number(codeLesen.get(email).versuche);
  }

  async function codeVerbrauchen(email) {
    codeLoeschen.run(email);
  }

  async function abgelaufeneCodesEntfernen(jetztIso) {
    abgelaufeneLoeschen.run(jetztIso);
  }

  for (const email of zugelassene) eintragen.run(email, new Date().toISOString());

  return {
    zugelasseneAuflisten, zulassen, sperren, istZugelassen,
    codeHinterlegen, codeHolen, versuchZaehlen, codeVerbrauchen, abgelaufeneCodesEntfernen,
  };
}
