# Technik Phase 1 – Stick-Image

Stand: 20.11.2026 · Status: **Grundgerüst geschrieben, noch nie gebaut oder getestet.**
Geschrieben auf einem Windows-Rechner ohne Linux/Python – Bau per GitHub Actions, Test auf einem separaten Test-Laptop.
Geprüft wurden nur: JavaScript-Syntax (`node --check`), JSON-Dateien, Unix-Zeilenenden.

---

## Aufbau

```
Laptop startet vom Stick (Einmal-Boot-Menü)
 └─ Fedora Silverblue (bootc-Image, GNOME 50)
     ├─ kinderstick-erststart.service   legt beim 1. Start Konten „kind“ und „eltern“ an
     ├─ GDM: automatische Anmeldung „kind“ → Sitzung gnome-kiosk-script-wayland
     │    └─ ~/.local/bin/gnome-kiosk-script → Firefox --kiosk http://127.0.0.1:8411/
     │         └─ Kinder-Oberfläche (Web-App, oberflaeche/)
     ├─ kinderstick-dienst.service      (Python, root, nur 127.0.0.1:8411)
     │    ├─ liefert Oberfläche aus, Einrichtung, Eltern-Bereich (PIN)
     │    ├─ zählt Nutzungszeit (loginctl: Sitzung „kind“ aktiv), Tageslimit, Schlafenszeit
     │    ├─ startet Apps im Kinderkonto (systemd-run --user -M kind@.host)
     │    └─ beendet Apps bei Sperre (pkill), WLAN über nmcli, Abmelden über loginctl
     ├─ Apps: GCompris, Tux Paint, Lernfenster (GTK4/WebKit, nur erlaubte Domains)
     ├─ Firefox-Richtlinien: nur 127.0.0.1:8411 erreichbar, keine Erweiterungen/Entwicklerwerkzeuge
     ├─ udev-Regel: interne Laufwerke ausgeblendet (UDISKS_IGNORE)
     └─ Updates: bootc upgrade (nur herunterladen, aktiv beim nächsten Start)
```

| Pfad im Projekt | Ziel im Image |
| --- | --- |
| `image/Containerfile` | Bauanleitung |
| `image/dateien/…` | 1:1 nach `/` |
| `dienst/kinderstick_dienst.py` | `/usr/lib/kinderstick/kinderstick_dienst.py` |
| `oberflaeche/` | `/usr/share/kinderstick/oberflaeche/` |
| `image/dateien/usr/share/kinderstick/apps.json` | App-Liste (Kacheln) |
| Daten zur Laufzeit | `/var/lib/kinderstick/` (einstellungen.json, nutzung.json; nur root) |

**Daten auf dem Stick (unverschlüsselt, bewusst unkritisch):** Vorname, Schulstufe, Zeiten, App-Freigaben, Nutzungsminuten pro Tag (60 Tage), PIN als scrypt-Hash. Keine Verläufe, keine Inhalte. Elternpasswort nur als System-Hash (`/etc/shadow`).

---

## Ungetestete Annahmen – beim ersten Bau/Test prüfen

| # | Annahme | Prüfen |
| --- | --- | --- |
| 1 | ✅ **Bestätigt (Bau 20.11.2026):** `quay.io/fedora-ostree-desktops/silverblue:45` existiert, alle Pakete installierbar, `bootc container lint` ohne Fehler | – |
| 2 | ✅ **Geprüft 20.11.2026** (packages.fedoraproject.org): `gnome-kiosk-script-session`, `gcompris-qt`, `tuxpaint`, `tuxmath`, `tuxtype2` (nicht „tuxtype“), `klettres`, `ktuberling`, `blinken`, `webkitgtk6.0`, `espeak-ng` gibt es für Fedora 44. Offen: Befehlsnamen von gcompris-qt, tuxmath, klettres, ktuberling, blinken (bestätigt nur `tuxtype` aus Paket tuxtype2) sowie Option `--fullscreen` bei tuxmath | Bau, App-Start |
| 3 | ✅ **Geprüft 20.11.2026:** Sitzungsdatei `/usr/share/wayland-sessions/gnome-kiosk-script-wayland.desktop`, Skriptpfad `~/.local/bin/gnome-kiosk-script` | – |
| 4 | GDM meldet nur beim Hochfahren automatisch an; nach dem Abmelden erscheint der Anmeldebildschirm | Test „Kinder-Modus beenden“ |
| 5 | ✅ **Bestätigt (2. Test 25.11.2026):** Oberfläche erscheint, Kacheln starten Programme. Programme öffneten sich aber **nicht im Vollbild** → `/usr/share/gnome-kiosk/window-config.ini` (`match-window-type=normal`, `set-fullscreen=true`), Lernfenster `fullscreen()`. ANTON: „Temporary failure in name resolution“ = kein Internet (WLAN nicht verbunden?) → Lernfenster zeigt jetzt eine kindgerechte Meldung. Ursprünglich: `systemd-run --user -M kind@.host` startet Apps sichtbar in der Kiosk-Sitzung (WAYLAND_DISPLAY im Benutzerdienst vorhanden) | App-Kachel antippen |
| 6 | Apps erscheinen unter gnome-kiosk vor Firefox und nach dem Schließen ist Firefox wieder sichtbar | Test |
| 7 | ✅ **Bestätigt (1. Test 24.11.2026):** Firefox liest `/etc/firefox/policies/policies.json` – aber die Ausnahme `http://127.0.0.1:8411/*` griff nicht (Firefox unterstützt **keine Ports** in Match-Patterns, MDN), daher „Blocked Page“ statt Oberfläche. Korrigiert auf `http://127.0.0.1/*` | Oberfläche erscheint nach Neubau |
| 8 | Web Speech API (Vorlesen) funktioniert in Firefox mit speech-dispatcher + espeak-ng; deutsche Stimme | Kachel antippen |
| 9 | `bootc-fetch-apply-updates.service` existiert im Silverblue-Image (sonst rpm-ostreed-automatic konfigurieren) | `systemctl cat bootc-fetch-apply-updates.service` |
| 10 | Teilweise bestätigt (1. Test 24.11.2026, privater Laptop, Secure Boot an): Stick startet, Kiosk-Sitzung mit Firefox erscheint. Im Bootmenü gab es keinen „USB“-Eintrag – gestartet über „Von EFI-Datei starten“ → `EFI/fedora/shimx64.efi`; `EFI/BOOT/BOOTX64.EFI` (Fallback-Pfad) startete **nicht** – klären (Fallback/fbx64, Bootmenü-Eintrag), sonst ist der Start für Eltern zu kompliziert. Ursprünglich: `bootc install to-disk --generic-image --filesystem btrfs` erzeugt einen Stick, der auf fremden Laptops mit Secure Boot startet | Test auf ≥ 10 Laptops |
| 11 | Lernfenster: ANTON funktioniert, obwohl nur Navigation (nicht Unterressourcen) auf anton.app beschränkt ist; Anmeldung bleibt gespeichert | Test |
| 13 | KLettres: Laut offenem KDE-Fehlerbericht 262015 spricht die deutsche Stimme Buchstabennamen („Emm“) statt Laute („Mmm“) – für Leseanfänger in der Volksschule ungünstig | Mit Kind testen, ggf. Kachel ersetzen |
| 14 | ✅ **Umgestellt 20.11.2026:** Image nutzt Fedora 45 (GNOME 51); alle Pakete laut packages.fedoraproject.org für F45 vorhanden. Offen: Tag `silverblue:45` auf quay.io | Bau |
| 15 | bootc-image-builder erzeugt mit `--type raw --rootfs btrfs` ein Abbild, das auf fremden UEFI-Laptops mit Secure Boot startet; Root-Dateisystem wächst beim ersten Start auf die Stick-Größe | Bau, Test auf 64-GB-Stick (`df -h /`) |
| 16 | ✅ **Bestätigt (Bau 20.11.2026):** Abbild `disk.raw` 15 GB (Root-Dateisystem btrfs 12,8 GiB), komprimiert 3,0 GB, als Artefakt hochgeladen. Passt auf Sticks ab 16 GB; ob das Root-Dateisystem auf größeren Sticks mitwächst, ist noch offen (#15) | – |
| 12 | Uhrzeit: Laptop-Uhr (RTC) und Zeitzone stimmen; bei Windows-Laptops läuft die RTC oft in Ortszeit → Zeitlimits/Schlafenszeit verschoben, bis NTP synchronisiert | Test ohne/mit WLAN |

---

## Test-Checkliste (separater Test-Laptop, nie ein Arbeitsgerät)

1. GitHub-Ablauf grün (Prüfen + Bauen).
2. Stick schreiben: `sudo IMAGE=ghcr.io/<besitzer>/kinderstick:latest ./werkzeuge/stick-schreiben.sh /dev/sdX`.
3. Test-Laptop über Einmal-Boot-Menü starten, **Secure Boot an**.
4. Einrichtungsassistent erscheint → ausfüllen → Startseite mit Name und Kacheln.
5. Kacheln: GCompris, Tux Paint, ANTON starten und wieder schließen.
6. Zeitlimit testen: im Eltern-Bereich Limit auf 1 Minute setzen → nach ≤ 1,5 min Sperrbildschirm, laufende App wird beendet.
7. Bonuszeit +15 → Sperre aufgehoben.
8. Schlafenszeit auf „jetzt“ setzen → Sperrbildschirm „Schlafenszeit“.
9. PIN 5× falsch → 5 Minuten Sperre.
10. WLAN im Eltern-Bereich verbinden; ANTON lädt.
11. „Kinder-Modus beenden“ → Anmeldebildschirm → Elternkonto anmelden → interne Laufwerke **nicht** sichtbar (Dateien-App).
12. Neustart → automatisch wieder Kinderkonto.
13. Stick abziehen, Laptop normal starten → **Windows unverändert**, kein BitLocker-Wiederherstellungsdialog.
14. Manipulation: Alt+F4/Strg+W in Firefox (startet neu), Strg+Alt+F3 (Textkonsole – braucht Passwort), Alt+Tab, Uhrzeit ändern (nicht möglich ohne Elternpasswort).

---

## Entwicklung der Oberfläche ohne Stick (auf einem privaten Rechner mit Python 3)

```
KS_TESTMODUS=1 KS_DATEN=./testdaten KS_OBERFLAECHE=./oberflaeche \
KS_APPS=./image/dateien/usr/share/kinderstick/apps.json python3 dienst/kinderstick_dienst.py
```
Dann im Browser `http://127.0.0.1:8411/` öffnen. Im Testmodus werden keine Systembefehle ausgeführt (App-Start, WLAN, Passwort nur als Ausgabe). Testdaten liegen in `./testdaten/` (in `.gitignore`).

---

## Technisch offen

- Fedora-Branding ersetzen (Logos, Name im Boot-Menü/Anmeldebildschirm; Paket `generic-logos`, eigener `os-release`-Name) – Fedora-Markenrichtlinien.
- Image signieren (cosign) und Updates nur signiert annehmen.
- Registry: Image öffentlich machen oder Zugangsdaten für `bootc upgrade` auf dem Stick hinterlegen (GHCR-Pakete sind standardmäßig privat).
- Lizenzhinweise (GPL-Quellen).

---

## Änderungen nach dem 2. Hardware-Test (26.11.2026)

- **Ausschalten:** Knopf ⏻ unten links auf der Startseite (mit Rückfrage) und im Eltern-Bereich → `POST /api/ausschalten` → `systemctl poweroff`.
- **Hintergrund-Galerie:** Knopf 🖼️ unten links; eigene SVG-Szenen in `oberflaeche/hintergruende/` (Eispalast, Savanne, Unterwasser, Weltraum, Regenbogen) → `POST /api/hintergrund`, gespeichert in `einstellungen.json`. **Keine Disney- oder andere geschützte Figuren** (Urheber-/Markenrecht – für ein Produkt nur mit Lizenz).
- **Vollbild:** gnome-kiosk-Fensterregeln (`image/dateien/usr/share/gnome-kiosk/window-config.ini`).
- **Start über EFI/BOOT (Stufe 1):** `image/efi-direktstart.sh` entfernt `fbx64.efi` aus dem Fallback-Pfad und legt `grubx64.efi` daneben → Stick erscheint als normaler USB-Eintrag, kein Firmware-Eintrag „Fedora“. Kontrolle im Bau-Protokoll („EFI-Bereich des Abbilds anzeigen“). **Ungetestet.**
- **Immer vom Stick starten (Stufe 2):** nur über die Startreihenfolge im BIOS des jeweiligen Laptops („USB zuerst“) – setzt Stufe 1 voraus.

---

## Änderungen nach dem 3. Hardware-Test (27.11.2026)

- **Vorlesen aus** (`VORLESEN_AKTIV = false` in `gemeinsam.js`); speech-dispatcher/espeak-ng entfernt.
- **Programme ersetzt:** Tux Paint, Tux Math, Tux Typing, KLettres, KTuberling, Blinken entfernt (ging nicht bzw. nicht kindgerecht). Neu als **eigene Programme der Oberfläche** (`oberflaeche/apps/`, laufen auch in der Vorschau): Malen, Rechnen, Buchstaben, Merkspiel. Sie passen sich an die Schulstufe an (`schulstufe` in `/api/status`). Apps mit `"seite"` in `apps.json` öffnet die Startseite selbst; `app.js` kehrt bei Sperre automatisch zurück.
- **GCompris nach Klasse:** `--difficulty 1-3 / 2-4 / 3-5 / 4-6` (Feld `optionen_nach_klasse`), dazu `--fullscreen --enable-kioskmode`.
- **Lernfenster:** „Fertig“-Knopf im Inhalt statt in der Titelleiste (im Vollbild blendet GTK die Titelleiste aus – man kam aus ANTON nicht mehr heraus).
- **Uhrzeit:** `/etc/adjtime` = `LOCAL` (Hardware-Uhr von Windows-Laptops läuft in Ortszeit; vorher ging der Stick ohne WLAN 1 h vor → Schlafenszeit zu früh). Einrichtung zeigt die Uhrzeit des Laptops und warnt, wenn sofort Schlafenszeit wäre.
- **App-Freigaben:** gespeichert wird `gesperrte_apps` (neue Apps nach Updates sind frei) bzw. `freigeschaltete_apps` für Apps mit `"standard_aus"`.
- **Netflix und Disney+** (`standard_aus`, erst nach Freischaltung im Eltern-Bereich): `/usr/libexec/kinderstick/videofenster` (seit Test 4: `fertigfenster --video`) startet einen eigenen Firefox (eigenes Profil, Kiosk) und einen kleinen „⬅ Fertig“-Knopf oben links (gnome-kiosk-Regel `match-title=Kinderstick-Fertig`, `set-above`). Firefox-Richtlinien: Website-Filter-Ausnahmen `*.netflix.com`, `*.disneyplus.com`, `registerdisney.go.com`; `EncryptedMediaExtensions` an (Widevine). **Ungetestet:** Widevine-Nachladen im Kiosk-Firefox, Disney+-Anmeldung (evtl. weitere Domains nötig), Bildqualität unter Linux (vermutlich max. 720p). Eltern sperren die Erwachsenen-Profile selbst mit Profil-PIN. Kein Netflix-/Disney-Logo verwenden, nicht mit den Marken werben.

## Änderungen nach dem 4. Hardware-Test (27.11.2026)

Ergebnis Test 4: eigene Programme passen. Probleme: Lernspiele nicht zu beenden, Netflix/Disney+ auf Englisch, kein „@“ im Browser, Ausschalten tat nichts, „Fertig“-Knopf lag zeitweise über dem Namen des Kindes.

- **`fertigfenster`** (ersetzt `videofenster`): startet ein Programm (`-- befehl …`) oder einen Streamingdienst (`--video name --start url`) mit dem kleinen „⬅ Fertig“-Knopf. Jetzt auch für **GCompris** (im Kiosk-Modus ohne eigenen Beenden-Knopf). Programm läuft in eigener Prozessgruppe, wird beim Beenden komplett gestoppt. Knopf erscheint erst nach 2,5 s; die Startseite zeigt beim Start eines Programms ein Ladebild („… wird geöffnet“), bis sie den Fokus zurückbekommt (spätestens nach 30 s).
- **Sprache:** Firefox-Richtlinien `RequestedLocales: de`, `intl.accept_languages = de-AT, de-DE, de, en` (gesperrt), deutsches Sprachpaket von der Erweiterungssperre ausgenommen. Startadressen direkt zur Anmeldung: `netflix.com/login`, `disneyplus.com/login` (Disney-Adresse ungeprüft).
- **Tastatur:** Layout `at` / `nodeadkeys` dreifach: dconf (`at+nodeadkeys`), `/etc/X11/xorg.conf.d/00-keyboard.conf` (localed), `/etc/environment.d/90-kinderstick-tastatur.conf` (`XKB_DEFAULT_LAYOUT`). Vermutung: gnome-kiosk lief mit US-Layout (AltGr+Q ergab kein „@“).
- **Ausschalten:** `systemctl poweroff --check-inhibitors=no`, Rückfall `systemctl start poweroff.target --job-mode=replace-irreversibly`; Fehler gehen ins Journal (`journalctl -u kinderstick-dienst`).
- **Ton:** Knopf 🔊 auf der Startseite (`/api/lautstaerke`, `wpctl` im Kinderkonto über `runuser`). Kopfhörer mit Kabel schaltet PipeWire selbst um. **Bluetooth-Kopfhörer** im Eltern-Bereich koppeln (`bluetoothctl`: suchen 8 s, `pair` mit Agent NoInputNoOutput, `trust`, `connect`); danach verbinden sie sich selbst.
- **Eigene Hintergründe:** Eltern laden Bilder hoch (im Browser auf max. 1920 × 1080 JPEG verkleinert), das Kind setzt gemalte Bilder (Malen, 🏞️) und Kamera-Fotos als Hintergrund. Ablage `/var/lib/kinderstick/hintergruende/eigen-*.jpg`, höchstens 20, Auslieferung über `/eigene-hintergruende/…`.
- **Neues Programm Kamera** (`apps/kamera.html`): „Blasen platzen“ (Bewegungserkennung über Bilddifferenz 64 × 48, auch Antippen), „Zauberspiegel“ (Effekte, Sticker, Foto mit Countdown), „Meine Fotos“. Kamera-Freigabe per Firefox-Richtlinie `Permissions.Camera.Allow` nur für `http://127.0.0.1:8411`; Mikrofon, Standort, Benachrichtigungen gesperrt. Bilder bleiben lokal.
- **Ungetestet:** ob die Tastatur jetzt stimmt, Dateiauswahl von USB-Sticks im Kiosk-Firefox (gvfs/udisks), Bluetooth-Koppeln aus dem Dienst heraus, Kamera-Zugriff im Kiosk.

## Änderungen nach dem 5. Hardware-Test (27.11.2026)

Ergebnis Test 5: insgesamt gut. Probleme: Ausschalten tat wieder nichts (Startseite und Eltern-Bereich), Kamera meldete „nicht erlaubt“ (NotAllowedError), „Fertig“ bei den Lernspielen wirkte wie eine eigene Kachel statt einer Leiste wie bei ANTON.

- **Einheitliche Kopfleiste** (`/usr/lib/kinderstick/kopfleiste.py`, GTK 4): links „⬅ Fertig“, dann der Programmname, rechts die Restzeit (Balken grün → gelb ab 10 min → rot ab 5 min, alle 30 s von `/api/status`) und ▲ zum Einklappen. Eingeklappt bleibt nur die Lasche ▼ oben in der Mitte.
  - **ANTON** (`lernfenster`): Leiste im Fenster, Lasche als `Gtk.Overlay` über der Seite.
  - **Lernspiele, Netflix, Disney+** (`fertigfenster --titel …`): eigenes Fenster über die ganze Bildschirmbreite (gnome-kiosk-Regel `match-title=Kinderstick-Leiste`, `set-x=0`, `set-y=0`, `set-above`), das Programm läuft darunter im Vollbild. Ausgeklappt verdeckt die Leiste die obersten 76 px des Programms. Eingeklappt wird das Fenster durchsichtig, und der Eingabebereich (`Gdk.Surface.set_input_region`, cairo) umfasst nur die Lasche, so gehen alle anderen Klicks an das Programm. Ohne python3-cairo fehlt der Knopf ▲.
  - **Eigene Programme:** Restzeit-Balken rechts in der vorhandenen Kopfzeile (`KsApp.zeitZeigen`). Einklappen ist dort nicht nötig.
- **Ausschalten in Stufen:** `poweroff --check-inhibitors=no` → `start poweroff.target --job-mode=replace-irreversibly` → `poweroff --force` → `poweroff --force --force`. Die nächste Stufe kommt jeweils, wenn der Rechner nach 20 s noch läuft; vorher läuft `sync`. Fehlertexte stehen in `/api/status` als `ausschalt_fehler`. Startseite und Eltern-Bereich zeigen sie nach 25 s rot an, mit dem Hinweis, notfalls den Ein-Knopf lange zu drücken.
- **Kamera:** Firefox-Einstellung `media.webrtc.camera.allow-pipewire = false` (gesperrt). Vermutung: Firefox fragte die Kamera über das PipeWire-Portal an, im Kiosk gibt es keinen Rückfrage-Dialog, also kam die Ablehnung. Mit `false` greift Firefox direkt über V4L2 zu. Die Fehlermeldung im Spiel nennt jetzt den Fehlernamen.
- **Ungetestet:** ob GTK den Eingabebereich beibehält (er wird alle 2 s neu gesetzt) und ob mutter das Verkleinern der Leiste annimmt; ob die Leiste über GCompris (Qt-Vollbild) und Firefox-Kiosk oben bleibt; welche Ausschalt-Stufe wirkt.
