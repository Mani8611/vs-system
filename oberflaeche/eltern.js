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
}

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

laden().catch((e) => meldung($("einst-meldung"), e.message, "fehler"));
