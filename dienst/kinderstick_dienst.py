#!/usr/bin/python3
"""Kinder-Stick – lokaler Dienst.

Aufgaben:
  * liefert die Kinder-Oberfläche (Web-App) aus
  * zählt die Nutzungszeit des Kinderkontos und setzt Tageslimit und Schlafenszeit durch
  * startet freigegebene Apps im Kinderkonto und beendet sie, wenn die Zeit um ist
  * Einrichtungsassistent (Name, Schulstufe, Eltern-PIN, Elternpasswort, Zeiten)
  * Eltern-Bereich mit PIN: Bonuszeit, Zeiten, App-Freigaben, WLAN, Kinder-Modus beenden

Sicherheit:
  * lauscht nur auf 127.0.0.1, prüft Host- und Origin-Header (Schutz vor DNS-Rebinding/CSRF)
  * PIN als scrypt-Hash, nach 5 Fehlversuchen 5 Minuten Sperre
  * Eltern-Aktionen nur mit kurzlebigem Token (10 Minuten) nach PIN-Eingabe

Entwicklung ohne Stick (Testmodus, keine Systembefehle):
  KS_TESTMODUS=1 KS_DATEN=./testdaten KS_OBERFLAECHE=./oberflaeche \
  KS_APPS=./image/dateien/usr/share/kinderstick/apps.json python3 dienst/kinderstick_dienst.py
Nur Python-Standardbibliothek.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8411
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
URSPRUENGE = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
OBERFLAECHE = Path(os.environ.get("KS_OBERFLAECHE", "/usr/share/kinderstick/oberflaeche")).resolve()
APPS_DATEI = Path(os.environ.get("KS_APPS", "/usr/share/kinderstick/apps.json"))
DATEN = Path(os.environ.get("KS_DATEN", "/var/lib/kinderstick"))
EINST_DATEI = DATEN / "einstellungen.json"
NUTZ_DATEI = DATEN / "nutzung.json"
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
    "erlaubte_apps": None,       # None = alle Apps aus apps.json
    "hintergrund": "standard",   # vom Kind gewählt (Datei in oberflaeche/hintergruende/)
}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
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
    if einst["erlaubte_apps"] is None:
        return APPS
    return [a for a in APPS if a["id"] in einst["erlaubte_apps"]]


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
        prog = os.path.basename(app["befehl"][0])[:15]   # Prozessname ist auf 15 Zeichen gekürzt
        try:
            ausfuehren(["pkill", "-u", KIND, "-x", prog], zeit=5)
        except (OSError, subprocess.TimeoutExpired):
            pass


def app_starten(app):
    if TESTMODUS:
        print("TEST – App-Start:", app["befehl"], flush=True)
        return True
    try:
        subprocess.Popen(
            ["systemd-run", "--user", "--machine", f"{KIND}@.host", "--collect", "--quiet",
             "--", *app["befehl"]],
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
            "apps": [{"id": a["id"], "name": a["name"], "symbol": a.get("symbol", "")}
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


def eltern_uebersicht():
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
            bekannt = {a["id"] for a in APPS}
            neu["erlaubte_apps"] = [i for i in ids if i in bekannt]
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


def hintergruende():
    """Erlaubte Hintergründe: „standard“ plus alle SVG-Dateien in oberflaeche/hintergruende/."""
    return {"standard"} | {p.stem for p in (OBERFLAECHE / "hintergruende").glob("*.svg")}


def kind_hintergrund(d):
    wahl = d.get("hintergrund")
    if not isinstance(wahl, str) or wahl not in hintergruende():
        return 400, {"fehler": "Diesen Hintergrund gibt es nicht."}
    with sperre:
        einst["hintergrund"] = wahl
        speichern(EINST_DATEI, einst)
    return 200, {"ok": True}


def ausschalten():
    """Computer ordnungsgemäß herunterfahren (Knopf auf der Startseite / im Eltern-Bereich)."""
    def los():
        with sperre:
            speichern(NUTZ_DATEI, nutzung)
        try:
            ausfuehren(["systemctl", "poweroff"], zeit=10)
        except (OSError, subprocess.TimeoutExpired):
            pass
    threading.Timer(1.0, los).start()   # erst antworten, dann herunterfahren
    return 200, {"ok": True}


def kind_starten(d):
    with sperre:
        gesperrt, _, _, _ = zustand()
        if gesperrt:
            return 423, {"fehler": "Für heute ist Schluss."}
        app = next((a for a in erlaubte_apps() if a["id"] == d.get("app")), None)
    if not app:
        return 404, {"fehler": "Dieses Programm ist nicht freigegeben."}
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
            if einst["eingerichtet"] and not gesperrt and kind_aktiv():
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

    def do_GET(self):
        if not self.host_ok():
            return self.json_antwort(403, {"fehler": "Verboten."})
        pfad = self.path.split("?", 1)[0]
        if pfad == "/api/status":
            return self.json_antwort(200, status())
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
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.json_antwort(415, {"fehler": "JSON erwartet."})
        try:
            laenge = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            laenge = -1
        if not 0 <= laenge <= 10000:
            return self.json_antwort(413, {"fehler": "Anfrage zu groß."})
        try:
            d = json.loads(self.rfile.read(laenge) or b"{}")
            if not isinstance(d, dict):
                raise ValueError
        except (ValueError, UnicodeDecodeError):
            return self.json_antwort(400, {"fehler": "Ungültige Anfrage."})

        pfad = self.path.split("?", 1)[0]
        try:
            if pfad == "/api/starten":
                code, antwort = kind_starten(d)
            elif pfad == "/api/hintergrund":
                code, antwort = kind_hintergrund(d)
            elif pfad == "/api/ausschalten":
                code, antwort = ausschalten()
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
