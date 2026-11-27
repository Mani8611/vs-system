"use strict";
// Kinder-Stick – Einrichtungsassistent (einmalig durch die Eltern)

const feld = (id) => document.getElementById(id);

let uhrzeit = null;   // Uhrzeit am Stick laut Dienst („HH:MM“)

async function pruefenObSchonEingerichtet() {
  try {
    const s = await api("/api/status");
    if (s.eingerichtet) location.href = "index.html";
    uhrzeit = s.uhrzeit || null;
    if (uhrzeit) {
      feld("uhrzeit-hinweis").textContent =
        `Uhrzeit am Laptop: ${uhrzeit} Uhr. Stimmt sie nicht: nach der Einrichtung im Eltern-Bereich das WLAN verbinden – dann stellt sie sich selbst.`;
    }
    schlafenPruefen();
  } catch (e) { /* Dienst startet noch */ }
}

const inMinuten = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** true, wenn mit den eingegebenen Zeiten JETZT Schlafenszeit wäre. */
function jetztSchlafenszeit() {
  if (!uhrzeit) return false;
  const m = inMinuten(uhrzeit);
  const von = inMinuten(feld("schlafen_von").value || "00:00");
  const bis = inMinuten(feld("schlafen_bis").value || "00:00");
  if (von === bis) return false;
  return von > bis ? m >= von || m < bis : m >= von && m < bis;
}

function schlafenPruefen() {
  const warnung = feld("schlafen-warnung");
  warnung.hidden = !jetztSchlafenszeit();
  warnung.textContent = `Achtung: Mit diesen Zeiten ist jetzt (${uhrzeit} Uhr) sofort Schlafenszeit und der Stick ist gesperrt. `
    + "Zum Ausprobieren „Schlafenszeit ab“ später einstellen.";
}
feld("schlafen_von").addEventListener("input", schlafenPruefen);
feld("schlafen_bis").addEventListener("input", schlafenPruefen);

feld("formular").addEventListener("submit", async (ereignis) => {
  ereignis.preventDefault();
  const ausgabe = feld("meldung");

  const pin = feld("pin").value.trim();
  const passwort = feld("passwort").value;
  if (!feld("kind_name").value.trim()) return meldung(ausgabe, "Bitte den Vornamen eingeben.", "fehler");
  if (!/^\d{4,8}$/.test(pin)) return meldung(ausgabe, "Die PIN muss aus 4 bis 8 Ziffern bestehen.", "fehler");
  if (pin !== feld("pin2").value.trim()) return meldung(ausgabe, "Die beiden PINs stimmen nicht überein.", "fehler");
  if (passwort.length < 8) return meldung(ausgabe, "Das Passwort muss mindestens 8 Zeichen haben.", "fehler");
  if (passwort !== feld("passwort2").value) return meldung(ausgabe, "Die beiden Passwörter stimmen nicht überein.", "fehler");

  if (jetztSchlafenszeit()
      && !confirm("Mit diesen Zeiten ist sofort Schlafenszeit und der Stick ist gesperrt. Trotzdem so einrichten?")) {
    return meldung(ausgabe, "Bitte die Schlafenszeit anpassen.", "fehler");
  }

  meldung(ausgabe, "Wird eingerichtet …");
  try {
    await api("/api/einrichtung", {
      kind_name: feld("kind_name").value.trim(),
      schulstufe: Number(feld("schulstufe").value),
      pin,
      passwort,
      limit_schultag: Number(feld("limit_schultag").value),
      limit_wochenende: Number(feld("limit_wochenende").value),
      schlafen_von: feld("schlafen_von").value,
      schlafen_bis: feld("schlafen_bis").value,
    });
    meldung(ausgabe, "Fertig! Der Kinder-Stick ist bereit.", "ok");
    setTimeout(() => { location.href = "index.html"; }, 1500);
  } catch (e) {
    meldung(ausgabe, e.message, "fehler");
  }
});

pruefenObSchonEingerichtet();
