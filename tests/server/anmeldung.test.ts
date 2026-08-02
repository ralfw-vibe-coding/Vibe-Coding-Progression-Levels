import { createAnmeldung } from "../../server/anmeldung.js";
import { createNutzerVerzeichnis } from "../../server/nutzerVerzeichnis.js";
import { createSimulierterMailProvider } from "../../server/resendMailProvider.js";
import { createSitzungsToken } from "../../server/sitzungsToken.js";

const GEHEIMNIS = "u5Hmt2sXhroxzSp3Vl5IuB5XDpQdgd3bgzSlsL3q4dM=";
const ADMIN = "chef@example.com";

async function neueAnmeldung({ zugelassene = [], dauerOtp = null, uhr = { jetzt: Date.now() } } = {} as any) {
  const verzeichnis = createNutzerVerzeichnis(zugelassene);
  const mail = createSimulierterMailProvider();
  const token = await createSitzungsToken(GEHEIMNIS, { jetzt: () => uhr.jetzt });
  const anmeldung = createAnmeldung(verzeichnis, mail, token, {
    adminEmail: ADMIN,
    dauerOtp,
    jetzt: () => uhr.jetzt,
  });
  return { anmeldung, verzeichnis, mail, token, uhr };
}

// Aus dem Betreff der verschickten Nachricht — dort steht er, damit man ihn schon in der
// Übersicht des Postfachs sieht.
function codeAus(mail: any) {
  return mail.gesendet.at(-1).betreff.match(/(\d{6})/)[1];
}

Deno.test("eine nicht freigeschaltete Adresse bekommt keinen Code", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  const ergebnis: any = await anmeldung.codeAnfordern("fremd@example.com");

  if (ergebnis.ok) throw new Error("eine unbekannte Adresse darf keinen Code bekommen");
  if (!ergebnis.grund.includes("freigeschaltet")) throw new Error(`unerwartete Begründung: ${ergebnis.grund}`);
  if (mail.gesendet.length !== 0) throw new Error("es darf nichts verschickt worden sein");
});

// Der Verwalter steht in der Konfiguration, nicht in der Liste — sonst käme nach dem ersten
// Start niemand herein, der die Liste pflegen könnte.
Deno.test("der Verwalter bekommt einen Code, ohne auf der Liste zu stehen", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  const ergebnis = await anmeldung.codeAnfordern(ADMIN);

  if (!ergebnis.ok) throw new Error(`der Verwalter muss hereinkommen, war: ${ergebnis.grund}`);
  if (mail.gesendet.length !== 1) throw new Error("es muss genau eine Nachricht verschickt worden sein");
  if (mail.gesendet[0].an !== ADMIN) throw new Error("die Nachricht muss an den Verwalter gehen");
});

Deno.test("der verschickte Text enthält den Code", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);

  const code = codeAus(mail);
  if (!/^\d{6}$/.test(code)) throw new Error(`erwartet sechs Ziffern, war ${code}`);
  if (!mail.gesendet[0].text.includes(code)) throw new Error("der Code muss auch im Text stehen");
});

// Ein Datenbankabzug oder ein Protokoll soll keine gültigen Anmeldecodes hergeben.
Deno.test("im Verzeichnis steht der Code nicht im Klartext", async () => {
  const { anmeldung, verzeichnis, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);

  const code = codeAus(mail);
  const abgelegt: any = await verzeichnis.codeHolen(ADMIN);
  if (abgelegt.codeHash === code) throw new Error("der Code darf nicht im Klartext abgelegt werden");
  if (abgelegt.codeHash.length !== 64) throw new Error(`erwartet einen SHA-256-Hash, war ${abgelegt.codeHash}`);
});

Deno.test("mit dem richtigen Code kommt ein gültiges Token", async () => {
  const { anmeldung, mail, token } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);

  const ergebnis = await anmeldung.codeEinloesen(ADMIN, codeAus(mail));
  if (!ergebnis.ok) throw new Error(`erwartet eine erfolgreiche Anmeldung, war: ${ergebnis.grund}`);
  if (!ergebnis.istAdmin) throw new Error("der Verwalter muss als solcher erkannt werden");

  const geprueft = await token.pruefen(ergebnis.token);
  if (geprueft?.email !== ADMIN) throw new Error("das Token muss auf die Adresse lauten");
});

Deno.test("derselbe Code gilt kein zweites Mal", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);
  const code = codeAus(mail);

  await anmeldung.codeEinloesen(ADMIN, code);
  const zweites = await anmeldung.codeEinloesen(ADMIN, code);
  if (zweites.ok) throw new Error("ein verbrauchter Code darf nicht noch einmal gelten");
});

Deno.test("ein abgelaufener Code wird abgelehnt", async () => {
  const uhr = { jetzt: Date.parse("2026-01-01T12:00:00Z") };
  const { anmeldung, mail } = await neueAnmeldung({ uhr });
  await anmeldung.codeAnfordern(ADMIN);
  const code = codeAus(mail);

  uhr.jetzt += 11 * 60_000;
  const ergebnis = await anmeldung.codeEinloesen(ADMIN, code);
  if (ergebnis.ok) throw new Error("nach zehn Minuten darf der Code nicht mehr gelten");
});

Deno.test("nach fünf Fehlversuchen ist der Code verbraucht", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);
  const code = codeAus(mail);

  for (let i = 0; i < 5; i++) await anmeldung.codeEinloesen(ADMIN, "000000");

  // Auch der richtige Code hilft jetzt nicht mehr — sonst wäre die Grenze wirkungslos.
  const ergebnis: any = await anmeldung.codeEinloesen(ADMIN, code);
  if (ergebnis.ok) throw new Error("nach zu vielen Versuchen darf auch der richtige Code nicht mehr gelten");
  if (!ergebnis.grund.includes("zu oft")) throw new Error(`unerwartete Begründung: ${ergebnis.grund}`);
});

Deno.test("die Meldung nennt die verbleibenden Versuche", async () => {
  const { anmeldung } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);

  const ergebnis: any = await anmeldung.codeEinloesen(ADMIN, "000000");
  if (!ergebnis.grund.includes("4")) throw new Error(`erwartet einen Hinweis auf 4 verbleibende, war: ${ergebnis.grund}`);
});

Deno.test("ein neu angeforderter Code beginnt wieder bei null Versuchen", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern(ADMIN);
  for (let i = 0; i < 4; i++) await anmeldung.codeEinloesen(ADMIN, "000000");

  await anmeldung.codeAnfordern(ADMIN);
  const ergebnis = await anmeldung.codeEinloesen(ADMIN, codeAus(mail));
  if (!ergebnis.ok) throw new Error(`ein frischer Code muss wieder wirken, war: ${ergebnis.grund}`);
});

// Der Weg hinein, wenn der Mailversand hakt.
Deno.test("der Dauer-Einmalcode wirkt auch ohne angeforderten Code", async () => {
  const { anmeldung } = await neueAnmeldung({ dauerOtp: "hibiskus" });
  const ergebnis = await anmeldung.codeEinloesen(ADMIN, "hibiskus");

  if (!ergebnis.ok) throw new Error(`der Dauercode muss ohne Anforderung wirken, war: ${ergebnis.grund}`);
});

// Er ist ein Generalschlüssel, aber kein Freifahrtschein an der Liste vorbei.
Deno.test("der Dauer-Einmalcode wirkt nicht für eine nicht zugelassene Adresse", async () => {
  const { anmeldung } = await neueAnmeldung({ dauerOtp: "hibiskus" });
  const ergebnis = await anmeldung.codeEinloesen("fremd@example.com", "hibiskus");

  if (ergebnis.ok) throw new Error("der Dauercode darf die Zugangsliste nicht aushebeln");
});

Deno.test("auch der Dauer-Einmalcode unterliegt der Versuchsgrenze", async () => {
  // Ohne Satz im Verzeichnis hinge an diesem Weg kein Zähler — er wäre unbegrenzt ratbar.
  const { anmeldung } = await neueAnmeldung({ dauerOtp: "hibiskus" });
  for (let i = 0; i < 5; i++) await anmeldung.codeEinloesen(ADMIN, "falsch");

  const ergebnis = await anmeldung.codeEinloesen(ADMIN, "hibiskus");
  if (ergebnis.ok) throw new Error("nach zu vielen Versuchen darf auch der Dauercode nicht mehr wirken");
});

Deno.test("ohne Dauer-Einmalcode gilt nur der erzeugte", async () => {
  const { anmeldung } = await neueAnmeldung();
  const ergebnis = await anmeldung.codeEinloesen(ADMIN, "hibiskus");
  if (ergebnis.ok) throw new Error("ohne konfigurierten Dauercode darf nichts durchkommen");
});

Deno.test("Groß-/Kleinschreibung und Leerraum ändern die Adresse nicht", async () => {
  const { anmeldung, mail } = await neueAnmeldung();
  await anmeldung.codeAnfordern("  Chef@Example.COM  ");
  if (mail.gesendet[0].an !== ADMIN) throw new Error(`erwartet ${ADMIN}, war ${mail.gesendet[0].an}`);

  const ergebnis = await anmeldung.codeEinloesen("CHEF@example.com", codeAus(mail));
  if (!ergebnis.ok) throw new Error("dieselbe Adresse in anderer Schreibweise muss dieselbe sein");
});

Deno.test("zugangPruefen kennt Verwalter und Zugelassene, sonst niemanden", async () => {
  const { anmeldung } = await neueAnmeldung({ zugelassene: ["partner@example.com"] });

  if (!(await anmeldung.zugangPruefen(ADMIN))) throw new Error("der Verwalter muss durchkommen");
  if (!(await anmeldung.zugangPruefen("partner@example.com"))) throw new Error("ein Zugelassener muss durchkommen");
  if (await anmeldung.zugangPruefen("fremd@example.com")) throw new Error("ein Fremder darf nicht durchkommen");
  if (await anmeldung.zugangPruefen("")) throw new Error("eine leere Adresse darf nicht durchkommen");
});

Deno.test("istAdmin gilt nur für den Verwalter", async () => {
  const { anmeldung } = await neueAnmeldung({ zugelassene: ["partner@example.com"] });
  if (!anmeldung.istAdmin(" CHEF@example.com ")) throw new Error("der Verwalter muss erkannt werden");
  if (anmeldung.istAdmin("partner@example.com")) throw new Error("ein gewöhnlicher Nutzer ist kein Verwalter");
});

Deno.test("zulassen und sperren pflegen die Liste", async () => {
  const { anmeldung } = await neueAnmeldung();

  const nachher: any[] = await anmeldung.zulassen(" Partner@Example.com ");
  if (nachher.length !== 1 || nachher[0].email !== "partner@example.com") {
    throw new Error(`erwartet die normalisierte Adresse, war ${JSON.stringify(nachher)}`);
  }
  if ((await anmeldung.sperren("partner@example.com")).length !== 0) throw new Error("sperren muss die Liste leeren");
});

Deno.test("was keine Adresse ist, kommt nicht auf die Liste", async () => {
  const { anmeldung } = await neueAnmeldung();
  const fehler = await anmeldung.zulassen("kein-at-zeichen").then(() => null, (f: Error) => f);
  if (fehler === null) throw new Error("eine Eingabe ohne @ muss abgelehnt werden");
});

// Wirkungslos wäre es ohnehin — er steht in der Konfiguration. Es stillschweigend geschehen zu
// lassen wäre schlimmer: Man hielte sich für ausgesperrt und wäre es nicht.
Deno.test("der Verwalter lässt sich nicht aus der Liste sperren", async () => {
  const { anmeldung } = await neueAnmeldung();
  const fehler = await anmeldung.sperren(ADMIN).then(() => null, (f: Error) => f);
  if (fehler === null) throw new Error("das Sperren des Verwalters muss abgelehnt werden");
  if (!(await anmeldung.zugangPruefen(ADMIN))) throw new Error("der Verwalter muss weiterhin hereinkommen");
});

Deno.test("ohne Mailversand gibt es eine verständliche Absage statt eines Absturzes", async () => {
  const verzeichnis = createNutzerVerzeichnis();
  const token = await createSitzungsToken(GEHEIMNIS);
  const anmeldung = createAnmeldung(verzeichnis, null, token, { adminEmail: ADMIN });

  const ergebnis: any = await anmeldung.codeAnfordern(ADMIN);
  if (ergebnis.ok) throw new Error("ohne Versand kann kein Code angefordert werden");
  if (!ergebnis.grund.includes("Mailversand")) throw new Error(`unerwartete Begründung: ${ergebnis.grund}`);
});
