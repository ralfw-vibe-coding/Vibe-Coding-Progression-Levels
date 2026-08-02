// Der zweite Body. Er orchestriert dieselbe Art Zusammenspiel wie body.js — nur für eine andere
// Frage: nicht "was steht im Depot", sondern "wer darf herein".
//
// Zwei Bodies statt einem, weil sich beide aus verschiedenen Gründen ändern. Dass server/body.js
// weiterhin keinen Nutzerbegriff kennt, ist der Beleg dafür, dass diese Stufe das Datenmodell des
// Depots wirklich unangetastet lässt: Es gibt keine Nutzer-ID an einem Kauf, und es kann keine
// geben, solange die beiden nichts voneinander wissen.
//
// Hier liegen alle Regeln, die das Nutzerverzeichnis bewusst nicht kennt: Wie Adressen
// normalisiert werden, wie lange ein Code gilt, wie oft man raten darf, dass der Verwalter immer
// hereinkommt, und wie verglichen wird.

const ZEHN_MINUTEN = 10;

/**
 * @param {import("./nutzerVerzeichnis.js").NutzerVerzeichnis} nutzerVerzeichnis
 * @param {{ senden: (n: { an: string, betreff: string, text: string }) => Promise<void> } | null} mail
 *   Fehlt der Versand, kann kein Code angefordert werden — angemeldet bleiben kann man trotzdem.
 * @param {{ ausstellen: (email: string) => Promise<string> } | null} sitzungsToken
 * @param {{ adminEmail?: string | null, dauerOtp?: string | null,
 *           gueltigkeitMinuten?: number, maxVersuche?: number, jetzt?: () => number }} [optionen]
 */
export function createAnmeldung(nutzerVerzeichnis, mail, sitzungsToken, {
  adminEmail = null,
  dauerOtp = null,
  gueltigkeitMinuten = ZEHN_MINUTEN,
  maxVersuche = 5,
  jetzt = () => Date.now(),
} = {}) {
  const verwalter = normalisieren(adminEmail);

  // Adressen werden überall in derselben Form behandelt, bevor sie das Verzeichnis erreichen.
  // Ohne das wären " Anna@Example.COM " und "anna@example.com" zwei verschiedene Personen — die
  // eine auf der Liste, die andere ausgesperrt, und niemand verstünde warum.
  function normalisieren(email) {
    return String(email ?? "").trim().toLowerCase();
  }

  // Der Verwalter steht nicht in der Liste, sondern in der Konfiguration. Ihn beim Start
  // einzutragen wäre bequemer, hinterließe aber nach einem Wechsel von ADMIN_EMAIL einen alten
  // Eintrag, der niemandem mehr auffällt — genau die Art Karteileiche, die später Zugriff
  // bedeutet.
  async function zugangPruefen(email) {
    const adresse = normalisieren(email);
    if (!adresse) return false;
    if (verwalter && adresse === verwalter) return true;
    return await nutzerVerzeichnis.istZugelassen(adresse);
  }

  function istAdmin(email) {
    return Boolean(verwalter) && normalisieren(email) === verwalter;
  }

  /**
   * Fordert einen Einmalcode an. Ist die Adresse nicht zugelassen, wird das gesagt — die Liste
   * ist damit von außen aufzählbar. Das ist bewusst so: Für ein Werkzeug mit einem bekannten,
   * kleinen Personenkreis ist eine verständliche Absage mehr wert als die Verschleierung, wer
   * dazugehört. Wer die Liste kennt, kommt damit noch lange nicht herein.
   */
  async function codeAnfordern(email) {
    const adresse = normalisieren(email);
    if (!(await zugangPruefen(adresse))) {
      return { ok: false, grund: "Diese Adresse ist nicht freigeschaltet." };
    }
    if (!mail) {
      return { ok: false, grund: "Es ist kein Mailversand eingerichtet — eine Anmeldung per Code ist gerade nicht möglich." };
    }

    const code = codeErzeugen();
    const gueltigBis = new Date(jetzt() + gueltigkeitMinuten * 60_000).toISOString();
    await nutzerVerzeichnis.codeHinterlegen({ email: adresse, codeHash: await hashen(adresse, code), gueltigBis });

    // Aufräumen bei Gelegenheit: Abgelaufene Codes werden ohnehin abgelehnt, aber die Tabelle
    // soll nicht endlos wachsen. Ein eigener Zeitplan wäre dafür zu viel Apparat.
    await nutzerVerzeichnis.abgelaufeneCodesEntfernen(new Date(jetzt()).toISOString());

    await mail.senden({
      an: adresse,
      betreff: `Dein Anmeldecode: ${code}`,
      text: [
        `Dein Anmeldecode für „Mein Depot“ lautet:`,
        ``,
        `    ${code}`,
        ``,
        `Er gilt ${gueltigkeitMinuten} Minuten und nur einmal.`,
        ``,
        `Wenn du dich nicht anmelden wolltest, ignoriere diese Nachricht —`,
        `ohne den Code passiert nichts.`,
      ].join("\n"),
    });

    return { ok: true, gueltigBis };
  }

  /**
   * Löst einen Code ein. Es gibt zwei, die passen können: der eben verschickte und der
   * Dauer-Einmalcode aus der Konfiguration. Einer von beiden genügt.
   */
  async function codeEinloesen(email, eingabe) {
    const adresse = normalisieren(email);
    if (!(await zugangPruefen(adresse))) return { ok: false, grund: "Anmeldung nicht möglich." };
    if (!sitzungsToken) {
      return { ok: false, grund: "Es ist kein Sitzungsgeheimnis eingerichtet — eine Anmeldung ist gerade nicht möglich." };
    }

    const offen = await nutzerVerzeichnis.codeHolen(adresse);
    const abgelaufen = offen !== null && offen.gueltigBis <= new Date(jetzt()).toISOString();

    if (offen !== null && offen.versuche >= maxVersuche) {
      await nutzerVerzeichnis.codeVerbrauchen(adresse);
      return { ok: false, grund: "Der Code wurde zu oft falsch eingegeben. Bitte fordere einen neuen an." };
    }

    const eingegeben = String(eingabe ?? "");
    const eingabeHash = await hashen(adresse, eingegeben);

    // Beide Vergleiche werden vollständig gerechnet, erst danach verodert. Ein `||` würde beim
    // ersten Treffer aufhören — und die Antwortzeit verriete, welcher der beiden Codes passte.
    const passtDauerCode = dauerOtp ? await gleich(eingabeHash, await hashen(adresse, dauerOtp)) : false;
    const passtErzeugter = offen?.codeHash && !abgelaufen ? await gleich(eingabeHash, offen.codeHash) : false;

    if (!passtDauerCode && !passtErzeugter) {
      const stand = await nutzerVerzeichnis.versuchZaehlen(
        adresse,
        new Date(jetzt() + gueltigkeitMinuten * 60_000).toISOString(),
      );
      const uebrig = Math.max(0, maxVersuche - stand);
      return {
        ok: false,
        grund: uebrig > 0
          ? `Der Code stimmt nicht. Noch ${uebrig} ${uebrig === 1 ? "Versuch" : "Versuche"}.`
          : "Der Code wurde zu oft falsch eingegeben. Bitte fordere einen neuen an.",
      };
    }

    // Auch beim Dauer-Einmalcode wird ein offener Code verbraucht: Sonst bliebe er gültig,
    // obwohl die Anmeldung längst stattgefunden hat.
    await nutzerVerzeichnis.codeVerbrauchen(adresse);
    return {
      ok: true,
      token: await sitzungsToken.ausstellen(adresse),
      email: adresse,
      istAdmin: istAdmin(adresse),
    };
  }

  // Prüft einen Sitzungsausweis. Nur durchgereicht, damit das Portal nicht zwei Bausteine
  // kennen muss — es fragt in allen Zugangsfragen diesen einen.
  async function tokenPruefen(token) {
    return sitzungsToken ? await sitzungsToken.pruefen(token) : null;
  }

  // --- Nutzerverwaltung, nur für den Verwalter (das Portal wacht darüber) ---

  async function zugelasseneAuflisten() {
    return await nutzerVerzeichnis.zugelasseneAuflisten();
  }

  async function zulassen(email) {
    const adresse = normalisieren(email);
    if (!adresse.includes("@")) throw new Error("Das sieht nicht nach einer E-Mail-Adresse aus.");
    await nutzerVerzeichnis.zulassen(adresse);
    return await zugelasseneAuflisten();
  }

  // Den Verwalter zu sperren wäre wirkungslos — er steht in der Konfiguration, nicht in der
  // Liste. Es stillschweigend geschehen zu lassen wäre die schlechtere Antwort: Man hielte sich
  // für ausgesperrt und wäre es nicht.
  async function sperren(email) {
    const adresse = normalisieren(email);
    if (verwalter && adresse === verwalter) {
      throw new Error("Der Verwalter steht in der Konfiguration und lässt sich hier nicht entfernen.");
    }
    await nutzerVerzeichnis.sperren(adresse);
    return await zugelasseneAuflisten();
  }

  return {
    codeAnfordern, codeEinloesen, tokenPruefen, zugangPruefen, istAdmin,
    zugelasseneAuflisten, zulassen, sperren,
  };
}

// Sechs Stellen aus dem Zufallsgenerator des Betriebssystems, nicht aus Math.random(): Dessen
// Folge lässt sich aus wenigen beobachteten Werten fortschreiben — wer einen eigenen Code
// anfordert, könnte damit den des Nächsten ausrechnen.
function codeErzeugen() {
  const [zahl] = crypto.getRandomValues(new Uint32Array(1));
  return String(zahl % 1_000_000).padStart(6, "0");
}

// Gespeichert wird nur der Hash. Das schützt nicht gegen Raten — sechs Ziffern sind in
// Millisekunden durchprobiert —, sondern gegen Lesen: Ein Datenbankabzug, ein Protokoll einer
// Abfrage oder eine Lesekopie gibt damit keine gültigen Anmeldecodes heraus. Gegen Raten wirken
// Ablauf und Versuchsgrenze; deshalb sind die beiden keine Kür.
//
// Die Adresse geht als Salz mit ein, damit zwei Personen mit zufällig gleichem Code nicht
// denselben Hash bekommen.
async function hashen(email, code) {
  const bytes = new TextEncoder().encode(`${email}:${code}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Zeitkonstanter Vergleich: Ein gewöhnliches === bricht beim ersten abweichenden Zeichen ab, und
// die Dauer verriete, wie viele Zeichen schon stimmen.
async function gleich(a, b) {
  if (a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}
