"use strict";
// Kinder-Stick – Kamera
//  * Blasen platzen: Seifenblasen steigen auf; wo sich vor der Kamera etwas bewegt (Hände!),
//    platzen sie. Bewegung = Unterschied zwischen zwei kleinen Kamerabildern. Antippen geht auch.
//  * Zauberspiegel: Effekte, Sticker, Foto mit Countdown
//  * Meine Fotos: ansehen, wegwerfen, als Hintergrund der Startseite verwenden
// Das Kamerabild verlässt den Computer nie. Fotos liegen nur im Speicher des Kinderkontos.

const $ = (id) => document.getElementById(id);
const video = $("video");
const leinwand = $("bild");
const ctx = leinwand.getContext("2d");

const MAX_FOTOS = 12;
const RUNDE_SEKUNDEN = 60;
// Bewegungsraster (klein reicht und ist schnell)
const RW = 64;
const RH = 48;
const raster = document.createElement("canvas");
raster.width = RW;
raster.height = RH;
const rctx = raster.getContext("2d", { willReadFrequently: true });

let strom = null;          // MediaStream der Kamera
let modus = null;          // "blasen" | "spiegel"
let schleife = null;

// ---------- Kamera ----------
async function kameraAn() {
  if (strom) return true;
  try {
    strom = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false,
    });
    video.srcObject = strom;
    await video.play();
    return true;
  } catch (e) {
    $("kamera-fehler").textContent = e && e.name === "NotAllowedError"
      ? "Die Kamera darf gerade nicht benutzt werden. Frag Mama oder Papa."
      : "Dieser Computer hat keine Kamera, oder sie ist gerade ausgeschaltet.";
    zeigen("keine-kamera");
    return false;
  }
}

function kameraAus() {   // Kamera wirklich ausschalten (Kontrolllicht geht aus)
  if (strom) strom.getTracks().forEach((t) => t.stop());
  strom = null;
  video.srcObject = null;
}

// ---------- Ansichten ----------
const ANSICHTEN = ["auswahl", "keine-kamera", "buehne", "ende", "fotos"];
function zeigen(id) {
  for (const a of ANSICHTEN) $(a).hidden = a !== id;
  $("menue").hidden = id === "auswahl";
  if (id !== "buehne") {
    cancelAnimationFrame(schleife);
    $("punkte").hidden = true;
    $("uhr").hidden = true;
    $("titel").textContent = "Kamera";
  }
  if (id !== "buehne" && id !== "ende") kameraAus();
}

function groesseAnpassen() {
  const rahmen = $("rahmen");
  const b = rahmen.clientWidth;
  const h = rahmen.clientHeight;
  const faktor = Math.min(b / 4, h / 3);
  leinwand.width = Math.max(320, Math.floor(faktor * 4));
  leinwand.height = Math.max(240, Math.floor(faktor * 3));
}
window.addEventListener("resize", () => { if (!$("buehne").hidden) groesseAnpassen(); });

/** Kamerabild gespiegelt (wie ein Spiegel) zeichnen. */
function videoZeichnen(c, b, h) {
  c.save();
  c.translate(b, 0);
  c.scale(-1, 1);
  c.drawImage(video, 0, 0, b, h);
  c.restore();
}

function hinweis(text) {
  $("hinweis").textContent = text;
  $("hinweis").hidden = false;
  setTimeout(() => { $("hinweis").hidden = true; }, 1800);
}

// ---------- Blasen platzen ----------
const FARBEN = ["#4D96FF", "#FF8FB1", "#6BCB77", "#FFB627", "#9B72CF", "#5ED6E0"];
let blasen = [];
let spritzer = [];
let punkte = 0;
let rundeEnde = 0;
let letzteBlase = 0;
let altesRaster = null;
let bewegung = new Uint8Array(RW * RH);
let bildZaehler = 0;

async function blasenStarten() {
  if (!(await kameraAn())) return;
  modus = "blasen";
  zeigen("buehne");
  $("spiegel-leiste").hidden = true;
  $("titel").textContent = "Blasen platzen";
  $("punkte").hidden = false;
  $("uhr").hidden = false;
  groesseAnpassen();
  blasen = [];
  spritzer = [];
  punkte = 0;
  altesRaster = null;
  bildZaehler = 0;
  rundeEnde = performance.now() + RUNDE_SEKUNDEN * 1000 + 2000;
  startHinweis("Wedle mit den Händen! 👋", 2000);
  punkteZeigen();
  cancelAnimationFrame(schleife);
  schleife = requestAnimationFrame(blasenBild);
}

function startHinweis(text, dauer) {
  $("start-hinweis").textContent = text;
  $("start-hinweis").hidden = false;
  setTimeout(() => { $("start-hinweis").hidden = true; }, dauer);
}

function punkteZeigen() {
  $("punkte").textContent = `🫧 ${punkte}`;
}

function bewegungMessen() {
  rctx.drawImage(video, 0, 0, RW, RH);
  const daten = rctx.getImageData(0, 0, RW, RH).data;
  const grau = new Uint8Array(RW * RH);
  for (let i = 0; i < RW * RH; i++) {
    grau[i] = (daten[i * 4] * 3 + daten[i * 4 + 1] * 6 + daten[i * 4 + 2]) / 10;
  }
  bildZaehler++;
  // Die ersten Bilder überspringen – die Kamera stellt noch Helligkeit ein
  if (altesRaster && bildZaehler > 20) {
    for (let i = 0; i < RW * RH; i++) bewegung[i] = Math.abs(grau[i] - altesRaster[i]) > 28 ? 1 : 0;
  } else {
    bewegung.fill(0);
  }
  altesRaster = grau;
}

/** Wie viele bewegte Rasterpunkte liegen unter der Blase? (Bild ist gespiegelt → x umdrehen) */
function bewegungBei(blase) {
  const sx = RW / leinwand.width;
  const sy = RH / leinwand.height;
  const r = blase.r;
  let treffer = 0;
  for (let y = Math.floor((blase.y - r) * sy); y <= (blase.y + r) * sy; y++) {
    if (y < 0 || y >= RH) continue;
    for (let x = Math.floor((blase.x - r) * sx); x <= (blase.x + r) * sx; x++) {
      if (x < 0 || x >= RW) continue;
      const dx = x / sx - blase.x;
      const dy = y / sy - blase.y;
      if (dx * dx + dy * dy > r * r) continue;
      if (bewegung[y * RW + (RW - 1 - x)]) treffer++;
    }
  }
  return treffer;
}

function blaseNeu() {
  const r = leinwand.width * (0.045 + Math.random() * 0.035);
  blasen.push({
    x: r + Math.random() * (leinwand.width - 2 * r), y: leinwand.height + r, r,
    tempo: leinwand.height * (0.0016 + Math.random() * 0.0016),
    wackeln: Math.random() * Math.PI * 2,
    farbe: FARBEN[Math.floor(Math.random() * FARBEN.length)],
  });
}

function platzen(blase) {
  punkte++;
  punkteZeigen();
  for (let i = 0; i < 10; i++) {
    const w = (i / 10) * Math.PI * 2;
    spritzer.push({ x: blase.x, y: blase.y, vx: Math.cos(w) * 4, vy: Math.sin(w) * 4, leben: 1, farbe: blase.farbe });
  }
}

function blaseZeichnen(b) {
  const verlauf = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
  verlauf.addColorStop(0, "rgba(255,255,255,0.85)");
  verlauf.addColorStop(0.35, b.farbe + "55");
  verlauf.addColorStop(1, b.farbe + "CC");
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fillStyle = verlauf;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
}

function blasenBild(jetzt) {
  const b = leinwand.width;
  const h = leinwand.height;
  videoZeichnen(ctx, b, h);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, b, h);
  bewegungMessen();

  const rest = Math.max(0, Math.ceil((rundeEnde - jetzt) / 1000));
  $("uhr").textContent = `⏱️ ${Math.min(rest, RUNDE_SEKUNDEN)}`;
  const laeuft = jetzt < rundeEnde;
  // Nach dem Start-Hinweis: alle 0,7 Sekunden eine neue Blase (höchstens 9 gleichzeitig)
  if (laeuft && jetzt > rundeEnde - RUNDE_SEKUNDEN * 1000 && jetzt - letzteBlase > 700 && blasen.length < 9) {
    blaseNeu();
    letzteBlase = jetzt;
  }

  blasen = blasen.filter((blase) => {
    blase.y -= blase.tempo * 16;
    blase.wackeln += 0.05;
    blase.x += Math.sin(blase.wackeln) * 0.8;
    if (blase.y + blase.r < 0) return false;
    if (blase.y < h - blase.r * 0.5 && bewegungBei(blase) >= 3) {
      platzen(blase);
      return false;
    }
    blaseZeichnen(blase);
    return true;
  });

  spritzer = spritzer.filter((s) => {
    s.x += s.vx;
    s.y += s.vy;
    s.leben -= 0.04;
    if (s.leben <= 0) return false;
    ctx.globalAlpha = s.leben;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = s.farbe;
    ctx.fill();
    ctx.globalAlpha = 1;
    return true;
  });

  if (!laeuft && blasen.length === 0) {
    rundeFertig();
    return;
  }
  if (!laeuft) blasen.forEach((blase) => { blase.tempo *= 1.04; });
  schleife = requestAnimationFrame(blasenBild);
}

function rundeFertig() {
  const rekord = KsApp.laden("kamera-rekord", 0);
  const neuerRekord = punkte > rekord;
  if (neuerRekord) KsApp.speichern("kamera-rekord", punkte);
  $("ende-titel").textContent = `${punkte} Blasen geplatzt!`;
  $("ende-text").textContent = neuerRekord && rekord > 0
    ? "Neuer Rekord! 🏆"
    : `Dein Rekord: ${Math.max(rekord, punkte)} Blasen`;
  zeigen("ende");
  KsApp.konfetti();
}

// Blasen auch mit Antippen platzen lassen
leinwand.addEventListener("pointerdown", (ereignis) => {
  const rand = leinwand.getBoundingClientRect();
  const x = (ereignis.clientX - rand.left) * (leinwand.width / rand.width);
  const y = (ereignis.clientY - rand.top) * (leinwand.height / rand.height);
  if (modus === "blasen") {
    const treffer = blasen.find((blase) => (blase.x - x) ** 2 + (blase.y - y) ** 2 <= blase.r ** 2);
    if (treffer) {
      blasen = blasen.filter((blase) => blase !== treffer);
      platzen(treffer);
    }
  } else if (modus === "spiegel") {
    stickerSetzen(x / leinwand.width, y / leinwand.height);
  }
});

// ---------- Zauberspiegel ----------
const EFFEKTE = [
  { id: "normal", symbol: "🙂", filter: "none" },
  { id: "bunt", symbol: "🎨", filter: "saturate(2.4) contrast(1.3)" },
  { id: "regenbogen", symbol: "🌈", filter: "regenbogen" },
  { id: "wackel", symbol: "〰️", filter: "none" },
  { id: "doppel", symbol: "🪞", filter: "none" },
  { id: "opa", symbol: "👴", filter: "sepia(1) contrast(1.1)" },
];
const STICKER = ["👑", "🎩", "🕶️", "🐶", "🐱", "🦄", "⭐", "❤️", "🌈", "🎈", "🦋", "🍦"];
let effekt = EFFEKTE[0];
let stickerWahl = STICKER[0];
let gesetzt = [];   // {s, x, y} – x/y als Anteil der Bildgröße

function spiegelLeisteBauen() {
  const effekte = $("effekte");
  for (const e of EFFEKTE) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = e.symbol;
    knopf.addEventListener("click", () => {
      effekt = e;
      effekte.querySelectorAll("button").forEach((k) => k.classList.toggle("aktiv", k === knopf));
    });
    if (e === effekt) knopf.classList.add("aktiv");
    effekte.append(knopf);
  }
  const sticker = $("sticker");
  for (const s of STICKER) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = s;
    knopf.addEventListener("click", () => {
      stickerWahl = s;
      sticker.querySelectorAll("button").forEach((k) => k.classList.toggle("aktiv", k === knopf));
    });
    if (s === stickerWahl) knopf.classList.add("aktiv");
    sticker.append(knopf);
  }
}

function stickerSetzen(x, y) {
  gesetzt.push({ s: stickerWahl, x, y });
  if (gesetzt.length > 15) gesetzt.shift();
}

async function spiegelStarten() {
  if (!(await kameraAn())) return;
  modus = "spiegel";
  zeigen("buehne");
  $("spiegel-leiste").hidden = false;
  $("titel").textContent = "Zauberspiegel";
  groesseAnpassen();
  startHinweis("Tippe aufs Bild für Sticker!", 2500);
  cancelAnimationFrame(schleife);
  schleife = requestAnimationFrame(spiegelBild);
}

function spiegelBild(jetzt) {
  const b = leinwand.width;
  const h = leinwand.height;
  ctx.filter = effekt.filter === "regenbogen"
    ? `hue-rotate(${Math.round(jetzt / 10) % 360}deg) saturate(1.8)`
    : effekt.filter;
  if (effekt.id === "wackel") {
    // Bild in Streifen zeichnen, jeder Streifen etwas verschoben
    ctx.fillStyle = "#1F2933";
    ctx.fillRect(0, 0, b, h);
    const streifen = 6;
    const vh = video.videoHeight || 480;
    const vb = video.videoWidth || 640;
    ctx.save();
    ctx.translate(b, 0);
    ctx.scale(-1, 1);
    for (let y = 0; y < h; y += streifen) {
      const versatz = Math.sin(y / 28 + jetzt / 250) * b * 0.03;
      ctx.drawImage(video, 0, (y / h) * vh, vb, (streifen / h) * vh, versatz, y, b, streifen);
    }
    ctx.restore();
  } else {
    videoZeichnen(ctx, b, h);
    if (effekt.id === "doppel") {
      // Linke Hälfte gespiegelt nach rechts – lustige „Doppel-Gesichter“
      ctx.save();
      ctx.translate(b, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(leinwand, 0, 0, b / 2, h, 0, 0, b / 2, h);
      ctx.restore();
    }
  }
  ctx.filter = "none";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(b * 0.12)}px sans-serif`;
  for (const s of gesetzt) ctx.fillText(s.s, s.x * b, s.y * h);
  schleife = requestAnimationFrame(spiegelBild);
}

$("sticker-weg").addEventListener("click", () => { gesetzt = []; });

let fotoLaeuft = false;
$("foto").addEventListener("click", () => {
  if (fotoLaeuft) return;
  fotoLaeuft = true;
  let zahl = 3;
  $("countdown").textContent = zahl;
  $("countdown").hidden = false;
  const takt = setInterval(() => {
    zahl--;
    if (zahl > 0) {
      $("countdown").textContent = zahl;
      return;
    }
    clearInterval(takt);
    $("countdown").hidden = true;
    fotoMachen();
    fotoLaeuft = false;
  }, 800);
});

function fotoMachen() {
  // Foto in fester Größe (640 × 480) speichern – klein genug für den Speicher
  const foto = document.createElement("canvas");
  foto.width = 640;
  foto.height = 480;
  foto.getContext("2d").drawImage(leinwand, 0, 0, 640, 480);
  const fotos = KsApp.laden("kamera-fotos", []);
  fotos.unshift(foto.toDataURL("image/jpeg", 0.8));
  KsApp.speichern("kamera-fotos", fotos.slice(0, MAX_FOTOS));
  $("blitz").hidden = false;
  setTimeout(() => { $("blitz").hidden = true; }, 400);
  hinweis("📸 Foto gemacht!");
}

// ---------- Meine Fotos ----------
let offenesFoto = null;

function fotosZeigen() {
  zeigen("fotos");
  const fotos = KsApp.laden("kamera-fotos", []);
  $("fotos-leer").hidden = fotos.length > 0;
  const liste = $("foto-liste");
  liste.replaceChildren();
  fotos.forEach((daten, nummer) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    const img = document.createElement("img");
    img.src = daten;
    img.alt = `Foto ${nummer + 1}`;
    knopf.append(img);
    knopf.addEventListener("click", () => {
      offenesFoto = nummer;
      $("foto-gross").src = daten;
      $("foto-dialog").showModal();
    });
    liste.append(knopf);
  });
}

$("foto-hintergrund").addEventListener("click", async () => {
  const fotos = KsApp.laden("kamera-fotos", []);
  if (offenesFoto === null || !fotos[offenesFoto]) return;
  try {
    await KsApp.alsHintergrund(fotos[offenesFoto]);
    $("foto-dialog").close();
    hinweis("🏞️ Ist jetzt dein Hintergrund!");
  } catch (e) {
    hinweis("Das hat nicht geklappt.");
  }
});
$("foto-loeschen").addEventListener("click", () => {
  const fotos = KsApp.laden("kamera-fotos", []);
  fotos.splice(offenesFoto, 1);
  KsApp.speichern("kamera-fotos", fotos);
  $("foto-dialog").close();
  fotosZeigen();
});
$("foto-zu").addEventListener("click", () => $("foto-dialog").close());

// ---------- Steuerung ----------
document.querySelectorAll("[data-modus]").forEach((karte) => {
  karte.addEventListener("click", () => {
    if (karte.dataset.modus === "blasen") blasenStarten();
    else if (karte.dataset.modus === "spiegel") spiegelStarten();
    else fotosZeigen();
  });
});
$("menue").addEventListener("click", () => { modus = null; zeigen("auswahl"); });
$("keine-zurueck").addEventListener("click", () => zeigen("auswahl"));
$("ende-menue").addEventListener("click", () => zeigen("auswahl"));
$("nochmal").addEventListener("click", blasenStarten);
window.addEventListener("pagehide", kameraAus);

spiegelLeisteBauen();
KsApp.start("kamera");
