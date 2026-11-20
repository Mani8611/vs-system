#!/bin/bash
# Kinder-Stick: schreibt das System-Image auf einen USB-Stick.
# Nur unter Linux mit Podman, als root. NICHT auf Firmen-PCs verwenden.
#
# ACHTUNG: Der gewählte Stick wird VOLLSTÄNDIG GELÖSCHT.
#
# Aufruf:
#   sudo IMAGE=ghcr.io/<besitzer>/kinderstick:latest ./werkzeuge/stick-schreiben.sh /dev/sdX
#   (lokal gebautes Image: IMAGE=localhost/kinderstick:latest)
set -euo pipefail

ZIEL="${1:-}"

if [[ $EUID -ne 0 ]]; then
    echo "Bitte als root ausführen (sudo)."
    exit 1
fi
if [[ -z "${IMAGE:-}" ]]; then
    echo "Bitte das Image angeben, z. B.: sudo IMAGE=ghcr.io/<besitzer>/kinderstick:latest $0 /dev/sdX"
    exit 1
fi
if [[ -z "$ZIEL" || ! -b "$ZIEL" ]]; then
    echo "Aufruf: sudo IMAGE=… $0 /dev/sdX"
    echo
    echo "Gefundene Laufwerke:"
    lsblk -d -o NAME,TRAN,SIZE,MODEL
    exit 1
fi

# Sicherheitsprüfungen: nur USB-Laufwerke, nichts Eingehängtes
TRANSPORT=$(lsblk -dno TRAN "$ZIEL" | tr -d '[:space:]')
if [[ "$TRANSPORT" != "usb" ]]; then
    echo "Abbruch: $ZIEL ist kein USB-Laufwerk (Anschluss: ${TRANSPORT:-unbekannt})."
    exit 1
fi
if lsblk -nro MOUNTPOINT "$ZIEL" | grep -q '[^[:space:]]'; then
    echo "Abbruch: Auf $ZIEL ist noch etwas eingehängt. Bitte zuerst aushängen."
    exit 1
fi

echo "Ziel:"
lsblk -o NAME,SIZE,MODEL,TRAN "$ZIEL"
echo
read -r -p "Der Stick $ZIEL wird GELÖSCHT. Zum Fortfahren JA eingeben: " ANTWORT
if [[ "$ANTWORT" != "JA" ]]; then
    echo "Abgebrochen."
    exit 1
fi

if [[ "$IMAGE" != localhost/* ]]; then
    podman pull "$IMAGE"
fi

# --generic-image: Bootloader am Standardpfad, keine EFI-Variablen setzen –
# damit startet der Stick auf beliebigen Laptops (Einmal-Boot-Menü).
podman run --rm --privileged --pid=host \
    -v /dev:/dev \
    -v /var/lib/containers:/var/lib/containers \
    --security-opt label=type:unconfined_t \
    "$IMAGE" \
    bootc install to-disk --wipe --generic-image --filesystem btrfs "$ZIEL"

echo
echo "Fertig. Stick abziehen und an einem Test-Laptop über das Einmal-Boot-Menü starten."
