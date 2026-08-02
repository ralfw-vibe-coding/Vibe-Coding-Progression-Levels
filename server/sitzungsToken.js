// Stellt Sitzungsausweise aus und prüft sie. Ein Ausweis ist ein JWT: drei mit Punkten
// verbundene Abschnitte — Kopf, Inhalt und eine Signatur über beide.
//
// Warum ein signiertes Token und keine Sitzungstabelle: Ein Token prüft sich an Ort und Stelle,
// eine Tabelle kostete bei *jeder* Anfrage eine Fahrt zur Datenbank. Der Preis dafür ist, dass
// ein ausgestelltes Token bis zum Ablauf gilt und sich nicht zurückrufen lässt. Diese Anwendung
// zahlt ihn nicht: Das Portal prüft zusätzlich bei jeder Anfrage, ob die Adresse noch zugelassen
// ist. Wer jemanden aussperrt, erwartet Wirkung sofort — nicht in sieben Tagen.
//
// Selbst gebaut statt eingekauft: Es sind vierzig Zeilen über die Web-Crypto-Schnittstelle, die
// Deno mitbringt. Eine Abhängigkeit dafür wäre in einem Projekt, das bisher mit einer einzigen
// auskommt, schlecht bezahlt.

const KOPF = { alg: "HS256", typ: "JWT" };

// Base64url ist Base64 ohne "+", "/" und Auffüllzeichen — sonst wäre ein Token nicht in jeder
// URL und jedem Header gefahrlos zu transportieren.
function nachBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function ausBase64Url(text) {
  const gefuellt = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(gefuellt), (z) => z.charCodeAt(0));
}

const alsText = (bytes) => new TextDecoder().decode(bytes);
const alsBytes = (text) => new TextEncoder().encode(text);
const objektNachBase64Url = (o) => nachBase64Url(alsBytes(JSON.stringify(o)));

/**
 * @param {string} geheimnisBase64 Das Signaturgeheimnis, wie es in AUTH_SESSION_SECRET steht.
 * @param {{ gueltigkeitSekunden?: number, jetzt?: () => number }} [optionen]
 *   `jetzt` ist einspeisbar, damit sich Ablauf prüfen lässt, ohne zu warten.
 * @returns {Promise<{ ausstellen: (email: string) => Promise<string>,
 *                     pruefen: (token: string) => Promise<{ email: string, gueltigBis: number } | null> }>}
 *
 * Async, weil der Schlüssel einmalig eingelesen werden muss. Ein unbrauchbares Geheimnis fällt
 * damit beim Start auf und nicht erst bei der ersten Anmeldung.
 */
export async function createSitzungsToken(geheimnisBase64, { gueltigkeitSekunden = 604_800, jetzt = () => Date.now() } = {}) {
  const schluessel = await crypto.subtle.importKey(
    "raw",
    ausBase64Url(String(geheimnisBase64 ?? "").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  async function signieren(daten) {
    return nachBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", schluessel, alsBytes(daten))));
  }

  // Im Inhalt steht nur, wer es ist und wie lange — kein Merkmal, ob jemand Verwalter ist. Das
  // wäre eine Behauptung von vor sieben Tagen; wer heute Verwalter ist, entscheidet die
  // Konfiguration bei jeder einzelnen Anfrage.
  async function ausstellen(email) {
    const jetztSekunden = Math.floor(jetzt() / 1000);
    const inhalt = { sub: email, iat: jetztSekunden, exp: jetztSekunden + gueltigkeitSekunden };
    const kopfUndInhalt = `${objektNachBase64Url(KOPF)}.${objektNachBase64Url(inhalt)}`;
    return `${kopfUndInhalt}.${await signieren(kopfUndInhalt)}`;
  }

  /**
   * Gibt bei jedem Fehler null zurück und sagt nie, welcher es war. "Abgelaufen" und "gefälscht"
   * zu unterscheiden ist eine Auskunft an denjenigen, der es versucht — und für den Client macht
   * es keinen Unterschied: In beiden Fällen führt der Weg zum Anmeldeschirm.
   */
  async function pruefen(token) {
    try {
      const teile = String(token ?? "").split(".");
      if (teile.length !== 3) return null;
      const [kopfB64, inhaltB64, signaturB64] = teile;

      // Zuerst der Kopf, vor allem anderen: Ein Token mit "alg":"none" behauptet, es brauche
      // gar keine Signatur. Wer das erst nach dem Lesen des Inhalts prüft, hat schon verloren —
      // das ist die klassische Art, ein JWT-Verfahren auszuhebeln.
      const kopf = JSON.parse(alsText(ausBase64Url(kopfB64)));
      if (kopf.alg !== "HS256") return null;

      const erwartet = await signieren(`${kopfB64}.${inhaltB64}`);
      // crypto.subtle.verify vergleicht zeitkonstant — anders als ein Vergleich der beiden
      // Zeichenketten, dessen Dauer verriete, wie viele Zeichen schon stimmen.
      const stimmt = await crypto.subtle.verify(
        "HMAC", schluessel, ausBase64Url(signaturB64), alsBytes(`${kopfB64}.${inhaltB64}`),
      );
      if (!stimmt || erwartet.length !== signaturB64.length) return null;

      const inhalt = JSON.parse(alsText(ausBase64Url(inhaltB64)));
      if (typeof inhalt.sub !== "string" || typeof inhalt.exp !== "number") return null;
      if (inhalt.exp * 1000 <= jetzt()) return null;

      return { email: inhalt.sub, gueltigBis: inhalt.exp * 1000 };
    } catch {
      // Kaputtes Base64, kein JSON, abgeschnitten — alles dasselbe Ergebnis: kein Ausweis.
      return null;
    }
  }

  return { ausstellen, pruefen };
}
