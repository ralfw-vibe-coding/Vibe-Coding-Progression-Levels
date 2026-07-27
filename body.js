// Body: kennt die Domäne und weitere Provider (hier: Persistenz), nicht den Event-Store
// selbst. Setzt Domänen-Funktionen zu Workflows zusammen. Das Frontend kennt nur dieses
// Interface — insbesondere weiß es nichts davon, dass und wie erfasste Daten überleben.
function createBody(domain, persistenz) {
  function nachAenderungSpeichern() {
    persistenz.speichern(domain.alleEreignisseAbfragen());
  }

  // filter ist optional: { suchbegriff, typen }. Suchbegriff wird gegen den Namen geprüft
  // (Groß-/Kleinschreibung egal), typen ist eine Liste erlaubter Typ-Werte. Depotwert,
  // Kaufwert und Veränderung bleiben unverändert vom Filter — sie beschreiben weiterhin das
  // ganze Depot, nicht nur den sichtbaren Ausschnitt. Ebenso bleibt anteilAmDepot je Position
  // depot-weit, weil das schon von der Domäne aus dem vollständigen Bestand berechnet wurde.
  function depotAbfragen(filter) {
    const modell = domain.positionenAbfragen();
    if (!filter) return modell;
    let positionen = modell.positionen;
    if (filter.suchbegriff) {
      const suchbegriff = filter.suchbegriff.toLowerCase();
      positionen = positionen.filter((p) => p.name.toLowerCase().includes(suchbegriff));
    }
    if (filter.typen && filter.typen.length > 0) {
      positionen = positionen.filter((p) => filter.typen.includes(p.typ));
    }
    return { ...modell, positionen };
  }

  function kaufErfassen(daten) {
    domain.kaufErfassen(daten);
    nachAenderungSpeichern();
    return domain.positionenAbfragen();
  }

  function kursupdateErfassen(daten) {
    domain.kursupdateErfassen(daten);
    nachAenderungSpeichern();
    return domain.positionenAbfragen();
  }

  // Workflow: eine neue Position braucht sowohl einen Kauf als auch einen aktuellen Kurs,
  // sonst wäre sie sofort "wertlos". Die Domäne kennt nur die beiden atomaren Commands,
  // die Komposition ist Wissen des Body.
  function neuePositionErfassen({ wertpapierId, name, typ, stueck, kaufkurs, kurs, datum }) {
    domain.kaufErfassen({ wertpapierId, name, typ, stueck, kaufkurs, datum });
    domain.kursupdateErfassen({ wertpapierId, kurs, datum });
    nachAenderungSpeichern();
    return domain.positionenAbfragen();
  }

  function positionsverlaufAbfragen(wertpapierId) {
    return domain.positionsverlaufAbfragen(wertpapierId);
  }

  return {
    depotAbfragen, kaufErfassen, kursupdateErfassen,
    neuePositionErfassen, positionsverlaufAbfragen,
  };
}

if (typeof module !== "undefined") {
  module.exports = { createBody };
}
