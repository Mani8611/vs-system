#!/usr/bin/python3
"""Kinder-Stick – lokaler Dienst.

Aufgaben:
  * liefert die Kinder-Oberfläche (Web-App) aus
  * zählt die Nutzungszeit des Kinderkontos und setzt Tageslimit und Schlafenszeit durch
  * startet freigegebene Apps im Kinderkonto und beendet sie, wenn die Zeit um ist
  * Einrichtungsassistent (Name, Schulstufe, Eltern-PIN, Elternpasswort, Zeiten)
  * Eltern-Bereich mit PIN: Bonuszeit, Zeiten, App-Freigaben, WLAN, Bluetooth-Kopfhörer,
    eigene Hintergrundbilder, Kinder-Modus beenden
  * Lautstärke (für die Startseite), Hintergrund, Ausschalten

Sicherheit:
  * lauscht nur auf 127.0.0.1, prüft Host- und Origin-Header (Schutz vor DNS-Rebinding/CSRF)
  * PIN als scrypt-Hash, nach 5 Fehlversuchen 5 Minuten Sperre
  * Eltern-Aktionen nur mit kurzlebigem Token (10 Minuten) nach PIN-Eingabe

Entwicklung ohne Stick (Testmodus, keine Systembefehle):
  KS_TESTMODUS=1 KS_DATEN=./testdaten KS_OBERFLAECHE=./oberflaeche \
  KS_APPS=./image/dateien/usr/share/kinderstick/apps.json python3 dienst/kinderstick_dienst.py
Nur Python-Standardbibliothek.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import pwd
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import hoeren   # Hörbücher und Kinder-Hörspiele (dienst/hoeren.py, am Stick daneben installiert)

PORT = 8411
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
URSPRUENGE = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
OBERFLAECHE = Path(os.environ.get("KS_OBERFLAECHE", "/usr/share/kinderstick/oberflaeche")).resolve()
APPS_DATEI = Path(os.environ.get("KS_APPS", "/usr/share/kinderstick/apps.json"))
DATEN = Path(os.environ.get("KS_DATEN", "/var/lib/kinderstick"))
EINST_DATEI = DATEN / "einstellungen.json"
NUTZ_DATEI = DATEN / "nutzung.json"
EIGENE_HG = DATEN / "hintergruende"     # eigene Hintergrundbilder (JPEG)
HOERBUECHER = DATEN / "hoerbuecher"     # eigene Hörbücher (ein Ordner je Hörbuch)
HOERREIHEN = Path(os.environ.get("KS_HOERREIHEN", "/usr/share/kinderstick/hoerreihen.json"))
HOER_PAUSE = 70                        # Sekunden: so lange gilt das Kind nach dem letzten Lebenszeichen der Hörbücher als „hörend“
EIGEN_ID = re.compile(r"eigen-[0-9a-f]{12}")
MAC = re.compile(r"[0-9A-F]{2}(:[0-9A-F]{2}){5}")
MAX_EIGENE_HG = 20
MAX_BILD_BYTES = 2_500_000
MAX_ANFRAGE = 10_000                   # Bytes; Bilder: MAX_ANFRAGE_BILD
MAX_ANFRAGE_BILD = 3_500_000
BILD_ROUTEN = {"/api/hintergrund-aus-bild", "/api/eltern/hintergrund-hochladen"}
KIND = "kind"
ELTERN = "eltern"
TESTMODUS = os.environ.get("KS_TESTMODUS") == "1"

TAKT = 30                 # Sekunden zwischen zwei Zeitmessungen
SPEICHERN_ALLE = 4        # Nutzung nur jede 4. Messung (2 Minuten) schreiben – schont den Stick
TOKEN_DAUER = 600         # Sekunden
MAX_FEHLVERSUCHE = 5
SPERRE_SEKUNDEN = 300
TAGE_AUFBEWAHREN = 60

STANDARD = {
    "eingerichtet": False,
    "kind_name": "",
    "schulstufe": 1,
    "pin": None,                 # {"salz": hex, "hash": hex}
    "limit_schultag": 60,        # Minuten (Montag–Freitag)
    "limit_wochenende": 90,      # Minuten (Samstag, Sonntag)
    "schlafen_von": "19:30",
    "schlafen_bis": "07:00",
    "erlaubte_apps": None,       # altes Format, wird nicht mehr geschrieben
    "gesperrte_apps": [],        # von den Eltern gesperrte Apps; alle anderen sind frei
    "freigeschaltete_apps": [],  # Apps mit "standard_aus" (Netflix, Disney+), die die Eltern freigeschaltet haben
    "hintergrund": "standard",   # vom Kind gewählt (Datei in oberflaeche/hintergruende/)
    "hoerreihen_aus": [],        # Hörspiel-Reihen aus dem Internet, die die Eltern ausgeschaltet haben
}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
}

CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

sperre = threading.Lock()
eltern_tokens = {}                       # token -> Ablaufzeit
fehlversuche = {"anzahl": 0, "gesperrt_bis": 0.0}


# ---------------------------------------------------------------- Speicher

def laden(datei, standard):
    try:
        with open(datei, encoding="utf-8") as f:
            daten = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        daten = {}
    ergebnis = json.loads(json.dumps(standard))  # tiefe Kopie
    if isinstance(daten, dict):
        ergebnis.update(daten)
    return ergebnis


def speichern(datei, daten):
    DATEN.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = datei.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, datei)


def apps_laden():
    with open(APPS_DATEI, encoding="utf-8") as f:
        return json.load(f)


einst = laden(EINST_DATEI, STANDARD)
nutzung = laden(NUTZ_DATEI, {})
APPS = apps_laden()
hoer = hoeren.Hoeren(HOERBUECHER, HOERREIHEN)
letzte_hoerzeit = 0.0   # letztes Lebenszeichen der Hörbücher (Hören zählt nicht zur Bildschirmzeit)


# ---------------------------------------------------------------- Zeitlogik

def heute():
    return datetime.now().strftime("%Y-%m-%d")


def tag_eintrag(tag=None):
    return nutzung.setdefault(tag or heute(), {"minuten": 0.0, "bonus": 0})


def limit_heute():
    wochenende = datetime.now().weekday() >= 5
    return einst["limit_wochenende"] if wochenende else einst["limit_schultag"]


def in_minuten(text):
    stunden, minuten = text.split(":")
    return int(stunden) * 60 + int(minuten)


def ist_schlafenszeit():
    jetzt = datetime.now()
    m = jetzt.hour * 60 + jetzt.minute
    von, bis = in_minuten(einst["schlafen_von"]), in_minuten(einst["schlafen_bis"])
    if von == bis:
        return False
    if von > bis:                       # über Mitternacht, z. B. 19:30–07:00
        return m >= von or m < bis
    return von <= m < bis


def zustand():
    """Liefert (gesperrt, grund, restminuten, limit_inkl_bonus)."""
    eintrag = tag_eintrag()
    gesamt = limit_heute() + eintrag["bonus"]
    rest = max(0.0, gesamt - eintrag["minuten"])
    if not einst["eingerichtet"]:
        return False, None, rest, gesamt
    if ist_schlafenszeit():
        return True, "schlafenszeit", rest, gesamt
    if rest <= 0:
        return True, "zeit_um", 0.0, gesamt
    return False, None, rest, gesamt


def alte_tage_entfernen():
    grenze = (datetime.now() - timedelta(days=TAGE_AUFBEWAHREN)).strftime("%Y-%m-%d")
    for tag in [t for t in nutzung if t < grenze]:
        del nutzung[tag]


def erlaubte_apps():
    # Das ältere Format „erlaubte_apps“ (nur Test-Sticks) wird ignoriert: die App-Liste hat sich geändert
    # Apps mit "standard_aus" (Netflix, Disney+: eigenes Abo nötig) erst nach Freischaltung durch die Eltern
    gesperrt = set(einst.get("gesperrte_apps") or [])
    frei = set(einst.get("freigeschaltete_apps") or [])
    return [a for a in APPS
            if (a["id"] in frei if a.get("standard_aus") else a["id"] not in gesperrt)]


# ---------------------------------------------------------------- Systembefehle

def ausfuehren(befehl, eingabe=None, zeit=20):
    """Führt einen Systembefehl aus; im Testmodus nur Ausgabe."""
    if TESTMODUS:
        print("TEST – würde ausführen:", " ".join(befehl[:4]), "…", flush=True)
        return subprocess.CompletedProcess(befehl, 0, "", "")
    return subprocess.run(befehl, input=eingabe, capture_output=True, text=True, timeout=zeit)


def kind_aktiv():
    if TESTMODUS:
        return True
    try:
        r = subprocess.run(["loginctl", "show-user", KIND, "-p", "State", "--value"],
                           capture_output=True, text=True, timeout=5)
        return r.stdout.strip() == "active"
    except (OSError, subprocess.TimeoutExpired):
        return False


def apps_beenden():
    for app in APPS:
        if not app.get("befehl"):
            continue   # eigene Programme der Oberfläche kehren selbst zur Startseite zurück
        prog = os.path.basename(app["befehl"][0])[:15]   # Prozessname ist auf 15 Zeichen gekürzt
        try:
            ausfuehren(["pkill", "-u", KIND, "-x", prog], zeit=5)
        except (OSError, subprocess.TimeoutExpired):
            pass


def app_starten(app):
    # Zusätzliche Startoptionen je Schulstufe (z. B. GCompris: Schwierigkeit passend zur Klasse)
    befehl = list(app["befehl"]) + list(app.get("optionen_nach_klasse", {}).get(str(einst["schulstufe"]), []))
    if TESTMODUS:
        print("TEST – App-Start:", befehl, flush=True)
        return True
    try:
        subprocess.Popen(
            ["systemd-run", "--user", "--machine", f"{KIND}@.host", "--collect", "--quiet",
             "--", *befehl],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def kind_abmelden():
    try:
        ausfuehren(["loginctl", "terminate-user", KIND], zeit=10)
    except (OSError, subprocess.TimeoutExpired):
        pass


def nmcli_felder(zeile):
    """Zerlegt eine Zeile aus 'nmcli -t' (Doppelpunkt getrennt, '\\:' maskiert)."""
    teile = re.split(r"(?<!\\):", zeile)
    return [t.replace("\\:", ":").replace("\\\\", "\\") for t in teile]


def wlan_liste():
    if TESTMODUS:
        return [{"ssid": "Test-WLAN", "signal": 80, "gesichert": True, "aktiv": False}]
    r = ausfuehren(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY",
                    "dev", "wifi", "list", "--rescan", "yes"], zeit=30)
    netze = {}
    for zeile in r.stdout.splitlines():
        felder = nmcli_felder(zeile)
        if len(felder) < 4 or not felder[1]:
            continue
        aktiv, ssid, signal, sicherheit = felder[0] == "*", felder[1], felder[2], felder[3]
        try:
            signal = int(signal)
        except ValueError:
            signal = 0
        alt = netze.get(ssid)
        if not alt or signal > alt["signal"] or aktiv:
            netze[ssid] = {"ssid": ssid, "signal": signal,
                           "gesichert": sicherheit not in ("", "--"), "aktiv": aktiv}
    return sorted(netze.values(), key=lambda n: (-n["aktiv"], -n["signal"]))


def wlan_verbinden(ssid, passwort):
    befehl = ["nmcli", "dev", "wifi", "connect", ssid]
    if passwort:
        befehl += ["password", passwort]
    r = ausfuehren(befehl, zeit=60)
    return r.returncode == 0, (r.stderr or r.stdout).strip()


# ---------------------------------------------------------------- PIN und Token

def pin_hash(pin, salz):
    return hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salz), n=2 ** 14, r=8, p=1).hex()


def pin_setzen(pin):
    salz = secrets.token_hex(16)
    einst["pin"] = {"salz": salz, "hash": pin_hash(pin, salz)}


def pin_pruefen(pin):
    jetzt = time.time()
    if fehlversuche["gesperrt_bis"] > jetzt:
        return "gesperrt"
    gespeichert = einst.get("pin")
    if gespeichert and hmac.compare_digest(pin_hash(pin, gespeichert["salz"]), gespeichert["hash"]):
        fehlversuche["anzahl"] = 0
        return "ok"
    fehlversuche["anzahl"] += 1
    if fehlversuche["anzahl"] >= MAX_FEHLVERSUCHE:
        fehlversuche["anzahl"] = 0
        fehlversuche["gesperrt_bis"] = jetzt + SPERRE_SEKUNDEN
    return "falsch"


def token_neu():
    token = secrets.token_urlsafe(24)
    eltern_tokens[token] = time.time() + TOKEN_DAUER
    return token


def token_gueltig(token):
    jetzt = time.time()
    for t in [t for t, ablauf in eltern_tokens.items() if ablauf < jetzt]:
        del eltern_tokens[t]
    return isinstance(token, str) and token in eltern_tokens


# ---------------------------------------------------------------- Prüfungen

ZEIT_MUSTER = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def zeiten_pruefen(d, ziel):
    """Übernimmt Limits und Schlafenszeit aus d nach ziel. Liefert Fehlertext oder None."""
    for feld in ("limit_schultag", "limit_wochenende"):
        if feld in d:
            try:
                wert = int(d[feld])
            except (TypeError, ValueError):
                return "Zeitlimit muss eine Zahl sein."
            if not 0 <= wert <= 600:
                return "Zeitlimit muss zwischen 0 und 600 Minuten liegen."
            ziel[feld] = wert
    for feld in ("schlafen_von", "schlafen_bis"):
        if feld in d:
            if not isinstance(d[feld], str) or not ZEIT_MUSTER.match(d[feld]):
                return "Uhrzeit bitte als HH:MM angeben."
            ziel[feld] = d[feld]
    return None


def pin_gueltig(pin):
    return isinstance(pin, str) and re.fullmatch(r"\d{4,8}", pin) is not None


# ---------------------------------------------------------------- Aktionen

def status():
    with sperre:
        gesperrt, grund, rest, gesamt = zustand()
        return {
            "eingerichtet": einst["eingerichtet"],
            "kind_name": einst["kind_name"],
            "gesperrt": gesperrt,
            "grund": grund,
            "rest_minuten": int(rest),
            "limit_minuten": int(gesamt),
            "schlafen_bis": einst["schlafen_bis"],
            "hintergrund": einst.get("hintergrund", "standard"),
            "eigene_hintergruende": [{"id": i, "url": f"/eigene-hintergruende/{i}.jpg"}
                                     for i in eigene_hintergruende()],
            "schulstufe": einst["schulstufe"],
            "ausschalt_fehler": ausschalt_fehler,
            "uhrzeit": datetime.now().strftime("%H:%M"),   # Uhrzeit am Stick (Kontrolle bei der Einrichtung)
            "apps": [{"id": a["id"], "name": a["name"], "symbol": a.get("symbol", ""),
                      "auch_gesperrt": bool(a.get("auch_gesperrt"))}
                     for a in erlaubte_apps()],
        }


def einrichten(d):
    with sperre:
        if einst["eingerichtet"]:
            return 409, {"fehler": "Der Stick ist bereits eingerichtet."}
        name = str(d.get("kind_name", "")).strip()
        if not 1 <= len(name) <= 30:
            return 400, {"fehler": "Bitte einen Namen mit 1 bis 30 Zeichen eingeben."}
        try:
            stufe = int(d.get("schulstufe", 1))
        except (TypeError, ValueError):
            stufe = 0
        if not 1 <= stufe <= 4:
            return 400, {"fehler": "Schulstufe bitte zwischen 1 und 4 wählen."}
        pin = d.get("pin")
        if not pin_gueltig(pin):
            return 400, {"fehler": "Die Eltern-PIN muss aus 4 bis 8 Ziffern bestehen."}
        passwort = d.get("passwort")
        if not isinstance(passwort, str) or len(passwort) < 8 or "\n" in passwort or "\r" in passwort:
            return 400, {"fehler": "Das Elternpasswort muss mindestens 8 Zeichen haben."}
        neu = dict(einst)
        fehler = zeiten_pruefen(d, neu)
        if fehler:
            return 400, {"fehler": fehler}
        r = ausfuehren(["chpasswd"], eingabe=f"{ELTERN}:{passwort}\n")
        if r.returncode != 0:
            return 500, {"fehler": "Das Elternpasswort konnte nicht gesetzt werden."}
        einst.update(neu)
        einst["kind_name"] = name
        einst["schulstufe"] = stufe
        pin_setzen(pin)
        einst["eingerichtet"] = True
        speichern(EINST_DATEI, einst)
        return 200, {"ok": True}


def eltern_anmelden(d):
    with sperre:
        if not einst["eingerichtet"]:
            return 409, {"fehler": "Noch nicht eingerichtet."}
        ergebnis = pin_pruefen(str(d.get("pin", "")))
        if ergebnis == "gesperrt":
            return 429, {"fehler": "Zu viele Versuche. Bitte in 5 Minuten noch einmal."}
        if ergebnis != "ok":
            return 403, {"fehler": "Die PIN stimmt nicht."}
        return 200, {"token": token_neu()}


def hoeren_eltern():
    with sperre:
        aus = set(einst.get("hoerreihen_aus") or [])
    return {
        "buecher": [{"id": b["id"], "titel": b["titel"], "kapitel": len(b["kapitel"]), "bytes": b["bytes"]}
                    for b in hoer.buecher()],
        "frei": hoer.frei(),
        "reihen": [{"id": r["id"], "titel": r["titel"], "alter": r.get("alter", ""), "an": r["id"] not in aus}
                   for r in hoer.reihen],
    }


def eltern_hoerreihen(d):
    an = d.get("an")
    if not isinstance(an, list) or not all(isinstance(i, str) for i in an):
        return 400, {"fehler": "Ungültige Auswahl."}
    with sperre:
        einst["hoerreihen_aus"] = [r["id"] for r in hoer.reihen if r["id"] not in an]
        speichern(EINST_DATEI, einst)
    return 200, {"ok": True}


def hoeren_aktiv():
    """Lebenszeichen der geöffneten Hörbücher – solange es kommt, läuft keine Bildschirmzeit."""
    global letzte_hoerzeit
    if not hoeren_erlaubt():
        return 403, {"fehler": "Hörbücher sind nicht freigegeben."}
    letzte_hoerzeit = time.time()
    return 200, {"ok": True}


def hoeren_erlaubt():
    with sperre:
        return any(a["id"] == "hoerbuecher" for a in erlaubte_apps())


def hoeren_kind():
    """Regal für das Kind: eigene Hörbücher und die eingeschalteten Hörspiel-Reihen."""
    if not hoeren_erlaubt():
        return 403, {"fehler": "Hörbücher sind nicht freigegeben."}
    with sperre:
        aus = set(einst.get("hoerreihen_aus") or [])
        grund = zustand()[1]
    buecher = []
    for b in hoer.buecher():
        if not b["kapitel"]:
            continue
        basis = f"/hoerbuecher/{b['id']}/"
        buecher.append({
            "id": b["id"], "titel": b["titel"],
            "cover": basis + urllib.parse.quote(b["cover"]) if b["cover"] else None,
            "kapitel": [{"name": k.rsplit(".", 1)[0], "url": basis + urllib.parse.quote(k)} for k in b["kapitel"]],
        })
    reihen = [{"id": r["id"], "titel": r["titel"], "bild": f"/hoerreihe-bild/{r['id']}"}
              for r in hoer.reihen if r["id"] not in aus]
    return 200, {"buecher": buecher, "reihen": reihen, "schlafenszeit": grund == "schlafenszeit"}


def hoeren_reihe(reihen_id):
    if not hoeren_erlaubt():
        return 403, {"fehler": "Hörbücher sind nicht freigegeben."}
    with sperre:
        if reihen_id in (einst.get("hoerreihen_aus") or []):
            return 404, {"fehler": "Diese Reihe ist ausgeschaltet."}
    try:
        feed = hoer.reihe(reihen_id)
    except (OSError, ValueError, hoeren.ET.ParseError):
        return 502, {"fehler": "Die Hörspiele konnten nicht geladen werden. Ist das Internet verbunden?"}
    if feed is None:
        return 404, {"fehler": "Diese Reihe gibt es nicht."}
    return 200, {"titel": feed["titel"],
                 "folgen": [{"id": f["id"], "titel": f["titel"], "dauer": f["dauer"],
                             "url": f"/hoerfolge/{reihen_id}/{f['id']}"} for f in feed["folgen"]]}


def eltern_uebersicht():
    hoer_stand = hoeren_eltern()
    with sperre:
        gesperrt, grund, rest, gesamt = zustand()
        tage = []
        for i in range(6, -1, -1):
            tag = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            eintrag = nutzung.get(tag, {"minuten": 0, "bonus": 0})
            tage.append({"tag": tag, "minuten": int(eintrag["minuten"]), "bonus": eintrag["bonus"]})
        erlaubt = {a["id"] for a in erlaubte_apps()}
        return 200, {
            "kind_name": einst["kind_name"],
            "schulstufe": einst["schulstufe"],
            "limit_schultag": einst["limit_schultag"],
            "limit_wochenende": einst["limit_wochenende"],
            "schlafen_von": einst["schlafen_von"],
            "schlafen_bis": einst["schlafen_bis"],
            "heute": {"gesperrt": gesperrt, "grund": grund,
                      "rest_minuten": int(rest), "limit_minuten": int(gesamt)},
            "tage": tage,
            "apps": [{"id": a["id"], "name": a["name"], "symbol": a.get("symbol", ""),
                      "erlaubt": a["id"] in erlaubt} for a in APPS],
            "hoeren": hoer_stand,
        }


def eltern_bonus(d):
    try:
        minuten = int(d.get("minuten", 0))
    except (TypeError, ValueError):
        minuten = 0
    if not -240 <= minuten <= 240 or minuten == 0:
        return 400, {"fehler": "Bonuszeit bitte zwischen -240 und 240 Minuten."}
    with sperre:
        eintrag = tag_eintrag()
        eintrag["bonus"] = max(-limit_heute(), eintrag["bonus"] + minuten)
        speichern(NUTZ_DATEI, nutzung)
        return 200, {"ok": True, "bonus": eintrag["bonus"]}


def eltern_einstellungen(d):
    with sperre:
        neu = dict(einst)
        fehler = zeiten_pruefen(d, neu)
        if fehler:
            return 400, {"fehler": fehler}
        if "erlaubte_apps" in d:
            ids = d["erlaubte_apps"]
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                return 400, {"fehler": "Ungültige App-Liste."}
            # Gespeichert wird, was GESPERRT ist – neue Programme (Update) sind so automatisch frei
            neu["gesperrte_apps"] = [a["id"] for a in APPS if a["id"] not in ids]
            neu["freigeschaltete_apps"] = [a["id"] for a in APPS if a.get("standard_aus") and a["id"] in ids]
            neu["erlaubte_apps"] = None
        if d.get("pin_neu"):
            if not pin_gueltig(d["pin_neu"]):
                return 400, {"fehler": "Die neue PIN muss aus 4 bis 8 Ziffern bestehen."}
        einst.update(neu)
        if d.get("pin_neu"):
            pin_setzen(d["pin_neu"])
        speichern(EINST_DATEI, einst)
        return 200, {"ok": True}


def eltern_beenden():
    threading.Timer(1.0, kind_abmelden).start()   # erst antworten, dann abmelden
    return 200, {"ok": True}


def eltern_wlan_verbinden(d):
    ssid = d.get("ssid")
    passwort = d.get("passwort") or ""
    if not isinstance(ssid, str) or not 1 <= len(ssid) <= 32:
        return 400, {"fehler": "Bitte ein WLAN auswählen."}
    if not isinstance(passwort, str) or len(passwort) > 63 or "\n" in passwort:
        return 400, {"fehler": "Ungültiges WLAN-Passwort."}
    ok, meldung = wlan_verbinden(ssid, passwort)
    if not ok:
        return 502, {"fehler": "Verbindung fehlgeschlagen. Passwort prüfen."}
    return 200, {"ok": True}


def eigene_hintergruende():
    """Eigene Bilder (von den Eltern hochgeladen oder vom Kind gemalt/fotografiert), neueste zuerst."""
    dateien = sorted(EIGENE_HG.glob("eigen-*.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [p.stem for p in dateien if EIGEN_ID.fullmatch(p.stem)]


def hintergruende():
    """Erlaubte Hintergründe: „standard“, alle SVG-Dateien in oberflaeche/hintergruende/ und eigene Bilder."""
    return ({"standard"} | {p.stem for p in (OBERFLAECHE / "hintergruende").glob("*.svg")}
            | set(eigene_hintergruende()))


def bild_speichern(d, als_hintergrund):
    """Speichert ein JPEG (data:-Adresse, im Browser schon auf Bildschirmgröße verkleinert)."""
    daten = d.get("bild")
    praefix = "data:image/jpeg;base64,"
    if not isinstance(daten, str) or not daten.startswith(praefix):
        return 400, {"fehler": "Bitte ein Bild auswählen."}
    try:
        roh = base64.b64decode(daten[len(praefix):], validate=True)
    except (ValueError, binascii.Error):
        return 400, {"fehler": "Das Bild ist beschädigt."}
    if not roh.startswith(b"\xff\xd8\xff") or len(roh) > MAX_BILD_BYTES:
        return 400, {"fehler": "Das Bild ist zu groß oder kein JPEG."}
    with sperre:
        EIGENE_HG.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Platz begrenzen: älteste eigene Bilder entfernen (nicht das gerade gewählte)
        vorhanden = eigene_hintergruende()
        for alt in vorhanden[MAX_EIGENE_HG - 1:]:
            if alt != einst.get("hintergrund"):
                (EIGENE_HG / f"{alt}.jpg").unlink(missing_ok=True)
        neu = "eigen-" + secrets.token_hex(6)
        tmp = EIGENE_HG / f"{neu}.tmp"
        tmp.write_bytes(roh)
        os.chmod(tmp, 0o644)
        os.replace(tmp, EIGENE_HG / f"{neu}.jpg")
        if als_hintergrund:
            einst["hintergrund"] = neu
            speichern(EINST_DATEI, einst)
    return 200, {"ok": True, "id": neu}


def eltern_hintergrund_loeschen(d):
    wahl = d.get("id")
    if not isinstance(wahl, str) or wahl not in eigene_hintergruende():
        return 404, {"fehler": "Dieses Bild gibt es nicht."}
    with sperre:
        (EIGENE_HG / f"{wahl}.jpg").unlink(missing_ok=True)
        if einst.get("hintergrund") == wahl:
            einst["hintergrund"] = "standard"
            speichern(EINST_DATEI, einst)
    return 200, {"ok": True}


# ---------------------------------------------------------------- Ton und Kopfhörer

def im_kinderkonto(befehl, zeit=10):
    """Befehl in der Sitzung des Kindes (PipeWire läuft dort, nicht als root)."""
    if TESTMODUS:
        return ausfuehren(befehl)
    uid = pwd.getpwnam(KIND).pw_uid
    return ausfuehren(["runuser", "-u", KIND, "--", "env", f"XDG_RUNTIME_DIR=/run/user/{uid}", *befehl], zeit=zeit)


def lautstaerke():
    if TESTMODUS:
        return 200, {"wert": 50, "stumm": False}
    try:
        r = im_kinderkonto(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    except (OSError, subprocess.TimeoutExpired, KeyError):
        return 503, {"fehler": "Ton nicht verfügbar."}
    treffer = re.search(r"Volume:\s*([\d.]+)", r.stdout)
    if r.returncode != 0 or not treffer:
        return 503, {"fehler": "Ton nicht verfügbar."}
    return 200, {"wert": round(float(treffer.group(1)) * 100), "stumm": "MUTED" in r.stdout}


def lautstaerke_setzen(d):
    try:
        wert = int(d.get("wert"))
    except (TypeError, ValueError):
        return 400, {"fehler": "Ungültige Lautstärke."}
    wert = max(0, min(100, wert))
    try:
        im_kinderkonto(["wpctl", "set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", f"{wert / 100:.2f}"])
        im_kinderkonto(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1" if wert == 0 else "0"])
    except (OSError, subprocess.TimeoutExpired, KeyError):
        return 503, {"fehler": "Ton nicht verfügbar."}
    return 200, {"ok": True, "wert": wert}


def bluetooth(*argumente, zeit=20):
    return ausfuehren(["bluetoothctl", *argumente], zeit=zeit)


def eltern_bluetooth_liste():
    """Sucht 8 Sekunden nach Bluetooth-Geräten. Kopfhörer und Lautsprecher stehen oben."""
    if TESTMODUS:
        return 200, {"geraete": []}
    bluetooth("power", "on", zeit=10)
    bluetooth("--timeout", "8", "scan", "on", zeit=20)
    geraete = []
    for zeile in bluetooth("devices", zeit=10).stdout.splitlines():
        teile = zeile.split(" ", 2)
        if len(teile) < 3 or teile[0] != "Device" or not MAC.fullmatch(teile[1]):
            continue
        mac, name = teile[1], teile[2].strip()
        if name.replace("-", ":") == mac:      # Gerät ohne Namen
            continue
        info = bluetooth("info", mac, zeit=10).stdout
        symbol = (re.search(r"Icon:\s*(\S+)", info) or [None, ""])[1]
        geraete.append({
            "mac": mac, "name": name[:60],
            "audio": symbol.startswith("audio"),
            "gekoppelt": "Paired: yes" in info,
            "verbunden": "Connected: yes" in info,
        })
    geraete.sort(key=lambda g: (not g["verbunden"], not g["audio"], g["name"].lower()))
    return 200, {"geraete": geraete[:30]}


def eltern_bluetooth_verbinden(d):
    mac = d.get("mac")
    if not isinstance(mac, str) or not MAC.fullmatch(mac):
        return 400, {"fehler": "Bitte ein Gerät auswählen."}
    if TESTMODUS:
        return 200, {"ok": True}
    info = bluetooth("info", mac, zeit=10).stdout
    if "Paired: yes" not in info:
        # Kurz erneut suchen – BlueZ vergisst gefundene, nicht gekoppelte Geräte nach 30 Sekunden
        bluetooth("--timeout", "5", "scan", "on", zeit=15)
        r = bluetooth("--agent", "NoInputNoOutput", "pair", mac, zeit=40)
        if r.returncode != 0 and "AlreadyExists" not in r.stdout + r.stderr:
            return 502, {"fehler": "Koppeln hat nicht geklappt. Kopfhörer in den Kopplungsmodus bringen und erneut versuchen."}
    bluetooth("trust", mac, zeit=10)       # verbindet sich danach beim Einschalten von selbst
    r = bluetooth("connect", mac, zeit=30)
    if r.returncode != 0:
        return 502, {"fehler": "Gekoppelt, aber nicht verbunden. Gerät einschalten und erneut versuchen."}
    return 200, {"ok": True}


def eltern_bluetooth_entfernen(d):
    mac = d.get("mac")
    if not isinstance(mac, str) or not MAC.fullmatch(mac):
        return 400, {"fehler": "Bitte ein Gerät auswählen."}
    if not TESTMODUS:
        bluetooth("remove", mac, zeit=15)
    return 200, {"ok": True}


def kind_hintergrund(d):
    wahl = d.get("hintergrund")
    if not isinstance(wahl, str) or wahl not in hintergruende():
        return 400, {"fehler": "Diesen Hintergrund gibt es nicht."}
    with sperre:
        einst["hintergrund"] = wahl
        speichern(EINST_DATEI, einst)
    return 200, {"ok": True}


ausschalten_laeuft = False
ausschalt_fehler = ""   # letzte Fehlermeldung beim Ausschalten – zeigt die Oberfläche an

# Stufen beim Ausschalten. Die nächste kommt nur, wenn der Rechner 20 s später noch läuft – beim
# echten Herunterfahren wird dieser Dienst früh beendet, die Schleife endet dann von selbst.
# Tests 27.11.2026: schon „poweroff --check-inhibitors=no“ und „start poweroff.target“ taten
# sichtbar nichts (Fehlermeldung unbekannt) – darum zusätzlich die erzwungenen Wege.
AUSSCHALT_STUFEN = [
    ["systemctl", "poweroff", "--check-inhibitors=no"],
    ["systemctl", "start", "poweroff.target", "--job-mode=replace-irreversibly"],
    ["systemctl", "poweroff", "--force"],             # Programme beenden, Laufwerke aushängen, aus
    ["systemctl", "poweroff", "--force", "--force"],  # sofort aus (Daten vorher mit sync gesichert)
]


def ausschalten():
    """Computer herunterfahren (Knopf auf der Startseite / im Eltern-Bereich)."""
    global ausschalten_laeuft, ausschalt_fehler

    def los():
        global ausschalten_laeuft, ausschalt_fehler
        with sperre:
            speichern(NUTZ_DATEI, nutzung)
        for befehl in AUSSCHALT_STUFEN:
            os.sync()
            try:
                r = ausfuehren(befehl, zeit=20)
                if r.returncode != 0:
                    ausschalt_fehler = (f"{' '.join(befehl[1:])}: "
                                        f"{(r.stderr or r.stdout or '').strip() or r.returncode}")[:300]
            except (OSError, subprocess.TimeoutExpired) as fehler:
                ausschalt_fehler = f"{' '.join(befehl[1:])}: {fehler}"[:300]
            if ausschalt_fehler:
                print("Ausschalten:", ausschalt_fehler, flush=True)
            time.sleep(20)
        ausschalt_fehler = ausschalt_fehler or "Der Computer hat auf keinen Ausschalt-Befehl reagiert."
        ausschalten_laeuft = False   # erneuter Versuch möglich

    with sperre:
        if ausschalten_laeuft:
            return 200, {"ok": True}
        ausschalten_laeuft = True
        ausschalt_fehler = ""
    zeitgeber = threading.Timer(1.0, los)   # erst antworten, dann herunterfahren
    zeitgeber.daemon = True
    zeitgeber.start()
    return 200, {"ok": True}


def kind_starten(d):
    with sperre:
        gesperrt, _, _, _ = zustand()
        app = next((a for a in erlaubte_apps() if a["id"] == d.get("app")), None)
    if not app:
        return 404, {"fehler": "Dieses Programm ist nicht freigegeben."}
    if gesperrt and not app.get("auch_gesperrt"):   # Hörbücher gehen auch zur Schlafenszeit
        return 423, {"fehler": "Für heute ist Schluss."}
    if app.get("seite"):
        # Eigenes Programm der Oberfläche – die Startseite wechselt selbst dorthin
        return 200, {"ok": True, "seite": app["seite"]}
    if not app_starten(app):
        return 500, {"fehler": "Das Programm konnte nicht gestartet werden."}
    return 200, {"ok": True}


# ---------------------------------------------------------------- Hintergrund

def zeit_schleife():
    zaehler = 0
    while True:
        time.sleep(TAKT)
        with sperre:
            gesperrt, _, _, _ = zustand()
            hoert = time.time() - letzte_hoerzeit < HOER_PAUSE   # Hören zählt nicht
            if einst["eingerichtet"] and not gesperrt and not hoert and kind_aktiv():
                tag_eintrag()["minuten"] += TAKT / 60
                zaehler += 1
                if zaehler >= SPEICHERN_ALLE:
                    zaehler = 0
                    alte_tage_entfernen()
                    speichern(NUTZ_DATEI, nutzung)
            gesperrt, _, _, _ = zustand()
        if gesperrt:
            apps_beenden()


# ---------------------------------------------------------------- HTTP

ELTERN_ROUTEN = {
    "/api/eltern/uebersicht": lambda d: eltern_uebersicht(),
    "/api/eltern/bonus": eltern_bonus,
    "/api/eltern/einstellungen": eltern_einstellungen,
    "/api/eltern/beenden": lambda d: eltern_beenden(),
    "/api/eltern/wlan-liste": lambda d: (200, {"netze": wlan_liste()}),
    "/api/eltern/wlan-verbinden": eltern_wlan_verbinden,
    "/api/eltern/hintergrund-hochladen": lambda d: bild_speichern(d, als_hintergrund=False),
    "/api/eltern/hintergrund-loeschen": eltern_hintergrund_loeschen,
    "/api/eltern/bluetooth-liste": lambda d: eltern_bluetooth_liste(),
    "/api/eltern/bluetooth-verbinden": eltern_bluetooth_verbinden,
    "/api/eltern/bluetooth-entfernen": eltern_bluetooth_entfernen,
    "/api/eltern/hoerbuch-neu": lambda d: hoer.buch_neu(d.get("titel")),
    "/api/eltern/hoerbuch-loeschen": lambda d: hoer.buch_loeschen(d.get("id")),
    "/api/eltern/hoerreihen": eltern_hoerreihen,
}


class Anfrage(BaseHTTPRequestHandler):
    server_version = "Kinderstick"
    sys_version = ""

    def log_message(self, format, *args):   # keine Zugriffsprotokolle (Datensparsamkeit)
        pass

    def senden(self, status_code, inhalt, typ):
        self.send_response(status_code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(inhalt)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.end_headers()
        self.wfile.write(inhalt)

    def json_antwort(self, status_code, daten):
        self.senden(status_code, json.dumps(daten, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8")

    def host_ok(self):
        return self.headers.get("Host", "") in HOSTS

    def schreiben(self, quelle, laenge=None):
        """Kopiert aus quelle (read(n)) zum Browser; bricht still ab, wenn der Browser abbricht."""
        rest = laenge
        try:
            while rest is None or rest > 0:
                stueck = quelle.read(1 << 16 if rest is None else min(rest, 1 << 16))
                if not stueck:
                    break
                self.wfile.write(stueck)
                if rest is not None:
                    rest -= len(stueck)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            self.close_connection = True

    def datei_streamen(self, pfad, typ):
        """Audio-/Bilddatei mit Range-Unterstützung (zum Spulen im Hörbuch)."""
        groesse = pfad.stat().st_size
        anfang, ende, code = 0, groesse - 1, 200
        treffer = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if treffer and (treffer.group(1) or treffer.group(2)):
            if treffer.group(1):
                anfang = int(treffer.group(1))
                if treffer.group(2):
                    ende = min(int(treffer.group(2)), groesse - 1)
            else:
                anfang = max(0, groesse - int(treffer.group(2)))
            if anfang >= groesse or anfang > ende:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{groesse}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(ende - anfang + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if code == 206:
            self.send_header("Content-Range", f"bytes {anfang}-{ende}/{groesse}")
        self.end_headers()
        with open(pfad, "rb") as f:
            f.seek(anfang)
            self.schreiben(f, ende - anfang + 1)

    def folge_durchreichen(self, url):
        """Hörspiel-Folge beim Sender holen und weitergeben (inkl. Spulen über Range)."""
        try:
            antwort = hoeren.audio_oeffnen(url, self.headers.get("Range"))
        except urllib.error.HTTPError as fehler:
            return self.json_antwort(416 if fehler.code == 416 else 502, {"fehler": "Folge nicht erreichbar."})
        except OSError:
            return self.json_antwort(502, {"fehler": "Kein Internet?"})
        with antwort:
            self.send_response(antwort.status)
            typ = antwort.headers.get("Content-Type", "")
            self.send_header("Content-Type", typ if typ.startswith("audio/") else "audio/mpeg")
            for name in ("Content-Length", "Content-Range", "Accept-Ranges"):
                if antwort.headers.get(name):
                    self.send_header(name, antwort.headers[name])
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.schreiben(antwort)

    def hoerbuch_hochladen(self):
        """Rohe Datei (kein JSON, kann sehr groß sein). Kopfzeilen: X-Token, X-Hoerbuch, X-Dateiname."""
        with sperre:
            gueltig = token_gueltig(self.headers.get("X-Token"))
        try:
            laenge = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            laenge = -1
        if not gueltig:
            code, antwort = 401, {"fehler": "Bitte erneut mit PIN anmelden."}
        else:
            name = urllib.parse.unquote(self.headers.get("X-Dateiname", ""))
            code, antwort = hoer.datei_speichern(self.headers.get("X-Hoerbuch", ""), name, laenge, self.rfile.read)
        if code != 200:
            self.close_connection = True   # Rest der Anfrage nicht mehr lesen
        self.json_antwort(code, antwort)

    def do_GET(self):
        if not self.host_ok():
            return self.json_antwort(403, {"fehler": "Verboten."})
        pfad = self.path.split("?", 1)[0]
        if pfad == "/api/status":
            return self.json_antwort(200, status())
        if pfad == "/api/lautstaerke":
            return self.json_antwort(*lautstaerke())
        if pfad == "/api/hoeren":
            return self.json_antwort(*hoeren_kind())
        if pfad == "/api/hoerreihe":
            abfrage = urllib.parse.parse_qs(self.path.partition("?")[2])
            return self.json_antwort(*hoeren_reihe((abfrage.get("id") or [""])[0]))
        if pfad.startswith("/hoerbuecher/") and pfad.count("/") == 3:
            _, _, buch, name = pfad.split("/")
            datei = hoer.datei_pfad(buch, urllib.parse.unquote(name))
            if not datei or not hoeren_erlaubt():
                return self.json_antwort(404, {"fehler": "Nicht gefunden."})
            return self.datei_streamen(datei, hoeren.TYPEN[datei.suffix.lower()])
        if pfad.startswith("/hoerfolge/") and pfad.count("/") == 3:
            _, _, reihe, folge = pfad.split("/")
            with sperre:
                aus = reihe in (einst.get("hoerreihen_aus") or [])
            url = None if aus or not hoeren_erlaubt() else hoer.folge_url(reihe, folge)
            if not url:
                return self.json_antwort(404, {"fehler": "Nicht gefunden."})
            return self.folge_durchreichen(url)
        if pfad.startswith("/hoerreihe-bild/"):
            bild = hoer.reihen_bild(pfad.rsplit("/", 1)[1])
            if not bild:
                return self.json_antwort(404, {"fehler": "Nicht gefunden."})
            return self.senden(200, bild[0], bild[1])
        if pfad.startswith("/eigene-hintergruende/"):
            name = pfad.rsplit("/", 1)[1].removesuffix(".jpg")
            datei = EIGENE_HG / f"{name}.jpg"
            if not EIGEN_ID.fullmatch(name) or not datei.is_file():
                return self.json_antwort(404, {"fehler": "Nicht gefunden."})
            return self.senden(200, datei.read_bytes(), "image/jpeg")
        if pfad == "/":
            pfad = "/index.html"
        datei = (OBERFLAECHE / pfad.lstrip("/")).resolve()
        typ = MIME.get(datei.suffix)
        if OBERFLAECHE not in datei.parents or not typ or not datei.is_file():
            return self.json_antwort(404, {"fehler": "Nicht gefunden."})
        self.senden(200, datei.read_bytes(), typ)

    def do_POST(self):
        if not self.host_ok():
            return self.json_antwort(403, {"fehler": "Verboten."})
        herkunft = self.headers.get("Origin")
        if herkunft and herkunft not in URSPRUENGE:
            return self.json_antwort(403, {"fehler": "Verboten."})
        if self.path.split("?", 1)[0] == "/api/eltern/hoerbuch-datei":
            return self.hoerbuch_hochladen()
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.json_antwort(415, {"fehler": "JSON erwartet."})
        try:
            laenge = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            laenge = -1
        pfad = self.path.split("?", 1)[0]
        if not 0 <= laenge <= (MAX_ANFRAGE_BILD if pfad in BILD_ROUTEN else MAX_ANFRAGE):
            return self.json_antwort(413, {"fehler": "Anfrage zu groß."})
        try:
            d = json.loads(self.rfile.read(laenge) or b"{}")
            if not isinstance(d, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.json_antwort(400, {"fehler": "Ungültige Anfrage."})

        try:
            if pfad == "/api/starten":
                code, antwort = kind_starten(d)
            elif pfad == "/api/hintergrund":
                code, antwort = kind_hintergrund(d)
            elif pfad == "/api/hintergrund-aus-bild":
                code, antwort = bild_speichern(d, als_hintergrund=True)
            elif pfad == "/api/lautstaerke":
                code, antwort = lautstaerke_setzen(d)
            elif pfad == "/api/ausschalten":
                code, antwort = ausschalten()
            elif pfad == "/api/hoeren-aktiv":   # Lebenszeichen der Hörbücher: Zeit läuft nicht
                code, antwort = hoeren_aktiv()
            elif pfad == "/api/einrichtung":
                code, antwort = einrichten(d)
            elif pfad == "/api/eltern/anmelden":
                code, antwort = eltern_anmelden(d)
            elif pfad in ELTERN_ROUTEN:
                with sperre:
                    gueltig = token_gueltig(d.get("token"))
                if not gueltig:
                    code, antwort = 401, {"fehler": "Bitte erneut mit PIN anmelden."}
                else:
                    code, antwort = ELTERN_ROUTEN[pfad](d)
            else:
                code, antwort = 404, {"fehler": "Nicht gefunden."}
        except subprocess.TimeoutExpired:
            code, antwort = 504, {"fehler": "Zeitüberschreitung."}
        self.json_antwort(code, antwort)


def main():
    DATEN.mkdir(mode=0o700, parents=True, exist_ok=True)
    threading.Thread(target=zeit_schleife, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Anfrage)
    zusatz = " (Testmodus – keine Systembefehle)" if TESTMODUS else ""
    print(f"Kinder-Stick-Dienst läuft auf http://127.0.0.1:{PORT}{zusatz}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
