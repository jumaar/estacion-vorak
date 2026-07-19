#!/bin/bash
# Configura autologin del usuario vorak en el display manager detectado.
# Soporta: GDM (Ubuntu), LightDM (Mint/Xubuntu), SDDM (KDE).
AUTOLOGIN_USER="vorak"

setup_gdm() {
    local conf="/etc/gdm3/custom.conf"
    mkdir -p /etc/gdm3 2>/dev/null || true
    touch "$conf" 2>/dev/null || true
    if ! grep -q "AutomaticLoginEnable=true" "$conf" 2>/dev/null; then
        sed -i 's/^#*\s*AutomaticLoginEnable=.*/AutomaticLoginEnable=true/' "$conf" 2>/dev/null || true
        if ! grep -q "^AutomaticLoginEnable=true" "$conf" 2>/dev/null; then
            printf '\n[daemon]\nAutomaticLoginEnable=true\nAutomaticLogin=%s\n' "$AUTOLOGIN_USER" >> "$conf"
        fi
        sed -i "s/^#*\s*AutomaticLogin=.*/AutomaticLogin=${AUTOLOGIN_USER}/" "$conf" 2>/dev/null || true
    fi
}

setup_lightdm() {
    local conf="/etc/lightdm/lightdm.conf"
    mkdir -p /etc/lightdm 2>/dev/null || true
    touch "$conf" 2>/dev/null || true
    if ! grep -q "autologin-user=${AUTOLOGIN_USER}" "$conf" 2>/dev/null; then
        if ! grep -q "^\[Seat:\*\]" "$conf" 2>/dev/null; then
            printf '\n[Seat:*]\n' >> "$conf"
        fi
        sed -i 's/^#*\s*autologin-user=.*/autologin-user='"${AUTOLOGIN_USER}"'/' "$conf" 2>/dev/null || true
        if ! grep -q "^autologin-user=${AUTOLOGIN_USER}" "$conf" 2>/dev/null; then
            sed -i "/^\[Seat:\*\]/a autologin-user=${AUTOLOGIN_USER}" "$conf" 2>/dev/null || true
        fi
        sed -i 's/^#*\s*autologin-user-timeout=.*/autologin-user-timeout=0/' "$conf" 2>/dev/null || true
    fi
    getent group autologin &>/dev/null && usermod -a -G autologin "$AUTOLOGIN_USER" 2>/dev/null || true
}

setup_sddm() {
    local confd="/etc/sddm.conf.d"
    local conf="${confd}/vorak-autologin.conf"
    mkdir -p "$confd" 2>/dev/null || true
    cat > "$conf" 2>/dev/null <<EOF
[Autologin]
User=${AUTOLOGIN_USER}
Session=plasma.desktop
EOF
}

if [ -d /etc/gdm3 ] || [ -f /etc/gdm3/custom.conf ]; then
    setup_gdm
    echo "autologin configurado para GDM (usuario: ${AUTOLOGIN_USER})"
elif [ -d /etc/lightdm ] || [ -f /etc/lightdm/lightdm.conf ]; then
    setup_lightdm
    echo "autologin configurado para LightDM (usuario: ${AUTOLOGIN_USER})"
elif [ -d /etc/sddm.conf.d ] || command -v sddm &>/dev/null; then
    setup_sddm
    echo "autologin configurado para SDDM (usuario: ${AUTOLOGIN_USER})"
else
    echo "No se detecto GDM/LightDM/SDDM — autologin omitido"
fi
