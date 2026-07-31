import { createWechselkursProvider, createSimulierterWechselkursProvider } from "../../server/wechselkursProvider.js";

Deno.test("dieselbe Währung braucht keine Umrechnung und keinen Netzzugriff", async () => {
  let aufrufe = 0;
  const provider = createWechselkursProvider({ fetchFn: () => { aufrufe++; return Promise.reject(new Error("darf nicht passieren")); } });
  const faktor = await provider.kursNach("EUR", "EUR");
  if (faktor !== 1) throw new Error(`erwartet Faktor 1, war ${faktor}`);
  if (aufrufe !== 0) throw new Error("für EUR nach EUR darf nichts abgerufen werden");
});

Deno.test("ein Wechselkurs wird je Währung nur einmal geholt", async () => {
  let aufrufe = 0;
  const provider = createWechselkursProvider({
    fetchFn: () => { aufrufe++; return Promise.resolve(new Response(JSON.stringify({ base: "USD", rates: { EUR: 0.878 } }))); },
  });
  await provider.kursNach("USD");
  await provider.kursNach("USD");
  await provider.kursNach("USD");
  if (aufrufe !== 1) throw new Error(`erwartet 1 Abruf, waren ${aufrufe}`);
});

Deno.test("der gelieferte Faktor wird durchgereicht", async () => {
  const provider = createWechselkursProvider({
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({ base: "USD", rates: { EUR: 0.87804 } }))),
  });
  const faktor = await provider.kursNach("USD");
  if (faktor !== 0.87804) throw new Error(`erwartet 0.87804, war ${faktor}`);
});

Deno.test("ein nicht erreichbarer Dienst wird gemeldet, statt still 1 anzunehmen", async () => {
  // Der stille Rückfall auf 1 wäre der gefährlichste Fehler: Aus 336 Dollar würden 336 Euro.
  const provider = createWechselkursProvider({ fetchFn: () => Promise.resolve(new Response("", { status: 503 })) });
  let gemeldet = false;
  try { await provider.kursNach("USD"); } catch { gemeldet = true; }
  if (!gemeldet) throw new Error("ein Ausfall des Wechselkursdienstes muss auffallen");
});

Deno.test("eine unbekannte Währung wird gemeldet", async () => {
  const provider = createWechselkursProvider({
    fetchFn: () => Promise.resolve(new Response(JSON.stringify({ base: "XYZ", rates: {} }))),
  });
  let gemeldet = false;
  try { await provider.kursNach("XYZ"); } catch { gemeldet = true; }
  if (!gemeldet) throw new Error("eine fehlende Umrechnung muss auffallen");
});

Deno.test("die simulierte Variante verhält sich wie die echte", async () => {
  const provider = createSimulierterWechselkursProvider({ USD: 0.9 });
  if (await provider.kursNach("EUR") !== 1) throw new Error("EUR nach EUR muss 1 sein");
  if (await provider.kursNach("USD") !== 0.9) throw new Error("USD muss 0.9 ergeben");
  let gemeldet = false;
  try { await provider.kursNach("CHF"); } catch { gemeldet = true; }
  if (!gemeldet) throw new Error("auch die Simulation muss Unbekanntes melden");
});
