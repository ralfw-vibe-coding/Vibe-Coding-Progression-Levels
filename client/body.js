// Body des Clients: kennt die Client-Domäne und die xProvider (Backend-Proxy, Datei-Im-/
// Export). Er orchestriert deren Zusammenspiel — das Portal kennt nur dieses Interface und
// erfährt nie, dass hinter dem Depot ein Server steht.
//
// Neu gegenüber Stufe 6 ist die gehaltene Kopie des zuletzt vom Server gelieferten Modells.
// Sie ist der Grund, warum Filtern und Dashboard ohne jeden Netzwerkaufruf auskommen: der
// Server liefert den Bestand, alles Weitere rechnet die Client-Domäne daraus aus. Ohne diese
// Kopie ginge bei jedem Tastenanschlag in der Suche eine Anfrage über die Leitung.
export function createBody(backend, imExport, domain) {
  let modell = { depotwert: 0, kaufwertGesamt: 0, veraenderungAbs: 0, veraenderungPct: 0, positionen: [], bekannteBroker: [] };

  async function initialisieren() {
    modell = await backend.depotAbfragen();
    return modell;
  }

  // Rein lokal: filtert die gehaltene Kopie, kein Netzwerkaufruf.
  function depotAbfragen(filter) {
    return domain.filtern(modell, filter);
  }

  // Jede Erfassung liefert vom Server das neue Gesamtmodell zurück — damit ist die Kopie
  // sofort wieder aktuell, ohne dass extra nachgeladen werden müsste. Persistiert wird
  // serverseitig bei jedem dieser Aufrufe; ein eigenes "Sichern" gibt es im Client nicht mehr.
  async function kaufErfassen(daten) {
    modell = await backend.kaufErfassen(daten);
    return modell;
  }

  async function kursupdateErfassen(daten) {
    modell = await backend.kursupdateErfassen(daten);
    return modell;
  }

  async function neuePositionErfassen(daten) {
    modell = await backend.neuePositionErfassen(daten);
    return modell;
  }

  function positionsverlaufAbfragen({ wertpapierId, broker }) {
    return backend.positionsverlaufAbfragen({ wertpapierId, broker });
  }

  // Dashboard-Projektionen über den vollen, ungefilterten Bestand: das Dashboard zeigt immer
  // das ganze Depot, unabhängig vom Filter der Positionen-Seite.
  function dashboardAbfragen() {
    return {
      nachTyp: domain.zusammensetzungNachTyp(modell.positionen),
      nachBroker: domain.zusammensetzungNachBroker(modell.positionen),
      gewinnerUndVerlierer: domain.gewinnerUndVerlierer(modell.positionen),
      konzentration: domain.konzentration(modell.positionen),
    };
  }

  // Der Export bleibt sinnvoll, obwohl der Server jetzt durchgehend persistiert: eine Datei
  // ist sichtbar, portabel und gehört dem Nutzer (siehe Stufe 5). Nur ist sie kein
  // Sicherheitsnetz mehr, sondern eine bewusste Kopie.
  async function exportieren() {
    imExport.export(await backend.dump());
  }

  // Gibt null zurück, wenn der Nutzer den Dateidialog abbricht.
  async function importieren() {
    const events = await imExport.import();
    if (!events) return null;
    modell = await backend.restore(events);
    return modell;
  }

  return {
    initialisieren, depotAbfragen, dashboardAbfragen, kaufErfassen, kursupdateErfassen,
    neuePositionErfassen, positionsverlaufAbfragen, exportieren, importieren,
  };
}
