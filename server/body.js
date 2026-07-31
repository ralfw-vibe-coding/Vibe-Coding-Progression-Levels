import { pruefeKennung, suchbegriffe } from "./wertpapierKennung.js";
import { namenPassenZusammen } from "./symbolSuche.js";
import { nachAussichtSortiert } from "./kursProvider.js";

// Body: kennt die Domäne, nie den Event-Store. Er orchestriert das Zusammenspiel — das Portal
// (das UI des Servers) kennt nur dieses Interface.
//
// Auffällig ist, was hier fehlt: kein Speichern, kein Laden, kein "Zustand sichern". Der
// Event-Store hält seine Ereignisse selbst dauerhaft (siehe dateiEventStore.js), also gibt es
// dafür nichts mehr zu orchestrieren. Was im Browser "exportieren/importieren" hieß, heißt hier
// dump/restore — dieselben zwei Operationen, ohne den Dateidialog, der ein reines
// Browser-Thema ist und im Client geblieben ist.
// Neu in dieser Stufe: der Body kennt zwei externe Dienste — eine Kursquelle und einen
// Wechselkursdienst. Beides sind xProvider wie eh und je, nur liegen sie diesmal nicht auf der
// Platte, sondern hinter einer Leitung. Für den Body ändert das nichts an seiner Rolle; für
// die Fehlerbehandlung ändert es alles, denn ein Netz kann langsam sein, lügen oder fehlen.

/**
 * @param {ReturnType<import("./domain.js").createDomain>} domain
 * @param {Record<string, import("./kursProvider.js").KursProvider>} [kursquellen]
 *   Verzeichnis benannter Kursquellen. Jede Position wird bei genau *ihrer* Quelle abgefragt —
 *   nicht reihum bei allen. Ein Kurs gehört zu einem Handelsplatz; wer ihn woanders herholt,
 *   bekommt eine andere Zahl.
 * @param {{ kursNach: (waehrung: string, ziel?: string) => Promise<number> } | null} [wechselkurse]
 * @param {import("./symbolSuche.js").SymbolSuche | null} [symbolSuche]
 *   Getrennt von der Kursquelle: anderer Vertrag, andere Kompositionsregel (siehe symbolSuche.js).
 */
export function createBody(domain, kursquellen = {}, wechselkurse = null, symbolSuche = null) {
  // Kein Filter: Filtern ist eine reine Anzeigefrage und war noch nie Sache der Domäne.
  // Es bleibt deshalb dort, wo es hingehört — im Client, nah an der Oberfläche.
  function depotAbfragen() {
    return domain.positionenAbfragen();
  }

  function kaufErfassen(daten) {
    domain.kaufErfassen(daten);
    return domain.positionenAbfragen();
  }

  function kursupdateErfassen(daten) {
    domain.kursupdateErfassen(daten);
    return domain.positionenAbfragen();
  }

  // Workflow: eine neue Position braucht sowohl einen Kauf als auch einen aktuellen Kurs,
  // sonst wäre sie sofort "wertlos". Die Domäne kennt nur die beiden atomaren Commands,
  // die Komposition ist Wissen des Body — und bleibt es auch als API-Aufruf: eine Aktion des
  // Nutzers ist ein Aufruf, nicht zwei, von denen der zweite scheitern könnte.
  /**
   * Was bei der Symbolermittlung herauskam. `symbol` ist null, wenn keines gefunden wurde —
   * dann sagt `grund`, warum. Das ist eine Auskunft, kein Fehler: Der Kauf ist in jedem Fall
   * erfasst.
   * @typedef {{ symbol: string | null, art?: "manuell", quelle?: string, boerse?: string,
   *             waehrung?: string, kurs?: number,
   *             herkunft?: "eingegeben" | "gefunden", ueber?: string, weitere?: number,
   *             grund?: string, unsicher?: any[] }} SymbolAuskunft
   */
  /**
   * @param {{ wertpapierId: string, name: string, typ: string, broker?: string | null,
   *           stueck: number, kaufkurs: number, kurs: number, datum: string,
   *           kursbezug?: { quelle: string, symbol: string, boerse?: string, waehrung?: string } | null }} position
   * @returns {Promise<{ modell: any, symbol: SymbolAuskunft }>}
   */
  async function neuePositionErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, kurs, datum, kursbezug }) {
    // Neue Positionen brauchen eine Kennung, mit der sich später auch ein Kurs finden lässt.
    // Bestehende Positionen bleiben unberührt — ihre WKN wurde vergeben, als das noch ging.
    const geprueft = pruefeKennung(wertpapierId);
    if (!geprueft.ok) throw new Error(geprueft.grund);

    domain.kaufErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, datum });
    domain.kursupdateErfassen({ wertpapierId, kurs, datum });

    // Der Kauf ist damit erfasst — alles Weitere darf ihn nicht mehr gefährden.
    /** @type {SymbolAuskunft} */
    let symbolErgebnis;
    if (kursbezug?.symbol) {
      domain.kursbezugZuordnen({ wertpapierId, ...kursbezug });
      symbolErgebnis = { ...kursbezug, herkunft: "eingegeben" };
    } else {
      symbolErgebnis = await symbolErmitteln(wertpapierId, name);
      // Klappt die Ermittlung nicht, gilt die Position als manuell gepflegt — nicht als
      // offene Aufgabe. Für Emittenten-Zertifikate und kleine Werte gibt es schlicht keine
      // Quelle; das jedes Mal als Mangel zu melden wäre Lärm. Nachtragen bleibt jederzeit
      // möglich, dann wird wieder eine automatische daraus.
      if (!symbolErgebnis.symbol) {
        domain.alsManuellMarkieren({ wertpapierId });
        symbolErgebnis = { ...symbolErgebnis, art: "manuell" };
      }
    }

    return { modell: domain.positionenAbfragen(), symbol: symbolErgebnis };
  }

  // Sucht beim Erfassen selbsttätig ein Kurssymbol. Bewusst als Nachgang zum Kauf und mit
  // eingefangenen Fehlern: Ein Papier, dessen Symbol niemand kennt — oder ein Dienst, der
  // gerade nicht antwortet — darf nicht dazu führen, dass ein getätigter Kauf nicht erfasst
  // werden kann. Im Zweifel steht die Position ohne Symbol da, und das wird angezeigt.
  /** @returns {Promise<SymbolAuskunft>} */
  async function symbolErmitteln(wertpapierId, name) {
    if (!symbolSuche) return { symbol: null, grund: "keine Symbolsuche eingerichtet" };

    try {
      // Kandidaten aus *allen* Suchwegen sammeln, statt beim ersten Treffer aufzuhören.
      // Der Grund ist ein realer Fall: Für Check Point liefert die ISIN-Suche nur die
      // US-Notierung, das Papier notiert aber auch in Stuttgart in Euro — und diesen
      // Kandidaten kennt nur die Namenssuche. Wer beim ersten Weg stehenbleibt, nimmt einen
      // Dollarkurs, wo ein Eurokurs zu haben wäre.
      const kandidaten = [];
      const gesehen = new Set();
      let gefundenUeber = null;
      for (const begriff of [...suchbegriffe(wertpapierId), name].filter(Boolean)) {
        for (const tr of await symbolSuche.symboleSuchen(begriff)) {
          if (gesehen.has(tr.symbol)) continue;
          gesehen.add(tr.symbol);
          kandidaten.push(tr);
          gefundenUeber ??= begriff;
        }
      }
      if (kandidaten.length === 0) return { symbol: null, grund: "kein Kurssymbol gefunden" };

      // Nur zuordnen, was plausibel dasselbe Papier ist. Eine Suche liefert auch dann
      // etwas, wenn der Suchbegriff daneben lag — und ein falsch zugeordnetes Symbol
      // brächte ab dem nächsten Abruf fremde Kurse ins Depot, ohne dass es auffiele.
      const passende = kandidaten.filter((tr) => namenPassenZusammen(name, tr.name));
      if (passende.length === 0) {
        return {
          symbol: null,
          grund: `gefunden wurde etwas (${kandidaten.slice(0, 2).map((tr) => tr.symbol).join(", ")}), aber nichts davon passt zum Namen`,
          unsicher: kandidaten.slice(0, 5),
        };
      }

      // Gefunden heißt nicht abrufbar. Ein Anbieter führt ein Papier in seiner Datenbank
      // und liefert für dasselbe Symbol trotzdem keinen Kurs — weil der Handelsplatz nicht
      // im Tarif ist. Deshalb wird jeder Kandidat mit einem echten Abruf belegt, bevor er
      // zugeordnet wird. Erst ein Kurs macht aus einem Treffer einen Kursbezug.
      const belegt = await ersterMitKurs(passende);
      if (!belegt) {
        return {
          symbol: null,
          grund: `gefunden (${passende.slice(0, 3).map((tr) => tr.symbol).join(", ")}), aber keine Quelle liefert dafür einen Kurs`,
          unsicher: passende.slice(0, 5),
        };
      }

      // Übernommen wird der ganze Bezug — samt Quelle, Handelsplatz und Währung. Die
      // Währung stammt aus dem Probeabruf, nicht aus der Suche: Sie ist damit belegt.
      domain.kursbezugZuordnen({
        wertpapierId,
        quelle: belegt.treffer.quelle,
        symbol: belegt.treffer.symbol,
        boerse: belegt.treffer.boerse,
        waehrung: belegt.waehrung,
      });
      return {
        symbol: belegt.treffer.symbol,
        quelle: belegt.treffer.quelle,
        boerse: belegt.treffer.boerse,
        waehrung: belegt.waehrung,
        kurs: belegt.kurs,
        herkunft: "gefunden",
        ueber: gefundenUeber,
        weitere: passende.length - 1,
      };
    } catch (f) {
      return { symbol: null, grund: `Symbolsuche nicht möglich: ${f.message}` };
    }
  }

  // Probiert die Kandidaten der Reihe nach durch und nimmt den ersten, für den wirklich ein
  // Kurs kommt. Deutsche Handelsplätze zuerst: Das Depot rechnet in Euro, und ein hier
  // notiertes Papier erspart die Umrechnung samt ihrer Ungenauigkeit.
  //
  // Die Zahl der Versuche ist begrenzt — jeder kostet einen Aufruf beim Anbieter, und
  // Anfragelimits sind knapp. Fünf reichen: Wer bis dahin nichts liefert, liefert auch danach
  // nichts Brauchbares.
  async function ersterMitKurs(treffer, hoechstens = 5) {
    // Dieselbe Reihenfolge wie in der Trefferliste des Dialogs. Was die Anwendung von sich aus
    // wählt und was sie dem Nutzer oben hinlegt, soll dieselbe Begründung haben — sonst wären
    // es zwei Meinungen darüber, was aussichtsreich ist.
    const sortiert = nachAussichtSortiert(treffer, kursquellen);

    for (const kandidat of sortiert.slice(0, hoechstens)) {
      const quelle = kursquellen[kandidat.quelle];
      try {
        const ergebnis = (await quelle.kurseAbrufen([kandidat.symbol])).get(kandidat.symbol);
        if (ergebnis && ergebnis.fehler === undefined) {
          return { treffer: kandidat, kurs: ergebnis.kurs, waehrung: ergebnis.waehrung };
        }
      } catch {
        // eine Quelle, die gerade nicht antwortet, disqualifiziert den Kandidaten nicht
        // grundsätzlich — aber für diese Zuordnung nehmen wir eine, die nachweislich liefert
      }
    }
    return null;
  }

  /** @param {{ wertpapierId: string, broker?: string | null }} position */
  function positionsverlaufAbfragen({ wertpapierId, broker }) {
    return domain.positionsverlaufAbfragen({ wertpapierId, broker });
  }

  // Sucht Kurssymbole zu einer Eingabe. Gibt der Nutzer eine WKN ein, wird zusätzlich mit der
  // daraus abgeleiteten ISIN gesucht — die Quellen kennen die WKN nicht, die ISIN oft schon.
  // Der erste Begriff, der etwas findet, gewinnt; so bleibt die Trefferliste übersichtlich.
  //
  // Zurück kommt nicht, was die Suche gefunden hat, sondern was davon abrufbar ist: Kandidaten,
  // deren Quelle den Handelsplatz gar nicht bedienen darf, fallen vorher heraus. Sie wären
  // sonst der größte Teil der Liste — und jeder einzelne eine Sackgasse, die erst ein
  // Probeabruf offenlegt. Wie viele weggefallen sind, wird mitgeteilt: Verschwiegen wirkt eine
  // kurze Liste wie ein schlechtes Suchergebnis.
  async function symboleSuchen(eingabe) {
    if (!symbolSuche) throw new Error("Für diesen Server ist keine Symbolsuche eingerichtet.");

    for (const begriff of suchbegriffe(eingabe)) {
      const gefunden = await symbolSuche.symboleSuchen(begriff);
      if (gefunden.length === 0) continue;
      const treffer = nachAussichtSortiert(gefunden, kursquellen);
      return { begriff, treffer, ohneKursquelle: gefunden.length - treffer.length };
    }
    return { begriff: String(eingabe ?? "").trim(), treffer: [], ohneKursquelle: 0 };
  }

  // Holt probeweise einen Kurs für einen einzelnen Kandidaten. Damit lässt sich vor dem
  // Zuordnen zeigen, ob er überhaupt liefert — der Unterschied zwischen "in der Datenbank
  // vorhanden" und "für mich abrufbar" ist bei kostenlosen Tarifen die Regel, nicht die
  // Ausnahme. Ohne diese Probe sieht man den Unterschied erst beim ersten Aktualisieren,
  // als roten Punkt.
  /** @param {{ quelle: string, symbol: string }} kandidat */
  async function kursbezugPruefen({ quelle, symbol }) {
    const kursquelle = kursquellen[quelle];
    if (!kursquelle) return { ok: false, grund: `Kursquelle „${quelle}" ist nicht eingerichtet` };
    try {
      const ergebnis = (await kursquelle.kurseAbrufen([symbol])).get(symbol);
      if (!ergebnis || ergebnis.fehler !== undefined) {
        return { ok: false, grund: ergebnis?.fehler ?? "kein Ergebnis erhalten" };
      }
      return { ok: true, kurs: ergebnis.kurs, waehrung: ergebnis.waehrung };
    } catch (f) {
      return { ok: false, grund: f.message };
    }
  }

  // Übernimmt einen kompletten Kursbezug. Fehlt die Quelle, wäre später unklar, wen man
  // fragen soll — deshalb wird sie verlangt.
  /**
   * @param {{ wertpapierId: string, art?: "automatisch" | "manuell" | null,
   *           quelle?: string | null, symbol?: string | null,
   *           boerse?: string | null, waehrung?: string | null,
   *           nachschlagenUnter?: string | null }} bezug
   */
  function kursbezugZuordnen({ wertpapierId, art, quelle, symbol, boerse, waehrung, nachschlagenUnter }) {
    if (art === "manuell") domain.alsManuellMarkieren({ wertpapierId, nachschlagenUnter: pruefeLink(nachschlagenUnter) });
    else if (symbol && !quelle) throw new Error("Zu einem Symbol gehört die Quelle, bei der es gilt.");
    else if (symbol) domain.kursbezugZuordnen({ wertpapierId, quelle, symbol, boerse, waehrung });
    else domain.kursbezugEntfernen({ wertpapierId });
    return domain.positionenAbfragen();
  }

  // Nur http(s) wird als Nachschlage-Adresse übernommen. Der Wert landet später als Link in
  // der Oberfläche — ein "javascript:"-Eintrag wäre dort eine Einladung.
  function pruefeLink(wert) {
    const link = String(wert ?? "").trim();
    if (!link) return null;
    try {
      const url = new URL(link);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Als Nachschlage-Adresse sind nur http- und https-Links zulässig.");
      }
      return url.href;
    } catch {
      throw new Error(`„${link}" ist keine gültige Web-Adresse.`);
    }
  }

  // Holt für alle Positionen mit hinterlegtem Symbol den aktuellen Kurs und schreibt daraus
  // Kursupdates. Der Ablauf ist bewusst so gebaut, dass ein Fehlschlag immer nur *ein* Papier
  // betrifft: Was sich abrufen lässt, wird eingetragen, der Rest wird begründet gemeldet.
  //
  // Zurück kommt neben dem neuen Modell ein Bericht — je Wertpapier, ob es geklappt hat und
  // woran es sonst lag. Er wird nicht gespeichert: Er beschreibt diesen einen Abruf, nicht
  // das Depot.
  async function kurseAktualisieren() {
    const positionen = domain.positionenAbfragen().positionen;
    const bericht = [];

    // Nach Quelle gruppieren: Jede Quelle wird einmal gefragt, mit genau ihren Symbolen.
    // Dasselbe Papier bei mehreren Brokern taucht dabei nur einmal auf.
    const jeQuelle = new Map();
    const gesehen = new Set();
    for (const p of positionen) {
      if (gesehen.has(p.wertpapierId)) continue;
      gesehen.add(p.wertpapierId);

      const bezug = p.kursbezug;
      // Bewusst manuell gepflegte Positionen tauchen im Bericht gar nicht auf. Sie jedes Mal
      // als Fehlschlag zu melden wäre Lärm über eine Entscheidung, die längst getroffen ist.
      if (bezug?.art === "manuell") continue;
      if (!bezug) {
        bericht.push({ wertpapierId: p.wertpapierId, name: p.name, erfolg: false, grund: "Angaben für den Kursabruf fehlen noch" });
        continue;
      }
      // Alte Zuordnungen ohne Quelle: Sie sagen zwar ein Symbol, aber nicht, wen man fragen
      // soll — und raten wäre genau das, was hier nicht passieren darf.
      if (!bezug.quelle) {
        bericht.push({ wertpapierId: p.wertpapierId, name: p.name, symbol: bezug.symbol, erfolg: false, grund: "Kursbezug ohne Quelle — bitte neu zuordnen" });
        continue;
      }
      if (!kursquellen[bezug.quelle]) {
        bericht.push({ wertpapierId: p.wertpapierId, name: p.name, symbol: bezug.symbol, erfolg: false, grund: `Kursquelle „${bezug.quelle}" ist nicht eingerichtet` });
        continue;
      }
      if (!jeQuelle.has(bezug.quelle)) jeQuelle.set(bezug.quelle, []);
      jeQuelle.get(bezug.quelle).push({ wertpapierId: p.wertpapierId, name: p.name, bezug });
    }

    const heute = new Date().toISOString().slice(0, 10);

    for (const [quellenName, eintraege] of jeQuelle) {
      const quelle = kursquellen[quellenName];
      const symbole = [...new Set(eintraege.map((e) => e.bezug.symbol))];

      let ergebnisse;
      try {
        ergebnisse = await quelle.kurseAbrufen(symbole);
      } catch (f) {
        // Fällt eine Quelle aus, betrifft das nur ihre Papiere — die anderen Quellen laufen
        // weiter. Kein Ausweichen auf eine fremde Quelle: Die liefert einen anderen Kurs.
        for (const e of eintraege) {
          bericht.push({ ...kennung(e), erfolg: false, grund: `${quellenName} nicht erreichbar: ${f.message}`, quelle: quellenName });
        }
        continue;
      }

      for (const e of eintraege) {
        const ergebnis = ergebnisse.get(e.bezug.symbol);
        if (!ergebnis || ergebnis.fehler !== undefined) {
          bericht.push({ ...kennung(e), erfolg: false, grund: ergebnis?.fehler ?? "kein Ergebnis erhalten", quelle: quellenName });
          continue;
        }

        // Die erwartete Währung stammt aus der Zuordnung. Weicht die gelieferte davon ab,
        // stimmt etwas nicht — womöglich meint das Symbol inzwischen ein anderes Papier.
        // Lieber nachfragen lassen als eine falsche Zahl übernehmen.
        if (e.bezug.waehrung && ergebnis.waehrung !== e.bezug.waehrung) {
          bericht.push({
            ...kennung(e), erfolg: false, quelle: quellenName,
            grund: `erwartet wurde ${e.bezug.waehrung}, geliefert ${ergebnis.waehrung} — bitte Zuordnung prüfen`,
          });
          continue;
        }

        let kurs = ergebnis.kurs;
        if (ergebnis.waehrung !== "EUR") {
          if (!wechselkurse) {
            bericht.push({ ...kennung(e), erfolg: false, grund: `Kurs in ${ergebnis.waehrung}, keine Umrechnung eingerichtet`, quelle: quellenName });
            continue;
          }
          try {
            kurs = kurs * await wechselkurse.kursNach(ergebnis.waehrung, "EUR");
          } catch (f) {
            bericht.push({ ...kennung(e), erfolg: false, grund: `Kurs in ${ergebnis.waehrung}, Umrechnung fehlgeschlagen: ${f.message}`, quelle: quellenName });
            continue;
          }
        }

        domain.kursupdateErfassen({ wertpapierId: e.wertpapierId, kurs, datum: heute });
        bericht.push({
          ...kennung(e), erfolg: true, kurs, quelle: quellenName,
          umgerechnetAus: ergebnis.waehrung === "EUR" ? null : ergebnis.waehrung,
        });
      }
    }

    return { modell: domain.positionenAbfragen(), bericht };
  }

  function kennung(e) {
    return { wertpapierId: e.wertpapierId, name: e.name, symbol: e.bezug.symbol, boerse: e.bezug.boerse };
  }

  // Der vollständige Ereignisbestand, roh — Grundlage für den Export im Client.
  function dump() {
    return domain.dump();
  }

  // Spielt einen kompletten Bestand ein — der Gegenpart zum Import im Client.
  function restore(events) {
    domain.restore(events);
    return domain.positionenAbfragen();
  }

  return {
    depotAbfragen, kaufErfassen, kursupdateErfassen, neuePositionErfassen,
    kursbezugZuordnen, kursbezugPruefen, symboleSuchen, kurseAktualisieren, positionsverlaufAbfragen, dump, restore,
  };
}
