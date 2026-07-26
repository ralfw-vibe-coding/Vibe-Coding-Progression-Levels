# Mein Depot

## App öffnen

`index.html` per Doppelklick öffnen — kein Server, keine Installation nötig.

## Tests ausführen

Voraussetzung: [Deno](https://deno.com) installiert.

```bash
deno task test
```

Mit Testabdeckung:

```bash
deno task coverage
```

Die Tests liegen in `tests/` und prüfen `eventStore.js`, `domain.js` und `body.js` — dieselben
Dateien, die auch `index.html` per `<script src>` lädt (siehe `Verlauf/Stufe 03.md` für den
Hintergrund).
