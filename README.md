# vs-system

Bootfähiges Linux-System (bootc, Fedora Silverblue 45) mit Kiosk-Oberfläche und lokalem Steuerdienst.

> Frühe Entwicklung, nicht auf echter Hardware getestet.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `image/` | Containerfile und Systemdateien des Images |
| `dienst/` | Lokaler Dienst (Python, nur Standardbibliothek) |
| `oberflaeche/` | Web-Oberfläche des Kiosks |
| `VORSCHAU.html` | Oberfläche im Browser ansehen (Simulation, ohne Installation) |
| `werkzeuge/` | Hilfsskripte |
| `.github/workflows/` | Prüfen, Image bauen, Disk-Abbild erzeugen |
| `doku/` | Technische Hinweise, Test-Checkliste, Schreibanleitung |

## Bauen

Der Ablauf `image-bauen.yml` baut das Image und erzeugt ein Disk-Abbild (`.raw.xz`) als Artefakt.
Schreiben auf einen USB-Stick: [`doku/stick-schreiben-windows.md`](doku/stick-schreiben-windows.md).

## Lizenz

Noch nicht festgelegt. Enthaltene Programme stehen unter ihren eigenen Lizenzen.
