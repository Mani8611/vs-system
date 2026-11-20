# Kinder-Stick unter Windows schreiben (Rufus)

Stand: 20.11.2026 · noch nicht praktisch erprobt.

## Voraussetzungen

- **Administratorrechte** auf dem Windows-Rechner (Rufus schreibt direkt auf das Laufwerk). Auf verwalteten Arbeitsgeräten nur mit Freigabe der IT.
- **Rufus** (rufus.ie) oder **balenaEtcher** (etcher.balena.io) – beide können `.raw.xz`-Abbilder direkt schreiben.
- **USB-Stick:** schnell (USB 3.2, gute Schreib-/Lesewerte oder USB-SSD-Stick), mindestens 64 GB. **Alles darauf wird gelöscht.**
- Das Abbild `kinderstick-JJJJ-MM-TT.raw.xz` und `kinderstick-pruefsumme.txt` aus dem GitHub-Ablauf (Actions → letzter Lauf → Artefakt „kinderstick-abbild“, ZIP entpacken).

## ⚠️ Wichtig: richtiges Laufwerk wählen

Rufus zeigt **alle** USB-Laufwerke an – auch externe Festplatten. **Vor dem Schreiben alle anderen USB-Laufwerke abziehen** (insbesondere externe Festplatten mit Projektdaten), sodass nur der Ziel-Stick angeschlossen ist. Ein falsch gewähltes Laufwerk wird vollständig gelöscht.

## Prüfsumme kontrollieren (optional, empfohlen)

PowerShell im Download-Ordner:

```
Get-FileHash .\kinderstick-*.raw.xz -Algorithm SHA256
```

Der Wert muss mit dem in `kinderstick-pruefsumme.txt` übereinstimmen.

## Schreiben mit Rufus

1. Nur den Ziel-Stick anstecken.
2. Rufus starten (fragt nach Administratorrechten).
3. **Laufwerk:** den USB-Stick wählen – Name und Größe genau prüfen.
4. **Startart:** „Laufwerk oder ISO-Abbild“ → **AUSWAHL** → `kinderstick-….raw.xz` wählen.
5. Übrige Einstellungen unverändert lassen (Rufus erkennt ein fertiges Abbild und schreibt es 1:1).
6. **START** → Warnung „Alle Daten werden gelöscht“ bestätigen.
7. Warten bis „FERTIG“, dann Stick über „Hardware sicher entfernen“ auswerfen.

Windows meldet danach eventuell „Laufwerk muss formatiert werden“ – **nicht formatieren**, einfach schließen. Windows kann das Linux-Dateisystem nicht lesen; das ist normal.

## Testen (anderer Laptop, nie ein Arbeitsgerät)

1. Laptop ausschalten, Stick anstecken.
2. Einschalten und sofort die **Einmal-Boot-Taste** drücken (häufig F12, F9, F8 oder Esc – je nach Hersteller).
3. Den USB-Stick auswählen. **Secure Boot eingeschaltet lassen**, **Bootreihenfolge nicht dauerhaft ändern.**
4. Einrichtungsassistent ausfüllen, danach Test-Checkliste in `doku/technik-phase1.md` abarbeiten.
5. Zum Schluss Stick abziehen und Laptop normal starten – das ursprüngliche System muss unverändert starten.
