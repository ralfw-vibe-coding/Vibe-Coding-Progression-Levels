// Provider: kapselt die Ressource "Browser-Speicher". Bekommt das Storage-Objekt injiziert
// (im Browser localStorage, in Tests ein einfaches Fake) statt es selbst zu kennen — genau wie
// der Event-Store nichts von Domäne oder UI weiß, weiß dieser Provider nichts von Events oder
// Domänenlogik. Er speichert und lädt schlicht eine Liste, wörtlich als JSON.
function createLocalStorageProvider(storage, schluessel) {
  function laden() {
    const roh = storage.getItem(schluessel);
    return roh ? JSON.parse(roh) : [];
  }

  function speichern(daten) {
    storage.setItem(schluessel, JSON.stringify(daten));
  }

  return { laden, speichern };
}

if (typeof module !== "undefined") {
  module.exports = { createLocalStorageProvider };
}
