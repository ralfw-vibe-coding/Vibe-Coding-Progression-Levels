// Portal des Clients: das UI im Browser. Ein Portal ist ein nach vorn gerichteter Adapter —
// hier kapselt es die UI-Technologie des Browsers (DOM, Dialoge, Hash-Routing) und übersetzt
// sie in Aufrufe des Body. Es kennt nur den Body, nie die Domäne, den Proxy oder gar den
// Server. Sein Gegenstück auf der anderen Seite der Leitung ist server/portal.js.
//
// Was hier steht, ist Darstellung: Formatierung, Markup, Balkenlängen, Farben. Was gerechnet
// wird, kommt aus der Domäne; was erfragt wird, aus dem Body.
export function createPortal(body) {
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
      card.className = "card" + (hatVeraenderung ? "" : " dimmed") + (verlauf ? " aufgeklappt" : "");

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
      dialogNeuePosition.close();
      mitFehlermeldung(async () => {
        await body.neuePositionErfassen(daten);
        neuRendern();
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
        const { wertpapierId, name, action, broker } = menuItem.dataset;
        if (action === "kauf") oeffneKaufDialog(wertpapierId, name, broker || null);
        else oeffneKursupdateDialog(wertpapierId, name);
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
