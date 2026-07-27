import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createLocalStorageProvider } = require("../localStorageProvider.js");

// Fake statt echtem localStorage: kein geteilter, über Testläufe hinweg persistenter Zustand.
function fakeStorage() {
  const daten = new Map<string, string>();
  return {
    getItem: (schluessel: string) => (daten.has(schluessel) ? daten.get(schluessel)! : null),
    setItem: (schluessel: string, wert: string) => { daten.set(schluessel, wert); },
  };
}

Deno.test("laden ohne zuvor Gespeichertes liefert ein leeres Array", () => {
  const provider = createLocalStorageProvider(fakeStorage(), "test-schluessel");
  const ergebnis = provider.laden();
  if (!Array.isArray(ergebnis) || ergebnis.length !== 0) {
    throw new Error("erwartet leeres Array ohne vorherige speichern()-Aufrufe");
  }
});

Deno.test("speichern und laden geben denselben Inhalt zurück", () => {
  const provider = createLocalStorageProvider(fakeStorage(), "test-schluessel");
  const daten = [{ seq: 1, eventType: "kauf", payload: { wertpapierId: "A" } }];
  provider.speichern(daten);
  const geladen = provider.laden();
  if (JSON.stringify(geladen) !== JSON.stringify(daten)) {
    throw new Error("geladene Daten weichen von den gespeicherten ab");
  }
});

Deno.test("zwei Provider mit unterschiedlichem Schlüssel im selben Storage stören sich nicht", () => {
  const storage = fakeStorage();
  const a = createLocalStorageProvider(storage, "a");
  const b = createLocalStorageProvider(storage, "b");
  a.speichern([{ marker: "a" }]);
  b.speichern([{ marker: "b" }]);
  if (JSON.stringify(a.laden()) === JSON.stringify(b.laden())) {
    throw new Error("unterschiedliche Schlüssel dürfen sich nicht überschreiben");
  }
});
