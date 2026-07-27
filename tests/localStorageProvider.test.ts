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

Deno.test("get ohne zuvor Gespeichertes liefert ein leeres Array", () => {
  const provider = createLocalStorageProvider(fakeStorage(), "test-schluessel");
  const ergebnis = provider.get();
  if (!Array.isArray(ergebnis) || ergebnis.length !== 0) {
    throw new Error("erwartet leeres Array ohne vorherige set()-Aufrufe");
  }
});

Deno.test("set und get geben denselben Inhalt zurück", () => {
  const provider = createLocalStorageProvider(fakeStorage(), "test-schluessel");
  const daten = [{ seq: 1, eventType: "kauf", payload: { wertpapierId: "A" } }];
  provider.set(daten);
  const geladen = provider.get();
  if (JSON.stringify(geladen) !== JSON.stringify(daten)) {
    throw new Error("geladene Daten weichen von den gespeicherten ab");
  }
});

Deno.test("zwei Provider mit unterschiedlichem Schlüssel im selben Storage stören sich nicht", () => {
  const storage = fakeStorage();
  const a = createLocalStorageProvider(storage, "a");
  const b = createLocalStorageProvider(storage, "b");
  a.set([{ marker: "a" }]);
  b.set([{ marker: "b" }]);
  if (JSON.stringify(a.get()) === JSON.stringify(b.get())) {
    throw new Error("unterschiedliche Schlüssel dürfen sich nicht überschreiben");
  }
});
