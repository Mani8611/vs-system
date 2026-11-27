"use strict";
// Kinder-Stick – gemeinsame Hilfsfunktionen

/** Ruft den lokalen Dienst auf. Ohne daten: GET, mit daten: POST (JSON). */
async function api(pfad, daten) {
  if (window.KS_VORSCHAU_API) return window.KS_VORSCHAU_API(pfad, daten || {});   // nur Vorschau (file://)
  const optionen = daten === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten) };
  const antwort = await fetch(pfad, optionen);
  let json = {};
  try { json = await antwort.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (!antwort.ok) {
    const fehler = new Error(json.fehler || "Fehler " + antwort.status);
    fehler.status = antwort.status;
    throw fehler;
  }
  return json;
}

/** Nach „Ausschalten“: fragt alle 5 s beim Dienst nach. Läuft der Rechner nach 25 s noch und
 *  meldet der Dienst einen Fehler, bekommt zeigen() den Text (zum Weitergeben an die Entwicklung). */
function ausschaltenBeobachten(zeigen) {
  const beginn = Date.now();
  let gezeigt = "";
  const timer = setInterval(async () => {
    try {
      const s = await api("/api/status");
      const sekunden = (Date.now() - beginn) / 1000;
      if (sekunden > 25 && s.ausschalt_fehler && s.ausschalt_fehler !== gezeigt) {
        gezeigt = s.ausschalt_fehler;
        zeigen("Das Ausschalten klappt gerade nicht. Notfalls den Ein-Knopf am Laptop lange drücken.\n"
          + "Meldung für die Entwicklung: " + s.ausschalt_fehler);
      }
      if (sekunden > 180) clearInterval(timer);
    } catch (e) { /* Dienst beendet – der Computer fährt herunter */ }
  }, 5000);
}

/** Vorlesen ist ausgeschaltet (Test 26.11.2026: die Stimme klingt nicht gut).
 *  Zum Wiedereinschalten VORLESEN_AKTIV auf true setzen – später ggf. als Eltern-Einstellung. */
const VORLESEN_AKTIV = false;

/** Liest einen Text vor (Web Speech API, falls verfügbar). */
function vorlesen(text) {
  if (!VORLESEN_AKTIV) return;
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const satz = new SpeechSynthesisUtterance(text);
    satz.lang = "de-AT";
    window.speechSynthesis.speak(satz);
  } catch (e) { /* Vorlesen ist optional */ }
}

/** Minuten lesbar: „1 h 20 min“ bzw. „45 min“. */
function minutenText(minuten) {
  const m = Math.max(0, Math.round(minuten));
  if (m >= 60) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  return `${m} min`;
}

/** Setzt eine Meldung (ok oder fehler) in ein Element. */
function meldung(element, text, art) {
  element.textContent = text || "";
  element.className = "meldung" + (art ? " " + art : "");
}
