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
| 5 | `systemd-run --user -M kind@.host` startet Apps sichtbar in der Kiosk-Sitzung (WAYLAND_DISPLAY im Benutzerdienst vorhanden) | App-Kachel antippen |
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
