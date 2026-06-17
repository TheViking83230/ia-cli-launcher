#!/bin/bash
# Script post-installation (postinst) du paquet .deb.
# Remplace le template par defaut d'electron-builder pour garantir un sandbox
# Chromium fonctionnel quel que soit le mode de lancement.

# Lien /usr/bin/ia-cli-launcher -> binaire installe dans /opt.
if type update-alternatives 2>/dev/null >&1; then
    # Retire un ancien lien direct qui n'utiliserait pas update-alternatives.
    if [ -L '/usr/bin/ia-cli-launcher' -a -e '/usr/bin/ia-cli-launcher' -a "`readlink '/usr/bin/ia-cli-launcher'`" != '/etc/alternatives/ia-cli-launcher' ]; then
        rm -f '/usr/bin/ia-cli-launcher'
    fi
    update-alternatives --install '/usr/bin/ia-cli-launcher' 'ia-cli-launcher' '/opt/IA CLI Launcher/ia-cli-launcher' 100 || ln -sf '/opt/IA CLI Launcher/ia-cli-launcher' '/usr/bin/ia-cli-launcher'
else
    ln -sf '/opt/IA CLI Launcher/ia-cli-launcher' '/usr/bin/ia-cli-launcher'
fi

# Sandbox Chromium : on force le SUID 4755 (root) de maniere inconditionnelle.
# Le template par defaut ne le posait que si les "user namespaces" non
# privilegies semblaient indisponibles ; or ce test tourne en root pendant
# l'installation (ou il reussit toujours), ce qui laissait chrome-sandbox en
# 0755 et faisait planter l'app pour un utilisateur normal sous Debian
# (« The SUID sandbox helper binary ... is not configured correctly »).
chmod 4755 '/opt/IA CLI Launcher/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
