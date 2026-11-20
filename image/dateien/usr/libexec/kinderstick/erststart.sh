#!/bin/bash
# Kinder-Stick: legt beim ersten Start das Kinder- und das Elternkonto an.
# Idempotent – kann gefahrlos mehrfach laufen.
set -euo pipefail

KIND=kind
ELTERN=eltern
DATEN=/var/lib/kinderstick

install -d -m 0700 "$DATEN"

# Kinderkonto: ohne Passwort, meldet sich automatisch an (siehe /etc/gdm/custom.conf)
if ! id "$KIND" &>/dev/null; then
    useradd -m -c "Kind" "$KIND"
    passwd -d "$KIND"
fi

# Elternkonto: Administrator, gesperrt bis der Einrichtungsassistent das Passwort setzt
if ! id "$ELTERN" &>/dev/null; then
    useradd -m -c "Eltern" -G wheel "$ELTERN"
    passwd -l "$ELTERN"
fi

# Sitzungen festlegen: Kind = Kiosk, Eltern = normales GNOME
install -d -m 0755 /var/lib/AccountsService/users
cat > "/var/lib/AccountsService/users/$KIND" <<EOF
[User]
Session=gnome-kiosk-script-wayland
SystemAccount=false
EOF
cat > "/var/lib/AccountsService/users/$ELTERN" <<EOF
[User]
Session=gnome
SystemAccount=false
EOF

# Kiosk-Skript des Kinderkontos (wird von gnome-kiosk-script-session gestartet)
KHOME=$(getent passwd "$KIND" | cut -d: -f6)
install -d -m 0755 -o "$KIND" -g "$KIND" "$KHOME/.local" "$KHOME/.local/bin"
install -m 0755 -o "$KIND" -g "$KIND" /usr/libexec/kinderstick/kiosk-skript "$KHOME/.local/bin/gnome-kiosk-script"

touch "$DATEN/.benutzer-angelegt"
