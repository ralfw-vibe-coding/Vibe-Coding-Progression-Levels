// Portal: das UI des Servers. Ein Portal ist ein nach vorn gerichteter Adapter — es nimmt
// Anfragen von außen entgegen und übersetzt sie in Aufrufe des Body. Damit ist es das
// Gegenstück zum Provider, der nach hinten zu einer Ressource adaptiert. Genau wie das
// Frontend-Portal im Browser kennt es nur den Body, nie die Domäne oder den Event-Store.
//
// Es hat zwei Aufgaben: den API bereitstellen und die Dateien des Clients ausliefern.
//
// Seit Stufe 13 ist es außerdem der einzige Ort, an dem über Zugang entschieden wird — und es
// kennt dafür zwei Bodies: einen für das Depot, einen für die Anmeldung. Zwei Wege führen
// herein, und beide enden in derselben Berechtigung, weil es nur ein Depot gibt:
//
//   X-API-Key            für Maschinen. Ein Skript kann keinen Code aus einem Postfach holen.
//   Authorization: Bearer für Menschen. Nach Einmalcode ausgestellt, zeitlich begrenzt.

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

// Die einzigen Endpunkte, die ohne Ausweis erreichbar sind — man braucht sie ja gerade, um
// einen zu bekommen. Als Liste von Paaren und nicht als Pfad-Präfix: Ein Präfix wie
// "/api/anmeldung/" wüchse still mit, sobald jemand später einen weiteren Endpunkt darunter
// hängt, und der wäre dann unbemerkt offen. Eine Liste zwingt zur bewussten Entscheidung.
const OFFENE_ENDPUNKTE = [
  ["/api/anmeldung/code", "POST"],
  ["/api/anmeldung/einloesen", "POST"],
];

/**
 * @param {*} body Der Depot-Body.
 * @param {string} apiKey Maschinenzugang. Wer ihn hat, betreibt die Anwendung.
 * @param {string} clientVerzeichnis
 * @param {*} [anmeldung] Der zweite Body (anmeldung.js). Fehlt er, gilt nur der API-Schlüssel
 *   und die Anmeldeendpunkte antworten 503 — so bleibt das Portal auch ohne eingerichtete
 *   Anmeldung benutzbar, etwa in Tests, die sich für sie nicht interessieren.
 */
export function createPortal(body, apiKey, clientVerzeichnis, anmeldung = null) {
  /**
   * Der einzige Ort, an dem die beiden Wege hinein zusammenlaufen. Gibt null zurück, wenn sich
   * niemand ausgewiesen hat.
   *
   * Der API-Schlüssel gilt als Verwalter: Wer ihn hat, betreibt die Anwendung. Ihm die
   * Nutzerverwaltung zu verweigern hieße, dass sich die Liste per Skript nicht in Gang bringen
   * ließe.
   *
   * Beim Token wird zusätzlich geprüft, ob die Adresse *noch* zugelassen ist — nicht nur, ob
   * das Token echt ist. Sonst wirkte ein Entzug erst nach Ablauf, also womöglich erst in sieben
   * Tagen; wer jemanden aussperrt, erwartet das aber jetzt.
   */
  async function zugangPruefen(request) {
    if (request.headers.get("x-api-key") === apiKey) {
      return { art: "schluessel", email: null, istAdmin: true };
    }

    const kopf = request.headers.get("authorization") ?? "";
    if (anmeldung && kopf.startsWith("Bearer ")) {
      const ausweis = await anmeldung.tokenPruefen(kopf.slice("Bearer ".length).trim());
      if (ausweis && await anmeldung.zugangPruefen(ausweis.email)) {
        return { art: "token", email: ausweis.email, istAdmin: anmeldung.istAdmin(ausweis.email) };
      }
    }
    return null;
  }

  async function anmeldungBehandeln(request, pfad) {
    if (!anmeldung) {
      return json({ fehler: "Für diesen Server ist keine Anmeldung eingerichtet." }, 503);
    }
    const daten = await request.json().catch(() => ({}));

    if (pfad === "/api/anmeldung/code") {
      const ergebnis = await anmeldung.codeAnfordern(daten.email);
      // 404 und nicht 401: Es fehlt nicht der Ausweis, es gibt die Adresse hier nicht.
      return ergebnis.ok ? json({ versendet: true, gueltigBis: ergebnis.gueltigBis }) : json({ fehler: ergebnis.grund }, 404);
    }

    const ergebnis = await anmeldung.codeEinloesen(daten.email, daten.code);
    return ergebnis.ok
      ? json({ token: ergebnis.token, email: ergebnis.email, istAdmin: ergebnis.istAdmin })
      : json({ fehler: ergebnis.grund }, 401);
  }

  async function nutzerBehandeln(request, pfad, methode) {
    try {
      if (methode === "GET") return json(await anmeldung.zugelasseneAuflisten());
      if (methode === "POST") return json(await anmeldung.zulassen((await request.json()).email));
      if (methode === "DELETE") {
        const email = decodeURIComponent(pfad.slice("/api/nutzer/".length));
        return json(await anmeldung.sperren(email));
      }
    } catch (f) {
      return json({ fehler: f.message }, 400);
    }
    return json({ fehler: `Unbekannter Endpunkt: ${methode} ${pfad}` }, 404);
  }

  async function apiBehandeln(request, pfad) {
    const methode = request.method;

    if (OFFENE_ENDPUNKTE.some(([p, m]) => p === pfad && m === methode)) {
      return await anmeldungBehandeln(request, pfad);
    }

    const zugang = await zugangPruefen(request);
    if (!zugang) {
      return json({ fehler: "Nicht angemeldet. Bitte melde dich an oder weise dich mit dem API-Schlüssel aus (Header: X-API-Key)." }, 401);
    }

    // Wer sich ausgewiesen hat, darf noch lange nicht alles: 403 heißt „erkannt, aber nicht
    // befugt" — im Unterschied zum 401 oben, das „nicht erkannt" bedeutet.
    if (pfad === "/api/nutzer" || pfad.startsWith("/api/nutzer/")) {
      if (!zugang.istAdmin) return json({ fehler: "Das darf nur der Verwalter." }, 403);
      if (!anmeldung) return json({ fehler: "Für diesen Server ist keine Anmeldung eingerichtet." }, 503);
      return await nutzerBehandeln(request, pfad, methode);
    }

    // Damit die Oberfläche weiß, wen sie vor sich hat — und ob sie die Nutzerverwaltung
    // anbieten soll. Zugleich beim Start die Probe, ob ein gespeichertes Token noch gilt.
    if (pfad === "/api/ich" && methode === "GET") {
      return json({ email: zugang.email, istAdmin: zugang.istAdmin, art: zugang.art });
    }

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

  // Die Seite geht unverändert raus — ohne Geheimnis darin. Bis Stufe 12 wurde hier der
  // API-Schlüssel hineingeschrieben, damit der Browser sich ausweisen kann. Solange die
  // Anwendung nur lokal lief, fiel das nicht auf; unter einer öffentlichen Adresse verschenkte
  // sie damit an jeden Besucher vollen Zugriff auf das Depot — im Seitenquelltext, im Klartext.
  //
  // Was ausgeliefert wird, ist deshalb nur noch eine Hülle. Wer hereinwill, holt sich seinen
  // Ausweis selbst: E-Mail eingeben, Code aus dem Postfach, Token.
  async function indexAusliefern() {
    const html = await Deno.readTextFile(`${clientVerzeichnis}/index.html`);
    return new Response(html, { headers: { "content-type": MIME_TYPEN.html } });
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
