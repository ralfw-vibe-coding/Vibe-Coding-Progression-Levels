// xProvider: kapselt die Ressource "Backend". Für den Client ist der Server nichts anderes
// als eine externe Ressource — genau wie es der Browser-Speicher in Stufe 4 und die Datei in
// Stufe 5 waren. Deshalb sieht dieser Proxy nach außen aus wie der Body des Servers: derselbe
// Methodensatz, dieselben Parameter. Wer ihn benutzt, muss nicht wissen, dass dazwischen ein
// Netzwerk liegt.
//
// HTTP, Statuscodes und der API-Schlüssel enden hier — kein anderes Client-Modul kennt sie.
export function createBackendProxyProvider(basisUrl, apiKey) {
  async function anfragen(pfad, optionen = {}) {
    const antwort = await fetch(`${basisUrl}${pfad}`, {
      ...optionen,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        ...optionen.headers,
      },
    });
    if (!antwort.ok) {
      const fehler = await antwort.json().catch(() => ({}));
      throw new Error(fehler.fehler ?? `Server antwortete mit ${antwort.status}.`);
    }
    return await antwort.json();
  }

  const senden = (pfad, methode, daten) =>
    anfragen(pfad, { method: methode, body: JSON.stringify(daten) });

  return {
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
