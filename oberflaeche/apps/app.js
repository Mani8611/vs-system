"use strict";
// Kinder-Stick – gemeinsamer Rahmen der eigenen Programme (apps/*.html)
//  * „Fertig“-Knopf führt zurück zur Startseite
//  * prüft regelmäßig beim Dienst: Zeit um / Schlafenszeit / App nicht mehr freigegeben → zurück
//  * liefert die Schulstufe des Kindes (1–4), damit sich die Programme anpassen

const KsApp = {
  schulstufe: 1,

  /** Startet den Rahmen; wartet auf die erste Antwort des Dienstes. */
  async start(appId) {
    document.getElementById("zurueck").addEventListener("click", () => KsApp.zurueck());
    KsApp.zeitAnlegen();
    await KsApp.pruefen(appId);
    setInterval(() => KsApp.pruefen(appId), 15000);
  },

  async pruefen(appId) {
    try {
      const s = await api("/api/status");
      const app = s.apps.find((a) => a.id === appId);
      // Apps mit „auch_gesperrt“ (Hörbücher) bleiben in der Schlafenszeit und nach Zeitende offen
      if (!s.eingerichtet || !app || (s.gesperrt && !app.auch_gesperrt)) {
        KsApp.zurueck();
        return;
      }
      KsApp.schulstufe = Math.min(4, Math.max(1, Number(s.schulstufe) || 1));
      KsApp.gesperrt = s.gesperrt;
      KsApp.grund = s.grund;
      if (app.auch_gesperrt) KsApp.zeitZeigen(0, 0);   // zählt nicht zur Bildschirmzeit
      else KsApp.zeitZeigen(s.rest_minuten, s.limit_minuten);
    } catch (e) { /* Dienst kurz nicht erreichbar – weiterspielen */ }
  },

  /** Restzeit rechts in der Kopfleiste – wie bei Lernspielen, ANTON, Netflix und Disney+. */
  zeitAnlegen() {
    const rechts = document.querySelector(".app-kopf-rechts");
    if (!rechts) return;
    const zeit = document.createElement("span");
    zeit.className = "app-zeit";
    zeit.id = "app-zeit";
    zeit.hidden = true;
    const text = document.createElement("span");
    const balken = document.createElement("span");
    balken.className = "app-zeit-balken";
    balken.append(document.createElement("i"));
    zeit.append(text, balken);
    rechts.append(zeit);
  },

  zeitZeigen(rest, limit) {
    const zeit = document.getElementById("app-zeit");
    if (!zeit) return;
    zeit.hidden = !(limit > 0);
    if (zeit.hidden) return;
    zeit.firstChild.textContent = "⏳ noch " + minutenText(rest);
    zeit.querySelector("i").style.width = Math.min(100, (rest / limit) * 100) + "%";
    zeit.classList.toggle("knapp", rest > 5 && rest <= 10);
    zeit.classList.toggle("fast-aus", rest <= 5);
  },

  /** Bild (JPEG als data:-Adresse) als Hintergrund der Startseite speichern. */
  alsHintergrund(bild) {
    return api("/api/hintergrund-aus-bild", { bild });
  },

  zurueck() {
    location.href = "../index.html";
  },

  /** Zufällige ganze Zahl von a bis b (einschließlich). */
  zufall(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  },

  mischen(liste) {
    const l = liste.slice();
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  },

  /** Kurze Animation an einem Element neu starten. */
  animieren(element, klasse) {
    element.classList.remove(klasse);
    void element.offsetWidth;
    element.classList.add(klasse);
  },

  konfetti() {
    const farben = ["#F26B5B", "#FFB627", "#6BCB77", "#4D96FF", "#9B72CF", "#FF8FB1"];
    for (let i = 0; i < 80; i++) {
      const k = document.createElement("div");
      k.className = "konfetti";
      k.style.left = Math.random() * 100 + "vw";
      k.style.background = farben[i % farben.length];
      k.style.animationDuration = 2 + Math.random() * 2 + "s";
      k.style.animationDelay = Math.random() * 0.8 + "s";
      document.body.append(k);
      setTimeout(() => k.remove(), 5000);
    }
  },

  lobText() {
    const texte = ["Super!", "Toll gemacht!", "Richtig!", "Klasse!", "Spitze!", "Prima!", "Genau!"];
    return texte[Math.floor(Math.random() * texte.length)];
  },

  /** Kleiner Speicher pro Programm (bleibt im Kinderkonto erhalten). */
  laden(schluessel, standard) {
    try {
      const wert = JSON.parse(localStorage.getItem("ks-" + schluessel));
      return wert === null ? standard : wert;
    } catch (e) {
      return standard;
    }
  },
  speichern(schluessel, wert) {
    try { localStorage.setItem("ks-" + schluessel, JSON.stringify(wert)); } catch (e) { /* voll/gesperrt */ }
  },
};
