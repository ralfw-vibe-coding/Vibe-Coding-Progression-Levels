// Der Vertrag jedes Nutzerverzeichnisses — als Testsuite, nicht als Prosa. Jede Ausprägung (im
// Arbeitsspeicher, in SQLite, in Postgres) ruft diese Funktion auf und muss sie bestehen. Damit
// ist "alle haben dasselbe Interface" keine Absichtserklärung, sondern nachprüfbar.
//
// Dieselbe Bauform wie eventStoreVertrag.ts, mit einem Unterschied: Die Ausprägungen sind hier
// teils async zu erzeugen (Postgres legt sein Schema über die Leitung an) und brauchen ein
// Aufräumen zwischen den Fällen, weil sie sich — anders als ein frischer Arbeitsspeicher — die
// Daten des vorherigen Tests merken würden.

export type VerzeichnisErzeuger = (zugelassene?: string[]) => Promise<{
  verzeichnis: any;
  aufraeumen?: () => Promise<void>;
}> | {
  verzeichnis: any;
  aufraeumen?: () => Promise<void>;
};

const IN_ZEHN_MINUTEN = new Date(Date.now() + 10 * 60_000).toISOString();
const GESTERN = new Date(Date.now() - 24 * 3_600_000).toISOString();

export function pruefeNutzerVerzeichnisVertrag(
  bezeichnung: string,
  erzeuge: VerzeichnisErzeuger,
  optionen: { ignore?: boolean } = {},
) {
  const ignore = optionen.ignore ?? false;

  function vertragstest(name: string, fn: (v: any) => Promise<void>) {
    Deno.test({
      name: `${bezeichnung} — ${name}`,
      ignore,
      async fn() {
        const { verzeichnis, aufraeumen } = await erzeuge();
        try {
          await fn(verzeichnis);
        } finally {
          await aufraeumen?.();
        }
      },
    });
  }

  vertragstest("ein neues Verzeichnis ist leer", async (v) => {
    if ((await v.zugelasseneAuflisten()).length !== 0) throw new Error("erwartet ein leeres Verzeichnis");
  });

  vertragstest("zulassen macht istZugelassen wahr und taucht in der Auflistung auf", async (v) => {
    await v.zulassen("a@example.com");
    if (!(await v.istZugelassen("a@example.com"))) throw new Error("die Adresse muss zugelassen sein");
    const liste = await v.zugelasseneAuflisten();
    if (liste.length !== 1 || liste[0].email !== "a@example.com") {
      throw new Error(`erwartet genau einen Eintrag, war ${JSON.stringify(liste)}`);
    }
    if (!liste[0].angelegtAm || Number.isNaN(Date.parse(liste[0].angelegtAm))) {
      throw new Error(`erwartet ein gültiges Datum, war ${liste[0].angelegtAm}`);
    }
  });

  vertragstest("eine unbekannte Adresse ist nicht zugelassen", async (v) => {
    if (await v.istZugelassen("fremd@example.com")) throw new Error("niemand darf ungefragt zugelassen sein");
  });

  // Ein zweiter Eintrag mit neuem Datum wäre eine Falschaussage darüber, seit wann jemand
  // dabei ist.
  vertragstest("zweimal zulassen legt nicht doppelt an", async (v) => {
    await v.zulassen("a@example.com");
    const zuerst = (await v.zugelasseneAuflisten())[0].angelegtAm;
    await v.zulassen("a@example.com");
    const liste = await v.zugelasseneAuflisten();
    if (liste.length !== 1) throw new Error(`erwartet einen Eintrag, war ${liste.length}`);
    if (liste[0].angelegtAm !== zuerst) throw new Error("das Aufnahmedatum darf sich nicht ändern");
  });

  vertragstest("sperren entfernt die Adresse", async (v) => {
    await v.zulassen("a@example.com");
    await v.sperren("a@example.com");
    if (await v.istZugelassen("a@example.com")) throw new Error("nach dem Sperren darf niemand mehr zugelassen sein");
    if ((await v.zugelasseneAuflisten()).length !== 0) throw new Error("die Auflistung muss leer sein");
  });

  vertragstest("eine unbekannte Adresse zu sperren ist kein Fehler", async (v) => {
    await v.sperren("gibtsnicht@example.com");
  });

  vertragstest("codeHinterlegen und codeHolen geben Hash und Frist unverändert zurück", async (v) => {
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "abc123", gueltigBis: IN_ZEHN_MINUTEN });
    const eintrag = await v.codeHolen("a@example.com");
    if (eintrag.codeHash !== "abc123") throw new Error(`erwartet abc123, war ${eintrag.codeHash}`);
    if (eintrag.gueltigBis !== IN_ZEHN_MINUTEN) throw new Error("die Frist muss unverändert bleiben");
    if (eintrag.versuche !== 0) throw new Error(`ein frischer Code beginnt bei 0 Versuchen, war ${eintrag.versuche}`);
  });

  vertragstest("ohne hinterlegten Code liefert codeHolen null", async (v) => {
    if ((await v.codeHolen("a@example.com")) !== null) throw new Error("erwartet null");
  });

  // Sonst bliebe ein alter Code gültig, den längst niemand mehr erwartet.
  vertragstest("ein zweites codeHinterlegen ersetzt das erste", async (v) => {
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "alt", gueltigBis: IN_ZEHN_MINUTEN });
    await v.versuchZaehlen("a@example.com", IN_ZEHN_MINUTEN);
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "neu", gueltigBis: IN_ZEHN_MINUTEN });

    const eintrag = await v.codeHolen("a@example.com");
    if (eintrag.codeHash !== "neu") throw new Error(`erwartet neu, war ${eintrag.codeHash}`);
    // Wer einen frischen Code anfordert, soll nicht an der Grenze des vorherigen scheitern.
    if (eintrag.versuche !== 0) throw new Error(`erwartet 0 Versuche beim neuen Code, war ${eintrag.versuche}`);
  });

  vertragstest("versuchZaehlen erhöht und gibt den neuen Stand zurück", async (v) => {
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "abc", gueltigBis: IN_ZEHN_MINUTEN });
    if ((await v.versuchZaehlen("a@example.com", IN_ZEHN_MINUTEN)) !== 1) throw new Error("erwartet 1");
    if ((await v.versuchZaehlen("a@example.com", IN_ZEHN_MINUTEN)) !== 2) throw new Error("erwartet 2");
    if ((await v.codeHolen("a@example.com")).versuche !== 2) throw new Error("der Stand muss abrufbar sein");
  });

  // Der Dauer-Einmalcode wirkt ohne angeforderten Code. Gäbe es dann keinen Satz, an dem ein
  // Zähler hängt, wäre er unbegrenzt ratbar.
  vertragstest("versuchZaehlen legt den Satz auch ohne hinterlegten Code an", async (v) => {
    const stand = await v.versuchZaehlen("a@example.com", IN_ZEHN_MINUTEN);
    if (stand !== 1) throw new Error(`erwartet 1, war ${stand}`);
    const eintrag = await v.codeHolen("a@example.com");
    if (eintrag === null) throw new Error("es muss ein Satz entstanden sein");
    if (eintrag.codeHash !== null) throw new Error(`erwartet keinen Hash, war ${eintrag.codeHash}`);
    if (eintrag.versuche !== 1) throw new Error(`erwartet 1 Versuch, war ${eintrag.versuche}`);
  });

  vertragstest("codeVerbrauchen entfernt den Code", async (v) => {
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "abc", gueltigBis: IN_ZEHN_MINUTEN });
    await v.codeVerbrauchen("a@example.com");
    if ((await v.codeHolen("a@example.com")) !== null) throw new Error("nach dem Verbrauchen darf nichts übrig sein");
  });

  vertragstest("abgelaufeneCodesEntfernen räumt nur Abgelaufenes weg", async (v) => {
    await v.codeHinterlegen({ email: "alt@example.com", codeHash: "x", gueltigBis: GESTERN });
    await v.codeHinterlegen({ email: "frisch@example.com", codeHash: "y", gueltigBis: IN_ZEHN_MINUTEN });
    await v.abgelaufeneCodesEntfernen(new Date().toISOString());

    if ((await v.codeHolen("alt@example.com")) !== null) throw new Error("der abgelaufene Code muss weg sein");
    if ((await v.codeHolen("frisch@example.com")) === null) throw new Error("der gültige Code muss bleiben");
  });

  vertragstest("Codes verschiedener Adressen stören einander nicht", async (v) => {
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "aaa", gueltigBis: IN_ZEHN_MINUTEN });
    await v.codeHinterlegen({ email: "b@example.com", codeHash: "bbb", gueltigBis: IN_ZEHN_MINUTEN });
    await v.versuchZaehlen("a@example.com", IN_ZEHN_MINUTEN);
    await v.codeVerbrauchen("a@example.com");

    const b = await v.codeHolen("b@example.com");
    if (b === null || b.codeHash !== "bbb" || b.versuche !== 0) {
      throw new Error(`der Code der anderen Adresse muss unberührt bleiben, war ${JSON.stringify(b)}`);
    }
  });

  // Wer jemanden aussperrt, will nicht, dass ein bereits verschickter Code ihn noch hereinlässt.
  vertragstest("sperren verwirft auch einen offenen Code", async (v) => {
    await v.zulassen("a@example.com");
    await v.codeHinterlegen({ email: "a@example.com", codeHash: "abc", gueltigBis: IN_ZEHN_MINUTEN });
    await v.sperren("a@example.com");
    if ((await v.codeHolen("a@example.com")) !== null) throw new Error("der offene Code muss mit weg sein");
  });

  vertragstest("ein Anfangsbestand ist sofort zugelassen", async () => {
    const { verzeichnis, aufraeumen } = await erzeuge(["start@example.com"]);
    try {
      if (!(await verzeichnis.istZugelassen("start@example.com"))) {
        throw new Error("der Anfangsbestand muss übernommen werden");
      }
    } finally {
      await aufraeumen?.();
    }
  });
}
