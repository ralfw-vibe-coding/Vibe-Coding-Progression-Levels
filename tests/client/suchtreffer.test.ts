import { suchtrefferAlsText } from "../../client/domain.js";

// Kandidaten, wie sie nach der Probe vorliegen: Der abgerufene Kurs hängt in `geprueft` am
// Treffer. Ohne ihn wäre die Liste wieder nur eine Aufzählung von Kürzeln.
const treffer = [
  { symbol: "EWG2.SG", name: "Euwax Gold II", boerse: "STU", waehrung: "EUR", quelle: "Yahoo", geprueft: { ok: true, kurs: 115.63, waehrung: "EUR" } },
  { symbol: "MSTR", name: "Strategy Inc", boerse: "US", waehrung: null, quelle: "Finnhub", geprueft: { ok: true, kurs: 96.63, waehrung: "USD" } },
];

Deno.test("der Text nennt die Position, den Suchbegriff und alle Kandidaten", () => {
  const text = suchtrefferAlsText({
    name: "Boerse Stuttg. Euwax-Gold", wertpapierId: "EWG2LD", begriff: "DE000EWG2LD7", treffer,
  });
  for (const erwartet of ["Boerse Stuttg. Euwax-Gold", "EWG2LD", "DE000EWG2LD7", "EWG2.SG", "Finnhub"]) {
    if (!text.includes(erwartet)) throw new Error(`"${erwartet}" fehlt im Text`);
  }
});

Deno.test("die Kandidaten stehen als Spiegelstrichliste", () => {
  const text = suchtrefferAlsText({ name: "X", wertpapierId: "Y", begriff: "Y", treffer });
  const striche = text.split("\n").filter((z) => z.startsWith("- "));
  // zwei Angaben zur Position plus zwei Kandidaten
  if (striche.length !== 4) throw new Error(`erwartet 4 Spiegelstriche, war ${striche.length}`);
  if (!striche.some((z) => z.includes("EWG2.SG") && z.includes("STU") && z.includes("Yahoo"))) {
    throw new Error("ein Kandidat muss Symbol, Börse und Quelle nennen");
  }
});

// Der Kurs ist der Kern dieser Liste: Ob ein Kandidat das richtige Papier ist, erkennt man an
// der Größenordnung, nicht am Kürzel. Steht er nicht da, muss die Gegenseite raten.
Deno.test("zu jedem Kandidaten steht der abgerufene Kurs samt Währung", () => {
  const text = suchtrefferAlsText({ name: "X", wertpapierId: "Y", begriff: "Y", treffer });
  if (!text.includes("115,63 EUR")) throw new Error("der Eurokurs fehlt");
  if (!text.includes("96,63 USD")) throw new Error("der Dollarkurs fehlt — und zwar als Dollar");
});

Deno.test("der Text stellt eine Frage — er ist kein bloßer Datenauszug", () => {
  const text = suchtrefferAlsText({ name: "X", wertpapierId: "Y", begriff: "Y", treffer });
  if (!text.includes("Frage:")) throw new Error("ohne Frage weiß die Gegenseite nicht, was zu tun ist");
  if (!text.includes("umgerechnet")) throw new Error("dass Fremdwährung kein Ausschlussgrund ist, muss dastehen");
});

Deno.test("ohne Treffer wird nach anderen Kennungen gefragt", () => {
  const text = suchtrefferAlsText({ name: "Lang+Schwarz", wertpapierId: "LS9KF5", begriff: "DE000LS9KF55", treffer: [] });
  if (!text.includes("nichts")) throw new Error("das leere Ergebnis muss benannt werden");
  if (!text.includes("Frage:")) throw new Error("auch ohne Treffer braucht es eine Frage");
});

Deno.test("fehlende Angaben werden benannt, nicht verschwiegen", () => {
  const text = suchtrefferAlsText({
    name: "X", wertpapierId: "Y", begriff: "Y",
    treffer: [{ symbol: "CHKP", name: "", boerse: "", waehrung: null, quelle: "Finnhub" }],
  });
  if (!text.includes("Börse unbekannt")) throw new Error("eine fehlende Börse muss als solche dastehen");
  if (!text.includes("ohne Namensangabe")) throw new Error("ein fehlender Name muss als solcher dastehen");
  // Ein Kandidat jenseits des Probenbudgets ist nicht "ohne Kurs", sondern "noch nicht gefragt".
  if (!text.includes("noch nicht abgerufen")) throw new Error("ein ungeprüfter Kandidat muss als ungeprüft dastehen");
});
