import {
  createResendMailProvider,
  createSimulierterMailProvider,
} from "../../server/resendMailProvider.js";

// fetchFn wird eingespeist — der Test prüft den Provider, nicht das Netz. Dasselbe Muster wie
// bei den Kursquellen und beim Wechselkursdienst.
function fakeFetch(antwort: Response | (() => never)) {
  const aufrufe: { url: string; optionen: any }[] = [];
  const fn = (url: any, optionen: any) => {
    aufrufe.push({ url: String(url), optionen });
    if (typeof antwort === "function") antwort();
    return Promise.resolve(antwort);
  };
  return { fn, aufrufe };
}

Deno.test("die Nachricht geht in der von Resend erwarteten Form raus", async () => {
  const { fn, aufrufe } = fakeFetch(new Response("{}", { status: 200 }));
  const mail = createResendMailProvider("re_test", { absender: "Mein Depot <no-reply@example.com>", fetchFn: fn as any });

  await mail.senden({ an: "a@example.com", betreff: "Dein Code", text: "123456" });

  if (aufrufe.length !== 1) throw new Error(`erwartet einen Aufruf, war ${aufrufe.length}`);
  const { url, optionen } = aufrufe[0];
  if (!url.startsWith("https://api.resend.com/emails")) throw new Error(`unerwartete Adresse: ${url}`);
  if (optionen.method !== "POST") throw new Error("erwartet POST");
  if (optionen.headers.authorization !== "Bearer re_test") throw new Error("der Schlüssel muss im Kopf stehen");

  const rumpf = JSON.parse(optionen.body);
  if (rumpf.from !== "Mein Depot <no-reply@example.com>") throw new Error(`unerwarteter Absender: ${rumpf.from}`);
  if (JSON.stringify(rumpf.to) !== JSON.stringify(["a@example.com"])) throw new Error("Empfänger muss eine Liste sein");
  if (rumpf.subject !== "Dein Code" || rumpf.text !== "123456") throw new Error("Betreff und Text müssen durchgereicht werden");
});

// Ohne diesen Hinweis sucht man den Fehler im eigenen Code, dabei fehlt nur die Verifikation
// der Absenderdomäne bei Resend.
Deno.test("ein 403 wird als Absenderproblem benannt, nicht als Anwendungsfehler", async () => {
  const { fn } = fakeFetch(new Response("", { status: 403 }));
  const mail = createResendMailProvider("re_test", { absender: "x <a@b.de>", fetchFn: fn as any });

  const fehler = await mail.senden({ an: "a@example.com", betreff: "x", text: "y" }).then(() => null, (f: Error) => f);
  if (fehler === null) throw new Error("ein 403 muss auffallen");
  if (!fehler.message.includes("verifiziert")) throw new Error(`erwartet einen Hinweis auf die Domäne, war: ${fehler.message}`);
});

Deno.test("das Anfragelimit bekommt eine verständliche Meldung", async () => {
  const { fn } = fakeFetch(new Response("", { status: 429 }));
  const mail = createResendMailProvider("re_test", { absender: "x <a@b.de>", fetchFn: fn as any });

  const fehler = await mail.senden({ an: "a@example.com", betreff: "x", text: "y" }).then(() => null, (f: Error) => f);
  if (!fehler?.message.includes("Anfragelimit")) throw new Error(`erwartet einen Hinweis auf das Limit, war: ${fehler?.message}`);
});

Deno.test("ein Zeitlimit wird als solches gemeldet", async () => {
  const { fn } = fakeFetch(() => {
    const f: any = new Error("abgebrochen");
    f.name = "TimeoutError";
    throw f;
  });
  const mail = createResendMailProvider("re_test", { absender: "x <a@b.de>", fetchFn: fn as any });

  const fehler = await mail.senden({ an: "a@example.com", betreff: "x", text: "y" }).then(() => null, (f: Error) => f);
  if (!fehler?.message.includes("rechtzeitig")) throw new Error(`erwartet einen Hinweis auf das Zeitlimit, war: ${fehler?.message}`);
});

Deno.test("die simulierte Variante merkt sich die Nachricht", async () => {
  const mail = createSimulierterMailProvider();
  await mail.senden({ an: "a@example.com", betreff: "Dein Code", text: "123456" });

  if (mail.gesendet.length !== 1) throw new Error(`erwartet eine Nachricht, war ${mail.gesendet.length}`);
  if (mail.gesendet[0].an !== "a@example.com" || mail.gesendet[0].text !== "123456") {
    throw new Error("die Nachricht muss unverändert nachlesbar sein");
  }
});
