// Der Anmeldeschirm: zwei Schritte in einer Karte — Adresse eingeben, Code eingeben.
//
// Wie client/portal.js ist dieses Modul reine Oberfläche und deshalb nicht automatisiert
// getestet; geprüft wird es beim Benutzen. Das ist eine bewusste Grenze und keine vergessene
// Aufgabe: Was hier steht, sind DOM-Aufrufe und Beschriftungen. Die Regeln, auf die es
// ankommt — wer hereindarf, wie lange ein Code gilt, wie oft man raten kann — liegen im Server
// und sind dort ausführlich geprüft.
//
// Fehler erscheinen als Text *in* der Karte, nicht als alert(). Beim Anmelden ist die Meldung
// der eigentliche Inhalt ("die Adresse kennt niemand", "noch drei Versuche") und keine Störung
// des Ablaufs.

const SPEICHERSCHLUESSEL = "mein-depot.token";

/**
 * @param {*} backend Der Backend-Proxy.
 * @param {{ beiErfolg: (token: string) => void }} optionen
 */
export function createAnmeldeSchirm(backend, { beiErfolg }) {
  const schirm = document.getElementById("anmeldung");
  const formAdresse = document.getElementById("form-anmeldung-adresse");
  const formCode = document.getElementById("form-anmeldung-code");
  const feldAdresse = document.getElementById("anmeldung-email");
  const feldCode = document.getElementById("anmeldung-code");
  const meldung = document.getElementById("anmeldung-meldung");
  const empfaenger = document.getElementById("anmeldung-empfaenger");
  const zurueck = document.getElementById("anmeldung-zurueck");

  let adresse = "";

  function zeigen() {
    document.querySelector("main").hidden = true;
    schirm.hidden = false;
    schrittAdresse();
  }

  function verbergen() {
    schirm.hidden = true;
  }

  function schrittAdresse() {
    formAdresse.hidden = false;
    formCode.hidden = true;
    melden("");
    feldAdresse.focus();
  }

  function schrittCode() {
    formAdresse.hidden = true;
    formCode.hidden = false;
    empfaenger.textContent = adresse;
    feldCode.value = "";
    melden("");
    feldCode.focus();
  }

  function melden(text, art = "fehler") {
    meldung.textContent = text;
    meldung.className = text ? `anmeldung-meldung ${art}` : "anmeldung-meldung";
  }

  // Beide Formulare sperren ihren Knopf, solange die Anfrage läuft: Ein zweiter Klick würde
  // sonst einen zweiten Code anfordern und den ersten damit ungültig machen — der Nutzer hätte
  // dann den falschen im Postfach.
  async function mitSperre(form, aktion) {
    const knopf = form.querySelector("button[type=submit]");
    const beschriftung = knopf.textContent;
    knopf.disabled = true;
    knopf.textContent = "Moment …";
    try {
      await aktion();
    } catch (fehler) {
      melden(fehler.message);
    } finally {
      knopf.disabled = false;
      knopf.textContent = beschriftung;
    }
  }

  formAdresse.addEventListener("submit", (e) => {
    e.preventDefault();
    mitSperre(formAdresse, async () => {
      adresse = feldAdresse.value.trim();
      if (!adresse) return;
      await backend.codeAnfordern(adresse);
      schrittCode();
      melden("Der Code ist unterwegs. Er gilt zehn Minuten.", "hinweis");
    });
  });

  formCode.addEventListener("submit", (e) => {
    e.preventDefault();
    mitSperre(formCode, async () => {
      const { token } = await backend.codeEinloesen(adresse, feldCode.value.trim());
      localStorage.setItem(SPEICHERSCHLUESSEL, token);
      beiErfolg(token);
    });
  });

  zurueck.addEventListener("click", (e) => {
    e.preventDefault();
    schrittAdresse();
  });

  return { zeigen, verbergen };
}

export function gespeichertesToken() {
  return localStorage.getItem(SPEICHERSCHLUESSEL);
}

export function tokenVergessen() {
  localStorage.removeItem(SPEICHERSCHLUESSEL);
}
