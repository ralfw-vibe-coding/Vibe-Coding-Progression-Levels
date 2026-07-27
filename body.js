// Body: kennt die Domäne und die xProvider (Browser-Speicher, Datei-Im-/Export), nie den
// Event-Store. Er orchestriert das Zusammenspiel — die Domäne weiß nichts von Speicherung,
// die Provider nichts von Fachlichkeit. Das Frontend kennt nur dieses Interface.
function createBody(domain, speicher, imExport) {
  function zustandSichern() {
    speicher.set(domain.dump());
  }

  // Einmal beim Laden der Seite: was zuletzt im Browser lag, wird zum Zustand der Domäne.
  function initialisieren() {
    domain.initialize(speicher.get());
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
    zustandSichern();
    return domain.positionenAbfragen();
  }

  function kursupdateErfassen(daten) {
    domain.kursupdateErfassen(daten);
    zustandSichern();
    return domain.positionenAbfragen();
  }

  // Workflow: eine neue Position braucht sowohl einen Kauf als auch einen aktuellen Kurs,
  // sonst wäre sie sofort "wertlos". Die Domäne kennt nur die beiden atomaren Commands,
  // die Komposition ist Wissen des Body.
  function neuePositionErfassen({ wertpapierId, name, typ, stueck, kaufkurs, kurs, datum }) {
    domain.kaufErfassen({ wertpapierId, name, typ, stueck, kaufkurs, datum });
    domain.kursupdateErfassen({ wertpapierId, kurs, datum });
    zustandSichern();
    return domain.positionenAbfragen();
  }

  function positionsverlaufAbfragen(wertpapierId) {
    return domain.positionsverlaufAbfragen(wertpapierId);
  }

  function exportieren() {
    imExport.export(domain.dump());
  }

  // Importierte Ereignisse ersetzen den bisherigen Zustand vollständig — und werden sofort
  // zum neuen Inhalt des Browser-Speichers, damit beides wieder deckungsgleich ist.
  // Gibt null zurück, wenn der Nutzer den Dateidialog abbricht.
  async function importieren() {
    const events = await imExport.import();
    if (!events) return null;
    domain.initialize(events);
    zustandSichern();
    return domain.positionenAbfragen();
  }

  return {
    initialisieren, depotAbfragen, kaufErfassen, kursupdateErfassen,
    neuePositionErfassen, positionsverlaufAbfragen, exportieren, importieren,
  };
}

if (typeof module !== "undefined") {
  module.exports = { createBody };
}
