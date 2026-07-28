// Body: kennt die Domäne, nie den Event-Store. Er orchestriert das Zusammenspiel — das Portal
// (das UI des Servers) kennt nur dieses Interface.
//
// Auffällig ist, was hier fehlt: kein Speichern, kein Laden, kein "Zustand sichern". Der
// Event-Store hält seine Ereignisse selbst dauerhaft (siehe dateiEventStore.js), also gibt es
// dafür nichts mehr zu orchestrieren. Was im Browser "exportieren/importieren" hieß, heißt hier
// dump/restore — dieselben zwei Operationen, ohne den Dateidialog, der ein reines
// Browser-Thema ist und im Client geblieben ist.
export function createBody(domain) {
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
   * @param {{ wertpapierId: string, name: string, typ: string, broker?: string | null,
   *           stueck: number, kaufkurs: number, kurs: number, datum: string }} position
   */
  function neuePositionErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, kurs, datum }) {
    domain.kaufErfassen({ wertpapierId, name, typ, broker, stueck, kaufkurs, datum });
    domain.kursupdateErfassen({ wertpapierId, kurs, datum });
    return domain.positionenAbfragen();
  }

  /** @param {{ wertpapierId: string, broker?: string | null }} position */
  function positionsverlaufAbfragen({ wertpapierId, broker }) {
    return domain.positionsverlaufAbfragen({ wertpapierId, broker });
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
    positionsverlaufAbfragen, dump, restore,
  };
}
