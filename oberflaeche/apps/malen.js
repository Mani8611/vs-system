"use strict";
// Kinder-Stick – Malen: Pinsel, Ausfüllen, Stempel, Radierer, Rückgängig, Bilder aufheben

const $ = (id) => document.getElementById(id);
const leinwand = $("leinwand");
const ctx = leinwand.getContext("2d", { willReadFrequently: true });

const FARBEN = ["#1F2933", "#FFFFFF", "#F26B5B", "#FF8FB1", "#F9A03F", "#FFD93D",
  "#6BCB77", "#2E9E5B", "#4D96FF", "#1B4F9C", "#9B72CF", "#8B5A2B"];
const STEMPEL = ["⭐", "❤️", "🌸", "🌈", "☀️", "🌙", "🦋", "🐱", "🐶", "🐟", "🦄", "🌳", "🏠", "🚗", "🎈", "🍎"];
const PINSEL = { 1: 6, 2: 16, 3: 34 };
const STEMPEL_GROESSE = { 1: 50, 2: 90, 3: 150 };
const MAX_SCHRITTE = 15;
const MAX_BILDER = 12;

const zustand = { werkzeug: "pinsel", farbe: FARBEN[2], groesse: 2, stempel: STEMPEL[0] };
let malt = false;
let letzter = null;
const verlauf = [];

// ---------- Leinwand ----------
function leinwandEinrichten() {
  const r = $("rahmen").getBoundingClientRect();
  leinwand.width = Math.round(r.width);
  leinwand.height = Math.round(r.height);
  leeren();
}

function leeren() {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, leinwand.width, leinwand.height);
}

function punkt(ereignis) {
  const r = leinwand.getBoundingClientRect();
  return {
    x: (ereignis.clientX - r.left) * (leinwand.width / r.width),
    y: (ereignis.clientY - r.top) * (leinwand.height / r.height),
  };
}

function merken() {
  verlauf.push(ctx.getImageData(0, 0, leinwand.width, leinwand.height));
  if (verlauf.length > MAX_SCHRITTE) verlauf.shift();
}

// ---------- Malen ----------
function linie(von, bis) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = zustand.werkzeug === "radierer" ? "#FFFFFF" : zustand.farbe;
  ctx.lineWidth = PINSEL[zustand.groesse] * (zustand.werkzeug === "radierer" ? 2 : 1);
  ctx.beginPath();
  ctx.moveTo(von.x, von.y);
  ctx.lineTo(bis.x, bis.y);
  ctx.stroke();
}

function stempeln(p) {
  const g = STEMPEL_GROESSE[zustand.groesse];
  ctx.font = `${g}px "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(zustand.stempel, p.x, p.y);
}

function farbeAlsRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Ausfüllen einer Fläche (Füllung mit Toleranz, damit Kanten sauber werden). */
function fuellen(p) {
  const b = leinwand.width;
  const h = leinwand.height;
  const x0 = Math.floor(p.x);
  const y0 = Math.floor(p.y);
  const bild = ctx.getImageData(0, 0, b, h);
  const d = bild.data;
  const start = (y0 * b + x0) * 4;
  const ziel = [d[start], d[start + 1], d[start + 2]];
  const neu = farbeAlsRgb(zustand.farbe);
  if (Math.abs(ziel[0] - neu[0]) + Math.abs(ziel[1] - neu[1]) + Math.abs(ziel[2] - neu[2]) < 10) return;
  const TOLERANZ = 90;
  const passt = (i) => Math.abs(d[i] - ziel[0]) + Math.abs(d[i + 1] - ziel[1]) + Math.abs(d[i + 2] - ziel[2]) <= TOLERANZ;
  const besucht = new Uint8Array(b * h);
  const stapel = [x0, y0];
  while (stapel.length) {
    const y = stapel.pop();
    let x = stapel.pop();
    while (x >= 0 && passt((y * b + x) * 4) && !besucht[y * b + x]) x--;
    x++;
    let oben = false;
    let unten = false;
    while (x < b && !besucht[y * b + x] && passt((y * b + x) * 4)) {
      const i = (y * b + x) * 4;
      d[i] = neu[0]; d[i + 1] = neu[1]; d[i + 2] = neu[2]; d[i + 3] = 255;
      besucht[y * b + x] = 1;
      if (y > 0) {
        const o = ((y - 1) * b + x);
        if (!besucht[o] && passt(o * 4)) { if (!oben) { stapel.push(x, y - 1); oben = true; } } else oben = false;
      }
      if (y < h - 1) {
        const u = ((y + 1) * b + x);
        if (!besucht[u] && passt(u * 4)) { if (!unten) { stapel.push(x, y + 1); unten = true; } } else unten = false;
      }
      x++;
    }
  }
  ctx.putImageData(bild, 0, 0);
}

leinwand.addEventListener("pointerdown", (e) => {
  $("stempel-leiste").hidden = true;
  const p = punkt(e);
  merken();
  if (zustand.werkzeug === "fuellen") return fuellen(p);
  if (zustand.werkzeug === "stempel") return stempeln(p);
  malt = true;
  letzter = p;
  leinwand.setPointerCapture(e.pointerId);
  linie(p, p);
});
leinwand.addEventListener("pointermove", (e) => {
  if (!malt) return;
  const p = punkt(e);
  linie(letzter, p);
  letzter = p;
});
const ende = () => { malt = false; letzter = null; };
leinwand.addEventListener("pointerup", ende);
leinwand.addEventListener("pointercancel", ende);

// ---------- Werkzeuge, Größen, Farben, Stempel ----------
function aktivSetzen(auswahl, element) {
  document.querySelectorAll(auswahl).forEach((k) => k.classList.toggle("aktiv", k === element));
}

document.querySelectorAll(".werkzeug").forEach((knopf) => knopf.addEventListener("click", () => {
  zustand.werkzeug = knopf.dataset.werkzeug;
  aktivSetzen(".werkzeug", knopf);
  $("stempel-leiste").hidden = zustand.werkzeug !== "stempel";
}));
document.querySelectorAll(".groesse").forEach((knopf) => knopf.addEventListener("click", () => {
  zustand.groesse = Number(knopf.dataset.groesse);
  aktivSetzen(".groesse", knopf);
}));

for (const farbe of FARBEN) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "farbe" + (farbe === zustand.farbe ? " aktiv" : "");
  knopf.style.background = farbe;
  knopf.setAttribute("aria-label", "Farbe " + farbe);
  knopf.addEventListener("click", () => {
    zustand.farbe = farbe;
    aktivSetzen(".farbe", knopf);
    if (zustand.werkzeug === "radierer" || zustand.werkzeug === "stempel") {
      zustand.werkzeug = "pinsel";
      aktivSetzen(".werkzeug", document.querySelector('[data-werkzeug="pinsel"]'));
      $("stempel-leiste").hidden = true;
    }
  });
  $("farben").append(knopf);
}

for (const s of STEMPEL) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = s;
  if (s === zustand.stempel) knopf.className = "aktiv";
  knopf.addEventListener("click", () => {
    zustand.stempel = s;
    aktivSetzen(".stempel-leiste button", knopf);
    document.querySelector('[data-werkzeug="stempel"]').textContent = s;
    $("stempel-leiste").hidden = true;
  });
  $("stempel-leiste").append(knopf);
}

// ---------- Rückgängig, Neu ----------
$("rueckgaengig").addEventListener("click", () => {
  const schritt = verlauf.pop();
  if (schritt) ctx.putImageData(schritt, 0, 0);
});
$("neu").addEventListener("click", () => $("neu-dialog").showModal());
$("neu-nein").addEventListener("click", () => $("neu-dialog").close());
$("neu-ja").addEventListener("click", () => {
  merken();
  leeren();
  $("neu-dialog").close();
});

// ---------- Bilder aufheben und wieder öffnen ----------
function bilderLaden() { return KsApp.laden("bilder", []); }

function hinweisZeigen(text) {
  $("gespeichert").textContent = text;
  $("gespeichert").hidden = false;
  setTimeout(() => { $("gespeichert").hidden = true; }, 1800);
}

$("speichern").addEventListener("click", () => {
  const bilder = bilderLaden();
  bilder.unshift(leinwand.toDataURL("image/jpeg", 0.8));
  KsApp.speichern("bilder", bilder.slice(0, MAX_BILDER));
  hinweisZeigen("💾 Aufgehoben!");
});

// Bild als Hintergrund der Startseite (wird am Stick gespeichert)
$("hintergrund").addEventListener("click", async () => {
  try {
    await KsApp.alsHintergrund(leinwand.toDataURL("image/jpeg", 0.85));
    hinweisZeigen("🏞️ Ist jetzt dein Hintergrund!");
  } catch (e) {
    hinweisZeigen("Das hat nicht geklappt.");
  }
});

$("bilder").addEventListener("click", () => {
  const bilder = bilderLaden();
  const liste = $("bilder-liste");
  liste.replaceChildren();
  $("bilder-leer").hidden = bilder.length > 0;
  for (const daten of bilder) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    const img = document.createElement("img");
    img.src = daten;
    img.alt = "Gemaltes Bild";
    knopf.append(img);
    knopf.addEventListener("click", () => {
      const bild = new Image();
      bild.onload = () => {
        merken();
        leeren();
        ctx.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
      };
      bild.src = daten;
      $("bilder-dialog").close();
    });
    liste.append(knopf);
  }
  $("bilder-dialog").showModal();
});
$("bilder-zu").addEventListener("click", () => $("bilder-dialog").close());

leinwandEinrichten();
KsApp.start("malen");
