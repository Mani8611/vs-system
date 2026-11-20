"use strict";
// Kinder-Stick – Vorschau-Modus
//
// Wird die Oberfläche direkt als Datei geöffnet (file://, z. B. Doppelklick auf index.html),
// ersetzt dieser Teil den lokalen Dienst durch eine Simulation im Browser.
// Auf dem Stick (http://127.0.0.1:8411) ist er ohne jede Wirkung.
//
// Adresszusätze für schnelle Ansichten:
//   index.html?vorschau=neu      – von vorne (Einrichtungsassistent)
//   index.html?vorschau=fertig   – eingerichtet mit Beispielkind „Lena“, PIN 1234
//   index.html?vorschau=schlafen – Sperrbildschirm „Schlafenszeit“
//   index.html?vorschau=zeitum   – Sperrbildschirm „Für heute ist Schluss“
//   eltern.html?vorschau=eltern  – Eltern-Bereich ohne PIN-Eingabe
//   index.html?vorschau=fertig&app=gcompris – Platzhalter einer Kachel direkt öffnen
(function () {
  if (location.protocol !== "file:") return;

  const SCHLUESSEL = "kinderstick-vorschau";
  // Gleiche Liste wie image/dateien/usr/share/kinderstick/apps.json (ohne Startbefehle)
  const APPS = [
    { id: "gcompris", name: "Lernspiele", symbol: "🧩", beschreibung: "GCompris: rund 195 Lernaktivitäten für 2- bis 10-Jährige – Maus und Tastatur, Buchstaben, Zählen und Rechnen, Uhr und Geld, Memory, Puzzles, Labyrinthe, Tiere, Musik." },
    { id: "tuxpaint", name: "Malen", symbol: "🎨", beschreibung: "Tux Paint: Malprogramm für Kinder – Pinsel, Stempel, Formen, Text und Zaubereffekte, mit lustigen Geräuschen. Bilder bleiben gespeichert." },
    { id: "anton", name: "ANTON lernen", symbol: "📚", beschreibung: "ANTON: Lern-App nach Lehrplan – Deutsch, Mathematik, Sachunterricht, Musik. Braucht Internet und ein (kostenloses) Konto." },
    { id: "klettres", name: "Buchstaben", symbol: "🔤", beschreibung: "KLettres: Buchstaben und Silben hören und eintippen, für Leseanfänger. Deutsche Sprachausgabe vorhanden (spricht teils Buchstabennamen statt Laute – vor Einsatz prüfen)." },
    { id: "tuxmath", name: "Rechnen", symbol: "➕", beschreibung: "Tux Math: Rechenaufgaben als Spiel – Kometen mit Aufgaben abwehren, bevor sie landen. Schwierigkeit einstellbar." },
    { id: "tuxtype", name: "Tippen lernen", symbol: "⌨️", beschreibung: "Tux Typing: Tastatur spielerisch kennenlernen – herabfallende Fische mit dem richtigen Buchstaben fangen." },
    { id: "ktuberling", name: "Kartoffelmann", symbol: "🥔", beschreibung: "KTuberling: Kartoffelmännchen anziehen und Szenen gestalten – Teile werden beim Ablegen vorgelesen. Für die Kleinsten." },
    { id: "blinken", name: "Merkspiel", symbol: "🧠", beschreibung: "Blinken: Farben und Töne in der richtigen Reihenfolge nachspielen – trainiert das Gedächtnis." },
  ];
  const STANDARD = {
    eingerichtet: false, kind_name: "", schulstufe: 1, pin: "",
    limit_schultag: 60, limit_wochenende: 90, schlafen_von: "19:30", schlafen_bis: "07:00",
    erlaubte_apps: null, minuten: 0, bonus: 0, schlafen_simuliert: false,
    verlauf: [35, 50, 20, 60, 45, 80],
  };
  const BEISPIEL = { eingerichtet: true, kind_name: "Lena", pin: "1234" };

  function laden() {
    try {
      const d = JSON.parse(localStorage.getItem(SCHLUESSEL));
      if (d) return Object.assign({}, STANDARD, d);
    } catch (e) { /* kein Speicher */ }
    return Object.assign({}, STANDARD);
  }
  function speichern() {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(z)); } catch (e) { /* kein Speicher */ }
  }

  let z = laden();
  const ansicht = new URLSearchParams(location.search).get("vorschau");
  if (ansicht === "neu") z = Object.assign({}, STANDARD);
  if (ansicht === "fertig") z = Object.assign({}, STANDARD, BEISPIEL);
  if (ansicht === "schlafen") z = Object.assign({}, STANDARD, BEISPIEL, { schlafen_simuliert: true });
  if (ansicht === "zeitum") z = Object.assign({}, STANDARD, BEISPIEL, { minuten: 999 });
  if (ansicht === "eltern") {
    if (!z.eingerichtet) z = Object.assign({}, STANDARD, BEISPIEL, { minuten: 25 });
    try { sessionStorage.setItem("elternToken", "vorschau"); } catch (e) { /* egal */ }
  }
  speichern();

  const wochenende = () => [0, 6].includes(new Date().getDay());
  const limit = () => (wochenende() ? z.limit_wochenende : z.limit_schultag);
  const kurz = (a) => ({ id: a.id, name: a.name, symbol: a.symbol });   // wie der echte Dienst
  const erlaubt = () => (z.erlaubte_apps ? APPS.filter((a) => z.erlaubte_apps.includes(a.id)) : APPS).map(kurz);

  // In der Vorschau zählt nur die simulierte Schlafenszeit – nicht die echte Uhrzeit.
  function zustand() {
    const gesamt = limit() + z.bonus;
    const rest = Math.max(0, gesamt - z.minuten);
    if (!z.eingerichtet) return { gesperrt: false, grund: null, rest, gesamt };
    if (z.schlafen_simuliert) return { gesperrt: true, grund: "schlafenszeit", rest, gesamt };
    if (rest <= 0) return { gesperrt: true, grund: "zeit_um", rest: 0, gesamt };
    return { gesperrt: false, grund: null, rest, gesamt };
  }

  let letzteZaehlung = Date.now();
  function zeitZaehlen() {
    const jetzt = Date.now();
    if (z.eingerichtet && !zustand().gesperrt && document.body && document.body.classList.contains("kind")) {
      z.minuten += (jetzt - letzteZaehlung) / 60000;
      speichern();
    }
    letzteZaehlung = jetzt;
  }

  function fehler(status, text) {
    const e = new Error(text);
    e.status = status;
    throw e;
  }

  function appFensterZeigen(app) {
    const fenster = document.createElement("div");
    fenster.className = "vorschau-app";
    const kopf = document.createElement("div");
    kopf.className = "vorschau-app-kopf";
    const fertig = document.createElement("button");
    fertig.type = "button";
    fertig.className = "knopf";
    fertig.textContent = "✔  Fertig – zurück";
    fertig.addEventListener("click", () => fenster.remove());
    kopf.append(fertig);
    const inhalt = document.createElement("div");
    inhalt.className = "vorschau-app-inhalt";
    const symbol = document.createElement("div");
    symbol.className = "vorschau-app-symbol";
    symbol.textContent = app.symbol;
    const titel = document.createElement("h2");
    titel.textContent = app.name;
    const beschreibung = document.createElement("p");
    beschreibung.className = "vorschau-app-beschreibung";
    beschreibung.textContent = (APPS.find((a) => a.id === app.id) || {}).beschreibung || "";
    const text = document.createElement("p");
    text.textContent = "Auf dem Stick startet hier das echte Programm. In der Vorschau ist es nicht verfügbar.";
    inhalt.append(symbol, titel, beschreibung, text);
    fenster.append(kopf, inhalt);
    document.body.append(fenster);
  }

  // Ersatz für den lokalen Dienst (gleiche Antworten wie dienst/kinderstick_dienst.py)
  window.KS_VORSCHAU_API = async function (pfad, d) {
    await new Promise((r) => setTimeout(r, 100));
    zeitZaehlen();
    const s = zustand();
    switch (pfad) {
      case "/api/status":
        return {
          eingerichtet: z.eingerichtet, kind_name: z.kind_name, gesperrt: s.gesperrt, grund: s.grund,
          rest_minuten: Math.floor(s.rest), limit_minuten: s.gesamt, schlafen_bis: z.schlafen_bis, apps: erlaubt(),
        };
      case "/api/einrichtung":
        if (z.eingerichtet) fehler(409, "Der Stick ist bereits eingerichtet.");
        if (!/^\d{4,8}$/.test(d.pin || "")) fehler(400, "Die Eltern-PIN muss aus 4 bis 8 Ziffern bestehen.");
        Object.assign(z, {
          eingerichtet: true, kind_name: d.kind_name, schulstufe: d.schulstufe, pin: d.pin,
          limit_schultag: d.limit_schultag, limit_wochenende: d.limit_wochenende,
          schlafen_von: d.schlafen_von, schlafen_bis: d.schlafen_bis, minuten: 0, bonus: 0,
        });
        speichern();
        return { ok: true };
      case "/api/starten": {
        if (s.gesperrt) fehler(423, "Für heute ist Schluss.");
        const app = erlaubt().find((a) => a.id === d.app);
        if (!app) fehler(404, "Dieses Programm ist nicht freigegeben.");
        appFensterZeigen(app);
        return { ok: true };
      }
      case "/api/eltern/anmelden":
        if (d.pin !== z.pin) fehler(403, "Die PIN stimmt nicht.");
        return { token: "vorschau" };
      case "/api/eltern/uebersicht": {
        const tage = [];
        for (let i = 6; i >= 0; i--) {
          const t = new Date(Date.now() - i * 864e5);
          const tag = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
          tage.push({ tag, minuten: i === 0 ? Math.floor(z.minuten) : (z.verlauf[6 - i] || 0), bonus: 0 });
        }
        const frei = new Set(erlaubt().map((a) => a.id));
        return {
          kind_name: z.kind_name, schulstufe: z.schulstufe,
          limit_schultag: z.limit_schultag, limit_wochenende: z.limit_wochenende,
          schlafen_von: z.schlafen_von, schlafen_bis: z.schlafen_bis,
          heute: { gesperrt: s.gesperrt, grund: s.grund, rest_minuten: Math.floor(s.rest), limit_minuten: s.gesamt },
          tage, apps: APPS.map((a) => Object.assign({ erlaubt: frei.has(a.id) }, kurz(a))),
        };
      }
      case "/api/eltern/bonus":
        z.bonus = Math.max(-limit(), z.bonus + Number(d.minuten || 0));
        speichern();
        return { ok: true, bonus: z.bonus };
      case "/api/eltern/einstellungen":
        for (const feld of ["limit_schultag", "limit_wochenende", "schlafen_von", "schlafen_bis", "erlaubte_apps"]) {
          if (feld in d) z[feld] = d[feld];
        }
        if (d.pin_neu) {
          if (!/^\d{4,8}$/.test(d.pin_neu)) fehler(400, "Die neue PIN muss aus 4 bis 8 Ziffern bestehen.");
          z.pin = d.pin_neu;
        }
        speichern();
        return { ok: true };
      case "/api/eltern/beenden":
        return { ok: true };
      case "/api/eltern/wlan-liste":
        await new Promise((r) => setTimeout(r, 800));
        return { netze: [
          { ssid: "Mein-WLAN", signal: 82, gesichert: true, aktiv: false },
          { ssid: "Nachbar-5G", signal: 41, gesichert: true, aktiv: false },
          { ssid: "Gast", signal: 30, gesichert: false, aktiv: false },
        ] };
      case "/api/eltern/wlan-verbinden":
        await new Promise((r) => setTimeout(r, 800));
        return { ok: true };
      default:
        fehler(404, "Nicht gefunden.");
    }
  };

  // Vorschau-Leiste (nur auf der Kinder-Startseite)
  function leisteBauen() {
    if (!document.body.classList.contains("kind")) return;
    const leiste = document.createElement("div");
    leiste.className = "vorschau-leiste";
    const titel = document.createElement("strong");
    titel.textContent = "Vorschau";
    leiste.append(titel);
    const knopf = (text, aktion) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.addEventListener("click", () => { aktion(); speichern(); if (window.aktualisieren) window.aktualisieren(); });
      leiste.append(b);
    };
    knopf("⏩ +10 min", () => { z.minuten += 10; });
    knopf("🌙 Schlafenszeit an/aus", () => { z.schlafen_simuliert = !z.schlafen_simuliert; });
    knopf("↺ Zeit zurücksetzen", () => { z.minuten = 0; z.bonus = 0; z.schlafen_simuliert = false; });
    knopf("⟲ Ganz neu beginnen", () => { z = Object.assign({}, STANDARD); speichern(); location.href = "index.html"; });
    const pin = document.createElement("span");
    pin.textContent = z.pin ? `Eltern-PIN: ${z.pin}` : "";
    leiste.append(pin);
    document.body.append(leiste);
  }
  document.addEventListener("DOMContentLoaded", leisteBauen);

  // index.html?vorschau=fertig&app=gcompris – öffnet direkt den Platzhalter einer Kachel
  const direktApp = new URLSearchParams(location.search).get("app");
  if (direktApp && APPS.some((a) => a.id === direktApp)) {
    document.addEventListener("DOMContentLoaded", () => appFensterZeigen({ id: direktApp, name: APPS.find((a) => a.id === direktApp).name, symbol: APPS.find((a) => a.id === direktApp).symbol }));
  }
})();
