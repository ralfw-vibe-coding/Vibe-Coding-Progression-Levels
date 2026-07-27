// xProvider (External-Resource-Provider): kapselt die Ressource "Datei". Hier steckt die
// Technologiefeinheit, die im Browser nun mal DOM ist — Dateiauswahl über ein <input>,
// Download über einen <a>-Klick. Bewusst trivial gehalten: ein manueller Test zeigt sofort,
// ob es funktioniert. In automatisierten Tests wird dieser Provider komplett gemockt.
export function createImExportProvider() {
  // Öffnet den Dateidialog und liefert die gelesenen Ereignisse.
  // null, wenn der Nutzer abbricht.
  function importieren() {
    return new Promise((resolve, reject) => {
      const eingabe = document.createElement("input");
      eingabe.type = "file";
      eingabe.accept = "application/json,.json";
      eingabe.addEventListener("cancel", () => resolve(null));
      eingabe.addEventListener("change", async () => {
        const datei = eingabe.files[0];
        if (!datei) return resolve(null);
        try {
          const events = JSON.parse(await datei.text());
          if (!Array.isArray(events)) throw new Error("Datei enthält keine Ereignisliste.");
          resolve(events);
        } catch (fehler) {
          reject(fehler);
        }
      });
      eingabe.click();
    });
  }

  function exportieren(events) {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `depot-events-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return { import: importieren, export: exportieren };
}
