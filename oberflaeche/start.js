"use strict";
// Kinder-Stick – Startseite des Kindes

const el = (id) => document.getElementById(id);
let letzteApps = "";
let letzterGrund = null;
let letzteEigene = "";
let eigeneHintergruende = [];   // [{id, url}] – eigene Bilder (Eltern-Bereich, Malen, Kamera)

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
  const eigeneStand = JSON.stringify(s.eigene_hintergruende || []);
  if (eigeneStand !== letzteEigene) {
    eigeneHintergruende = s.eigene_hintergruende || [];
    galerieBauen();
    letzteEigene = eigeneStand;
  }
  hintergrundSetzen(s.hintergrund);

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
    const antwort = await api("/api/starten", { app: app.id });
    if (antwort.seite) location.href = antwort.seite;   // eigenes Programm (apps/…)
    else oeffnenZeigen(app);
  } catch (e) {
    vorlesen(e.message);
    aktualisieren();
  }
}

// ---------- „Wird geöffnet“ ----------
// Programme wie Lernspiele oder Netflix brauchen ein paar Sekunden. So lange zeigt die Startseite
// ein Ladebild (auch damit der „Fertig“-Knopf nicht über dem Namen des Kindes erscheint).
let oeffnenZeit = null;
function oeffnenZeigen(app) {
  el("oeffnen-symbol").textContent = app.symbol;
  el("oeffnen-titel").textContent = `${app.name} wird geöffnet`;
  el("oeffnen-hinweis").hidden = false;
  clearTimeout(oeffnenZeit);
  oeffnenZeit = setTimeout(oeffnenVerbergen, 30000);
}
function oeffnenVerbergen() {
  clearTimeout(oeffnenZeit);
  el("oeffnen-hinweis").hidden = true;
}
// Kommt die Startseite nach dem Programm wieder nach vorne, verschwindet das Ladebild
let warWeg = false;
window.addEventListener("blur", () => { if (!el("oeffnen-hinweis").hidden) warWeg = true; });
window.addEventListener("focus", () => { if (warWeg) { warWeg = false; oeffnenVerbergen(); } });
el("oeffnen-hinweis").addEventListener("click", oeffnenVerbergen);

// ---------- Lautstärke ----------
let tonZeit = null;
el("ton-knopf").addEventListener("click", async () => {
  el("ton-dialog").showModal();
  try {
    const t = await api("/api/lautstaerke");
    el("ton-regler").value = t.stumm ? 0 : t.wert;
    el("ton-regler").disabled = false;
  } catch (e) {
    el("ton-regler").disabled = true;
    el("ton-hinweis").textContent = "Der Ton lässt sich gerade nicht einstellen.";
  }
});
el("ton-regler").addEventListener("input", () => {
  clearTimeout(tonZeit);   // nicht bei jeder kleinen Bewegung den Dienst fragen
  tonZeit = setTimeout(() => api("/api/lautstaerke", { wert: Number(el("ton-regler").value) }).catch(() => {}), 150);
});
el("ton-schliessen").addEventListener("click", () => el("ton-dialog").close());

// ---------- Hintergrund-Galerie ----------
// Eigene, frei verwendbare Bilder (oberflaeche/hintergruende/). Der Dienst prüft die Auswahl.
const HINTERGRUENDE = [
  { id: "standard", name: "Grün" },
  { id: "eispalast", name: "Eispalast" },
  { id: "savanne", name: "Savanne" },
  { id: "unterwasser", name: "Unterwasser" },
  { id: "weltraum", name: "Weltraum" },
  { id: "regenbogen", name: "Regenbogen" },
];

function hintergrundSetzen(id) {
  const eigen = eigeneHintergruende.find((h) => h.id === id);
  document.body.dataset.hintergrund = eigen ? "eigen" : (HINTERGRUENDE.some((h) => h.id === id) ? id : "standard");
  document.body.style.backgroundImage = eigen ? `url("${eigen.url}")` : "";
}

function galerieBauen() {
  el("hg-galerie").replaceChildren();
  const eigene = eigeneHintergruende.map((h, i) => ({ id: h.id, name: `Mein Bild ${i + 1}`, url: h.url }));
  for (const h of [...HINTERGRUENDE, ...eigene]) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "hg-wahl";
    const bild = document.createElement("span");
    bild.className = "hg-bild";
    bild.dataset.hintergrund = h.url ? "eigen" : h.id;
    if (h.url) bild.style.backgroundImage = `url("${h.url}")`;
    const name = document.createElement("span");
    name.textContent = h.name;
    knopf.append(bild, name);
    knopf.addEventListener("click", async () => {
      vorlesen(h.name);
      hintergrundSetzen(h.id);
      el("hg-dialog").close();
      try {
        await api("/api/hintergrund", { hintergrund: h.id });
      } catch (e) {
        aktualisieren();
      }
    });
    el("hg-galerie").append(knopf);
  }
}

el("hg-knopf").addEventListener("click", () => {
  vorlesen("Such dir einen Hintergrund aus");
  el("hg-dialog").showModal();
});
el("hg-schliessen").addEventListener("click", () => el("hg-dialog").close());

// ---------- Ausschalten ----------
el("aus-knopf").addEventListener("click", () => {
  vorlesen("Computer ausschalten?");
  el("aus-dialog").showModal();
});
el("aus-nein").addEventListener("click", () => el("aus-dialog").close());
el("aus-ja").addEventListener("click", async () => {
  el("aus-dialog").close();
  el("aus-fehler").hidden = true;
  try {
    // Mit Daten = POST. Test 6 (27.11.2026): ohne {} ging ein GET hinaus, der Dienst antwortete
    // „Nicht gefunden“ und der Fehler wurde nur „vorgelesen“ (Vorlesen ist aus) – nichts geschah.
    await api("/api/ausschalten", {});
    vorlesen("Tschüss!");
    el("aus-hinweis").hidden = false;
    ausschaltenBeobachten((text) => {
      el("aus-fehler").textContent = text;
      el("aus-fehler").hidden = false;
    });
  } catch (e) {
    el("aus-hinweis").hidden = false;
    el("aus-fehler").textContent = "Das Ausschalten hat nicht geklappt: " + e.message;
    el("aus-fehler").hidden = false;
    setTimeout(() => { el("aus-hinweis").hidden = true; }, 10000);
  }
});

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

// PIN auch über die Tastatur (Ziffernreihe und Nummernblock, auch bei ausgeschaltetem NumLock)
el("pin-dialog").addEventListener("keydown", (e) => {
  let taste = null;
  if (/^[0-9]$/.test(e.key)) taste = e.key;
  else if (/^Numpad[0-9]$/.test(e.code)) taste = e.code.slice(-1);
  else if (e.key === "Backspace" || e.key === "Delete") taste = "⌫";
  else if (e.key === "Enter") taste = "OK";
  if (taste === null) return;   // Escape schließt den Dialog wie gewohnt
  e.preventDefault();
  pinTaste(taste);
});

pinTastenBauen();
galerieBauen();
aktualisieren();
setInterval(aktualisieren, 15000);
