// Wissen über Wertpapierkennungen — keine Depot-Fachlichkeit, sondern eine Eigenschaft der
// Kennungen selbst. Deshalb eine eigene kleine Einheit statt eines Anhängsels an die Domäne.
//
// Der Anlass: Kursquellen kennen die deutsche WKN nicht. Sie ist eine nationale Kennung, die
// internationale Datenanbieter nicht führen — eine Suche danach liefert bei Yahoo wie bei
// Twelve Data nichts. Womit sie etwas anfangen können, ist die ISIN.
//
// Glücklicherweise ist bei deutschen Emissionen die WKN in der ISIN enthalten:
//   DE000 + WKN + Prüfziffer
// Die Prüfziffer lässt sich berechnen, die ISIN also aus der WKN ableiten. Das gilt nur für
// hier begebene Papiere — der Arero etwa ist in Luxemburg aufgelegt (LU0360863863) und lässt
// sich so nicht herleiten. Ein Fehlversuch kostet aber nichts: Die Suche findet dann eben
// nichts, und der Name bleibt als Weg.

// Prüfziffer nach dem Luhn-Verfahren: Buchstaben werden erst zu Zahlen (A=10 … Z=35), dann
// wird von rechts jede zweite Ziffer verdoppelt und Quersummen gebildet.
function pruefziffer(ohnePruefziffer) {
  const ziffern = [...ohnePruefziffer]
    .map((z) => (/[0-9]/.test(z) ? z : String(z.toUpperCase().charCodeAt(0) - 55)))
    .join("");

  let summe = 0;
  let verdoppeln = true;
  for (let i = ziffern.length - 1; i >= 0; i--) {
    let d = Number(ziffern[i]);
    if (verdoppeln) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    summe += d;
    verdoppeln = !verdoppeln;
  }
  return (10 - (summe % 10)) % 10;
}

// Eine WKN sind sechs Zeichen aus Ziffern und Großbuchstaben.
export function istWkn(wert) {
  return typeof wert === "string" && /^[0-9A-Z]{6}$/i.test(wert.trim());
}

export function istIsin(wert) {
  return typeof wert === "string" && /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/i.test(wert.trim());
}

/** Leitet die ISIN einer deutschen Emission aus ihrer WKN ab. null, wenn es keine WKN ist. */
export function isinAusWkn(wkn) {
  if (!istWkn(wkn)) return null;
  const rumpf = `DE000${wkn.trim().toUpperCase()}`;
  return rumpf + pruefziffer(rumpf);
}

// Aus einer Nutzereingabe die Begriffe machen, mit denen sich eine Suche lohnt. Eine WKN wird
// dabei um ihre abgeleitete ISIN ergänzt — nicht ersetzt, denn manche Quellen führen doch
// hauseigene Kürzel, die zufällig so aussehen.
export function suchbegriffe(eingabe) {
  const wert = String(eingabe ?? "").trim();
  if (!wert) return [];
  const abgeleitet = isinAusWkn(wert);
  return abgeleitet ? [abgeleitet, wert] : [wert];
}

// Prüft, ob eine Kennung für den Kursabruf taugt.
//
// Die WKN wird abgelehnt, und zwar bewusst hart: Keine Kursquelle kennt sie, die daraus
// abgeleitete ISIN stimmt nur bei deutschen Emissionen, und wo sie nicht stimmt, liefert die
// Suche irgendetwas — im schlimmsten Fall ein fremdes Papier. Lieber beim Erfassen einmal
// nachschlagen als später einen falschen Kurs im Depot haben.
//
// Erlaubt sind ISIN und Tickersymbol. Die Abgrenzung ist eine Heuristik: Genau sechs Zeichen
// aus Ziffern und Großbuchstaben ist die Form einer WKN. Ein Tickersymbol dieser Form gäbe es
// theoretisch — praktisch enthalten Ticker fast immer einen Punkt oder sind kürzer.
export function pruefeKennung(wert) {
  const kennung = String(wert ?? "").trim();
  if (!kennung) return { ok: false, grund: "Es fehlt eine Wertpapierkennung." };
  if (istIsin(kennung)) return { ok: true };
  if (istWkn(kennung)) {
    return {
      ok: false,
      grund: `„${kennung}" ist eine WKN. Kursquellen kennen die WKN nicht — bitte die ISIN `
        + `(z. B. ${isinAusWkn(kennung)}, falls es eine deutsche Emission ist) oder das `
        + `Tickersymbol angeben. Beides steht im Wertpapierprospekt oder beim Broker.`,
    };
  }
  return { ok: true }; // alles andere gilt als Tickersymbol
}
