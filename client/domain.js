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
