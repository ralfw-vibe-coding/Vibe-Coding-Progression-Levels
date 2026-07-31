import { handarbeitNoetig, istKursVeraltet, kursAlterInTagen, kurspflege, VERALTET_AB_TAGEN } from "../../client/domain.js";

const HEUTE = "2026-07-28";
const pos = (kursDatum: string | null, art: string | null = null, anteil = 10) => ({
  kursDatum, anteilAmDepot: anteil,
  kursbezug: art ? { art } : null,
});

Deno.test("das Kursalter wird in Tagen bestimmt", () => {
  if (kursAlterInTagen(pos("2026-07-28"), HEUTE) !== 0) throw new Error("heute ist 0 Tage alt");
  if (kursAlterInTagen(pos("2026-07-21"), HEUTE) !== 7) throw new Error("erwartet 7 Tage");
  if (kursAlterInTagen(pos("2026-07-24T21:54:29"), HEUTE) !== 4) throw new Error("eine Uhrzeit darf nicht stören");
  if (kursAlterInTagen(pos(null), HEUTE) !== null) throw new Error("ohne Kurs gibt es kein Alter");
});

Deno.test("eine Woche ist nicht alt — ein Quartal schon", () => {
  // Die Grenze ist bewusst großzügig: Wer lange hält, braucht keinen tagesaktuellen Kurs.
  if (istKursVeraltet(pos("2026-07-21"), HEUTE)) throw new Error("7 Tage sind nicht veraltet");
  if (istKursVeraltet(pos("2026-05-28"), HEUTE)) throw new Error("61 Tage sind noch nicht veraltet");
  if (!istKursVeraltet(pos("2026-01-28"), HEUTE)) throw new Error("ein halbes Jahr ist veraltet");
});

Deno.test("genau an der Grenze gilt der Kurs noch", () => {
  const grenze = new Date(Date.parse(HEUTE) - VERALTET_AB_TAGEN * 86400000).toISOString().slice(0, 10);
  if (istKursVeraltet(pos(grenze), HEUTE)) throw new Error(`${VERALTET_AB_TAGEN} Tage sollen noch gelten`);
});

Deno.test("die drei Zustände werden unterschieden", () => {
  if (kurspflege(pos("2026-07-28", "automatisch")) !== "automatisch") throw new Error("automatisch nicht erkannt");
  if (kurspflege(pos("2026-07-28", "manuell")) !== "manuell") throw new Error("manuell nicht erkannt");
  // Ohne jede Zuordnung: eine offene Aufgabe, kein erledigter Fall.
  if (kurspflege(pos("2026-07-28", null)) !== "offen") throw new Error("offen nicht erkannt");
});

Deno.test("Handarbeit lohnt bei manuellen Positionen mit altem Kurs, die größten zuerst", () => {
  const positionen = [
    pos("2026-01-01", "manuell", 5),      // alt, klein
    pos("2026-01-01", "manuell", 60),     // alt, groß  -> zuerst
    pos("2026-07-27", "manuell", 30),     // frisch     -> nein
    pos("2026-01-01", "automatisch", 40), // alt, aber holt sich Kurse selbst -> nein
    pos("2026-01-01", null, 20),          // offen: erst einrichten, nicht abtippen -> nein
  ];
  const noetig = handarbeitNoetig(positionen, HEUTE);
  if (noetig.length !== 2) throw new Error(`erwartet 2 Positionen, war ${noetig.length}`);
  if (noetig[0].anteilAmDepot !== 60) throw new Error("die größte Position muss zuerst kommen");
});
