import { isinAusWkn, istIsin, istWkn, pruefeKennung, suchbegriffe } from "../../server/wertpapierKennung.js";

Deno.test("die ISIN wird korrekt aus der WKN abgeleitet", () => {
  // Gegen bekannte, echte ISINs geprüft — eine selbst erdachte Prüfziffer wäre wertlos.
  if (isinAusWkn("EWG2LD") !== "DE000EWG2LD7") throw new Error(`erwartet DE000EWG2LD7, war ${isinAusWkn("EWG2LD")}`);
  if (isinAusWkn("722713") !== "DE0007227134") throw new Error(`erwartet DE0007227134, war ${isinAusWkn("722713")}`);
});

Deno.test("Kleinschreibung wird angenommen", () => {
  if (isinAusWkn("ewg2ld") !== "DE000EWG2LD7") throw new Error("die Eingabe darf klein geschrieben sein");
});

Deno.test("was keine WKN ist, ergibt keine ISIN", () => {
  for (const eingabe of ["Apple", "US0378331005", "ABC", "", null]) {
    if (isinAusWkn(eingabe as any) !== null) throw new Error(`erwartet null für ${eingabe}`);
  }
});

Deno.test("WKN und ISIN werden auseinandergehalten", () => {
  if (!istWkn("865985") || !istWkn("A2QBZ1")) throw new Error("gültige WKN nicht erkannt");
  if (istWkn("US0378331005")) throw new Error("eine ISIN ist keine WKN");
  if (!istIsin("US0378331005") || !istIsin("DE000EWG2LD7")) throw new Error("gültige ISIN nicht erkannt");
  if (istIsin("865985")) throw new Error("eine WKN ist keine ISIN");
});

Deno.test("aus einer WKN werden zwei Suchbegriffe, ISIN zuerst", () => {
  // Die ISIN zuerst, weil sie die einzige ist, mit der die Quellen etwas anfangen können.
  const begriffe = suchbegriffe("EWG2LD");
  if (JSON.stringify(begriffe) !== JSON.stringify(["DE000EWG2LD7", "EWG2LD"])) {
    throw new Error(`erwartet [ISIN, WKN], war ${JSON.stringify(begriffe)}`);
  }
});

Deno.test("aus einem Namen wird nur ein Suchbegriff", () => {
  if (JSON.stringify(suchbegriffe("Apple")) !== JSON.stringify(["Apple"])) throw new Error("ein Name bleibt allein");
  if (suchbegriffe("   ").length !== 0) throw new Error("eine leere Eingabe ergibt keine Suche");
});

Deno.test("eine WKN wird als Kennung abgelehnt — mit Weg nach vorn", () => {
  // Hart abgelehnt, weil keine Kursquelle die WKN kennt und die Ableitung nur bei deutschen
  // Emissionen stimmt. Wo sie nicht stimmt, liefert die Suche irgendetwas.
  const ergebnis = pruefeKennung("865985");
  if (ergebnis.ok) throw new Error("eine WKN darf nicht durchgehen");
  if (!ergebnis.grund?.includes("ISIN")) throw new Error("die Meldung muss sagen, was stattdessen geht");
  // Die abgeleitete ISIN als Vorschlag — spart das Nachschlagen, wo sie stimmt. Gegen die
  // Ableitung geprüft statt gegen eine getippte Prüfziffer: die wäre selbst zu prüfen.
  if (!ergebnis.grund?.includes(isinAusWkn("865985")!)) throw new Error("die abgeleitete ISIN sollte vorgeschlagen werden");
});

Deno.test("ISIN und Tickersymbol werden angenommen", () => {
  for (const gut of ["US0378331005", "DE000EWG2LD7", "AAPL", "APC.DE", "EWG2.SG", "HVJD.HM"]) {
    if (!pruefeKennung(gut).ok) throw new Error(`${gut} sollte angenommen werden`);
  }
});

Deno.test("eine leere Kennung wird abgelehnt", () => {
  if (pruefeKennung("").ok || pruefeKennung(null as any).ok) throw new Error("leer ist keine Kennung");
});
