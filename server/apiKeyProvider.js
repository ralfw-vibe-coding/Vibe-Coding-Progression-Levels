// xProvider: kapselt die Ressource "API-Schlüssel". Der Schlüssel wird beim allerersten Start
// erzeugt und danach wiederverwendet — sonst würde jeder Neustart alle gespeicherten
// curl-Aufrufe entwerten. Die Datei ist bewusst nicht im Repo (siehe .gitignore): sie gehört
// zur laufenden Installation, nicht zum Quellcode.
export function createApiKeyProvider(pfad) {
  async function holenOderErzeugen() {
    try {
      const vorhandener = (await Deno.readTextFile(pfad)).trim();
      if (vorhandener) return vorhandener;
    } catch (fehler) {
      if (!(fehler instanceof Deno.errors.NotFound)) throw fehler;
    }
    const neuer = crypto.randomUUID();
    const verzeichnis = pfad.slice(0, pfad.lastIndexOf("/"));
    if (verzeichnis) await Deno.mkdir(verzeichnis, { recursive: true });
    await Deno.writeTextFile(pfad, neuer);
    return neuer;
  }

  return { holenOderErzeugen };
}
