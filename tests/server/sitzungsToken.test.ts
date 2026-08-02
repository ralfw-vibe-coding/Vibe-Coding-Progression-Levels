import { createSitzungsToken } from "../../server/sitzungsToken.js";

const GEHEIMNIS = "u5Hmt2sXhroxzSp3Vl5IuB5XDpQdgd3bgzSlsL3q4dM=";
const ANDERES_GEHEIMNIS = "Zm9vYmFyYmF6cXV1eGZvb2JhcmJhenF1dXhmb28xMjM0NTY=";

const nachBase64Url = (o: unknown) =>
  btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

Deno.test("ein ausgestelltes Token wird als gültig erkannt und nennt die Adresse", async () => {
  const token = await createSitzungsToken(GEHEIMNIS);
  const geprueft: any = await token.pruefen(await token.ausstellen("a@example.com"));
  if (geprueft === null) throw new Error("das eigene Token muss gelten");
  if (geprueft.email !== "a@example.com") throw new Error(`erwartet a@example.com, war ${geprueft.email}`);
});

// Der Inhalt enthält absichtlich kein Merkmal, ob jemand Verwalter ist: Das wäre eine Behauptung
// von vor sieben Tagen. Dieser Test nagelt die Entscheidung fest.
Deno.test("der Inhalt enthält genau sub, iat und exp — nichts weiter", async () => {
  const token = await createSitzungsToken(GEHEIMNIS);
  const inhaltB64 = (await token.ausstellen("a@example.com")).split(".")[1];
  const inhalt = JSON.parse(atob(inhaltB64.replaceAll("-", "+").replaceAll("_", "/")));

  const felder = Object.keys(inhalt).sort().join(",");
  if (felder !== "exp,iat,sub") throw new Error(`erwartet exp,iat,sub — war ${felder}`);
});

Deno.test("ein Token aus fremder Hand gilt nicht", async () => {
  const fremd = await createSitzungsToken(ANDERES_GEHEIMNIS);
  const eigen = await createSitzungsToken(GEHEIMNIS);
  if ((await eigen.pruefen(await fremd.ausstellen("a@example.com"))) !== null) {
    throw new Error("ein mit anderem Geheimnis signiertes Token darf nicht gelten");
  }
});

Deno.test("ein verändertes Token gilt nicht", async () => {
  const token = await createSitzungsToken(GEHEIMNIS);
  const [kopf, , signatur] = (await token.ausstellen("a@example.com")).split(".");
  // Der Angriff, um den es geht: die Adresse im Inhalt austauschen und die Signatur behalten.
  const gefaelscht = `${kopf}.${nachBase64Url({ sub: "fremd@example.com", iat: 1, exp: 9_999_999_999 })}.${signatur}`;

  if ((await token.pruefen(gefaelscht)) !== null) throw new Error("ein ausgetauschter Inhalt muss auffallen");
});

// Die klassische Art, ein JWT-Verfahren auszuhebeln: Das Token behauptet, es brauche gar keine
// Signatur.
Deno.test('ein Token mit "alg":"none" gilt nicht', async () => {
  const token = await createSitzungsToken(GEHEIMNIS);
  const ohneSignatur = `${nachBase64Url({ alg: "none", typ: "JWT" })}.${
    nachBase64Url({ sub: "fremd@example.com", iat: 1, exp: 9_999_999_999 })
  }.`;

  if ((await token.pruefen(ohneSignatur)) !== null) throw new Error('"alg":"none" muss abgelehnt werden');
});

Deno.test("ein abgelaufenes Token gilt nicht", async () => {
  let uhr = Date.parse("2026-01-01T12:00:00Z");
  const token = await createSitzungsToken(GEHEIMNIS, { gueltigkeitSekunden: 60, jetzt: () => uhr });
  const ausgestellt = await token.ausstellen("a@example.com");

  if ((await token.pruefen(ausgestellt)) === null) throw new Error("frisch muss es gelten");
  uhr += 61_000;
  if ((await token.pruefen(ausgestellt)) !== null) throw new Error("nach Ablauf darf es nicht mehr gelten");
});

Deno.test("Unsinn führt zu keinem Ausweis, nicht zu einem Absturz", async () => {
  const token = await createSitzungsToken(GEHEIMNIS);
  for (const unsinn of ["", "abc", "a.b", "a.b.c.d", "...", null, undefined, "%%%.%%%.%%%"]) {
    if ((await token.pruefen(unsinn as any)) !== null) throw new Error(`erwartet null für ${JSON.stringify(unsinn)}`);
  }
});

Deno.test("die Gültigkeitsdauer richtet sich nach der Vorgabe", async () => {
  const uhr = Date.parse("2026-01-01T12:00:00Z");
  const token = await createSitzungsToken(GEHEIMNIS, { gueltigkeitSekunden: 3_600, jetzt: () => uhr });
  const geprueft: any = await token.pruefen(await token.ausstellen("a@example.com"));

  if (geprueft.gueltigBis !== uhr + 3_600_000) {
    throw new Error(`erwartet ${uhr + 3_600_000}, war ${geprueft.gueltigBis}`);
  }
});
