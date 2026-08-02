// xProvider: kapselt die Ressource "Backend". Für den Client ist der Server nichts anderes
// als eine externe Ressource — genau wie es der Browser-Speicher in Stufe 4 und die Datei in
// Stufe 5 waren. Deshalb sieht dieser Proxy nach außen aus wie der Body des Servers: derselbe
// Methodensatz, dieselben Parameter. Wer ihn benutzt, muss nicht wissen, dass dazwischen ein
// Netzwerk liegt.
//
// HTTP, Statuscodes und der Ausweis enden hier — kein anderes Client-Modul kennt sie.
//
// Seit Stufe 13 ist der Ausweis nicht mehr ein fester Schlüssel aus der Seite, sondern ein
// Token, das man sich mit einem Einmalcode holt. Deshalb wird er *gesetzt* und nicht im
// Konstruktor übergeben: Der Proxy wird schon gebraucht, bevor es ein Token gibt — für die
// Anforderung des Codes nämlich — und wieder, nachdem eines abgelaufen ist.

/**
 * @param {string} basisUrl
 * @param {{ fetchFn?: typeof fetch, beiAbgelaufenerSitzung?: (() => void) | null }} [optionen]
 *   `fetchFn` ist einspeisbar, damit sich der Proxy ohne Server prüfen lässt — dieselbe
 *   Konvention wie bei den Providern auf der Serverseite.
 */
export function createBackendProxyProvider(basisUrl, { fetchFn = fetch, beiAbgelaufenerSitzung = null } = {}) {
  let token = null;

  function tokenSetzen(neues) {
    token = neues || null;
  }

  async function anfragen(pfad, optionen = {}) {
    const antwort = await fetchFn(`${basisUrl}${pfad}`, {
      ...optionen,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...optionen.headers,
      },
    });

    // Der einzige Statuscode, der hier eine eigene Bedeutung hat: Die Sitzung ist abgelaufen
    // oder wurde entzogen. Das Token wegzuwerfen ist wichtiger als die Meldung — sonst
    // versuchte es der nächste Aufruf mit demselben untauglichen Ausweis noch einmal.
    if (antwort.status === 401) {
      token = null;
      beiAbgelaufenerSitzung?.();
      throw new Error("Die Sitzung ist abgelaufen. Bitte melde dich neu an.");
    }

    if (!antwort.ok) {
      const fehler = await antwort.json().catch(() => ({}));
      throw new Error(fehler.fehler ?? `Server antwortete mit ${antwort.status}.`);
    }
    return await antwort.json();
  }

  const senden = (pfad, methode, daten) =>
    anfragen(pfad, { method: methode, body: JSON.stringify(daten) });

  return {
    tokenSetzen,

    // --- Anmeldung. Diese beiden gehen ohne Ausweis; man braucht sie ja, um einen zu bekommen.
    codeAnfordern: (email) => senden("/api/anmeldung/code", "POST", { email }),
    codeEinloesen: (email, code) => senden("/api/anmeldung/einloesen", "POST", { email, code }),
    ichAbfragen: () => anfragen("/api/ich"),

    // --- Nutzerverwaltung, nur für den Verwalter
    nutzerAuflisten: () => anfragen("/api/nutzer"),
    nutzerZulassen: (email) => senden("/api/nutzer", "POST", { email }),
    nutzerSperren: (email) => anfragen(`/api/nutzer/${encodeURIComponent(email)}`, { method: "DELETE" }),

    // --- Depot
    depotAbfragen: () => anfragen("/api/depot"),
    kaufErfassen: (daten) => senden("/api/kauf", "POST", daten),
    kursupdateErfassen: (daten) => senden("/api/kursupdate", "POST", daten),
    neuePositionErfassen: (daten) => senden("/api/neue-position", "POST", daten),
    positionsverlaufAbfragen: ({ wertpapierId, broker }) => {
      const query = broker ? `?broker=${encodeURIComponent(broker)}` : "";
      return anfragen(`/api/verlauf/${encodeURIComponent(wertpapierId)}${query}`);
    },
    kursbezugZuordnen: (daten) => senden("/api/kursbezug", "POST", daten),
    kursbezugPruefen: (daten) => senden("/api/kursbezug-pruefen", "POST", daten),
    symboleSuchen: (begriff) => anfragen(`/api/symbol-suche?q=${encodeURIComponent(begriff)}`),
    // Dieser eine Aufruf wartet auf fremde Dienste und darf deshalb länger dauern als die
    // anderen — das Zeitlimit im Server liegt bei zehn Sekunden je Quelle.
    kurseAktualisieren: () => senden("/api/kurse-aktualisieren", "POST", {}),
    dump: () => anfragen("/api/events"),
    restore: (events) => senden("/api/events", "PUT", events),
  };
}
