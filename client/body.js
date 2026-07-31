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

  // Der Server versucht beim Erfassen selbst, ein Kurssymbol zu finden. Was dabei
  // herauskam, kommt als Auskunft zurück — das Portal zeigt es dem Nutzer.
  async function neuePositionErfassen(daten) {
    const { modell: neuesModell, symbol } = await backend.neuePositionErfassen(daten);
    modell = neuesModell;
    return symbol;
  }

  function positionsverlaufAbfragen({ wertpapierId, broker }) {
    return backend.positionsverlaufAbfragen({ wertpapierId, broker });
  }

  // Reine Auskunft: Das Depot ändert sich dabei nicht, also auch nicht das gehaltene Modell.
  function symboleSuchen(begriff) {
    return backend.symboleSuchen(begriff);
  }

  // Reine Auskunft: ändert nichts am Depot, beantwortet nur "liefert dieser Kandidat?"
  function kursbezugPruefen(daten) {
    return backend.kursbezugPruefen(daten);
  }

  async function kursbezugZuordnen(daten) {
    modell = await backend.kursbezugZuordnen(daten);
    return modell;
  }

  // Der Bericht sagt je Wertpapier, ob der Abruf geklappt hat. Er wird nicht aufbewahrt: Er
  // beschreibt genau diesen einen Versuch — beim nächsten Laden der Seite ist er hinfällig.
  async function kurseAktualisieren() {
    const { modell: neuesModell, bericht } = await backend.kurseAktualisieren();
    modell = neuesModell;
    return bericht;
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

  // Wann zuletzt ein Kurs eingetroffen ist, steht schon im Bestand — es ist das jüngste
  // Kursdatum aller Positionen. Dafür braucht es keinen zusätzlichen gespeicherten Zeitpunkt,
  // der mit der Wirklichkeit auseinanderlaufen könnte.
  function letzteAktualisierung() {
    const datumsangaben = modell.positionen.map((p) => p.kursDatum).filter(Boolean).sort();
    return datumsangaben.length ? datumsangaben[datumsangaben.length - 1] : null;
  }

  return {
    initialisieren, depotAbfragen, dashboardAbfragen, kaufErfassen, kursupdateErfassen,
    neuePositionErfassen, kursbezugZuordnen, kursbezugPruefen, symboleSuchen, kurseAktualisieren, letzteAktualisierung,
    positionsverlaufAbfragen, exportieren, importieren,
  };
}
