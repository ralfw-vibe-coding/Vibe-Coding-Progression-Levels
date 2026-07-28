import { createEventStore } from "./eventStore.js";

// Ein Event-Store, der seine Ereignisse in einer Datei hält. Er erfüllt denselben Vertrag wie
// jede andere Ausprägung (siehe den EventStore-Typ in eventStore.js) und ist gegen sie
// austauschbar — er erfährt beim Erzeugen nur auf andere Weise, wo seine Ereignisse liegen:
// nicht als Bestand, sondern als Dateiname.
//
// Dass und wohin geschrieben wird, ist sein eigenes Detail. Wer ihn benutzt, muss sich ums
// Speichern nicht kümmern — und kann es auch nicht vergessen. Genau das war vorher anders: Ein
// zusätzlicher Provider hat den Bestand weggeschrieben, und der Body musste nach jedem Command
// daran denken. Ein einziges vergessenes "jetzt sichern" hätte gereicht, um Daten zu verlieren.
//
// Innen ist er der Store aus eventStore.js — nur mit dem Zusatz, nach jeder Änderung zu
// schreiben. Deshalb gelten Reihenfolge, seq-Vergabe und Filterung unverändert, ohne sie ein
// zweites Mal zu programmieren.
//
// @returns {import("./eventStore.js").EventStore}
export function createDateiEventStore(pfad) {
  // Eine fehlende Datei ist kein Fehler, sondern der Normalfall beim allerersten Start: ein
  // leeres Depot. Andere Lesefehler (beschädigtes JSON, fehlende Rechte) werden durchgereicht —
  // sie stillschweigend als "leer" auszulegen würde vorhandene Daten verstecken, und der Nutzer
  // würde womöglich über seinem eigenen Bestand neu anfangen.
  function laden() {
    try {
      return JSON.parse(Deno.readTextFileSync(pfad));
    } catch (fehler) {
      if (fehler instanceof Deno.errors.NotFound) return [];
      throw fehler;
    }
  }

  const store = createEventStore(laden());

  // Schreiben und Lesen laufen absichtlich synchron. Der Preis ist, dass der Server währenddessen
  // kurz wartet; der Gewinn ist, dass ein Ereignis nach append() garantiert auf der Platte liegt
  // und die ganze Domäne synchron bleiben darf. Bei der Größenordnung dieser Anwendung — auch bei
  // zehntausend Ereignissen — ist das keine spürbare Wartezeit.
  function schreiben() {
    const verzeichnis = pfad.slice(0, pfad.lastIndexOf("/"));
    if (verzeichnis) Deno.mkdirSync(verzeichnis, { recursive: true });
    Deno.writeTextFileSync(pfad, JSON.stringify(store.query(), null, 2));
  }

  function append(eventType, payload) {
    const event = store.append(eventType, payload);
    schreiben();
    return event;
  }

  function restore(neueEvents) {
    store.restore(neueEvents);
    schreiben();
  }

  return { append, query: store.query, restore };
}
