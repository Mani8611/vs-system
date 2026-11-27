"use strict";
// Kinder-Stick – Buchstaben
//  * Anfangsbuchstabe: großer Buchstabe, drei Bilder – welches beginnt damit? (1. Klasse)
//  * Wörter lesen: ein Wort, drei Bilder – welches passt? (ab 2. Klasse längere Wörter)
// Ohne Sprachausgabe: die Bilder tragen die Bedeutung.

const $ = (id) => document.getElementById(id);
const RUNDE = 10;

// anlaut: false = Anfangslaut weicht vom Buchstaben ab (Sch, St, Sp, Ei …) → nur zum Lesen
const WOERTER = [
  ["Apfel", "🍎"], ["Auto", "🚗"], ["Ameise", "🐜"], ["Ananas", "🍍"],
  ["Ball", "⚽"], ["Banane", "🍌"], ["Baum", "🌳"], ["Biene", "🐝"], ["Buch", "📖"], ["Brot", "🍞"],
  ["Delfin", "🐬"], ["Drache", "🐉"],
  ["Ente", "🦆"], ["Elefant", "🐘"], ["Erdbeere", "🍓"], ["Eis", "🍦", false],
  ["Fisch", "🐟"], ["Fuchs", "🦊"], ["Frosch", "🐸"], ["Feuer", "🔥"],
  ["Giraffe", "🦒"], ["Gurke", "🥒"], ["Geschenk", "🎁"],
  ["Haus", "🏠"], ["Hund", "🐶"], ["Hase", "🐰"], ["Herz", "❤️"], ["Hut", "🎩"],
  ["Igel", "🦔"], ["Insel", "🏝️"],
  ["Katze", "🐱"], ["Kuh", "🐮"], ["Käse", "🧀"], ["Kerze", "🕯️"], ["Krone", "👑"], ["Karotte", "🥕"],
  ["Löwe", "🦁"], ["Löffel", "🥄"], ["Leiter", "🪜"],
  ["Maus", "🐭"], ["Mond", "🌙"], ["Milch", "🥛"], ["Mais", "🌽"],
  ["Nase", "👃"], ["Nudeln", "🍝"],
  ["Ohr", "👂"], ["Oktopus", "🐙"],
  ["Pinguin", "🐧"], ["Pilz", "🍄"], ["Pferd", "🐴"], ["Pizza", "🍕"],
  ["Rose", "🌹"], ["Rakete", "🚀"], ["Regen", "🌧️"], ["Ring", "💍"],
  ["Sonne", "☀️"], ["Socke", "🧦"], ["Sofa", "🛋️"],
  ["Schaf", "🐑", false], ["Schnecke", "🐌", false], ["Schlange", "🐍", false], ["Stern", "⭐", false],
  ["Tomate", "🍅"], ["Tiger", "🐯"], ["Tasse", "☕"], ["Torte", "🎂"],
  ["Uhr", "⏰"], ["Ufo", "🛸"],
  ["Wal", "🐳"], ["Wolke", "☁️"], ["Würfel", "🎲"],
  ["Zebra", "🦓"], ["Zitrone", "🍋"], ["Zug", "🚂"],
].map(([wort, emoji, anlaut]) => ({ wort, emoji, anlaut: anlaut !== false }));

let modus = "anlaut";
let fragen = [];
let nummer = 0;
let ergebnisse = [];
let fehlerInFrage = false;
let sterne = KsApp.laden("buchstaben-sterne", 0);

/** Wortlänge passend zur Klasse (Lesen): 1. Kl. kurz, später auch lang. */
function lesbar(w) {
  const k = KsApp.schulstufe;
  if (k === 1) return w.wort.length <= 4;
  if (k === 2) return w.wort.length <= 6;
  return true;
}

function frageBauen() {
  if (modus === "anlaut") {
    const kandidaten = WOERTER.filter((w) => w.anlaut);
    const ziel = kandidaten[KsApp.zufall(0, kandidaten.length - 1)];
    const buchstabe = ziel.wort[0];
    const andere = KsApp.mischen(kandidaten.filter((w) => w.wort[0] !== buchstabe)).slice(0, 2);
    return { ziel, buchstabe, auswahl: KsApp.mischen([ziel, ...andere]) };
  }
  const kandidaten = WOERTER.filter(lesbar);
  const ziel = kandidaten[KsApp.zufall(0, kandidaten.length - 1)];
  // Ab der 2. Klasse ähnliche Wörter (gleicher Anfangsbuchstabe) als Ablenkung, wenn vorhanden
  let andere = KsApp.schulstufe >= 2 ? WOERTER.filter((w) => w !== ziel && w.wort[0] === ziel.wort[0]) : [];
  andere = KsApp.mischen(andere).slice(0, 2);
  while (andere.length < 2) {
    const w = WOERTER[KsApp.zufall(0, WOERTER.length - 1)];
    if (w !== ziel && !andere.includes(w)) andere.push(w);
  }
  return { ziel, auswahl: KsApp.mischen([ziel, ...andere]) };
}

function rundeStarten(m) {
  modus = m;
  fragen = [];
  const benutzt = new Set();
  while (fragen.length < RUNDE) {
    const f = frageBauen();
    if (benutzt.has(f.ziel.wort)) continue;
    benutzt.add(f.ziel.wort);
    fragen.push(f);
  }
  nummer = 0;
  ergebnisse = [];
  $("auswahl").hidden = true;
  $("ende").hidden = true;
  $("spiel").hidden = false;
  frageZeigen();
}

function frageZeigen() {
  const f = fragen[nummer];
  fehlerInFrage = false;
  $("lob").textContent = "";
  $("lob").className = "lob";
  fortschritt();
  const vorgabe = $("vorgabe");
  if (modus === "anlaut") {
    $("frage").textContent = "Welches Bild fängt so an?";
    vorgabe.textContent = `${f.buchstabe} ${f.buchstabe.toLowerCase()}`;
    vorgabe.className = "vorgabe";
  } else {
    $("frage").textContent = "Welches Bild passt zum Wort?";
    vorgabe.textContent = KsApp.schulstufe === 1 ? f.ziel.wort.toUpperCase() : f.ziel.wort;
    vorgabe.className = "vorgabe wort";
  }
  const bilder = $("bilder");
  bilder.replaceChildren();
  for (const w of f.auswahl) {
    const karte = document.createElement("button");
    karte.type = "button";
    karte.className = "bild-karte";
    const emoji = document.createElement("span");
    emoji.className = "emoji";
    emoji.textContent = w.emoji;
    const wort = document.createElement("span");
    wort.className = "wort";
    karte.append(emoji, wort);
    karte.addEventListener("click", () => antwort(karte, w));
    bilder.append(karte);
  }
}

/** Wort mit hervorgehobenem Anfangsbuchstaben unter das Bild schreiben. */
function wortZeigen(karte, w) {
  const feld = karte.querySelector(".wort");
  const b = document.createElement("b");
  b.textContent = w.wort[0];
  feld.replaceChildren(b, document.createTextNode(w.wort.slice(1)));
}

function antwort(karte, w) {
  const f = fragen[nummer];
  if (karte.disabled) return;
  if (w === f.ziel) {
    karte.classList.add("richtig");
    wortZeigen(karte, w);
    document.querySelectorAll(".bild-karte").forEach((k) => { k.disabled = true; });
    ergebnisse[nummer] = !fehlerInFrage;
    if (!fehlerInFrage) {
      sterne += 1;
      KsApp.speichern("buchstaben-sterne", sterne);
      $("sterne").textContent = `⭐ ${sterne}`;
    }
    $("lob").textContent = KsApp.lobText();
    $("lob").className = "lob gut";
    setTimeout(() => {
      nummer += 1;
      if (nummer < RUNDE) frageZeigen();
      else rundeEnde();
    }, 1600);
  } else {
    fehlerInFrage = true;
    karte.classList.add("falsch");
    karte.disabled = true;
    wortZeigen(karte, w);
    KsApp.animieren(karte, "wackelt");
    $("lob").textContent = "Das ist " + w.wort + ". Versuch ein anderes Bild!";
    $("lob").className = "lob nochmal";
  }
}

function fortschritt() {
  const f = $("fortschritt");
  f.replaceChildren();
  for (let i = 0; i < RUNDE; i++) {
    const p = document.createElement("span");
    if (ergebnisse[i] === true) p.className = "richtig";
    else if (ergebnisse[i] === false) p.className = "falsch";
    else if (i === nummer) p.className = "jetzt";
    f.append(p);
  }
}

function rundeEnde() {
  const richtig = ergebnisse.filter((e) => e).length;
  $("spiel").hidden = true;
  $("ende").hidden = false;
  $("ende-symbol").textContent = richtig >= 8 ? "🏆" : richtig >= 5 ? "🌟" : "💪";
  $("ende-titel").textContent = richtig >= 8 ? "Super gemacht!" : richtig >= 5 ? "Gut gemacht!" : "Weiter üben!";
  $("ende-text").textContent = `Du hast ${richtig} von ${RUNDE} gleich richtig erkannt.`;
  if (richtig >= 5) KsApp.konfetti();
}

function auswahlZeigen() {
  $("auswahl").hidden = false;
  $("spiel").hidden = true;
  $("ende").hidden = true;
}

$("wahl-anlaut").addEventListener("click", () => rundeStarten("anlaut"));
$("wahl-lesen").addEventListener("click", () => rundeStarten("lesen"));
$("nochmal").addEventListener("click", () => rundeStarten(modus));
$("andere").addEventListener("click", auswahlZeigen);
$("sterne").textContent = `⭐ ${sterne}`;

KsApp.start("buchstaben");
