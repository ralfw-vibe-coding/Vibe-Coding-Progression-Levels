import { createNutzerVerzeichnis } from "../../server/nutzerVerzeichnis.js";
import { pruefeNutzerVerzeichnisVertrag } from "./nutzerVerzeichnisVertrag.ts";

// Die Ausprägung im Arbeitsspeicher ist die einfachste — jeder Testfall bekommt ein frisches
// Verzeichnis, aufzuräumen gibt es nichts.
pruefeNutzerVerzeichnisVertrag("Nutzerverzeichnis im Arbeitsspeicher", (zugelassene = []) => ({
  verzeichnis: createNutzerVerzeichnis(zugelassene),
}));

// Darüber hinaus das, was nur diese Ausprägung ausmacht.
Deno.test("das Verzeichnis im Arbeitsspeicher hängt nicht am übergebenen Array", async () => {
  const anfang = ["a@example.com"];
  const verzeichnis = createNutzerVerzeichnis(anfang);
  anfang.push("b@example.com");

  if (await verzeichnis.istZugelassen("b@example.com")) {
    throw new Error("eine spätere Änderung am Array darf das Verzeichnis nicht verändern");
  }
});

// codeHolen gibt eine Kopie heraus: Sonst könnte ein Aufrufer den Versuchszähler von außen
// zurücksetzen und die Grenze wäre wirkungslos.
Deno.test("codeHolen gibt eine Kopie heraus, keinen Zugriff auf den Bestand", async () => {
  const verzeichnis = createNutzerVerzeichnis();
  await verzeichnis.codeHinterlegen({
    email: "a@example.com",
    codeHash: "abc",
    gueltigBis: new Date(Date.now() + 600_000).toISOString(),
  });
  await verzeichnis.versuchZaehlen("a@example.com", new Date(Date.now() + 600_000).toISOString());

  const geholt: any = await verzeichnis.codeHolen("a@example.com");
  geholt.versuche = 0;

  const nochmal: any = await verzeichnis.codeHolen("a@example.com");
  if (nochmal.versuche !== 1) {
    throw new Error("der Bestand darf sich von außen nicht verändern lassen");
  }
});
