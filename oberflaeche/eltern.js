"use strict";
// Kinder-Stick – Eltern-Bereich (nur nach PIN-Eingabe, Token gilt 10 Minuten)

const $ = (id) => document.getElementById(id);
const token = sessionStorage.getItem("elternToken");
let gewaehltesNetz = null;

function zurueckZumKind() {
  sessionStorage.removeItem("elternToken");
  location.href = "index.html";
}

/** Eltern-API mit Token; bei abgelaufenem Token zurück zur Startseite. */
async function elternApi(pfad, daten = {}) {
  try {
    return await api(pfad, { ...daten, token });
  } catch (e) {
    if (e.status === 401) zurueckZumKind();
    throw e;
  }
}

async function laden() {
  if (!token) return zurueckZumKind();
  const u = await elternApi("/api/eltern/uebersicht");

  $("unterzeile").textContent = `${u.kind_name} · ${u.schulstufe}. Klasse Volksschule`;

  const h = u.heute;
  $("heute-rest").textContent = `Noch ${minutenText(h.rest_minuten)}`;
  let text = `Heutiges Limit inklusive Bonus: ${minutenText(h.limit_minuten)}.`;
  if (h.gesperrt) text += h.grund === "schlafenszeit" ? " Gerade ist Schlafenszeit." : " Die Zeit für heute ist aufgebraucht.";
  $("heute-text").textContent = text;

  // Nutzung der letzten 7 Tage als einfache Balken
  const max = Math.max(30, ...u.tage.map((t) => t.minuten));
  const tage = $("tage");
  tage.replaceChildren();
  for (const t of u.tage) {
    const spalte = document.createElement("div");
    spalte.className = "tag";
    const wert = document.createElement("span");
    wert.textContent = `${t.minuten}′`;
    const balken = document.createElement("div");
    balken.className = "tag-balken";
    balken.style.height = `${Math.round((t.minuten / max) * 80)}px`;
    const datum = document.createElement("span");
    const d = new Date(t.tag + "T12:00:00");
    datum.textContent = d.toLocaleDateString("de-AT", { weekday: "short" });
    spalte.append(wert, balken, datum);
    tage.append(spalte);
  }

  $("limit_schultag").value = u.limit_schultag;
  $("limit_wochenende").value = u.limit_wochenende;
  $("schlafen_von").value = u.schlafen_von;
  $("schlafen_bis").value = u.schlafen_bis;

  const liste = $("app-liste");
  liste.replaceChildren();
  for (const app of u.apps) {
    const zeile = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = app.id;
    box.checked = app.erlaubt;
    zeile.append(box, `${app.symbol} ${app.name}`);
    liste.append(zeile);
  }
  hoerenZeigen(u.hoeren);
}

// ---------- Hörbücher ----------
function groesseText(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function hoerenZeigen(h) {
  if (!h) return;
  // Ca. 30 MB je Stunde (MP3 mit 64 kbit/s, typisch für Hörbücher)
  $("hoer-platz").textContent = `Noch frei für Hörbücher: ${groesseText(h.frei)} (etwa ${Math.floor(h.frei / 30e6)} Stunden). 3 GB bleiben für System-Updates reserviert.`;
  const liste = $("hoer-liste");
  liste.replaceChildren();
  for (const buch of h.buecher) {
    const zeile = document.createElement("div");
    zeile.className = "bt-geraet";
    const text = document.createElement("span");
    text.textContent = `🎧 ${buch.titel} – ${buch.kapitel} ${buch.kapitel === 1 ? "Teil" : "Teile"}, ${groesseText(buch.bytes)}`;
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "knopf zweit";
    weg.textContent = "Löschen";
    weg.addEventListener("click", async () => {
      if (weg.dataset.sicher !== "1") {   // zweimal tippen statt confirm()
        weg.dataset.sicher = "1";
        weg.textContent = "Wirklich löschen?";
        setTimeout(() => { weg.dataset.sicher = ""; weg.textContent = "Löschen"; }, 5000);
        return;
      }
      try {
        await elternApi("/api/eltern/hoerbuch-loeschen", { id: buch.id });
        meldung($("hoer-meldung"), `„${buch.titel}“ gelöscht.`, "ok");
        laden();
      } catch (e) {
        meldung($("hoer-meldung"), e.message, "fehler");
      }
    });
    zeile.append(text, weg);
    liste.append(zeile);
  }

  const reihen = $("reihen-liste");
  reihen.replaceChildren();
  for (const r of h.reihen) {
    const zeile = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = r.id;
    box.checked = r.an;
    zeile.append(box, `${r.titel}${r.alter ? ` (${r.alter} Jahre)` : ""}`);
    reihen.append(zeile);
  }
}

let hoerAuswahl = [];
function hoerAuswahlSetzen(dateien) {
  const erlaubt = /\.(mp3|m4a|m4b|ogg|opus|jpe?g|png)$/i;
  hoerAuswahl = [...dateien].filter((d) => erlaubt.test(d.name));
  const ordner = [...dateien].find((d) => d.webkitRelativePath);
  if (ordner && !$("hoer-titel").value.trim()) $("hoer-titel").value = ordner.webkitRelativePath.split("/")[0];
  const bytes = hoerAuswahl.reduce((s, d) => s + d.size, 0);
  const uebrig = dateien.length - hoerAuswahl.length;
  $("hoer-auswahl").textContent = hoerAuswahl.length
    ? `${hoerAuswahl.length} Dateien, zusammen ${groesseText(bytes)}${uebrig ? ` (${uebrig} andere Dateien werden übersprungen)` : ""}`
    : "Keine passenden Dateien (MP3, M4A/M4B, OGG, JPG, PNG).";
  $("hoer-hochladen").disabled = hoerAuswahl.length === 0;
}
$("hoer-dateien").addEventListener("change", () => hoerAuswahlSetzen($("hoer-dateien").files));
$("hoer-ordner").addEventListener("change", () => hoerAuswahlSetzen($("hoer-ordner").files));

/** Eine Datei roh hochladen (kein JSON – Hörbücher sind groß). */
async function hoerDateiSenden(buchId, datei) {
  if (window.KS_VORSCHAU_API) return window.KS_VORSCHAU_API("/api/eltern/hoerbuch-datei", { id: buchId, name: datei.name, groesse: datei.size }, true);
  const antwort = await fetch("/api/eltern/hoerbuch-datei", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Token": token, "X-Hoerbuch": buchId, "X-Dateiname": encodeURIComponent(datei.name),
    },
    body: datei,
  });
  let json = {};
  try { json = await antwort.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (antwort.status === 401) zurueckZumKind();
  if (!antwort.ok) throw new Error(json.fehler || "Fehler " + antwort.status);
  return json;
}

$("hoer-hochladen").addEventListener("click", async () => {
  const titel = $("hoer-titel").value.trim();
  if (!titel) return meldung($("hoer-meldung"), "Bitte zuerst einen Titel eingeben.", "fehler");
  $("hoer-hochladen").disabled = true;
  try {
    const { id } = await elternApi("/api/eltern/hoerbuch-neu", { titel });
    let i = 0;
    for (const datei of hoerAuswahl) {
      i += 1;
      meldung($("hoer-meldung"), `Lade hoch: ${i} von ${hoerAuswahl.length} – ${datei.name} …`);
      await hoerDateiSenden(id, datei);
    }
    meldung($("hoer-meldung"), `„${titel}“ ist auf dem Stick.`, "ok");
    $("hoer-titel").value = "";
    $("hoer-auswahl").textContent = "";
    hoerAuswahl = [];
  } catch (e) {
    meldung($("hoer-meldung"), e.message, "fehler");
    $("hoer-hochladen").disabled = false;
  }
  laden();
});

$("reihen-speichern").addEventListener("click", async () => {
  const an = [...document.querySelectorAll("#reihen-liste input:checked")].map((b) => b.value);
  try {
    await elternApi("/api/eltern/hoerreihen", { an });
    meldung($("reihen-meldung"), "Gespeichert.", "ok");
  } catch (e) {
    meldung($("reihen-meldung"), e.message, "fehler");
  }
});

// Bonuszeit
document.querySelectorAll("[data-bonus]").forEach((knopf) => {
  knopf.addEventListener("click", async () => {
    try {
      await elternApi("/api/eltern/bonus", { minuten: Number(knopf.dataset.bonus) });
      meldung($("bonus-meldung"), "Gespeichert.", "ok");
      laden();
    } catch (e) {
      meldung($("bonus-meldung"), e.message, "fehler");
    }
  });
});

// Einstellungen speichern
$("speichern").addEventListener("click", async () => {
  const daten = {
    limit_schultag: Number($("limit_schultag").value),
    limit_wochenende: Number($("limit_wochenende").value),
    schlafen_von: $("schlafen_von").value,
    schlafen_bis: $("schlafen_bis").value,
    erlaubte_apps: [...document.querySelectorAll("#app-liste input:checked")].map((b) => b.value),
  };
  const pinNeu = $("pin_neu").value.trim();
  if (pinNeu) daten.pin_neu = pinNeu;
  try {
    await elternApi("/api/eltern/einstellungen", daten);
    $("pin_neu").value = "";
    meldung($("einst-meldung"), "Gespeichert.", "ok");
    laden();
  } catch (e) {
    meldung($("einst-meldung"), e.message, "fehler");
  }
});

// WLAN
$("wlan-suchen").addEventListener("click", async () => {
  meldung($("wlan-meldung"), "Suche WLAN …");
  try {
    const { netze } = await elternApi("/api/eltern/wlan-liste");
    const liste = $("wlan-liste");
    liste.replaceChildren();
    for (const netz of netze) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "wlan-netz";
      const name = document.createElement("span");
      name.textContent = `${netz.gesichert ? "🔒" : "📶"} ${netz.ssid}`;
      const info = document.createElement("span");
      info.textContent = netz.aktiv ? "verbunden" : `${netz.signal} %`;
      knopf.append(name, info);
      knopf.addEventListener("click", () => {
        gewaehltesNetz = netz;
        document.querySelectorAll(".wlan-netz").forEach((k) => k.classList.remove("gewaehlt"));
        knopf.classList.add("gewaehlt");
        $("wlan-label").textContent = netz.gesichert ? `Passwort für „${netz.ssid}“` : `„${netz.ssid}“ ist offen – kein Passwort nötig`;
        $("wlan-passwort").hidden = !netz.gesichert;
        $("wlan-verbinden-bereich").hidden = false;
      });
      liste.append(knopf);
    }
    meldung($("wlan-meldung"), netze.length ? "" : "Kein WLAN gefunden.", netze.length ? "" : "fehler");
  } catch (e) {
    meldung($("wlan-meldung"), e.message, "fehler");
  }
});

$("wlan-verbinden").addEventListener("click", async () => {
  if (!gewaehltesNetz) return;
  meldung($("wlan-meldung"), "Verbinde …");
  try {
    await elternApi("/api/eltern/wlan-verbinden", { ssid: gewaehltesNetz.ssid, passwort: $("wlan-passwort").value });
    $("wlan-passwort").value = "";
    meldung($("wlan-meldung"), `Verbunden mit „${gewaehltesNetz.ssid}“.`, "ok");
  } catch (e) {
    meldung($("wlan-meldung"), e.message, "fehler");
  }
});

// Bluetooth-Kopfhörer
async function btSuchen() {
  meldung($("bt-meldung"), "Suche Geräte (ca. 10 Sekunden) …");
  $("bt-suchen").disabled = true;
  try {
    const { geraete } = await elternApi("/api/eltern/bluetooth-liste");
    const liste = $("bt-liste");
    liste.replaceChildren();
    for (const g of geraete) {
      const zeile = document.createElement("div");
      zeile.className = "bt-geraet";
      const name = document.createElement("span");
      name.textContent = `${g.audio ? "🎧" : "📱"} ${g.name}${g.verbunden ? " – verbunden" : g.gekoppelt ? " – gekoppelt" : ""}`;
      const knoepfe = document.createElement("span");
      knoepfe.className = "knopf-reihe";
      if (!g.verbunden) {
        const verbinden = document.createElement("button");
        verbinden.type = "button";
        verbinden.className = "knopf";
        verbinden.textContent = g.gekoppelt ? "Verbinden" : "Koppeln";
        verbinden.addEventListener("click", () => btAktion("/api/eltern/bluetooth-verbinden", g, `Verbinde mit „${g.name}“ …`));
        knoepfe.append(verbinden);
      }
      if (g.gekoppelt) {
        const entfernen = document.createElement("button");
        entfernen.type = "button";
        entfernen.className = "knopf zweit";
        entfernen.textContent = "Entfernen";
        entfernen.addEventListener("click", () => btAktion("/api/eltern/bluetooth-entfernen", g, "Entferne …"));
        knoepfe.append(entfernen);
      }
      zeile.append(name, knoepfe);
      liste.append(zeile);
    }
    meldung($("bt-meldung"), geraete.length ? "" : "Kein Gerät gefunden. Ist der Kopfhörer im Kopplungsmodus?", geraete.length ? "" : "fehler");
  } catch (e) {
    meldung($("bt-meldung"), e.message, "fehler");
  }
  $("bt-suchen").disabled = false;
}

async function btAktion(pfad, geraet, text) {
  meldung($("bt-meldung"), text);
  try {
    await elternApi(pfad, { mac: geraet.mac });
    await btSuchen();
    meldung($("bt-meldung"), "Erledigt.", "ok");
  } catch (e) {
    meldung($("bt-meldung"), e.message, "fehler");
  }
}
$("bt-suchen").addEventListener("click", btSuchen);

// Eigene Hintergrundbilder
async function bilderZeigen() {
  const s = await api("/api/status");
  const bereich = $("eigene-bilder");
  bereich.replaceChildren();
  for (const h of s.eigene_hintergruende || []) {
    const bild = document.createElement("div");
    bild.className = "eigenes-bild";
    bild.style.backgroundImage = `url("${h.url}")`;
    const weg = document.createElement("button");
    weg.type = "button";
    weg.textContent = "🗑 Löschen";
    weg.addEventListener("click", async () => {
      if (!confirm("Dieses Bild löschen?")) return;
      try {
        await elternApi("/api/eltern/hintergrund-loeschen", { id: h.id });
        bilderZeigen();
      } catch (e) {
        meldung($("bild-meldung"), e.message, "fehler");
      }
    });
    bild.append(weg);
    bereich.append(bild);
  }
}

/** Liest ein Bild und verkleinert es auf höchstens 1920 × 1080 (JPEG) – spart Platz am Stick. */
function bildVerkleinern(datei) {
  return new Promise((fertig, fehler) => {
    const leser = new FileReader();
    leser.onerror = () => fehler(new Error("Die Datei konnte nicht gelesen werden."));
    leser.onload = () => {
      const bild = new Image();
      bild.onerror = () => fehler(new Error("Das ist kein Bild, das sich öffnen lässt."));
      bild.onload = () => {
        const faktor = Math.min(1, 1920 / bild.width, 1080 / bild.height);
        const leinwand = document.createElement("canvas");
        leinwand.width = Math.round(bild.width * faktor);
        leinwand.height = Math.round(bild.height * faktor);
        leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
        fertig(leinwand.toDataURL("image/jpeg", 0.85));
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  });
}

$("bild-datei").addEventListener("change", async () => {
  const datei = $("bild-datei").files[0];
  $("bild-datei").value = "";
  if (!datei) return;
  meldung($("bild-meldung"), "Lade hoch …");
  try {
    await elternApi("/api/eltern/hintergrund-hochladen", { bild: await bildVerkleinern(datei) });
    meldung($("bild-meldung"), "Hochgeladen. Das Kind kann es jetzt mit 🖼️ auswählen.", "ok");
    bilderZeigen();
  } catch (e) {
    meldung($("bild-meldung"), e.message, "fehler");
  }
});

// Fertig
$("zurueck").addEventListener("click", zurueckZumKind);
$("beenden").addEventListener("click", async () => {
  try {
    await elternApi("/api/eltern/beenden");
    sessionStorage.removeItem("elternToken");
    document.body.textContent = "Kinder-Modus wird beendet …";
  } catch (e) {
    alert(e.message);
  }
});

// Zweimal tippen statt confirm(): Firefox zeigt dort die Adresse 127.0.0.1:8411 als Überschrift
let ausschaltenBereit = null;
$("ausschalten").addEventListener("click", async () => {
  const knopf = $("ausschalten");
  if (!ausschaltenBereit) {
    knopf.textContent = "Wirklich ausschalten? Nochmal tippen";
    ausschaltenBereit = setTimeout(() => {
      knopf.textContent = "Computer ausschalten";
      ausschaltenBereit = null;
    }, 5000);
    return;
  }
  clearTimeout(ausschaltenBereit);
  ausschaltenBereit = null;
  knopf.textContent = "Computer ausschalten";
  try {
    await api("/api/ausschalten", {});   // mit Daten = POST (Test 6: GET → „Nicht gefunden“)
    sessionStorage.removeItem("elternToken");
    document.body.textContent = "Der Computer schaltet sich aus. Danach kann der Stick abgezogen werden.";
    ausschaltenBeobachten((text) => {
      const p = document.createElement("p");
      p.style.color = "#C0392B";
      p.style.whiteSpace = "pre-line";
      p.textContent = text;
      document.body.append(p);
    });
  } catch (e) {
    alert(e.message);
  }
});

laden().catch((e) => meldung($("einst-meldung"), e.message, "fehler"));
bilderZeigen().catch(() => {});
