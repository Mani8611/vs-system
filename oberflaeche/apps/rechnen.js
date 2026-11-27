"use strict";
// Kinder-Stick – Rechnen: 10 Aufgaben pro Runde, passend zur Schulstufe.
//  1. Klasse: Plus/Minus im Zahlenraum 10, nach einer sehr guten Runde bis 20 (mit Bildhilfe bis 10)
//  2. Klasse: Plus/Minus bis 100, Malreihen 2, 5, 10 (später alle)
//  3. Klasse: Plus/Minus bis 1000, kleines Einmaleins, Teilen
//  4. Klasse: wie 3. Klasse, dazu Zehnerzahlen mal einstellig (z. B. 30 · 4)

const $ = (id) => document.getElementById(id);
const RUNDE = 10;

const ARTEN = {
  plus: { name: "Plus", symbol: "+", farbe: "farbe-1", ab: 1 },
  minus: { name: "Minus", symbol: "−", farbe: "farbe-2", ab: 1 },
  gemischt: { name: "Gemischt", symbol: "±", farbe: "farbe-3", ab: 1 },
  mal: { name: "Mal", symbol: "·", farbe: "farbe-4", ab: 2 },
  geteilt: { name: "Geteilt", symbol: ":", farbe: "farbe-5", ab: 3 },
};

let art = "plus";
let aufgaben = [];
let nummer = 0;
let eingabe = "";
let versuche = 0;
let ergebnisse = [];
let sterne = KsApp.laden("rechnen-sterne", 0);

// Stand pro Rechenart: Stufe innerhalb der Klasse (1 = leichter Einstieg, 2 = schwerer)
const stand = KsApp.laden("rechnen-stand", {});
const stufeVon = (a) => stand[`${KsApp.schulstufe}-${a}`] || 1;

function zahlenraum(a) {
  const k = KsApp.schulstufe;
  const s = stufeVon(a);
  if (k === 1) return s === 1 ? 10 : 20;
  if (k === 2) return s === 1 ? 50 : 100;
  return s === 1 ? 500 : 1000;
}

function neueAufgabe(a) {
  const z = KsApp.zufall;
  const k = KsApp.schulstufe;
  const max = zahlenraum(a);
  if (a === "gemischt") a = Math.random() < 0.5 ? "plus" : "minus";
  if (a === "plus") {
    // ab 3. Klasse meist glatte Zehner, damit es im Kopf lösbar bleibt
    const runden = k >= 3 && Math.random() < 0.7 ? 10 : 1;
    const x = z(1, Math.floor((max - 1) / runden)) * runden;
    const y = z(runden === 10 ? 1 : 0, Math.floor((max - x) / runden)) * runden;
    return { text: `${x} + ${y}`, loesung: x + y, x, y, op: "+" };
  }
  if (a === "minus") {
    const runden = k >= 3 && Math.random() < 0.7 ? 10 : 1;
    const x = z(1, Math.floor(max / runden)) * runden;
    const y = z(0, Math.floor(x / runden)) * runden;
    return { text: `${x} − ${y}`, loesung: x - y, x, y, op: "−" };
  }
  if (a === "mal") {
    let reihe;
    if (k === 2 && stufeVon("mal") === 1) reihe = [2, 5, 10][z(0, 2)];
    else reihe = z(2, 10);
    let faktor = z(1, 10);
    if (k === 4 && Math.random() < 0.3) faktor *= 10;
    return { text: `${faktor} · ${reihe}`, loesung: faktor * reihe };
  }
  // geteilt (Umkehrung des Einmaleins)
  const teiler = z(2, 10);
  const ergebnis = z(1, 10);
  return { text: `${teiler * ergebnis} : ${teiler}`, loesung: ergebnis };
}

// ---------- Auswahl ----------
function auswahlZeigen() {
  $("auswahl").hidden = false;
  $("spiel").hidden = true;
  $("ende").hidden = true;
  const karten = $("wahl-karten");
  karten.replaceChildren();
  for (const [schluessel, a] of Object.entries(ARTEN)) {
    if (KsApp.schulstufe < a.ab) continue;
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "wahl-karte " + a.farbe;
    const gross = document.createElement("span");
    gross.className = "gross";
    gross.textContent = a.symbol;
    const name = document.createElement("span");
    name.textContent = a.name;
    const klein = document.createElement("span");
    klein.className = "klein";
    klein.textContent = schluessel === "mal" || schluessel === "geteilt" ? "Einmaleins" : `bis ${zahlenraum(schluessel)}`;
    knopf.append(gross, name, klein);
    knopf.addEventListener("click", () => rundeStarten(schluessel));
    karten.append(knopf);
  }
}

// ---------- Runde ----------
function rundeStarten(a) {
  art = a;
  aufgaben = [];
  const gesehen = new Set();
  while (aufgaben.length < RUNDE) {
    const neu = neueAufgabe(a);
    if (gesehen.has(neu.text) && gesehen.size < 40) continue;
    gesehen.add(neu.text);
    aufgaben.push(neu);
  }
  nummer = 0;
  ergebnisse = [];
  $("auswahl").hidden = true;
  $("ende").hidden = true;
  $("spiel").hidden = false;
  aufgabeZeigen();
}

function aufgabeZeigen() {
  eingabe = "";
  versuche = 0;
  $("lob").textContent = "";
  $("lob").className = "lob";
  fortschrittZeichnen();
  aufgabeZeichnen();
  hilfeZeichnen(aufgaben[nummer]);
}

function aufgabeZeichnen() {
  const a = aufgaben[nummer];
  const feld = $("aufgabe");
  feld.replaceChildren(document.createTextNode(`${a.text} = `));
  const antwort = document.createElement("span");
  antwort.className = "antwort" + (eingabe ? "" : " leer");
  antwort.textContent = eingabe || "?";
  feld.append(antwort);
}

function fortschrittZeichnen() {
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

/** Bildhilfe: Punkte zum Abzählen, nur in der 1. Klasse bis 10. */
function hilfeZeichnen(a) {
  const h = $("hilfe");
  h.replaceChildren();
  if (KsApp.schulstufe !== 1 || !a.op || a.x > 10 || a.y > 10) return;
  const gruppe = (anzahl, zeichen) => {
    const g = document.createElement("div");
    g.className = "gruppe";
    for (let i = 0; i < anzahl; i++) {
      const s = document.createElement("span");
      s.textContent = zeichen;
      g.append(s);
    }
    return g;
  };
  const op = document.createElement("span");
  op.className = "zeichen";
  op.textContent = a.op;
  if (a.op === "+") h.append(gruppe(a.x, "🍎"), op, gruppe(a.y, "🍐"));
  else h.append(gruppe(a.x - a.y, "🍎"), gruppe(a.y, "✖️"));
}

function taste(t) {
  if ($("spiel").hidden) return;
  if (t === "⌫") eingabe = eingabe.slice(0, -1);
  else if (t === "✔") return pruefen();
  else if (eingabe.length < 4) eingabe = (eingabe + t).replace(/^0+(?=\d)/, "");
  aufgabeZeichnen();
}

function pruefen() {
  if (!eingabe) return;
  const a = aufgaben[nummer];
  const lob = $("lob");
  if (Number(eingabe) === a.loesung) {
    if (versuche === 0) {
      sterne += 1;
      KsApp.speichern("rechnen-sterne", sterne);
      $("sterne").textContent = `⭐ ${sterne}`;
    }
    ergebnisse[nummer] = versuche === 0;
    lob.textContent = KsApp.lobText();
    lob.className = "lob gut";
    KsApp.animieren($("eule"), "huepft");
    setTimeout(weiter, 1100);
  } else {
    versuche += 1;
    KsApp.animieren($("aufgabe"), "wackelt");
    if (versuche === 1) {
      lob.textContent = "Fast! Versuch es noch einmal.";
      lob.className = "lob nochmal";
      eingabe = "";
      aufgabeZeichnen();
    } else {
      ergebnisse[nummer] = false;
      lob.textContent = `Das Ergebnis ist ${a.loesung}.`;
      lob.className = "lob nochmal";
      eingabe = String(a.loesung);
      aufgabeZeichnen();
      setTimeout(weiter, 2200);
    }
  }
}

function weiter() {
  nummer += 1;
  if (nummer < RUNDE) return aufgabeZeigen();
  rundeEnde();
}

function rundeEnde() {
  const richtig = ergebnisse.filter((e) => e === true).length;
  $("spiel").hidden = true;
  $("ende").hidden = false;
  let text = `Du hast ${richtig} von ${RUNDE} Aufgaben gleich richtig gelöst.`;
  // Sehr gute Runde → nächste Stufe innerhalb der Klasse
  const schluessel = `${KsApp.schulstufe}-${art}`;
  if (richtig >= 9 && stufeVon(art) === 1 && art !== "geteilt") {
    stand[schluessel] = 2;
    KsApp.speichern("rechnen-stand", stand);
    text += art === "mal" ? " Jetzt kommen alle Malreihen!" : ` Ab jetzt rechnest du bis ${zahlenraum(art)}!`;
  }
  $("ende-symbol").textContent = richtig >= 8 ? "🏆" : richtig >= 5 ? "🌟" : "💪";
  $("ende-titel").textContent = richtig >= 8 ? "Super gemacht!" : richtig >= 5 ? "Gut gemacht!" : "Weiter üben!";
  $("ende-text").textContent = text;
  if (richtig >= 5) KsApp.konfetti();
}

// ---------- Tasten ----------
for (const t of ["1", "2", "3", "4", "5", "⌫", "6", "7", "8", "9", "0", "✔"]) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = t;
  if (t === "⌫") knopf.className = "loeschen";
  if (t === "✔") knopf.className = "ok";
  knopf.addEventListener("click", () => taste(t));
  $("tasten").append(knopf);
}
document.addEventListener("keydown", (e) => {
  if (/^\d$/.test(e.key)) taste(e.key);
  else if (e.key === "Backspace") taste("⌫");
  else if (e.key === "Enter") taste("✔");
});

$("nochmal").addEventListener("click", () => rundeStarten(art));
$("andere").addEventListener("click", auswahlZeigen);
$("sterne").textContent = `⭐ ${sterne}`;

KsApp.start("rechnen").then(auswahlZeigen);
