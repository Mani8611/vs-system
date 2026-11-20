"use strict";
// Kinder-Stick – Einrichtungsassistent (einmalig durch die Eltern)

const feld = (id) => document.getElementById(id);

async function pruefenObSchonEingerichtet() {
  try {
    const s = await api("/api/status");
    if (s.eingerichtet) location.href = "index.html";
  } catch (e) { /* Dienst startet noch */ }
}

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
