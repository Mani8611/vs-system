"use strict";
// Kinder-Stick – Merkspiel (Memory): Paare finden. Größe wählbar, Vorschlag passend zur Klasse.

const $ = (id) => document.getElementById(id);
const BILDER = ["🐶", "🐱", "🐰", "🦊", "🐻", "🐼", "🐸", "🐵", "🦁", "🐯", "🐮", "🐷", "🐧", "🦉", "🐢", "🦋"];
const GROESSEN = [
  { paare: 6, spalten: 4, name: "Leicht", farbe: "farbe-3" },
  { paare: 8, spalten: 4, name: "Mittel", farbe: "farbe-2" },
  { paare: 10, spalten: 5, name: "Schwer", farbe: "farbe-4" },
  { paare: 12, spalten: 6, name: "Profi", farbe: "farbe-1" },
];

let groesse = GROESSEN[0];
let offen = [];
let gefunden = 0;
let zuege = 0;
let sperre = false;

function auswahlZeigen() {
  $("auswahl").hidden = false;
  $("spiel").hidden = true;
  $("ende").hidden = true;
  const vorschlag = Math.min(KsApp.schulstufe, GROESSEN.length) - 1;
  const karten = $("wahl-karten");
  karten.replaceChildren();
  GROESSEN.forEach((g, i) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "wahl-karte " + g.farbe;
    const gross = document.createElement("span");
    gross.className = "gross";
    gross.textContent = g.paare * 2;
    const name = document.createElement("span");
    name.textContent = g.name;
    const klein = document.createElement("span");
    klein.className = "klein";
    klein.textContent = i === vorschlag ? "⭐ passt für dich" : `${g.paare} Paare`;
    knopf.append(gross, name, klein);
    knopf.addEventListener("click", () => spielStarten(g));
    karten.append(knopf);
  });
}

function spielStarten(g) {
  groesse = g;
  offen = [];
  gefunden = 0;
  zuege = 0;
  sperre = false;
  $("zuege").textContent = "Züge: 0";
  $("auswahl").hidden = true;
  $("ende").hidden = true;
  $("spiel").hidden = false;
  const feld = $("feld");
  feld.replaceChildren();
  feld.style.gridTemplateColumns = `repeat(${g.spalten}, 130px)`;
  const motive = KsApp.mischen(BILDER).slice(0, g.paare);
  for (const motiv of KsApp.mischen([...motive, ...motive])) {
    const karte = document.createElement("button");
    karte.type = "button";
    karte.className = "karte-m";
    karte.dataset.motiv = motiv;
    const innen = document.createElement("span");
    innen.className = "innen";
    const hinten = document.createElement("span");
    hinten.className = "hinten";
    hinten.textContent = "?";
    const vorne = document.createElement("span");
    vorne.className = "vorne";
    vorne.textContent = motiv;
    innen.append(hinten, vorne);
    karte.append(innen);
    karte.addEventListener("click", () => umdrehen(karte));
    feld.append(karte);
  }
}

function umdrehen(karte) {
  if (sperre || karte.classList.contains("offen") || karte.classList.contains("gefunden")) return;
  karte.classList.add("offen");
  offen.push(karte);
  if (offen.length < 2) return;
  zuege += 1;
  $("zuege").textContent = `Züge: ${zuege}`;
  const [a, b] = offen;
  offen = [];
  if (a.dataset.motiv === b.dataset.motiv) {
    setTimeout(() => {
      a.classList.add("gefunden");
      b.classList.add("gefunden");
      KsApp.animieren(a, "huepft");
      KsApp.animieren(b, "huepft");
      gefunden += 1;
      if (gefunden === groesse.paare) setTimeout(spielEnde, 700);
    }, 350);
  } else {
    sperre = true;
    setTimeout(() => {
      a.classList.remove("offen");
      b.classList.remove("offen");
      sperre = false;
    }, 1100);
  }
}

function spielEnde() {
  $("spiel").hidden = true;
  $("ende").hidden = false;
  $("ende-text").textContent = `Du hast ${zuege} Züge gebraucht.`;
  KsApp.konfetti();
}

$("nochmal").addEventListener("click", () => spielStarten(groesse));
$("andere").addEventListener("click", auswahlZeigen);

KsApp.start("merkspiel").then(auswahlZeigen);
