"""Kinder-Stick – gemeinsame Kopfleiste für Programmfenster (Lernfenster, Fertigfenster).

Links „⬅ Fertig“, daneben der Programmname, rechts die Restzeit als Balken und ein Knopf ▲ zum
Einklappen. Eingeklappt bleibt nur eine kleine Lasche „▼“ oben in der Mitte, das Programm ist
sonst ganz im Vollbild; ein Druck auf die Lasche holt die Leiste zurück.
Die Restzeit kommt alle 30 Sekunden vom Dienst (127.0.0.1:8411/api/status).
"""
import json
import threading
import urllib.request

import gi

gi.require_version("Gtk", "4.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402

DIENST = "http://127.0.0.1:8411/api/status"

CSS = """
.ks-leiste { background: #1B4332; padding: 8px 16px; }
.ks-leiste .ks-titel { color: white; font-size: 24px; font-weight: bold; }
.ks-leiste .ks-zeit { color: white; font-size: 20px; font-weight: bold; }
button.ks-fertig { font-size: 22px; font-weight: bold; padding: 8px 26px; border-radius: 16px;
                   background: #FFB627; color: #1B4332; }
button.ks-klappen { font-size: 20px; padding: 6px 18px; border-radius: 14px;
                    background: rgba(255, 255, 255, 0.18); color: white; }
levelbar.ks-zeitbalken trough { min-height: 16px; min-width: 180px; border-radius: 8px;
                                background: rgba(255, 255, 255, 0.25); }
levelbar.ks-zeitbalken block.filled { border-radius: 8px; background: #6BCB77; }
levelbar.ks-zeitbalken block.empty { background: transparent; }
levelbar.ks-zeitbalken.knapp block.filled { background: #FFB627; }
levelbar.ks-zeitbalken.fast-aus block.filled { background: #F26B5B; }
button.ks-lasche { font-size: 20px; font-weight: bold; padding: 2px 30px; border-radius: 0 0 18px 18px;
                   background: #1B4332; color: white; }
"""


def stil_laden():
    stil = Gtk.CssProvider()
    stil.load_from_string(CSS)   # ab GTK 4.12
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(), stil, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)


class Kopfleiste(Gtk.Box):
    """Die Leiste selbst. beim_fertig() beendet das Programm, beim_klappen(True/False) klappt."""

    def __init__(self, titel, beim_fertig, beim_klappen):
        super().__init__(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        self.add_css_class("ks-leiste")

        fertig = Gtk.Button(label="⬅  Fertig")
        fertig.add_css_class("ks-fertig")
        fertig.connect("clicked", lambda *_: beim_fertig())
        self.append(fertig)

        name = Gtk.Label(label=titel, xalign=0, hexpand=True)
        name.add_css_class("ks-titel")
        self.append(name)

        self.zeit = Gtk.Label(label="")
        self.zeit.add_css_class("ks-zeit")
        self.append(self.zeit)
        self.balken = Gtk.LevelBar(min_value=0, max_value=1, value=1, valign=Gtk.Align.CENTER)
        self.balken.add_css_class("ks-zeitbalken")
        # Eigene Farben statt der Standard-Stufen von GTK
        for stufe in (Gtk.LEVEL_BAR_OFFSET_LOW, Gtk.LEVEL_BAR_OFFSET_HIGH, Gtk.LEVEL_BAR_OFFSET_FULL):
            self.balken.remove_offset_value(stufe)
        self.balken.set_visible(False)
        self.append(self.balken)

        klappen = Gtk.Button(label="▲")
        klappen.add_css_class("ks-klappen")
        klappen.set_tooltip_text("Leiste einklappen")
        klappen.connect("clicked", lambda *_: beim_klappen(True))
        self.klappen = klappen
        self.append(klappen)

        self.zeit_holen()
        GLib.timeout_add_seconds(30, self.zeit_holen)

    def zeit_holen(self):
        def holen():
            try:
                with urllib.request.urlopen(DIENST, timeout=3) as antwort:
                    s = json.load(antwort)
                GLib.idle_add(self.zeit_zeigen, int(s.get("rest_minuten", 0)), int(s.get("limit_minuten", 0)))
            except (OSError, ValueError):
                pass   # Dienst kurz nicht erreichbar – Anzeige bleibt
        threading.Thread(target=holen, daemon=True).start()
        return True

    def zeit_zeigen(self, rest, limit):
        if limit <= 0:
            self.zeit.set_label("")
            self.balken.set_visible(False)
            return False
        self.zeit.set_label(f"⏳ noch {rest} Min." if rest != 1 else "⏳ noch 1 Min.")
        self.balken.set_value(max(0.0, min(1.0, rest / limit)))
        self.balken.set_visible(True)
        for klasse, an in (("knapp", 5 < rest <= 10), ("fast-aus", rest <= 5)):
            (self.balken.add_css_class if an else self.balken.remove_css_class)(klasse)
        return False


def lasche(beim_klappen):
    """Kleine Lasche oben in der Mitte, holt die eingeklappte Leiste zurück."""
    knopf = Gtk.Button(label="▼", halign=Gtk.Align.CENTER, valign=Gtk.Align.START)
    knopf.add_css_class("ks-lasche")
    knopf.set_tooltip_text("Leiste zeigen")
    knopf.connect("clicked", lambda *_: beim_klappen(False))
    knopf.set_visible(False)
    return knopf
