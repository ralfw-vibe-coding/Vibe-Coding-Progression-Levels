// xProvider: kapselt die Ressource "Mailversand". Nötig geworden, weil ein Einmalcode einen Weg
// zum Nutzer braucht, den nur der Nutzer selbst lesen kann — genau darin besteht der Nachweis,
// dass ihm die Adresse gehört.
//
// Bewusst dumm gehalten: `senden({ an, betreff, text })`, sonst nichts. Was in einer Anmeldemail
// steht, ist eine fachliche Entscheidung und gehört in anmeldung.js. Ein Versender, der von
// Anmeldecodes wüsste, wäre für nichts anderes mehr zu gebrauchen.
const BASIS = "https://api.resend.com/emails";

/**
 * @param {string} apiKey Zugangsschlüssel von Resend.
 * @param {{ absender?: string, zeitlimitMs?: number, fetchFn?: typeof fetch }} [optionen]
 *   `absender` im Format `Name <adresse@domain>`; die Domäne muss bei Resend verifiziert sein,
 *   sonst wird erst der erste echte Versand abgelehnt.
 */
export function createResendMailProvider(apiKey, { absender, zeitlimitMs = 10_000, fetchFn = fetch } = {}) {
  async function senden({ an, betreff, text }) {
    let antwort;
    try {
      antwort = await fetchFn(BASIS, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ from: absender, to: [an], subject: betreff, text }),
        signal: AbortSignal.timeout(zeitlimitMs),
      });
    } catch (f) {
      throw new Error(f.name === "TimeoutError" ? "Resend antwortete nicht rechtzeitig" : `Resend nicht erreichbar: ${f.message}`);
    }

    if (antwort.ok) return;

    // 403 heißt hier fast immer: Die Absenderdomäne ist bei Resend nicht verifiziert. Das ist
    // eine Aussage über die Einrichtung, nicht über die Anwendung — und ohne diesen Hinweis
    // sucht man den Fehler im eigenen Code.
    if (antwort.status === 403) throw new Error("Resend lehnt den Absender ab — ist die Domäne dort verifiziert?");
    if (antwort.status === 429) throw new Error("Anfragelimit bei Resend erreicht, gleich erneut versuchen");
    throw new Error(`Resend antwortete mit ${antwort.status}`);
  }

  return { name: "Resend", senden };
}

// Ohne Netz, für Tests: merkt sich, was verschickt worden wäre.
export function createSimulierterMailProvider({ name = "Simulation" } = {}) {
  const gesendet = [];
  async function senden(nachricht) {
    gesendet.push(nachricht);
  }
  return { name, senden, gesendet };
}

// Für die lokale Entwicklung ohne Resend-Schlüssel: Die Nachricht landet auf der Konsole, damit
// man den Code zum Anmelden ablesen kann.
//
// Nur lokal einsetzen. Auf einem deployten Server stünden Anmeldecodes damit im Protokoll, das
// mehr Leute sehen als das Postfach des Empfängers — deshalb entscheidet main.js, wann dieser
// Versender überhaupt in Frage kommt, und sagt es beim Start deutlich.
export function createKonsolenMailProvider() {
  async function senden({ an, betreff, text }) {
    console.log(`\n--- Mail an ${an} --- ${betreff}\n${text}\n---\n`);
  }
  return { name: "Konsole", senden };
}
