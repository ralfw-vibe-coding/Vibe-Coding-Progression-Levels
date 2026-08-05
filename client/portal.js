// Portal des Clients: das UI im Browser. Ein Portal ist ein nach vorn gerichteter Adapter —
// hier kapselt es die UI-Technologie des Browsers (DOM, Dialoge, Hash-Routing) und übersetzt
// sie in Aufrufe des Body. Es kennt nur den Body, nie die Domäne, den Proxy oder gar den
// Server. Sein Gegenstück auf der anderen Seite der Leitung ist server/portal.js.
//
// Was hier steht, ist Darstellung: Formatierung, Markup, Balkenlängen, Farben. Was gerechnet
// wird, kommt aus der Domäne; was erfragt wird, aus dem Body.
import { VERSION } from "./version.js";

export function createPortal(body, domain) {
  const TYP_KLASSE = { "Zertifikat": "zert", "Fonds": "fonds", "ETF": "etf", "Aktie": "aktie" };
  const TYP_FARBE = { Aktie: "#DB2777", ETF: "#2563EB", Zertifikat: "#D97706", Fonds: "#7C3AED" };
  const BROKER_FARBEN = ["#4F46E5", "#0F9D58", "#DB2777", "#D97706", "#2563EB", "#7C3AED", "#DC2626", "#0EA5E9"];

  // Echtes "heute" statt eines festen Datums — es gibt keine feste Geschichte mehr, an die
  // ein Datum gebunden wäre, das Depot gehört, wem auch immer gerade den Browser benutzt.
  const jetzt = new Date();
  const HEUTE = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}-${String(jetzt.getDate()).padStart(2, "0")}`;

  // Welche Positionen ihren Verlauf zeigen — und gleich der zugehörige, schon geladene
  // Verlauf dazu. Seit der Verlauf vom Server kommt, wird er einmal beim Aufklappen geholt
  // und hier behalten; das Rendern selbst bleibt dadurch synchron.
  const aufgeklappt = new Map();

  // Ergebnis des letzten Kursabrufs, je wertpapierId. Absichtlich nur im Speicher: Es
  // beschreibt einen Versuch, nicht das Depot — nach einem Neuladen ist es hinfällig.
  let kursBericht = new Map();
  let abrufLaeuft = false;

  function fmtEUR(n) {
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function fmtSignedEUR(n) {
    return (n >= 0 ? "+" : "") + fmtEUR(n);
  }
  function fmtPct(n) {
    return (n >= 0 ? "+" : "") + n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  }
  // Kurse (Einzelpreise) behalten ihre Quellgenauigkeit (z. B. 11,1479 € bei Bruchstück-ETFs)
  // statt auf 2 Nachkommastellen gerundet zu werden wie die großen Summen.
  function fmtKurs(n) {
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " €";
  }
  function fmtStueck(n) {
    return Number.isInteger(n) ? n.toLocaleString("de-DE") : n.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  function fmtDatum(datum) {
    const [jahr, monat, tag] = datum.split("T")[0].split("-");
    return `${tag}.${monat}.${jahr}`;
  }
  // Ein Betrag in der Währung, in der er wirklich notiert. fmtKurs hängt immer ein Euro-Zeichen
  // an — bei einem Dollarkurs wäre das schlicht falsch und würde beim Vergleich in die Irre
  // führen, gerade dann, wenn man zwischen Handelsplätzen wählt.
  function fmtBetrag(n, waehrung) {
    const zahl = n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (!waehrung) return zahl;
    return waehrung === "EUR" ? `${zahl} €` : `${zahl} ${waehrung}`;
  }

  function fmtAnteil(n) {
    return n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  }
  // Logarithmische Balkenskala: 0 % -> 0 %, 100 % Kursgewinn -> ~50 % Länge,
  // 500 % -> ~75 % Länge. Keine harte Obergrenze, nur zunehmend flacher. Reine
  // Visualisierungslogik ohne Domänenwissen, daher hier im Portal.
  function balkenAnteil(pct) {
    return Math.min(1, (0.5 * Math.log(1 + Math.abs(pct) / 5)) / Math.log(21));
  }
  function balkenDicke(anteil) {
    return Math.min(9, Math.max(3, 3 + 6 * anteil));
  }

  // Broker gehört zur Identität einer Position (siehe server/domain.js): derselbe Titel bei
  // verschiedenen Brokern sind zwei eigenständige Karten mit eigenem Auf-/Zuklapp-Zustand.
  function verlaufSchluessel(wertpapierId, broker) {
    return `${wertpapierId}::${broker || ""}`;
  }

  function verlaufHtml(eintraege) {
    const zeilen = eintraege.map((e) => {
      const art = e.eventType === "kauf" ? "Kauf" : "Kurs";
      const detail = e.eventType === "kauf"
        ? `${fmtStueck(e.stueck)} Stück${e.kaufkurs != null ? " @ " + fmtKurs(e.kaufkurs) : ""}`
        : fmtKurs(e.kurs);
      return `<div class="verlauf-eintrag"><span>${fmtDatum(e.datum)} · <span class="verlauf-art">${art}</span></span><span>${detail}</span></div>`;
    }).join("");
    return `<div class="verlauf">${zeilen}</div>`;
  }

  // Nach dem Erfassen: knapp sagen, ob ein Kurssymbol gefunden wurde. Ein Erfolg wird nur
  // beiläufig erwähnt, ein Fehlschlag deutlicher — denn der hat Folgen für später.
  function meldeSymbolAuskunft(name, auskunft) {
    if (!auskunft || auskunft.herkunft === "eingegeben") return;
    if (auskunft.symbol) {
      const wo = [auskunft.boerse, auskunft.waehrung, auskunft.quelle].filter(Boolean).join(", ");
      const mehr = auskunft.weitere > 0 ? `\n\nEs gab ${auskunft.weitere} weitere Möglichkeiten — über „Kurssymbol zuordnen…" lässt sich eine andere wählen.` : "";
      alert(`Kursbezug für ${name}: ${auskunft.symbol}${wo ? ` (${wo})` : ""}${mehr}`);
      return;
    }
    alert(`Für ${name} wurde kein Kurssymbol gefunden — ${auskunft.grund}.\n\nDie Position ist erfasst, ihr Kurs lässt sich aber nicht automatisch holen. Über „Kurssymbol zuordnen…" kannst du selbst suchen.`);
  }

  // Zeigt, wie diese Position zu ihren Kursen kommt — und ob etwas zu tun ist.
  //
  // Drei Zustände, drei verschiedene Bedeutungen im Alltag:
  //   automatisch — nichts zu tun; nach einem Abruf grün oder rot
  //   manuell     — bewusst ohne Quelle; interessant wird nur das Alter des Kurses
  //   offen       — Angaben fehlen; anklickbar, weil es eine Aufgabe ist
  function kurspflegeHtml(p) {
    const art = domain.kurspflege(p);

    if (art === "offen") {
      return `<button type="button" class="pflege offen" data-nachtragen data-wertpapier-id="${p.wertpapierId}" data-name="${p.name}"
        title="Angaben für den Kursabruf fehlen — zum Nachtragen anklicken">einrichten</button>`;
    }

    if (art === "manuell") {
      const alter = domain.kursAlterInTagen(p, HEUTE);
      const veraltet = domain.istKursVeraltet(p, HEUTE);
      const text = alter === null ? "manuell" : veraltet ? `manuell · ${alterText(alter)}` : "manuell";
      const grund = alter === null
        ? "wird von Hand gepflegt — noch kein Kurs erfasst"
        : `wird von Hand gepflegt — Kurs ist ${alterText(alter)} alt${veraltet ? ", ein neuer lohnt sich" : ""}`;
      const klasse = `pflege manuell${veraltet ? " veraltet" : ""}`;

      // Mit hinterlegter Adresse wird das Kennzeichen zum Link: ein Klick führt dorthin, wo
      // der Kurs steht. Das ist der ganze Sinn der Angabe — nicht jedes Mal neu suchen.
      const adresse = p.kursbezug?.nachschlagenUnter;
      if (adresse) {
        return `<a class="${klasse}" href="${adresse}" target="_blank" rel="noopener"
          title="${grund} — zum Nachschlagen anklicken">${text} ↗</a>`;
      }
      return `<span class="${klasse}" title="${grund}">${text}</span>`;
    }

    // automatisch: der Punkt zeigt das Ergebnis des letzten Abrufs
    if (abrufLaeuft) return `<span class="kurs-punkt" title="wird abgerufen…"></span>`;
    const e = kursBericht.get(p.wertpapierId);
    if (!e) return "";
    if (e.erfolg) {
      const woher = e.umgerechnetAus ? `${e.quelle}, umgerechnet aus ${e.umgerechnetAus}` : e.quelle;
      return `<span class="kurs-punkt ok" title="${fmtKurs(e.kurs)} — ${woher}"></span>`;
    }
    return `<span class="kurs-punkt fehler" title="${String(e.grund).replace(/"/g, "'")}"></span>`;
  }

  function alterText(tage) {
    if (tage < 31) return `${tage} Tage`;
    const monate = Math.round(tage / 30.4);
    return monate < 12 ? `${monate} Monate` : `${Math.round(tage / 365)} Jahre`;
  }

  // Der Stand kommt aus dem Bestand selbst (jüngstes Kursdatum), nicht aus einer eigenen
  // Notiz — so kann er gar nicht erst mit der Wirklichkeit auseinanderlaufen.
  function renderKursStand() {
    const stand = body.letzteAktualisierung();
    const anzeige = document.getElementById("kurs-stand");
    if (abrufLaeuft) { anzeige.textContent = "Kurse werden geholt…"; return; }
    anzeige.textContent = stand ? `Kurse vom ${fmtDatum(stand)}` : "noch keine Kurse";
  }

  function renderModell(modell) {
    document.getElementById("hero-wert").textContent = fmtEUR(modell.depotwert);
    document.getElementById("hero-kaufwert").textContent = "Kaufwert " + fmtEUR(modell.kaufwertGesamt);
    document.getElementById("hero-veraenderung-pct").textContent = fmtPct(modell.veraenderungPct);
    document.getElementById("hero-veraenderung-abs").textContent = fmtSignedEUR(modell.veraenderungAbs);

    const container = document.getElementById("positions");
    container.innerHTML = "";

    for (const p of modell.positionen) {
      const klasse = TYP_KLASSE[p.typ] || "aktie";
      const hatVeraenderung = p.diffPct != null;
      const negativ = hatVeraenderung && p.diffPct < 0;
      const verlauf = aufgeklappt.get(verlaufSchluessel(p.wertpapierId, p.broker));

      const card = document.createElement("div");
      card.className = "card" + (hatVeraenderung ? "" : " dimmed") + (verlauf ? " aufgeklappt" : "")
        + (abrufLaeuft && domain.kurspflege(p) === "automatisch" ? " wartet" : "");

      let barHtml = "";
      if (hatVeraenderung) {
        const anteil = balkenAnteil(p.diffPct);
        const dicke = balkenDicke(anteil);
        barHtml = `
          <div class="bar-track${negativ ? " neg" : ""}">
            <div class="bar${negativ ? " neg" : ""}" style="height:${dicke.toFixed(1)}px; width:${(anteil * 100).toFixed(1)}%; border-radius:${(dicke / 2).toFixed(1)}px;"></div>
          </div>`;
      }

      const pctHtml = hatVeraenderung
        ? `<span class="pct${negativ ? " neg" : ""}">${fmtPct(p.diffPct)}</span>`
        : `<span class="pct zero">wertlos</span>`;

      card.innerHTML = `
        <div class="card-strip strip-${klasse}"></div>
        <div class="card-body">
          <div class="card-top">
            <div class="card-top-left">
              <span class="badge badge-${klasse}">${p.typ}</span>
              ${p.broker ? `<span class="card-broker">${p.broker}</span>` : ""}
              ${kurspflegeHtml(p)}
            </div>
            <div class="card-top-right">
              <a class="wkn" href="https://www.finanzen.net/suchergebnis.asp?_search=${p.wertpapierId}" target="_blank" rel="noopener">${p.wertpapierId}</a>
              <div class="card-add-wrap">
                <button type="button" class="add-btn" data-wertpapier-id="${p.wertpapierId}" data-name="${p.name}" aria-label="Erfassen für ${p.wertpapierId}">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                </button>
                <div class="add-menu">
                  <button type="button" data-action="kauf" data-wertpapier-id="${p.wertpapierId}" data-name="${p.name}" data-broker="${p.broker || ""}">Kauf erfassen</button>
                  <button type="button" data-action="kursupdate" data-wertpapier-id="${p.wertpapierId}" data-name="${p.name}">Kursupdate erfassen</button>
                  <button type="button" data-action="symbol" data-wertpapier-id="${p.wertpapierId}" data-name="${p.name}" data-bezug="${p.kursbezug ? encodeURIComponent(JSON.stringify(p.kursbezug)) : ""}">Kursbezug zuordnen…</button>
                </div>
              </div>
            </div>
          </div>
          <div class="card-name" data-verlauf-toggle data-wertpapier-id="${p.wertpapierId}" data-broker="${p.broker || ""}">
            <span>${p.name}</span>
            <svg class="verlauf-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          ${verlauf ? verlaufHtml(verlauf) : ""}
          <div class="card-value-row">
            <span class="card-value">${fmtEUR(p.wert)}</span>
            ${p.kurs != null ? `<span class="card-value-detail">(${fmtKurs(p.kurs)})${p.kursDatum ? " " + fmtDatum(p.kursDatum) : ""}</span>` : ""}
          </div>
          <div class="card-sub-row">${p.kaufwert != null ? `Kaufwert ${fmtEUR(p.kaufwert)} (${fmtKurs(p.kaufkurs)}) · ` : ""}${fmtStueck(p.stueck)} Stück</div>
          ${barHtml}
          <div class="card-foot">
            ${pctHtml}
            <span class="share"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>${fmtAnteil(p.anteilAmDepot)}</span>
          </div>
        </div>`;
      container.appendChild(card);
    }
  }

  // --- Dashboard: 4 handgebaute SVG-Grafiken, keine externe Chart-Bibliothek. Was gruppiert
  // und sortiert wird, rechnet die Domäne; hier werden nur Farben vergeben und Formen
  // gezeichnet. ---
  function donutChartHtml(eintraege) {
    const gesamt = eintraege.reduce((s, e) => s + e.wert, 0);
    if (gesamt <= 0) return `<div class="chart-leer">Keine Werte vorhanden</div>`;
    // Kreis samt Strichbreite muss innerhalb der viewBox bleiben (radius + strokeWidth/2 <=
    // mitte), sonst wird er am Rand abgeschnitten.
    const radius = 46, strokeWidth = 16, umfang = 2 * Math.PI * radius, mitte = 64;
    let cursor = 0;
    const kreise = eintraege.map((e) => {
      const laenge = (e.wert / gesamt) * umfang;
      const dashoffset = -cursor;
      cursor += laenge;
      return `<circle cx="${mitte}" cy="${mitte}" r="${radius}" fill="none" stroke="${e.farbe}" stroke-width="${strokeWidth}" stroke-dasharray="${laenge.toFixed(2)} ${(umfang - laenge).toFixed(2)}" stroke-dashoffset="${dashoffset.toFixed(2)}"></circle>`;
    }).join("");
    const legende = eintraege.map((e) => {
      const diffHtml = e.diffPct != null
        ? ` · <span class="chart-nebenwert-pct ${e.diffPct < 0 ? "neg" : "pos"}">${fmtPct(e.diffPct)}</span>`
        : "";
      return `
      <div class="chart-legende-zeile">
        <span class="chart-legende-punkt" style="background:${e.farbe}"></span>
        <span class="chart-legende-label">${e.label}</span>
        <span class="chart-legende-wert">${fmtAnteil((e.wert / gesamt) * 100)}<span class="chart-nebenwert">${fmtEUR(e.wert)}${diffHtml}</span></span>
      </div>`;
    }).join("");
    return `
      <div class="chart-donut-wrap">
        <svg width="128" height="128" viewBox="0 0 128 128" class="chart-donut">
          <g transform="rotate(-90 ${mitte} ${mitte})">${kreise}</g>
        </svg>
        <div class="chart-legende">${legende}</div>
      </div>`;
  }

  function renderGewinnerVerliererChart(bewertet) {
    const container = document.getElementById("chart-gewinner-verlierer");
    if (bewertet.length === 0) {
      container.innerHTML = `<div class="chart-leer">Keine bewerteten Positionen</div>`;
      return;
    }
    container.innerHTML = `<div class="chart-zeilen">${bewertet.map((p) => {
      const negativ = p.diffPct < 0;
      const laenge = Math.min(45, balkenAnteil(p.diffPct) * 90);
      const rect = negativ
        ? `<rect class="chart-bar neg" x="${(45 - laenge).toFixed(1)}" y="3" width="${laenge.toFixed(1)}" height="8" rx="4"></rect>`
        : `<rect class="chart-bar pos" x="45" y="3" width="${laenge.toFixed(1)}" height="8" rx="4"></rect>`;
      return `
        <div class="chart-zeile">
          <span class="chart-zeile-label">${p.name}<span class="chart-zeile-typ">${p.typ}</span></span>
          <svg width="90" height="14" viewBox="0 0 90 14"><line class="chart-mittellinie" x1="45" y1="0" x2="45" y2="14"></line>${rect}</svg>
          <span class="chart-zeile-wert ${negativ ? "neg" : "pos"}">${fmtPct(p.diffPct)}<span class="chart-nebenwert">${fmtSignedEUR(p.diffAbs)}</span></span>
        </div>`;
    }).join("")}</div>`;
  }

  function renderKonzentrationChart(sortiert) {
    const container = document.getElementById("chart-konzentration");
    if (sortiert.length === 0) {
      container.innerHTML = `<div class="chart-leer">Keine Positionen</div>`;
      return;
    }
    container.innerHTML = `<div class="chart-zeilen">${sortiert.map((p) => {
      const breite = Math.min(90, (p.anteilAmDepot / 100) * 90);
      const diffHtml = p.diffPct != null
        ? ` · <span class="chart-nebenwert-pct ${p.diffPct < 0 ? "neg" : "pos"}">${fmtPct(p.diffPct)}</span>`
        : "";
      return `
        <div class="chart-zeile">
          <span class="chart-zeile-label">${p.name}<span class="chart-zeile-typ">${p.typ}</span></span>
          <svg width="90" height="14" viewBox="0 0 90 14"><rect class="chart-bar" x="0" y="3" width="${breite.toFixed(1)}" height="8" rx="4"></rect></svg>
          <span class="chart-zeile-wert">${fmtAnteil(p.anteilAmDepot)}<span class="chart-nebenwert">${fmtEUR(p.wert)}${diffHtml}</span></span>
        </div>`;
    }).join("")}</div>`;
  }

  function renderDashboard() {
    const { nachTyp, nachBroker, gewinnerUndVerlierer, konzentration } = body.dashboardAbfragen();
    document.getElementById("chart-typ").innerHTML = donutChartHtml(
      nachTyp.map((e) => ({ ...e, farbe: TYP_FARBE[e.label] || "#8B8DA0" })),
    );
    document.getElementById("chart-broker").innerHTML = donutChartHtml(
      nachBroker.map((e, i) => ({ ...e, farbe: BROKER_FARBEN[i % BROKER_FARBEN.length] })),
    );
    renderGewinnerVerliererChart(gewinnerUndVerlierer);
    renderKonzentrationChart(konzentration);
  }

  // --- Routing: #/positionen (Default) und #/dashboard, rein clientseitig per Hash.
  // Kein location.reload(), nur Sichtbarkeit umschalten. ---
  const ROUTEN = ["positionen", "dashboard"];
  function aktuelleRoute() {
    const hash = location.hash.replace(/^#\//, "");
    return ROUTEN.includes(hash) ? hash : "positionen";
  }
  function route() {
    const aktiv = aktuelleRoute();
    document.getElementById("view-positionen").hidden = aktiv !== "positionen";
    document.getElementById("view-dashboard").hidden = aktiv !== "dashboard";
    document.querySelectorAll(".page-nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === aktiv);
    });
    if (aktiv === "dashboard") renderDashboard();
  }

  const aktiverFilter = { suchbegriff: "", typen: [], broker: [] };
  const filterBrokerChips = document.getElementById("filter-broker-chips");
  // Broker-Chips bleiben aktuell, indem sie bei jedem Render aus dem depot-weiten
  // bekannteBroker neu aufgebaut werden — die laufende Auswahl (aktiverFilter.broker) ist die
  // Wahrheitsquelle, das Chip-Markup samt aktivem Zustand wird daraus jedes Mal neu erzeugt.
  function aktualisiereBrokerFilterChips(bekannteBroker) {
    aktiverFilter.broker = aktiverFilter.broker.filter((b) => bekannteBroker.includes(b));
    filterBrokerChips.innerHTML = bekannteBroker
      .map((b) => `<button type="button" class="broker-chip${aktiverFilter.broker.includes(b) ? " active" : ""}" data-broker="${b}">${b}</button>`)
      .join("");
  }
  function neuRendern() {
    const modell = body.depotAbfragen(aktiverFilter);
    renderModell(modell);
    renderKursStand();
    aktualisiereBrokerFilterChips(modell.bekannteBroker);
    if (aktuelleRoute() === "dashboard") renderDashboard();
  }

  // Fehler aus dem Backend sind für den Nutzer erst einmal alle gleich: es hat nicht geklappt.
  // Wichtig ist nur, dass sie sichtbar werden statt still in der Konsole zu landen.
  async function mitFehlermeldung(aktion) {
    try {
      await aktion();
    } catch (fehler) {
      alert("Das hat nicht geklappt: " + fehler.message);
    }
  }

  function verdrahten() {
    document.getElementById("heute-anzeige").textContent = fmtDatum(HEUTE);
    document.getElementById("version-anzeige").textContent = `v${VERSION}`;
    window.addEventListener("hashchange", route);

    // --- Im-/Export ---
    document.getElementById("btn-export").addEventListener("click", () => {
      mitFehlermeldung(() => body.exportieren());
    });
    document.getElementById("btn-import").addEventListener("click", () => {
      mitFehlermeldung(async () => {
        const modell = await body.importieren();
        if (modell) neuRendern(); // null = Dialog abgebrochen
      });
    });

    // --- Kurse aktualisieren: der einzige Knopf, der auf fremde Dienste wartet. Deshalb
    // sperrt er sich für die Dauer des Abrufs selbst, dreht sich sichtbar, und die betroffenen
    // Karten pulsieren. Ohne diese Rückmeldung wüsste niemand, ob überhaupt etwas passiert. ---
    const btnKurse = document.getElementById("btn-kurse");
    btnKurse.addEventListener("click", () => {
      if (abrufLaeuft) return;
      abrufLaeuft = true;
      kursBericht = new Map();
      btnKurse.disabled = true;
      btnKurse.classList.add("laeuft");
      neuRendern();

      mitFehlermeldung(async () => {
        try {
          const bericht = await body.kurseAktualisieren();
          kursBericht = new Map(bericht.map((e) => [e.wertpapierId, e]));
        } finally {
          // Auch wenn der Aufruf scheitert, muss der Knopf wieder bedienbar sein — sonst
          // bliebe die Seite nach einem Netzfehler dauerhaft blockiert.
          abrufLaeuft = false;
          btnKurse.disabled = false;
          btnKurse.classList.remove("laeuft");
          neuRendern();
        }
      });
    });

    // --- Kurssymbol zuordnen ---
    const dialogSymbol = document.getElementById("dialog-symbol");
    let symbolWertpapierId = null;
    let dialogPositionsname = "";
    let gewaehlterBezug = null;
    function oeffneSymbolDialog(wertpapierId, name, bezug) {
      symbolWertpapierId = wertpapierId;
      dialogPositionsname = name;
      letzteSuche = null;
      trefferKopf.hidden = true;
      const form = document.getElementById("form-symbol");
      form.reset();
      gewaehlterBezug = bezug && bezug.symbol ? { ...bezug } : null;
      // Vorbelegt mit der WKN: Daraus leitet der Server die ISIN ab, mit der die Suche
      // überhaupt erst eine Chance hat.
      document.getElementById("sym-suche").value = wertpapierId;
      document.getElementById("sym-nachschlagen").value = bezug?.nachschlagenUnter ?? "";
      document.getElementById("sym-treffer").innerHTML = "";
      zeigeGewaehltenBezug();
      document.getElementById("symbol-position-info").textContent = `${name} (${wertpapierId})`;
      dialogSymbol.showModal();
    }
    // Suche im Symbol-Dialog: Die Trefferliste ist die eigentliche Hilfe — sie zeigt dasselbe
    // Papier an mehreren Handelsplätzen, und erst die Auswahl macht daraus ein brauchbares
    // Symbol. Ein Klick übernimmt es ins Feld darunter.
    const trefferListe = document.getElementById("sym-treffer");
    const sucheFeld = document.getElementById("sym-suche");
    const btnSuche = document.getElementById("btn-symbol-suche");
    const trefferKopf = document.getElementById("sym-treffer-kopf");
    // Das letzte Suchergebnis wird behalten, damit es sich kopieren lässt — aus dem Markup
    // ließe es sich nur mühsam zurückgewinnen.
    let letzteSuche = null;

    async function symbolSuchen() {
      const begriff = sucheFeld.value.trim();
      if (!begriff) return;
      trefferListe.innerHTML = `<div class="such-hinweis">wird gesucht…</div>`;
      trefferKopf.hidden = true;
      btnSuche.disabled = true;
      try {
        const { begriff: gesucht, treffer, ohneKursquelle = 0 } = await body.symboleSuchen(begriff);
        letzteSuche = { name: dialogPositionsname, wertpapierId: symbolWertpapierId, begriff: gesucht, treffer };
        trefferKopf.hidden = false;
        if (treffer.length === 0) {
          zeigeAnzahl(0, 0);
          const nameVorschlagen = gesucht !== begriff || /^[0-9A-Z]{6}$/i.test(begriff);
          trefferListe.innerHTML = `<div class="such-hinweis">${
            ohneKursquelle > 0
              // Der Unterschied ist wichtig genug für eine eigene Formulierung: "nichts
              // gefunden" hieße, das Papier sei unbekannt. Hier ist es bekannt — nur liefert
              // keiner der eingerichteten Zugänge einen Kurs dafür. Das erste lädt zum
              // Weitersuchen ein, das zweite nicht.
              ? `Zu „${gesucht}" gibt es ${ohneKursquelle} Eintrag/Einträge, aber für keinen davon liefert eine der eingerichteten Quellen Kurse. Das Papier bleibt handgepflegt.`
              : `Nichts gefunden zu „${gesucht}".${
                nameVorschlagen ? " Versuch es mit dem Namen des Papiers — die Ableitung aus der WKN gelingt nur bei deutschen Emissionen." : ""
              } Manche Papiere, etwa Zertifikate einzelner Emittenten, führt ohnehin keine der Quellen.`
          }</div>`;
          return;
        }
        const hinweise = [];
        if (gesucht !== begriff) hinweise.push(`Gesucht wurde die abgeleitete ISIN ${gesucht}.`);
        if (ohneKursquelle > 0) hinweise.push(`${ohneKursquelle} weitere Einträge sind ausgeblendet — ihre Quelle liefert für diesen Handelsplatz keine Kurse.`);
        const hinweis = hinweise.length ? `<div class="such-hinweis">${hinweise.join(" ")}</div>` : "";
        // Übernommen wird der komplette Bezug — Quelle, Symbol, Handelsplatz, Währung. Ein
        // Symbol allein wäre mehrdeutig: derselbe Titel notiert anderswo in anderer Währung.
        trefferListe.innerHTML = hinweis + treffer.map((tr, i) => `
          <button type="button" data-bezug="${encodeURIComponent(JSON.stringify(tr))}" data-nr="${i}">
            <div class="treffer-symbol">${tr.symbol}${tr.waehrung ? ` · ${tr.waehrung}` : ""}</div>
            <div class="treffer-name">${[tr.name, tr.boerse, tr.quelle].filter(Boolean).join(" · ")}</div>
            <div class="treffer-probe" data-probe="${i}">wird geprüft…</div>
          </button>`).join("");

        // Jeden Kandidaten probeweise abrufen. Erst das trennt "steht in der Datenbank" von
        // "liefert mir einen Kurs" — bei kostenlosen Tarifen ist das oft nicht dasselbe, und
        // ohne diese Probe merkt man den Unterschied erst am roten Punkt nach dem nächsten
        // Aktualisieren.
        pruefeKandidaten(treffer);
      } catch (fehler) {
        trefferListe.innerHTML = `<div class="such-hinweis">Suche nicht möglich: ${fehler.message}</div>`;
        trefferKopf.hidden = true;
      } finally {
        btnSuche.disabled = false;
      }
    }

    // Nacheinander statt gleichzeitig: Jeder Aufruf zählt gegen das Anfragelimit der Quelle,
    // und ein Schwall paralleler Anfragen ist der sicherste Weg, ausgesperrt zu werden.
    // Höchstens so viele Kandidaten werden probeweise abgerufen. Eine Namenssuche kann
    // zwanzig Treffer liefern; zwanzig Abrufe wären bei acht erlaubten pro Minute ein
    // sicherer Weg ins Anfragelimit. Der Server sortiert nach Aussicht, die vorderen sind
    // die aussichtsreichen.
    const HOECHSTENS_PROBEN = 8;

    // Die Zählung über der Liste: wie viele Kandidaten wirklich einen Kurs geliefert haben.
    // "18 Treffer" war die falsche Zahl — sie zählte, was gefunden wurde, und nicht, was
    // brauchbar ist. Am Ende geht es um genau eine Frage: Wovon kann ich einen Kurs holen?
    function zeigeAnzahl(liefern, offen) {
      const feld = document.getElementById("sym-treffer-anzahl");
      if (liefern === 0 && offen === 0) { feld.textContent = "keine abrufbare Quelle"; return; }
      feld.textContent = offen > 0
        ? `${liefern} mit Kurs · ${offen} werden geprüft`
        : `${liefern} ${liefern === 1 ? "Quelle liefert" : "Quellen liefern"} einen Kurs`;
    }

    // Ein Kandidat, für den kein Kurs kommt, verschwindet aus der Liste. Grau stehenlassen
    // hieße: Der Nutzer muss weiter zwischen "geht" und "geht nicht" unterscheiden — genau
    // die Arbeit, die ihm die Probe abnehmen soll. Was bleibt, ist ausnahmslos benutzbar.
    function entferne(knopf) {
      knopf.remove();
    }

    // Die Probe weiß mehr als der Suchtreffer: Finnhub etwa nennt bei der Suche keine Währung,
    // beim Kursabruf aber sehr wohl. Diese bestätigte Währung wird in den Treffer zurück-
    // geschrieben, damit sie mitgespeichert wird — sie ist später die Sollgröße, an der ein
    // stillschweigend gewechselter Handelsplatz auffällt.
    function waehrungNachtragen(knopf, waehrung) {
      if (!waehrung) return;
      const bezug = JSON.parse(decodeURIComponent(knopf.dataset.bezug));
      bezug.waehrung = waehrung;
      knopf.dataset.bezug = encodeURIComponent(JSON.stringify(bezug));
    }

    async function pruefeKandidaten(treffer) {
      const zuPruefen = Math.min(treffer.length, HOECHSTENS_PROBEN);
      let liefern = 0;
      zeigeAnzahl(0, zuPruefen);

      for (const [i, tr] of treffer.entries()) {
        const feld = trefferListe.querySelector(`[data-probe="${i}"]`);
        if (!feld) return; // Dialog inzwischen geschlossen oder neu gesucht
        if (i >= HOECHSTENS_PROBEN) {
          feld.textContent = "noch nicht geprüft — zum Prüfen anklicken";
          continue;
        }
        try {
          const ergebnis = await body.kursbezugPruefen({ quelle: tr.quelle, symbol: tr.symbol });
          if (ergebnis.ok) {
            feld.textContent = `liefert ${fmtBetrag(ergebnis.kurs, ergebnis.waehrung)}`;
            feld.className = "treffer-probe liefert";
            waehrungNachtragen(feld.closest("button"), ergebnis.waehrung);
            tr.geprueft = { ok: true, kurs: ergebnis.kurs, waehrung: ergebnis.waehrung };
            liefern++;
          } else {
            tr.geprueft = { ok: false, grund: ergebnis.grund };
            entferne(feld.closest("button"));
          }
        } catch (fehler) {
          tr.geprueft = { ok: false, grund: fehler.message };
          entferne(feld.closest("button"));
        }
        zeigeAnzahl(liefern, zuPruefen - i - 1);
      }

      if (liefern === 0 && treffer.length <= HOECHSTENS_PROBEN) {
        trefferListe.insertAdjacentHTML("beforeend",
          `<div class="such-hinweis">Gefunden schon, abrufbar keiner: Jede Quelle hat den Kurs verweigert.
           Die Gründe stehen nicht mehr da, weil sie nichts nützen — für dieses Papier bleibt nur Handpflege.</div>`);
      }
    }

    btnSuche.addEventListener("click", symbolSuchen);

    // Kopiert die Trefferliste als Text — samt Frage und Zusammenhang, damit man ihn einer
    // KI vorlegen kann, ohne noch etwas dazuschreiben zu müssen.
    const btnKopieren = document.getElementById("btn-treffer-kopieren");
    btnKopieren.addEventListener("click", async () => {
      if (!letzteSuche) return;
      // Kopiert wird, was auf dem Schirm steht: die Kandidaten mit Kurs. Wer die Liste einer
      // KI vorlegt, will eine Empfehlung unter benutzbaren Möglichkeiten — Einträge, die
      // ohnehin keinen Kurs hergeben, würden die Antwort nur in die Irre führen.
      const text = domain.suchtrefferAlsText({
        ...letzteSuche,
        treffer: letzteSuche.treffer.filter((t) => t.geprueft?.ok !== false),
      });
      const beschriftung = document.getElementById("btn-treffer-kopieren-text");
      try {
        await navigator.clipboard.writeText(text);
        beschriftung.textContent = "kopiert";
        btnKopieren.classList.add("fertig");
        setTimeout(() => {
          beschriftung.textContent = "kopieren";
          btnKopieren.classList.remove("fertig");
        }, 1800);
      } catch {
        // Ohne Zwischenablage-Recht (etwa über http auf einem fremden Rechner) bleibt der
        // Text wenigstens sichtbar und lässt sich von Hand markieren.
        trefferListe.innerHTML = `<textarea class="kopier-text" readonly>${text}</textarea>`;
      }
    });
    // Enter im Suchfeld darf nicht das Formular abschicken — es soll suchen.
    sucheFeld.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); symbolSuchen(); }
    });
    trefferListe.addEventListener("click", async (e) => {
      const treffer = e.target.closest("button[data-bezug]");
      if (!treffer) return;
      // Ungeprüfte Kandidaten werden beim Anklicken nachgeholt — dann kostet die Prüfung nur
      // dort einen Aufruf, wo tatsächlich Interesse besteht.
      const probeFeld = treffer.querySelector(".treffer-probe");
      if (probeFeld?.textContent.startsWith("noch nicht geprüft")) {
        const roh = JSON.parse(decodeURIComponent(treffer.dataset.bezug));
        const eintrag = letzteSuche?.treffer.find((t) => t.symbol === roh.symbol && t.quelle === roh.quelle);
        probeFeld.textContent = "wird geprüft…";
        const ergebnis = await body.kursbezugPruefen({ quelle: roh.quelle, symbol: roh.symbol });
        if (ergebnis.ok) {
          probeFeld.textContent = `liefert ${fmtBetrag(ergebnis.kurs, ergebnis.waehrung)}`;
          probeFeld.className = "treffer-probe liefert";
          waehrungNachtragen(treffer, ergebnis.waehrung);
          if (eintrag) eintrag.geprueft = { ok: true, kurs: ergebnis.kurs, waehrung: ergebnis.waehrung };
        } else {
          // Auch hier verschwindet er: Eine Zeile, die keinen Kurs liefert, ist keine Auswahl,
          // sondern eine Falle. Angeklickt hat der Nutzer sie ja gerade, weil er sie wollte.
          if (eintrag) eintrag.geprueft = { ok: false, grund: ergebnis.grund };
          entferne(treffer);
          return;
        }
      }
      // Erst jetzt lesen: die Probe kann die Währung ergänzt haben.
      const bezug = JSON.parse(decodeURIComponent(treffer.dataset.bezug));
      gewaehlterBezug = bezug;
      zeigeGewaehltenBezug();
    });

    function zeigeGewaehltenBezug() {
      const anzeige = document.getElementById("sym-gewaehlt");
      if (!gewaehlterBezug?.symbol) {
        anzeige.innerHTML = `<span class="such-hinweis">Noch nichts gewählt — oben suchen und einen Treffer anklicken.</span>`;
        return;
      }
      const b = gewaehlterBezug;
      anzeige.innerHTML = `
        <div class="treffer-symbol">${b.symbol}${b.waehrung ? ` · ${b.waehrung}` : ""}</div>
        <div class="treffer-name">${[b.boerse, b.quelle].filter(Boolean).join(" · ")}</div>`;
    }

    document.getElementById("form-symbol").addEventListener("submit", (e) => {
      e.preventDefault();
      const bezug = gewaehlterBezug;
      dialogSymbol.close();
      mitFehlermeldung(async () => {
        await body.kursbezugZuordnen({
          wertpapierId: symbolWertpapierId,
          quelle: bezug?.quelle ?? null,
          symbol: bezug?.symbol ?? null,
          boerse: bezug?.boerse ?? null,
          waehrung: bezug?.waehrung ?? null,
        });
        neuRendern();
      });
    });
    // Wenn sich nichts finden lässt, ist das eine Entscheidung und keine offene Aufgabe:
    // Die Position wird als manuell gepflegt gekennzeichnet und hört auf, nach Arbeit zu rufen.
    document.getElementById("btn-manuell").addEventListener("click", () => {
      const id = symbolWertpapierId;
      dialogSymbol.close();
      const nachschlagenUnter = document.getElementById("sym-nachschlagen").value.trim() || null;
      mitFehlermeldung(async () => {
        await body.kursbezugZuordnen({ wertpapierId: id, art: "manuell", nachschlagenUnter });
        neuRendern();
      });
    });

    // --- Filterung: Suchbegriff + Typ-Chips + Broker-Chips, beide Mehrfachauswahl. Reine
    // Anzeigefrage — nur welche Karten erscheinen, ändert sich, und nichts davon fragt den
    // Server: gefiltert wird die bereits geladene Kopie. ---
    document.getElementById("filter-suche").addEventListener("input", (e) => {
      aktiverFilter.suchbegriff = e.target.value;
      neuRendern();
    });
    document.querySelectorAll(".typ-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const typ = chip.dataset.typ;
        const index = aktiverFilter.typen.indexOf(typ);
        if (index === -1) aktiverFilter.typen.push(typ);
        else aktiverFilter.typen.splice(index, 1);
        chip.classList.toggle("active");
        neuRendern();
      });
    });
    // Broker-Chips werden bei jedem Render neu aufgebaut, daher per Delegation.
    filterBrokerChips.addEventListener("click", (e) => {
      const chip = e.target.closest(".broker-chip");
      if (!chip) return;
      const broker = chip.dataset.broker;
      const index = aktiverFilter.broker.indexOf(broker);
      if (index === -1) aktiverFilter.broker.push(broker);
      else aktiverFilter.broker.splice(index, 1);
      neuRendern();
    });

    // --- Globale Erfassung: neue Position = Kauf + Kursupdate zusammen (Body-Workflow) ---
    const dialogNeuePosition = document.getElementById("dialog-neue-position");
    const brokerChipsContainer = document.getElementById("np-broker-chips");
    const brokerNeuFeld = document.getElementById("np-broker-neu");

    document.getElementById("btn-neue-position").addEventListener("click", () => {
      const form = document.getElementById("form-neue-position");
      form.reset();
      form.datum.value = HEUTE;
      // Broker als Tag erfassen: bekannte Broker aus dem Bestand stehen als Chips zur Wahl,
      // ein neuer lässt sich daneben eintippen (deaktiviert dann jede Chip-Auswahl).
      const { bekannteBroker } = body.depotAbfragen();
      brokerChipsContainer.innerHTML = bekannteBroker
        .map((b) => `<button type="button" class="broker-chip" data-broker="${b}">${b}</button>`)
        .join("");
      dialogNeuePosition.showModal();
    });
    brokerChipsContainer.addEventListener("click", (e) => {
      const chip = e.target.closest(".broker-chip");
      if (!chip) return;
      const warAktiv = chip.classList.contains("active");
      brokerChipsContainer.querySelectorAll(".broker-chip").forEach((c) => c.classList.remove("active"));
      if (!warAktiv) chip.classList.add("active");
      brokerNeuFeld.value = "";
    });
    brokerNeuFeld.addEventListener("input", () => {
      brokerChipsContainer.querySelectorAll(".broker-chip").forEach((c) => c.classList.remove("active"));
    });
    // Aktueller Kurs ist beim Neuanlegen meist noch der Kaufkurs -> als Vorschlag übernehmen,
    // sobald das Kaufkurs-Feld verlassen wird, aber nur falls der Nutzer dort noch nichts
    // eingetragen hat.
    document.getElementById("np-kaufkurs").addEventListener("blur", (e) => {
      const kursFeld = document.getElementById("np-kurs");
      if (e.target.value !== "" && kursFeld.value === "") kursFeld.value = e.target.value;
    });
    document.getElementById("form-neue-position").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const aktiverChip = brokerChipsContainer.querySelector(".broker-chip.active");
      const broker = brokerNeuFeld.value.trim() || aktiverChip?.dataset.broker || null;
      const daten = {
        wertpapierId: form.wkn.value.trim(),
        name: form.name.value.trim(),
        typ: form.typ.value,
        broker,
        stueck: parseFloat(form.stueck.value),
        kaufkurs: parseFloat(form.kaufkurs.value),
        kurs: parseFloat(form.kurs.value),
        datum: form.datum.value,
      };
      daten.kursbezug = null; // beim Anlegen ermittelt der Server selbst
      dialogNeuePosition.close();
      mitFehlermeldung(async () => {
        // Der Server sucht selbst nach einem Kurssymbol, wenn keines angegeben wurde. Was
        // dabei herauskam, gehört dem Nutzer gesagt — sonst bliebe unklar, warum eine Position
        // später nicht mit aktualisiert wird.
        const auskunft = await body.neuePositionErfassen(daten);
        neuRendern();
        meldeSymbolAuskunft(daten.name, auskunft);
      });
    });

    // --- Lokale Erfassung: Nachkauf oder Kursupdate zu einer bestehenden Position ---
    // Ein Nachkauf muss beim selben Broker landen wie die Position, an der er ausgelöst wurde
    // — sonst entstünde (Broker gehört zur Identität) versehentlich eine zweite,
    // eigenständige Position statt der beabsichtigten Aufstockung.
    let aktiveWertpapierId = null;
    let aktiverBroker = null;
    const dialogKauf = document.getElementById("dialog-kauf");
    const dialogKursupdate = document.getElementById("dialog-kursupdate");

    function oeffneKaufDialog(wertpapierId, name, broker) {
      aktiveWertpapierId = wertpapierId;
      aktiverBroker = broker || null;
      const form = document.getElementById("form-kauf");
      form.reset();
      form.datum.value = HEUTE;
      document.getElementById("kauf-position-info").textContent =
        aktiverBroker ? `${name} (${wertpapierId}) · ${aktiverBroker}` : `${name} (${wertpapierId})`;
      dialogKauf.showModal();
    }
    function oeffneKursupdateDialog(wertpapierId, name) {
      aktiveWertpapierId = wertpapierId;
      const form = document.getElementById("form-kursupdate");
      form.reset();
      form.datum.value = HEUTE;
      document.getElementById("kursupdate-position-info").textContent = `${name} (${wertpapierId})`;
      dialogKursupdate.showModal();
    }

    document.getElementById("form-kauf").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const daten = {
        wertpapierId: aktiveWertpapierId,
        broker: aktiverBroker,
        stueck: parseFloat(form.stueck.value),
        kaufkurs: parseFloat(form.kaufkurs.value),
        datum: form.datum.value,
      };
      dialogKauf.close();
      mitFehlermeldung(async () => {
        await body.kaufErfassen(daten);
        await verlaufNachladen();
        neuRendern();
      });
    });
    document.getElementById("form-kursupdate").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const daten = {
        wertpapierId: aktiveWertpapierId,
        kurs: parseFloat(form.kurs.value),
        datum: form.datum.value,
      };
      dialogKursupdate.close();
      mitFehlermeldung(async () => {
        await body.kursupdateErfassen(daten);
        await verlaufNachladen();
        neuRendern();
      });
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => btn.closest("dialog").close());
    });

    // Menü am lokalen "+" und Verlauf-Umschalter per Delegation, da Karten bei jedem
    // renderModell() neu aufgebaut werden.
    document.getElementById("positions").addEventListener("click", (e) => {
      const addBtn = e.target.closest(".add-btn");
      if (addBtn) {
        e.stopPropagation();
        const wrap = addBtn.closest(".card-add-wrap");
        const warOffen = wrap.classList.contains("open");
        document.querySelectorAll(".card-add-wrap.open").forEach((w) => w.classList.remove("open"));
        if (!warOffen) wrap.classList.add("open");
        return;
      }
      const menuItem = e.target.closest(".add-menu button");
      if (menuItem) {
        document.querySelectorAll(".card-add-wrap.open").forEach((w) => w.classList.remove("open"));
        const { wertpapierId, name, action, broker, bezug } = menuItem.dataset;
        if (action === "kauf") oeffneKaufDialog(wertpapierId, name, broker || null);
        else if (action === "symbol") oeffneSymbolDialog(wertpapierId, name, bezug ? JSON.parse(decodeURIComponent(bezug)) : null);
        else oeffneKursupdateDialog(wertpapierId, name);
        return;
      }
      const nachtragen = e.target.closest("[data-nachtragen]");
      if (nachtragen) {
        e.stopPropagation();
        const { wertpapierId, name } = nachtragen.dataset;
        oeffneSymbolDialog(wertpapierId, name, null);
        return;
      }
      const verlaufToggle = e.target.closest("[data-verlauf-toggle]");
      if (verlaufToggle) {
        const { wertpapierId, broker } = verlaufToggle.dataset;
        const schluessel = verlaufSchluessel(wertpapierId, broker || null);
        if (aufgeklappt.has(schluessel)) {
          aufgeklappt.delete(schluessel);
          neuRendern();
        } else {
          // Der Verlauf kommt jetzt vom Server: einmal holen, dann behalten, solange die
          // Karte offen ist.
          mitFehlermeldung(async () => {
            const eintraege = await body.positionsverlaufAbfragen({ wertpapierId, broker: broker || null });
            aufgeklappt.set(schluessel, eintraege);
            neuRendern();
          });
        }
      }
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".card-add-wrap.open").forEach((w) => w.classList.remove("open"));
    });

    // Nach einer Erfassung stimmen offene Verläufe nicht mehr — sie werden neu geholt, damit
    // der gerade erfasste Vorgang sofort in der aufgeklappten Karte auftaucht.
    async function verlaufNachladen() {
      for (const schluessel of [...aufgeklappt.keys()]) {
        const [wertpapierId, broker] = schluessel.split("::");
        aufgeklappt.set(schluessel, await body.positionsverlaufAbfragen({ wertpapierId, broker: broker || null }));
      }
    }
  }

  // Startpunkt: erst den Bestand vom Server holen, dann zeichnen und verdrahten.
  async function starten() {
    await body.initialisieren();
    verdrahten();
    neuRendern();
    route();
  }

  return { starten };
}
