"use strict";
// Kinder-Stick – Hörbücher: eigene Hörbücher vom Stick und Kinder-Hörspiele aus ausgewählten Reihen.
// Hören zählt nicht zur Bildschirmzeit (Lebenszeichen /api/hoeren-aktiv) und geht auch zur Schlafenszeit.

const $ = (id) => document.getElementById(id);
const audio = $("audio");
const FARBEN = ["#F26B5B", "#4D96FF", "#6BCB77", "#9B72CF", "#F9A03F", "#FF8FB1"];
const TIMER_MINUTEN = [0, 10, 15, 20, 30, 45, 60];

let regal = { buecher: [], reihen: [], schlafenszeit: false };
let aktuell = null;      // {art: "buch"|"reihe", id, titel, bild, eintraege: [{titel, url}], index}
let timerEnde = 0;       // Zeitpunkt (ms), 0 = aus
let timerGesetzt = false;

// ---------- Hilfen ----------
function zeitText(sekunden) {
  const s = Math.max(0, Math.floor(sekunden || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function hinweisZeigen(text) {
  const h = $("hinweis");
  h.textContent = text;
  h.hidden = false;
  clearTimeout(hinweisZeigen.zeit);
  hinweisZeigen.zeit = setTimeout(() => { h.hidden = true; }, 2500);
}

function coverElement(bild, titel, nummer) {
  if (bild) {
    const img = document.createElement("img");
    img.className = "cover";
    img.src = bild;
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(coverElement(null, titel, nummer)), { once: true });
    return img;
  }
  const platz = document.createElement("span");
  platz.className = "cover";
  platz.style.background = FARBEN[nummer % FARBEN.length];
  platz.textContent = "🎧";
  return platz;
}

// Gemerkte Stellen (je Audio-Adresse) und fertig gehörte Folgen
const positionen = KsApp.laden("hoer-pos", {});
const gehoert = new Set(KsApp.laden("hoer-fertig", []));
function positionMerken(url, sekunden) {
  if (sekunden < 5) return;
  delete positionen[url];
  positionen[url] = Math.floor(sekunden);
  const schluessel = Object.keys(positionen);
  for (const alt of schluessel.slice(0, Math.max(0, schluessel.length - 300))) delete positionen[alt];
  KsApp.speichern("hoer-pos", positionen);
}
function alsGehoert(url) {
  delete positionen[url];
  KsApp.speichern("hoer-pos", positionen);
  gehoert.add(url);
  KsApp.speichern("hoer-fertig", [...gehoert].slice(-500));
}

// ---------- Ansichten ----------
function zeigen(ansicht) {
  $("regal").hidden = ansicht !== "regal";
  $("liste").hidden = ansicht !== "liste";
  $("regal-knopf").hidden = ansicht === "regal";
  if (ansicht === "regal") weiterZeigen();
}

async function regalLaden() {
  try {
    regal = await api("/api/hoeren");
  } catch (e) {
    $("laden-fehler").textContent = e.message;
    $("laden-fehler").hidden = false;
    return;
  }
  $("nacht-hinweis").hidden = !regal.schlafenszeit;

  const buecher = $("buecher");
  buecher.replaceChildren();
  regal.buecher.forEach((b, i) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = b.titel;
    knopf.append(coverElement(b.cover, b.titel, i), name);
    knopf.addEventListener("click", () => buchOeffnen(b));
    buecher.append(knopf);
  });
  $("buecher-leer").hidden = regal.buecher.length > 0;

  const reihen = $("reihen");
  reihen.replaceChildren();
  regal.reihen.forEach((r, i) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.titel;
    knopf.append(coverElement(r.bild, r.titel, i + 2), name);
    knopf.addEventListener("click", () => reiheOeffnen(r));
    reihen.append(knopf);
  });
  $("reihen-titel").hidden = regal.reihen.length === 0;
  weiterZeigen();
}

function weiterZeigen() {
  const z = KsApp.laden("hoer-zuletzt", null);
  const passt = z && z.eintrag && (z.art === "reihe" || regal.buecher.some((b) => b.id === z.id));
  $("weiter").hidden = !passt || (aktuell && !audio.paused);
  if (passt) $("weiter-titel").textContent = z.art === "buch" ? `${z.titel} – ${z.eintrag.titel}` : z.eintrag.titel;
}

function listeZeigen(titel, bild, zusatz) {
  $("liste-titel").textContent = titel;
  $("liste-zusatz").textContent = zusatz;
  $("liste-bild").hidden = !bild;
  if (bild) $("liste-bild").src = bild;
  $("folgen").replaceChildren();
  $("liste-meldung").hidden = true;
  zeigen("liste");
}

function folgenZeichnen(quelle) {
  const liste = $("folgen");
  liste.replaceChildren();
  quelle.eintraege.forEach((e, i) => {
    const li = document.createElement("li");
    const knopf = document.createElement("button");
    knopf.type = "button";
    const istJetzt = aktuell && aktuell.eintraege[aktuell.index] && aktuell.eintraege[aktuell.index].url === e.url;
    knopf.classList.toggle("jetzt", !!istJetzt);
    knopf.classList.toggle("gehoert", gehoert.has(e.url));
    const symbol = document.createElement("span");
    symbol.className = "folge-symbol";
    symbol.textContent = istJetzt ? "🔊" : gehoert.has(e.url) ? "✓" : positionen[e.url] ? "◐" : "▶";
    const titel = document.createElement("span");
    titel.className = "folge-titel";
    titel.textContent = e.titel;
    const dauer = document.createElement("span");
    dauer.className = "folge-dauer";
    dauer.textContent = e.dauer ? zeitText(e.dauer) : "";
    knopf.append(symbol, titel, dauer);
    knopf.addEventListener("click", () => abspielen(quelle, i));
    li.append(knopf);
    liste.append(li);
  });
}

let offeneQuelle = null;
function buchOeffnen(b) {
  offeneQuelle = {
    art: "buch", id: b.id, titel: b.titel, bild: b.cover,
    eintraege: b.kapitel.map((k) => ({ titel: k.name, url: k.url })),
  };
  listeZeigen(b.titel, b.cover, b.kapitel.length === 1 ? "1 Teil" : `${b.kapitel.length} Teile`);
  folgenZeichnen(offeneQuelle);
}

async function reiheOeffnen(r) {
  listeZeigen(r.titel, r.bild, "Lade die Folgen …");
  offeneQuelle = null;
  try {
    const daten = await api("/api/hoerreihe?id=" + encodeURIComponent(r.id));
    offeneQuelle = {
      art: "reihe", id: r.id, titel: r.titel, bild: r.bild,
      eintraege: daten.folgen.map((f) => ({ titel: f.titel, url: f.url, dauer: f.dauer })),
    };
    $("liste-zusatz").textContent = `${daten.folgen.length} Folgen – die neuesten oben`;
    folgenZeichnen(offeneQuelle);
  } catch (e) {
    $("liste-zusatz").textContent = "";
    $("liste-meldung").textContent = e.message;
    $("liste-meldung").hidden = false;
  }
}

// ---------- Abspielen ----------
function abspielen(quelle, index) {
  aktuell = { ...quelle, index };
  const eintrag = quelle.eintraege[index];
  audio.src = eintrag.url;
  const stelle = positionen[eintrag.url] || 0;
  audio.addEventListener("loadedmetadata", () => {
    if (stelle && stelle < audio.duration - 5) audio.currentTime = stelle;
  }, { once: true });
  audio.play().catch(() => {});
  KsApp.speichern("hoer-zuletzt", { art: quelle.art, id: quelle.id, titel: quelle.titel, bild: quelle.bild, index, eintrag });

  $("spieler").hidden = false;
  document.body.classList.add("spielt");
  $("spieler-titel").textContent = quelle.art === "buch" && quelle.eintraege.length > 1
    ? `${quelle.titel} – ${eintrag.titel}` : eintrag.titel;
  $("spieler-bild").hidden = !quelle.bild;
  if (quelle.bild) $("spieler-bild").src = quelle.bild;
  $("naechstes").disabled = index >= quelle.eintraege.length - 1;
  // Zur Schlafenszeit startet der Einschlaf-Timer von selbst (30 Minuten)
  if (regal.schlafenszeit && !timerGesetzt) timerSetzen(30);
  if (offeneQuelle && offeneQuelle.id === quelle.id) folgenZeichnen(offeneQuelle);
}

$("weiter").addEventListener("click", () => {
  const z = KsApp.laden("hoer-zuletzt", null);
  if (!z) return;
  if (z.art === "buch") {
    const b = regal.buecher.find((x) => x.id === z.id);
    if (!b) return;
    buchOeffnen(b);
    const index = Math.max(0, offeneQuelle.eintraege.findIndex((e) => e.url === z.eintrag.url));
    abspielen(offeneQuelle, index);
  } else {
    abspielen({ art: "reihe", id: z.id, titel: z.titel, bild: z.bild, eintraege: [z.eintrag] }, 0);
  }
  $("weiter").hidden = true;
});

$("abspielen").addEventListener("click", () => {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
$("zurueck30").addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 30); });
$("vor30").addEventListener("click", () => {
  if (audio.duration) audio.currentTime = Math.min(audio.duration - 1, audio.currentTime + 30);
});
$("naechstes").addEventListener("click", () => {
  if (aktuell && aktuell.index < aktuell.eintraege.length - 1) abspielen(aktuell, aktuell.index + 1);
});

let ziehen = false;
$("position").addEventListener("input", () => { ziehen = true; $("zeit-jetzt").textContent = zeitText($("position").value); });
$("position").addEventListener("change", () => { audio.currentTime = Number($("position").value); ziehen = false; });

let letztesMerken = 0;
audio.addEventListener("timeupdate", () => {
  if (!ziehen) {
    $("position").max = Math.floor(audio.duration || 0);
    $("position").value = Math.floor(audio.currentTime);
    $("zeit-jetzt").textContent = zeitText(audio.currentTime);
  }
  $("zeit-gesamt").textContent = zeitText(audio.duration);
  if (aktuell && Date.now() - letztesMerken > 5000) {
    letztesMerken = Date.now();
    positionMerken(aktuell.eintraege[aktuell.index].url, audio.currentTime);
  }
});
audio.addEventListener("play", () => { $("abspielen").textContent = "⏸"; lebenszeichen(); });
audio.addEventListener("pause", () => {
  $("abspielen").textContent = "▶";
  if (aktuell && !audio.ended) positionMerken(aktuell.eintraege[aktuell.index].url, audio.currentTime);
});
audio.addEventListener("ended", () => {
  if (!aktuell) return;
  alsGehoert(aktuell.eintraege[aktuell.index].url);
  // Hörbuch: nächster Teil von selbst; Hörspiel-Reihe: nach einer Folge ist Schluss
  if (aktuell.art === "buch" && aktuell.index < aktuell.eintraege.length - 1) abspielen(aktuell, aktuell.index + 1);
  else if (offeneQuelle) folgenZeichnen(offeneQuelle);
});
audio.addEventListener("error", () => {
  if (audio.src) hinweisZeigen("Das lässt sich gerade nicht abspielen.");
});

// ---------- Einschlaf-Timer ----------
function timerSetzen(minuten) {
  timerGesetzt = true;
  timerEnde = minuten ? Date.now() + minuten * 60000 : 0;
  audio.volume = 1;
  timerAnzeigen();
}
function timerAnzeigen() {
  const rest = timerEnde ? Math.max(0, Math.ceil((timerEnde - Date.now()) / 60000)) : 0;
  $("timer-knopf").textContent = timerEnde ? `🌙 ${rest}` : "🌙";
}
setInterval(() => {
  if (!timerEnde) return;
  const rest = timerEnde - Date.now();
  if (rest <= 0) {
    audio.pause();
    audio.volume = 1;
    timerEnde = 0;
    hinweisZeigen("Gute Nacht! 🌙");
  } else if (rest < 20000) {
    audio.volume = Math.max(0, rest / 20000);   // die letzten 20 Sekunden langsam leiser
  }
  timerAnzeigen();
}, 1000);

for (const minuten of TIMER_MINUTEN) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.textContent = minuten ? `${minuten} Min.` : "Aus";
  knopf.dataset.minuten = minuten;
  knopf.addEventListener("click", () => {
    timerSetzen(minuten);
    $("timer-dialog").close();
    hinweisZeigen(minuten ? `Timer: ${minuten} Minuten` : "Timer aus");
  });
  $("timer-wahl").append(knopf);
}
$("timer-knopf").addEventListener("click", () => {
  for (const k of $("timer-wahl").children) k.classList.toggle("aktiv", !timerEnde && k.dataset.minuten === "0");
  $("timer-dialog").showModal();
});
$("timer-zu").addEventListener("click", () => $("timer-dialog").close());

// ---------- Lebenszeichen: solange die Hörbücher offen sind, läuft keine Bildschirmzeit ----------
function lebenszeichen() {
  api("/api/hoeren-aktiv", {}).catch(() => {});
}
setInterval(lebenszeichen, 30000);

$("regal-knopf").addEventListener("click", () => zeigen("regal"));
window.addEventListener("pagehide", () => {
  if (aktuell && !audio.paused) positionMerken(aktuell.eintraege[aktuell.index].url, audio.currentTime);
});

KsApp.start("hoerbuecher").then(() => {
  lebenszeichen();
  regalLaden();
});
