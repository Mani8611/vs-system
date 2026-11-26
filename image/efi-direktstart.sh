#!/bin/bash
# Kinder-Stick – nur beim Bau des Images ausgeführt.
#
# Ziel: Der Stick startet über den Standard-Startpfad EFI/BOOT/BOOTX64.EFI direkt das System.
# Dann zeigt jeder Laptop den Stick von selbst als „USB“-Eintrag im Bootmenü, und
# „USB zuerst“ in der Startreihenfolge funktioniert.
#
# Problem (1. Hardware-Test 24.11.2026): Fedoras Shim startet über EFI/BOOT zuerst das
# Fallback-Programm fbx64.efi. Das trägt „Fedora“ fest in die Firmware des Laptops ein und
# startet neu – auf fremden Eltern-Laptops unerwünscht, und der Start klappte nicht.
#
# Lösung: fbx64.efi aus dem Startpfad entfernen und grubx64.efi danebenlegen. Shim lädt dann
# grubx64.efi aus demselben Ordner; GRUB liest seine Konfiguration weiterhin aus EFI/fedora/.
# Die Quelldateien liegen je nach bootupd-Version unter /usr/lib/bootupd/updates oder /usr/lib/efi.
set -euo pipefail

orte=()
for d in /usr/lib/bootupd/updates /usr/lib/efi; do
    [ -d "$d" ] && orte+=("$d")
done
if [ "${#orte[@]}" -eq 0 ]; then
    echo "FEHLER: Keine EFI-Quelldateien gefunden (/usr/lib/bootupd/updates, /usr/lib/efi)." >&2
    exit 1
fi

echo "== EFI-Dateien vorher =="
find "${orte[@]}" -iname '*.efi' -o -iname '*.csv' | sort

grub=$(find "${orte[@]}" -iname grubx64.efi | head -n1)
mm=$(find "${orte[@]}" -iname mmx64.efi | head -n1)
if [ -z "$grub" ]; then
    echo "FEHLER: grubx64.efi nicht gefunden." >&2
    exit 1
fi

anzahl=0
while IFS= read -r boot; do
    [ -f "$boot/BOOTX64.EFI" ] || continue
    rm -fv "$boot/fbx64.efi" "$boot/FBX64.EFI"
    cp -v "$grub" "$boot/grubx64.efi"
    [ -n "$mm" ] && cp -v "$mm" "$boot/mmx64.efi"
    anzahl=$((anzahl + 1))
done < <(find "${orte[@]}" -type d -iname BOOT -path '*/EFI/*')

if [ "$anzahl" -eq 0 ]; then
    echo "FEHLER: Kein Ordner EFI/BOOT mit BOOTX64.EFI gefunden." >&2
    exit 1
fi

echo "== EFI-Dateien nachher =="
find "${orte[@]}" -iname '*.efi' -o -iname '*.csv' | sort
