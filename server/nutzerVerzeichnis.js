// xProvider: kapselt die Ressource "wer darf herein". Zwei Dinge liegen darin — die Liste der
// zugelassenen Adressen und die gerade offenen Einmalcodes.
//
// Warum das *nicht* in den Event-Store gehört, obwohl dort schon eine Datenbank steht: Der
// Event-Store erzählt die Geschichte eines Depots, und über `GET/PUT /api/events` lässt er sich
// im Ganzen aus- und wieder einspielen. Läge die Nutzerliste darin, würde der Import einer
// Sicherung von gestern sie mitüberschreiben, und ein Export gäbe sie an jeden weiter, der eine
// Sicherungsdatei bekommt. Das Versprechen dieser Stufe — das Datenmodell des Depots bleibt
// unangetastet — wäre schon im ersten Schritt gebrochen.
//
// Warum Liste und Codes *einen* Vertrag teilen, obwohl das eine dauerhaft und das andere
// flüchtig ist: Es ist dieselbe Ressource. Sie werden immer im selben Ablauf gebraucht (erst
// prüfen, ob jemand zugelassen ist, dann einen Code hinterlegen), liegen am selben Ort und
// bräuchten sonst zweimal dieselben drei Ausprägungen. Aufteilen lohnt sich erst, wenn etwas
// hinzukommt, das man einzeln austauschen will.
//
// Was hier bewusst *nicht* steht: jede Regel. Ablauf, Versuchsgrenze, Normalisierung von
// Adressen, "der Verwalter ist immer zugelassen" — all das liegt in anmeldung.js. Dieser
// Baustein legt ab, gibt zurück und entfernt, sonst nichts. Sonst müsste jede Ausprägung
// dieselben Regeln erneut richtig treffen, und die dritte hätte sie anders.

/**
 * Der Vertrag jedes Nutzerverzeichnisses. Wer ihn erfüllt, kann jeden anderen ersetzen. Geprüft
 * wird er für alle Ausprägungen gemeinsam in tests/server/nutzerVerzeichnisVertrag.ts.
 *
 * Alle Operationen sind async — aus demselben Grund wie beim Event-Store: Die anspruchsvollste
 * Ausprägung sitzt hinter einer Leitung und kann nicht synchron antworten. Der Vertrag richtet
 * sich nach ihr, damit wirklich *alle* austauschbar bleiben.
 *
 * Adressen kommen hier bereits normalisiert an (klein, ohne Leerraum). Das Verzeichnis
 * vergleicht sie zeichengenau und kümmert sich nicht darum, wie sie zustande kamen.
 *
 * @typedef {object} NutzerVerzeichnis
 * @property {() => Promise<{ email: string, angelegtAm: string }[]>} zugelasseneAuflisten
 *   Alle zugelassenen Adressen, älteste zuerst.
 * @property {(email: string) => Promise<void>} zulassen
 *   Nimmt eine Adresse auf. Zweimal aufgerufen ändert sich nichts — wer schon draufsteht, steht
 *   drauf, und ein zweiter Eintrag mit neuem Datum wäre eine Falschaussage über die Historie.
 * @property {(email: string) => Promise<void>} sperren
 *   Nimmt eine Adresse von der Liste und verwirft einen etwaigen offenen Code. Eine unbekannte
 *   Adresse zu sperren ist kein Fehler: Das Ergebnis ist dasselbe.
 * @property {(email: string) => Promise<boolean>} istZugelassen
 * @property {(eintrag: { email: string, codeHash: string, gueltigBis: string }) => Promise<void>} codeHinterlegen
 *   Legt einen offenen Code ab und ersetzt dabei einen vorherigen. Es gibt nie zwei offene Codes
 *   für dieselbe Adresse — sonst bliebe ein alter Code gültig, den längst niemand mehr erwartet.
 * @property {(email: string) => Promise<{ codeHash: string | null, gueltigBis: string, versuche: number } | null>} codeHolen
 *   Der offene Code, oder null. `codeHash` kann null sein: Dann wurde nur gezählt, ohne dass je
 *   ein Code angefordert wurde (siehe versuchZaehlen).
 * @property {(email: string, gueltigBis: string) => Promise<number>} versuchZaehlen
 *   Erhöht den Fehlversuchszähler und gibt den neuen Stand zurück. Legt den Satz auch dann an,
 *   wenn nie ein Code hinterlegt wurde — sonst hinge am Dauer-Einmalcode kein Zähler und er
 *   wäre unbegrenzt ratbar. `gueltigBis` gilt nur für diesen neu angelegten Fall und sagt, wie
 *   lange der Zähler stehen bleibt; wie lang das ist, entscheidet der Aufrufer, nicht der
 *   Speicher.
 * @property {(email: string) => Promise<void>} codeVerbrauchen
 *   Entfernt den offenen Code. Wird nach erfolgreicher Anmeldung gerufen, damit derselbe Code
 *   kein zweites Mal gilt.
 * @property {(jetztIso: string) => Promise<void>} abgelaufeneCodesEntfernen
 *   Räumt auf. Für die Sicherheit nicht nötig — abgelaufene Codes werden ohnehin abgelehnt —,
 *   wohl aber dafür, dass die Tabelle nicht endlos wächst.
 */

/**
 * Nutzerverzeichnis im Arbeitsspeicher: ohne Abhängigkeiten und ohne Gedächtnis über das
 * Programmende hinaus. Für Tests, und als lesbare Fassung dessen, was die anderen beiden
 * Ausprägungen in ihrer jeweiligen Datenbank tun.
 *
 * @param {string[]} zugelassene Adressen, mit denen das Verzeichnis startet.
 * @returns {NutzerVerzeichnis}
 */
export function createNutzerVerzeichnis(zugelassene = []) {
  /** @type {Map<string, string>} email -> angelegtAm */
  const liste = new Map();
  /** @type {Map<string, { codeHash: string | null, gueltigBis: string, versuche: number }>} */
  const codes = new Map();

  for (const email of zugelassene) liste.set(email, new Date().toISOString());

  async function zugelasseneAuflisten() {
    return [...liste.entries()]
      .map(([email, angelegtAm]) => ({ email, angelegtAm }))
      .sort((a, b) => a.angelegtAm.localeCompare(b.angelegtAm));
  }

  async function zulassen(email) {
    if (!liste.has(email)) liste.set(email, new Date().toISOString());
  }

  async function sperren(email) {
    liste.delete(email);
    codes.delete(email);
  }

  async function istZugelassen(email) {
    return liste.has(email);
  }

  async function codeHinterlegen({ email, codeHash, gueltigBis }) {
    // Ein neuer Code beginnt bei null Versuchen: Wer einen frischen anfordert, soll nicht an der
    // Grenze des vorherigen scheitern.
    codes.set(email, { codeHash, gueltigBis, versuche: 0 });
  }

  async function codeHolen(email) {
    const eintrag = codes.get(email);
    return eintrag ? { ...eintrag } : null;
  }

  async function versuchZaehlen(email, gueltigBis) {
    const vorhanden = codes.get(email);
    if (!vorhanden) {
      // Kein angeforderter Code, aber jemand probiert etwas — das ist der Weg über den
      // Dauer-Einmalcode. Auch der braucht eine Grenze, also entsteht der Satz hier.
      codes.set(email, { codeHash: null, gueltigBis, versuche: 1 });
      return 1;
    }
    vorhanden.versuche += 1;
    return vorhanden.versuche;
  }

  async function codeVerbrauchen(email) {
    codes.delete(email);
  }

  async function abgelaufeneCodesEntfernen(jetztIso) {
    for (const [email, eintrag] of codes) {
      if (eintrag.gueltigBis < jetztIso) codes.delete(email);
    }
  }

  return {
    zugelasseneAuflisten, zulassen, sperren, istZugelassen,
    codeHinterlegen, codeHolen, versuchZaehlen, codeVerbrauchen, abgelaufeneCodesEntfernen,
  };
}
