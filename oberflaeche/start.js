"use strict";
// Kinder-Stick – Startseite des Kindes

const el = (id) => document.getElementById(id);
let letzteApps = "";
let letzterGrund = null;

async function aktualisieren() {
  let s;
  try {
    s = await api("/api/status");
  } catch (e) {
    el("zeit-text").textContent = "Einen Moment …";
    return;
  }
  if (!s.eingerichtet) {
    location.href = "einrichtung.html";
    return;
  }

  el("gruss").textContent = `Hallo ${s.kind_name}!`;

  // Restzeit
  const rest = s.rest_minuten;
  el("zeit-text").textContent = `Noch ${minutenText(rest)}`;
  const anteil = s.limit_minuten > 0 ? Math.min(100, (rest / s.limit_minuten) * 100) : 0;
  el("balken").style.width = anteil + "%";
  el("balken").classList.toggle("knapp", rest <= 10);

  // Kacheln nur neu zeichnen, wenn sich die Apps geändert haben
  const appsStand = JSON.stringify(s.apps);
  if (appsStand !== letzteApps) {
    kachelnZeichnen(s.apps);
    letzteApps = appsStand;
  }

  // Sperre (Schlafenszeit oder Zeit um)
  el("kacheln").hidden = s.gesperrt;
  el("sperre").hidden = !s.gesperrt;
  if (s.gesperrt) {
    if (s.grund === "schlafenszeit") {
      el("sperre-symbol").textContent = "🌙";
      el("sperre-titel").textContent = "Schlafenszeit";
      el("sperre-text").textContent = `Gute Nacht! Ab ${s.schlafen_bis} Uhr geht es weiter.`;
    } else {
      el("sperre-symbol").textContent = "🌻";
      el("sperre-titel").textContent = "Für heute ist Schluss";
      el("sperre-text").textContent = "Deine Zeit für heute ist vorbei. Morgen geht es weiter!";
    }
    if (letzterGrund !== s.grund) vorlesen(el("sperre-titel").textContent);
  }
  letzterGrund = s.gesperrt ? s.grund : null;
}

function kachelnZeichnen(apps) {
  const bereich = el("kacheln");
  bereich.replaceChildren();
  for (const app of apps) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "kachel";
    const symbol = document.createElement("span");
    symbol.className = "kachel-symbol";
    symbol.textContent = app.symbol;
    symbol.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "kachel-name";
    name.textContent = app.name;
    knopf.append(symbol, name);
    knopf.addEventListener("click", () => starten(app));
    bereich.append(knopf);
  }
}

async function starten(app) {
  vorlesen(app.name);
  try {
    await api("/api/starten", { app: app.id });
  } catch (e) {
    vorlesen(e.message);
    aktualisieren();
  }
}

// ---------- PIN-Dialog für den Eltern-Bereich ----------
let pin = "";

function pinAnzeigen() {
  el("pin-anzeige").textContent = "●".repeat(pin.length);
}

function pinTastenBauen() {
  const tasten = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
  for (const t of tasten) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = t;
    if (t === "OK") knopf.className = "ok";
    knopf.addEventListener("click", () => pinTaste(t));
    el("pin-tasten").append(knopf);
  }
}

async function pinTaste(t) {
  if (t === "⌫") {
    pin = pin.slice(0, -1);
  } else if (t === "OK") {
    try {
      const antwort = await api("/api/eltern/anmelden", { pin });
      sessionStorage.setItem("elternToken", antwort.token);
      location.href = "eltern.html";
      return;
    } catch (e) {
      el("pin-fehler").textContent = e.message;
      pin = "";
    }
  } else if (pin.length < 8) {
    pin += t;
    el("pin-fehler").textContent = "";
  }
  pinAnzeigen();
}

el("eltern-knopf").addEventListener("click", () => {
  pin = "";
  pinAnzeigen();
  el("pin-fehler").textContent = "";
  el("pin-dialog").showModal();
});
el("pin-abbrechen").addEventListener("click", () => el("pin-dialog").close());

pinTastenBauen();
aktualisieren();
setInterval(aktualisieren, 15000);
