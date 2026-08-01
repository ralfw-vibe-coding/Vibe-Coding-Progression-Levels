import { createEventStore } from "../../server/eventStore.js";
import { pruefeEventStoreVertrag } from "./eventStoreVertrag.ts";

// Der Store im Arbeitsspeicher bekommt seinen Anfangsbestand direkt übergeben — das ist seine
// Art, zu erfahren, wo seine Ereignisse herkommen. Alles Weitere prüft der gemeinsame Vertrag,
// den jede Ausprägung erfüllen muss.
pruefeEventStoreVertrag("Event-Store im Arbeitsspeicher", (initialeEvents = []) => ({
  store: createEventStore(initialeEvents),
}));

Deno.test("der Store im Arbeitsspeicher hängt nicht am übergebenen Array", async () => {
  const initiale = [
    { seq: 1, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "A" } },
  ];
  const store = createEventStore(initiale);
  initiale.push({ seq: 2, eventType: "kauf", timestamp: "2020-01-01T00:00:00.000Z", payload: { wertpapierId: "B" } });

  if ((await store.query()).length !== 1) {
    throw new Error("spätere Änderungen am übergebenen Array dürfen den Store nicht erreichen");
  }
});
