// xProvider (External-Resource-Provider): kapselt die Ressource "Browser-Speicher". Kennt
// weder Domäne noch Ereignis-Semantik — er legt eine Liste ab und gibt sie wieder heraus.
// Das Storage-Objekt wird injiziert (im Browser localStorage, in Tests ein Fake).
function createLocalStorageProvider(storage, schluessel) {
  function get() {
    const roh = storage.getItem(schluessel);
    return roh ? JSON.parse(roh) : [];
  }

  function set(daten) {
    storage.setItem(schluessel, JSON.stringify(daten));
  }

  return { get, set };
}

if (typeof module !== "undefined") {
  module.exports = { createLocalStorageProvider };
}
