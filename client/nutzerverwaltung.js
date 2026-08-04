// Die Nutzerverwaltung des Verwalters: wer darf herein, wer nicht mehr.
//
// Ein Dialog und keine eigene Seite. Eine dritte Route zöge Änderungen in client/portal.js nach
// sich — die größte und einzige ungetestete Datei des Clients —, und sie passte auch nicht zur
// Nutzungshäufigkeit: Man trägt jemanden ein und schließt das Fenster wieder.
//
// Wie der Anmeldeschirm ist dieses Modul reine Oberfläche und deshalb nicht automatisiert
// getestet. Die Regel, auf die es ankommt — dass nur der Verwalter das darf —, steht im Portal
// und ist dort geprüft. Dieser Knopf ist nur die bequeme Fassade davor; wer ihn per Werkzeug
// umgeht, kommt trotzdem nicht weiter.

/**
 * @param {*} backend Der Backend-Proxy.
 * @param {{ eigeneEmail: string | null }} optionen
 */
export function createNutzerverwaltung(backend, { eigeneEmail = null } = {}) {
  const dialog = document.getElementById("dialog-nutzer");
  const form = document.getElementById("form-nutzer");
  const feld = document.getElementById("nutzer-email");
  const liste = document.getElementById("nutzer-liste");
  const meldung = document.getElementById("nutzer-meldung");

  function melden(text) {
    meldung.textContent = text ?? "";
  }

  function zeichnen(eintraege) {
    if (eintraege.length === 0) {
      liste.innerHTML = `<div class="feld-hinweis">Außer dir ist noch niemand freigeschaltet.</div>`;
      return;
    }
    liste.innerHTML = eintraege.map((n) => `
      <div class="nutzer-zeile">
        <span class="nutzer-email">${n.email}</span>
        <button type="button" class="nutzer-entfernen" data-email="${n.email}"
                aria-label="${n.email} entfernen">entfernen</button>
      </div>`).join("");
  }

  async function laden() {
    melden("");
    try {
      zeichnen(await backend.nutzerAuflisten());
    } catch (fehler) {
      melden(fehler.message);
    }
  }

  async function oeffnen() {
    form.reset();
    liste.innerHTML = "";
    dialog.showModal();
    await laden();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = feld.value.trim();
    if (!email) return;
    try {
      zeichnen(await backend.nutzerZulassen(email));
      form.reset();
      melden("");
    } catch (fehler) {
      melden(fehler.message);
    }
  });

  liste.addEventListener("click", async (e) => {
    const knopf = e.target.closest(".nutzer-entfernen");
    if (!knopf) return;
    const email = knopf.dataset.email;
    // Einmal nachfragen: Ein Fehlklick sperrt sonst jemanden aus, und zwar sofort — sein Token
    // verliert augenblicklich seine Wirkung, nicht erst beim nächsten Anmelden.
    if (!confirm(`${email} den Zugang entziehen?`)) return;
    try {
      zeichnen(await backend.nutzerSperren(email));
      melden("");
    } catch (fehler) {
      melden(fehler.message);
    }
  });

  // Der eigene Eintrag steht nicht in der Liste — der Verwalter kommt über die Konfiguration
  // herein. Damit das nicht wie ein Fehler aussieht, wird es einmal gesagt.
  if (eigeneEmail) {
    document.getElementById("nutzer-verwalter").textContent = eigeneEmail;
  }

  return { oeffnen };
}
