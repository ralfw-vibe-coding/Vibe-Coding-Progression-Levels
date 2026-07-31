// Domäne des Clients — bewusst dünn. Die Fachlogik des Depots (was ein Kauf bedeutet, wie
// sich ein Depotwert ergibt) liegt weiterhin ausschließlich im Server. Hier steht nur, was
// mit bereits geladenen Daten im Client geschieht: sie filtern und für die Darstellung
// projizieren.
//
// Beides lag bis Stufe 6 unbenannt zwischen Frontend-Body und index.html verstreut. Als
// eigene Schicht ist es testbar, und das Portal muss die Ergebnisse nur noch binden statt sie
// selbst auszurechnen. Alles hier ist rein rechnerisch: keine Farben, kein Markup, kein DOM.

// Filtern verändert nicht, was das Depot wert ist, sondern nur, welcher Ausschnitt davon zu
// sehen ist. Depotwert, Kaufwert, Veränderung und anteilAmDepot bleiben deshalb unangetastet
// — sie beschreiben weiterhin das ganze Depot. Ebenso bekannteBroker: sonst würde die
// Filterleiste die Auswahl verlieren, die sie gerade selbst getroffen hat.
export function filtern(modell, filter) {
  if (!filter) return modell;
  let positionen = modell.positionen;
  if (filter.suchbegriff) {
    const suchbegriff = filter.suchbegriff.toLowerCase();
    positionen = positionen.filter((p) => p.name.toLowerCase().includes(suchbegriff));
  }
  if (filter.typen && filter.typen.length > 0) {
    positionen = positionen.filter((p) => filter.typen.includes(p.typ));
  }
  if (filter.broker && filter.broker.length > 0) {
    positionen = positionen.filter((p) => filter.broker.includes(p.broker));
  }
  return { ...modell, positionen };
}

// Summiert wert und kaufwert je Gruppe, damit sich daraus (wie bei einer einzelnen Position)
// eine gruppenweite Gewinn/Verlust-Quote ableiten lässt. kaufwertBekannt bleibt false, solange
// keine einzige Position der Gruppe einen bekannten Kaufwert hat — dann gibt es auch
// gruppenweit keine sinnvolle Prozentangabe.
function gruppieren(positionen, schluesselFn) {
  const gruppen = new Map();
  for (const p of positionen) {
    const schluessel = schluesselFn(p);
    let agg = gruppen.get(schluessel);
    if (!agg) {
      agg = { wert: 0, kaufwert: 0, kaufwertBekannt: false };
      gruppen.set(schluessel, agg);
    }
    agg.wert += p.wert;
    if (p.kaufwert != null) {
      agg.kaufwert += p.kaufwert;
      agg.kaufwertBekannt = true;
    }
  }
  return [...gruppen.entries()]
    .map(([label, agg]) => ({
      label,
      wert: agg.wert,
      diffPct: agg.kaufwertBekannt && agg.kaufwert ? ((agg.wert - agg.kaufwert) / agg.kaufwert) * 100 : null,
    }))
    .sort((a, b) => b.wert - a.wert);
}

export function zusammensetzungNachTyp(positionen) {
  return gruppieren(positionen, (p) => p.typ);
}

export function zusammensetzungNachBroker(positionen) {
  return gruppieren(positionen, (p) => p.broker || "Ohne Broker");
}

// Nur bewertete Positionen: ohne bekannten Kaufwert gibt es keinen Gewinn und keinen Verlust,
// so eine Position gehört in keine der beiden Richtungen einsortiert.
export function gewinnerUndVerlierer(positionen) {
  return positionen.filter((p) => p.diffPct != null).sort((a, b) => b.diffPct - a.diffPct);
}

export function konzentration(positionen) {
  return positionen.slice().sort((a, b) => b.anteilAmDepot - a.anteilAmDepot);
}

// --- Kurspflege: wie eine Position zu ihren Kursen kommt, und wie alt der letzte ist -------

// Ab wann ein Kurs als veraltet gilt. Bewusst großzügig: Wer Positionen über Jahre hält,
// braucht keinen tagesaktuellen Kurs — ein zwei Wochen alter Stand ist für die Frage
// "wie steht mein Depot?" völlig ausreichend. Erst nach einem Quartal wird die Zahl so
// unscharf, dass sie in die Irre führen kann.
export const VERALTET_AB_TAGEN = 90;

const TAG_IN_MS = 24 * 60 * 60 * 1000;

/** Alter des angezeigten Kurses in Tagen. null, wenn es gar keinen gibt. */
export function kursAlterInTagen(position, heute) {
  if (!position.kursDatum) return null;
  const kurs = Date.parse(position.kursDatum.slice(0, 10));
  const jetzt = Date.parse(String(heute).slice(0, 10));
  if (Number.isNaN(kurs) || Number.isNaN(jetzt)) return null;
  return Math.max(0, Math.round((jetzt - kurs) / TAG_IN_MS));
}

export function istKursVeraltet(position, heute) {
  const alter = kursAlterInTagen(position, heute);
  return alter !== null && alter > VERALTET_AB_TAGEN;
}

// Drei Zustände, die im Alltag ganz Verschiedenes bedeuten:
//   automatisch — läuft von selbst, nichts zu tun
//   manuell     — bewusst ohne Quelle; hier lohnt ein Blick, wenn der Kurs alt wird
//   offen       — die Angaben fehlen noch; eine Aufgabe, kein Dauerzustand
export function kurspflege(position) {
  return position.kursbezug?.art ?? "offen";
}

// Wo sich Handarbeit lohnt: manuell gepflegte Positionen mit veraltetem Kurs, die größten
// zuerst — bei einer Position mit 60 % Depotanteil fällt ein alter Kurs schwerer ins Gewicht
// als bei einer mit 0,8 %.
export function handarbeitNoetig(positionen, heute) {
  return positionen
    .filter((p) => kurspflege(p) === "manuell" && istKursVeraltet(p, heute))
    .sort((a, b) => b.anteilAmDepot - a.anteilAmDepot);
}

// Fasst eine Trefferliste als Text zusammen, den man einer KI vorlegen kann.
//
// Der Anlass ist ein realer Arbeitsablauf: Die Suche liefert mehrere Kandidaten, und welcher
// davon das eigene Papier ist, sieht man ihnen nicht immer an — EWG2 und EWG2.SG können
// dasselbe sein oder auch nicht. Statt zu raten, legt man die Liste jemandem vor, der die
// Papiere kennt.
//
// Deshalb steht im Text nicht nur die Liste, sondern auch die Frage und der Zusammenhang:
// welche Position gesucht wird, womit gesucht wurde, und worauf es bei der Wahl ankommt.
// Ein Text ohne Frage wäre nur ein Datenauszug.
export function suchtrefferAlsText({ name, wertpapierId, begriff, treffer }) {
  const zeilen = [];
  zeilen.push("Ich suche das passende Kurssymbol für eine Position in meinem Wertpapierdepot.");
  zeilen.push("");
  zeilen.push("Die Position:");
  zeilen.push(`- Name: ${name}`);
  zeilen.push(`- Kennung: ${wertpapierId}`);
  if (begriff && begriff !== wertpapierId) zeilen.push(`- gesucht wurde mit: ${begriff}`);
  zeilen.push("");

  if (treffer.length === 0) {
    zeilen.push("Gefunden wurde nichts.");
    zeilen.push("");
    zeilen.push("Frage: Unter welchem Namen oder welcher Kennung ist dieses Papier sonst zu finden?");
    return zeilen.join("\n");
  }

  zeilen.push(`Kandidaten, für die tatsächlich ein Kurs abrufbar ist (${treffer.length}):`);
  for (const t of treffer) {
    const teile = [
      t.symbol,
      t.name || "ohne Namensangabe",
      t.boerse ? `Börse ${t.boerse}` : "Börse unbekannt",
      `Quelle ${t.quelle}`,
      // Der abgerufene Kurs ist die eigentliche Entscheidungshilfe: Ob ein Kandidat das
      // richtige Papier ist, sieht man am ehesten an der Größenordnung. Ein Kürzel sagt
      // wenig, 15,87 € gegen 77,17 € sagt alles.
      kursText(t),
    ];
    zeilen.push(`- ${teile.filter(Boolean).join(" — ")}`);
  }
  zeilen.push("");
  zeilen.push("Frage: Welcher dieser Kandidaten gehört zu der genannten Position?");
  zeilen.push("Bitte genau einen auswählen und kurz begründen. Falls keiner passt, das bitte sagen.");
  zeilen.push("Der abgerufene Kurs steht dabei — er sollte zur Größenordnung des Papiers passen.");
  zeilen.push("Fremdwährungen sind kein Ausschlussgrund, sie werden umgerechnet.");
  return zeilen.join("\n");
}

function kursText(t) {
  if (!t.geprueft?.ok) return "Kurs noch nicht abgerufen";
  const zahl = t.geprueft.kurs.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `Kurs ${zahl} ${t.geprueft.waehrung ?? ""}`.trim();
}
