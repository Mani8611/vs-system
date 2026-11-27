"""Kinder-Stick – Hörbücher und Kinder-Hörspiele (wird vom Dienst kinderstick_dienst.py genutzt).

Zwei Quellen:
  * Eigene Hörbücher: die Eltern laden Audiodateien auf den Stick (ein Ordner je Hörbuch,
    Kapitel nach Dateinamen sortiert, ein Bild im Ordner ist das Cover). Ablage
    /var/lib/kinderstick/hoerbuecher/hb-<12 hex>/ mit info.json (Titel).
  * Hörspiele aus dem Internet: eine feste Liste ausgewählter, kostenloser Kinder-Podcasts
    öffentlich-rechtlicher Sender (/usr/share/kinderstick/hoerreihen.json). Der Dienst lädt die
    Feeds und reicht Bilder und Audio selbst durch – Firefox spricht nur mit 127.0.0.1, das Kind
    kann so nur die Folgen dieser Reihen hören und nicht im Internet herumklicken.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BUCH_ID = re.compile(r"hb-[0-9a-f]{12}")
REIHEN_ID = re.compile(r"[a-z0-9-]{2,40}")
FOLGEN_ID = re.compile(r"[0-9a-f]{16}")
TYPEN = {
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".m4b": "audio/mp4", ".ogg": "audio/ogg",
    ".opus": "audio/ogg", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
}
AUDIO = {".mp3", ".m4a", ".m4b", ".ogg", ".opus"}
BILD = {".jpg", ".jpeg", ".png"}
MAX_DATEI = 2_000_000_000        # Bytes je Datei
RESERVE = 3_000_000_000          # so viel bleibt immer frei – System-Updates brauchen Platz
MAX_BUECHER = 200
FEED_GUELTIG = 6 * 3600          # Feeds höchstens alle 6 Stunden neu laden
MAX_FEED_BYTES = 15_000_000
MAX_BILD_BYTES = 3_000_000
MAX_FOLGEN = 80                  # neueste Folgen je Reihe
AGENT = "Kinderstick/1.0 (Hoerbuecher)"
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"


def _sortierschluessel(name):
    """„Kapitel 2“ vor „Kapitel 10“ (Zahlen als Zahlen vergleichen)."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def dateiname_saeubern(name):
    """Nur der Dateiname, ohne Pfad und ohne Sonderzeichen; None, wenn der Typ nicht erlaubt ist."""
    name = os.path.basename(str(name).replace("\\", "/")).strip()
    stamm, endung = os.path.splitext(name)
    endung = endung.lower()
    if endung not in TYPEN:
        return None
    stamm = re.sub(r"[^\w .()\-]", "_", stamm, flags=re.UNICODE).strip(" .")[:100] or "datei"
    return stamm + endung


def _passt_zum_typ(endung, anfang):
    """Prüft die ersten Bytes – damit landen nur echte Audio-/Bilddateien auf dem Stick."""
    if endung == ".mp3":
        return anfang.startswith(b"ID3") or (len(anfang) > 1 and anfang[0] == 0xFF and anfang[1] & 0xE0 == 0xE0)
    if endung in (".m4a", ".m4b"):
        return anfang[4:8] == b"ftyp"
    if endung in (".ogg", ".opus"):
        return anfang.startswith(b"OggS")
    if endung in (".jpg", ".jpeg"):
        return anfang.startswith(b"\xff\xd8\xff")
    if endung == ".png":
        return anfang.startswith(b"\x89PNG")
    return False


def _laden(url, max_bytes):
    anfrage = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(anfrage, timeout=20) as antwort:
        daten = antwort.read(max_bytes + 1)
    if len(daten) > max_bytes:
        raise ValueError("zu groß")
    return daten


def _text(element, pfad):
    gefunden = element.find(pfad)
    return (gefunden.text or "").strip() if gefunden is not None and gefunden.text else ""


def _dauer(text):
    """itunes:duration („1:02:03“, „12:30“ oder Sekunden) → Sekunden."""
    try:
        sekunden = 0
        for teil in text.strip().split(":"):
            sekunden = sekunden * 60 + int(float(teil))
        return sekunden
    except ValueError:
        return 0


def feed_lesen(xml):
    """RSS-Feed → {titel, bild, folgen: [{id, titel, url, dauer}]} (nur https-Audio)."""
    wurzel = ET.fromstring(xml)
    kanal = wurzel.find("channel")
    if kanal is None:
        raise ValueError("kein RSS")
    bild = _text(kanal, "image/url")
    itunes_bild = kanal.find(ITUNES + "image")
    if itunes_bild is not None and itunes_bild.get("href"):
        bild = itunes_bild.get("href")
    folgen = []
    for eintrag in kanal.findall("item"):
        anhang = eintrag.find("enclosure")
        if anhang is None:
            continue
        url = (anhang.get("url") or "").strip()
        typ = (anhang.get("type") or "").lower()
        if not url.startswith("https://") or not (typ.startswith("audio/") or url.split("?")[0].endswith((".mp3", ".m4a"))):
            continue
        folgen.append({
            "id": hashlib.sha256(url.encode()).hexdigest()[:16],
            "titel": _text(eintrag, "title")[:200] or "Folge",
            "url": url,
            "dauer": _dauer(_text(eintrag, ITUNES + "duration")),
        })
        if len(folgen) >= MAX_FOLGEN:
            break
    return {"titel": _text(kanal, "title")[:120], "bild": bild if bild.startswith("https://") else "",
            "folgen": folgen}


class Hoeren:
    def __init__(self, ordner, reihen_datei):
        self.ordner = Path(ordner)
        self.sperre = threading.Lock()
        try:
            with open(reihen_datei, encoding="utf-8") as f:
                self.reihen = [r for r in json.load(f) if REIHEN_ID.fullmatch(r.get("id", ""))]
        except (OSError, ValueError):
            self.reihen = []
        self.feeds = {}    # reihen-id -> (zeitpunkt, feed)
        self.bilder = {}   # reihen-id -> (zeitpunkt, bytes, typ)

    # ------------------------------------------------------------ eigene Hörbücher

    def frei(self):
        """Bytes, die noch für Hörbücher verwendet werden können (Reserve abgezogen)."""
        self.ordner.mkdir(mode=0o700, parents=True, exist_ok=True)
        return max(0, shutil.disk_usage(self.ordner).free - RESERVE)

    def buecher(self):
        ergebnis = []
        if not self.ordner.is_dir():
            return ergebnis
        for ordner in self.ordner.iterdir():
            if not (ordner.is_dir() and BUCH_ID.fullmatch(ordner.name)):
                continue
            try:
                info = json.loads((ordner / "info.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                info = {}
            dateien = sorted((p for p in ordner.iterdir() if p.suffix.lower() in TYPEN),
                             key=lambda p: _sortierschluessel(p.name))
            kapitel = [p.name for p in dateien if p.suffix.lower() in AUDIO]
            bilder = [p.name for p in dateien if p.suffix.lower() in BILD]
            ergebnis.append({
                "id": ordner.name,
                "titel": info.get("titel") or "Hörbuch",
                "kapitel": kapitel,
                "cover": bilder[0] if bilder else None,
                "bytes": sum(p.stat().st_size for p in dateien),
                "erstellt": info.get("erstellt", 0),
            })
        ergebnis.sort(key=lambda b: _sortierschluessel(b["titel"]))
        return ergebnis

    def buch_neu(self, titel):
        titel = str(titel or "").strip()
        if not 1 <= len(titel) <= 80:
            return 400, {"fehler": "Bitte einen Titel mit 1 bis 80 Zeichen eingeben."}
        with self.sperre:
            self.ordner.mkdir(mode=0o700, parents=True, exist_ok=True)
            if sum(1 for _ in self.ordner.iterdir()) >= MAX_BUECHER:
                return 400, {"fehler": "Es sind schon sehr viele Hörbücher auf dem Stick."}
            neu = "hb-" + secrets.token_hex(6)
            (self.ordner / neu).mkdir(mode=0o755)
            (self.ordner / neu / "info.json").write_text(
                json.dumps({"titel": titel, "erstellt": int(time.time())}, ensure_ascii=False), encoding="utf-8")
        return 200, {"ok": True, "id": neu}

    def buch_loeschen(self, buch):
        if not isinstance(buch, str) or not BUCH_ID.fullmatch(buch) or not (self.ordner / buch).is_dir():
            return 404, {"fehler": "Dieses Hörbuch gibt es nicht."}
        shutil.rmtree(self.ordner / buch, ignore_errors=True)
        return 200, {"ok": True}

    def datei_speichern(self, buch, name, laenge, lesen):
        """Speichert eine hochgeladene Datei; lesen(n) liefert die nächsten n Bytes der Anfrage."""
        if not isinstance(buch, str) or not BUCH_ID.fullmatch(buch) or not (self.ordner / buch).is_dir():
            return 404, {"fehler": "Dieses Hörbuch gibt es nicht."}
        sauber = dateiname_saeubern(name)
        if not sauber:
            return 400, {"fehler": "Nur MP3-, M4A/M4B-, OGG-Dateien und Bilder (JPG, PNG)."}
        if not 0 < laenge <= MAX_DATEI:
            return 413, {"fehler": "Die Datei ist zu groß (höchstens 2 GB)."}
        if laenge > self.frei():
            return 507, {"fehler": "Auf dem Stick ist nicht mehr genug Platz."}
        ziel = self.ordner / buch / sauber
        tmp = self.ordner / buch / (".upload-" + secrets.token_hex(4))
        try:
            with open(tmp, "wb") as f:
                rest = laenge
                erster = True
                while rest > 0:
                    stueck = lesen(min(rest, 1 << 20))
                    if not stueck:
                        raise ConnectionError("Übertragung abgebrochen")
                    if erster and not _passt_zum_typ(ziel.suffix.lower(), stueck[:16]):
                        tmp.unlink(missing_ok=True)
                        return 400, {"fehler": f"„{sauber}“ ist keine passende Audio- oder Bilddatei."}
                    erster = False
                    f.write(stueck)
                    rest -= len(stueck)
            os.chmod(tmp, 0o644)
            os.replace(tmp, ziel)
        except (OSError, ConnectionError) as fehler:
            tmp.unlink(missing_ok=True)
            return 500, {"fehler": f"Speichern fehlgeschlagen: {fehler}"}
        return 200, {"ok": True, "name": sauber}

    def datei_pfad(self, buch, name):
        """Pfad einer Hörbuch-Datei oder None (nur gültige Namen innerhalb des Ordners)."""
        if not BUCH_ID.fullmatch(buch) or dateiname_saeubern(name) != name:
            return None
        pfad = self.ordner / buch / name
        return pfad if pfad.is_file() else None

    # ------------------------------------------------------------ Hörspiele aus dem Internet

    def reihe(self, reihen_id):
        """Feed einer Reihe (zwischengespeichert); None bei unbekannter Reihe, ValueError/OSError bei Fehler."""
        eintrag = next((r for r in self.reihen if r["id"] == reihen_id), None)
        if not eintrag:
            return None
        with self.sperre:
            zwischen = self.feeds.get(reihen_id)
        if zwischen and time.time() - zwischen[0] < FEED_GUELTIG:
            return zwischen[1]
        try:
            feed = feed_lesen(_laden(eintrag["feed"], MAX_FEED_BYTES))
        except (OSError, ValueError, ET.ParseError):
            if zwischen:
                return zwischen[1]   # lieber alte Liste als gar keine
            raise
        with self.sperre:
            self.feeds[reihen_id] = (time.time(), feed)
        return feed

    def folge_url(self, reihen_id, folgen_id):
        if not FOLGEN_ID.fullmatch(folgen_id):
            return None
        try:
            feed = self.reihe(reihen_id)
        except (OSError, ValueError, ET.ParseError):
            return None
        if not feed:
            return None
        return next((f["url"] for f in feed["folgen"] if f["id"] == folgen_id), None)

    def reihen_bild(self, reihen_id):
        """(bytes, typ) des Reihen-Bildes oder None."""
        with self.sperre:
            zwischen = self.bilder.get(reihen_id)
        if zwischen and time.time() - zwischen[0] < FEED_GUELTIG:
            return zwischen[1], zwischen[2]
        try:
            feed = self.reihe(reihen_id)
            if not feed or not feed["bild"]:
                return None
            daten = _laden(feed["bild"], MAX_BILD_BYTES)
        except (OSError, ValueError, ET.ParseError):
            return (zwischen[1], zwischen[2]) if zwischen else None
        typ = "image/png" if daten.startswith(b"\x89PNG") else "image/jpeg" if daten.startswith(b"\xff\xd8") else None
        if not typ:
            return None
        with self.sperre:
            self.bilder[reihen_id] = (time.time(), daten, typ)
        return daten, typ


def audio_oeffnen(url, bereich):
    """Öffnet eine Folge beim Sender, auf Wunsch ab einer Stelle (Range-Kopf wird weitergegeben)."""
    kopf = {"User-Agent": AGENT}
    if bereich and re.fullmatch(r"bytes=\d*-\d*", bereich):
        kopf["Range"] = bereich
    return urllib.request.urlopen(urllib.request.Request(url, headers=kopf), timeout=20)
