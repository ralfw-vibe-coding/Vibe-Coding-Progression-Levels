// Der Vertrag jeder Kursquelle — als Testsuite, nicht als Prosa. Jede Ausprägung ruft diese
// Funktion auf und muss sie bestehen, auch die verkettete.
//
// Die Quellen bekommen dafür ein vorgegebenes `fetch` untergeschoben, damit im Test kein Netz
// nötig ist. Geprüft wird also nicht, ob Yahoo erreichbar ist, sondern ob die Quelle sich an
// die Abmachung hält: Auf jedes angefragte Symbol kommt genau eine Antwort, und die ist
// entweder ein Kurs mit Währung oder ein Fehler mit Begründung.

export type QuellenErzeuger = (vorgaben: {
  /** Symbole, für die die Quelle einen Kurs liefern soll — Symbol -> Kurs in Euro. */
  treffer: Record<string, number>;
}) => any;

export function pruefeKursProviderVertrag(bezeichnung: string, erzeugeQuelle: QuellenErzeuger) {
  function vertragstest(name: string, fn: (quelle: any) => Promise<void>) {
    Deno.test(`${bezeichnung} — ${name}`, async () => {
      await fn(erzeugeQuelle({ treffer: { GUT: 42.5, AUCHGUT: 7 } }));
    });
  }

  vertragstest("liefert zu jedem angefragten Symbol genau einen Eintrag", async (quelle) => {
    const ergebnis: any = await quelle.kurseAbrufen(["GUT", "UNBEKANNT", "AUCHGUT"]);
    if (ergebnis.size !== 3) throw new Error(`erwartet 3 Einträge, war ${ergebnis.size}`);
    for (const symbol of ["GUT", "UNBEKANNT", "AUCHGUT"]) {
      if (!ergebnis.has(symbol)) throw new Error(`kein Eintrag für ${symbol}`);
    }
  });

  vertragstest("ein Treffer nennt Kurs, Währung und Quelle", async (quelle) => {
    const e: any = (await quelle.kurseAbrufen(["GUT"])).get("GUT");
    if (e.fehler !== undefined) throw new Error(`erwartet einen Treffer, war Fehler: ${e.fehler}`);
    if (e.kurs !== 42.5) throw new Error(`erwartet Kurs 42.5, war ${e.kurs}`);
    if (typeof e.waehrung !== "string" || !e.waehrung) throw new Error("ein Treffer muss eine Währung nennen");
    if (typeof e.quelle !== "string" || !e.quelle) throw new Error("ein Treffer muss seine Quelle nennen");
  });

  vertragstest("ein unbekanntes Symbol ergibt einen Fehler mit Begründung, keinen Absturz", async (quelle) => {
    const e: any = (await quelle.kurseAbrufen(["UNBEKANNT"])).get("UNBEKANNT");
    if (e.fehler === undefined) throw new Error("erwartet einen Fehler");
    if (typeof e.fehler !== "string" || !e.fehler) throw new Error("der Fehler muss eine lesbare Begründung nennen");
    if (e.kurs !== undefined) throw new Error("ein Fehler darf keinen Kurs mitliefern");
  });

  vertragstest("ein unbekanntes Symbol verhindert nicht die Kurse der anderen", async (quelle) => {
    const ergebnis: any = await quelle.kurseAbrufen(["UNBEKANNT", "GUT"]);
    if (ergebnis.get("GUT").kurs !== 42.5) throw new Error("ein Fehlschlag darf die übrigen Symbole nicht mitreißen");
  });

  vertragstest("eine leere Anfrage ergibt ein leeres Ergebnis", async (quelle) => {
    const ergebnis: any = await quelle.kurseAbrufen([]);
    if (ergebnis.size !== 0) throw new Error(`erwartet ein leeres Ergebnis, war ${ergebnis.size}`);
  });

  vertragstest("die Quelle nennt ihren Namen", async (quelle) => {
    if (typeof quelle.name !== "string" || !quelle.name) throw new Error("jede Quelle braucht einen Namen");
  });
}
