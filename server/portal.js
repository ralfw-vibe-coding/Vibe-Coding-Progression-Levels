// Portal: das UI des Servers. Ein Portal ist ein nach vorn gerichteter Adapter — es nimmt
// Anfragen von außen entgegen und übersetzt sie in Aufrufe des Body. Damit ist es das
// Gegenstück zum Provider, der nach hinten zu einer Ressource adaptiert. Genau wie das
// Frontend-Portal im Browser kennt es nur den Body, nie die Domäne oder den Event-Store.
//
// Es hat zwei Aufgaben: den API bereitstellen und die Dateien des Clients ausliefern.

const MIME_TYPEN = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  css: "text/css; charset=utf-8",
};

function json(daten, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { "content-type": MIME_TYPEN.json },
  });
}

export function createPortal(body, apiKey, clientVerzeichnis) {
  // Jede API-Anfrage weist sich mit dem Schlüssel aus — auch die aus dem Browser. Es gibt
  // keinen Sonderweg für die eigene Oberfläche: sie ist nur einer von mehreren möglichen
  // Clients, curl ist ein gleichberechtigter anderer.
  function istBerechtigt(request) {
    return request.headers.get("x-api-key") === apiKey;
  }

  async function apiBehandeln(request, pfad) {
    if (!istBerechtigt(request)) {
      return json({ fehler: "Ungültiger oder fehlender API-Schlüssel (Header: X-API-Key)." }, 401);
    }

    const methode = request.method;

    if (pfad === "/api/depot" && methode === "GET") {
      return json(await body.depotAbfragen());
    }
    if (pfad === "/api/events" && methode === "GET") {
      return json(await body.dump());
    }
    if (pfad === "/api/events" && methode === "PUT") {
      const events = await request.json();
      if (!Array.isArray(events)) return json({ fehler: "Erwartet wird eine Liste von Ereignissen." }, 400);
      return json(await body.restore(events));
    }
    if (pfad === "/api/kauf" && methode === "POST") {
      return json(await body.kaufErfassen(await request.json()));
    }
    if (pfad === "/api/kursupdate" && methode === "POST") {
      return json(await body.kursupdateErfassen(await request.json()));
    }
    if (pfad === "/api/neue-position" && methode === "POST") {
      try {
        return json(await body.neuePositionErfassen(await request.json()));
      } catch (f) {
        return json({ fehler: f.message }, 400);
      }
    }
    if (pfad === "/api/symbol-suche" && methode === "GET") {
      const begriff = new URL(request.url).searchParams.get("q") ?? "";
      try {
        return json(await body.symboleSuchen(begriff));
      } catch (f) {
        return json({ fehler: f.message }, 503);
      }
    }
    if (pfad === "/api/kursbezug-pruefen" && methode === "POST") {
      return json(await body.kursbezugPruefen(await request.json()));
    }
    if (pfad === "/api/kursbezug" && methode === "POST") {
      try {
        return json(await body.kursbezugZuordnen(await request.json()));
      } catch (f) {
        return json({ fehler: f.message }, 400);
      }
    }
    // Der einzige Endpunkt, der auf einen fremden Dienst wartet — und damit der einzige, der
    // spürbar dauern kann. Fehler einzelner Papiere stehen im Bericht, nicht im Statuscode:
    // Ein Abruf, bei dem zehn von zwölf klappen, ist kein gescheiterter Aufruf.
    if (pfad === "/api/kurse-aktualisieren" && methode === "POST") {
      try {
        return json(await body.kurseAktualisieren());
      } catch (f) {
        return json({ fehler: f.message }, 503);
      }
    }
    if (pfad.startsWith("/api/verlauf/") && methode === "GET") {
      const wertpapierId = decodeURIComponent(pfad.slice("/api/verlauf/".length));
      const broker = new URL(request.url).searchParams.get("broker");
      return json(await body.positionsverlaufAbfragen({ wertpapierId, broker }));
    }

    return json({ fehler: `Unbekannter Endpunkt: ${methode} ${pfad}` }, 404);
  }

  // Der Browser braucht den Schlüssel, um den API benutzen zu dürfen — er bekommt ihn beim
  // Ausliefern der Seite mitgegeben. Damit bleibt der Client frei von jeder fest
  // eingebauten Konfiguration: er erfährt zur Laufzeit, womit er sich auszuweisen hat.
  async function indexAusliefern() {
    const html = await Deno.readTextFile(`${clientVerzeichnis}/index.html`);
    const mitSchluessel = html.replace(
      "</head>",
      `<script>window.__API_KEY__ = ${JSON.stringify(apiKey)};</script>\n</head>`,
    );
    return new Response(mitSchluessel, { headers: { "content-type": MIME_TYPEN.html } });
  }

  async function dateiAusliefern(pfad) {
    // Nur flache Dateinamen zulassen — verhindert, dass über "../" etwas außerhalb des
    // Client-Verzeichnisses ausgeliefert wird.
    const name = pfad.slice(1);
    if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) return new Response("Not Found", { status: 404 });
    try {
      const inhalt = await Deno.readTextFile(`${clientVerzeichnis}/${name}`);
      const endung = name.slice(name.lastIndexOf(".") + 1);
      return new Response(inhalt, {
        headers: { "content-type": MIME_TYPEN[endung] ?? "text/plain; charset=utf-8" },
      });
    } catch (fehler) {
      if (fehler instanceof Deno.errors.NotFound) return new Response("Not Found", { status: 404 });
      throw fehler;
    }
  }

  async function behandeln(request) {
    const pfad = new URL(request.url).pathname;
    if (pfad.startsWith("/api/")) return await apiBehandeln(request, pfad);
    if (pfad === "/" || pfad === "/index.html") return await indexAusliefern();
    return await dateiAusliefern(pfad);
  }

  return { behandeln };
}
