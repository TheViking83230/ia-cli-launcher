#!/usr/bin/env bash
# Build Linux (.deb + AppImage) dans un conteneur electronuserland/builder,
# lance par scripts/release.js. /src : projet (lecture seule) ; /out : sortie.
set -euo pipefail

mkdir -p /build
cd /src
# Copie sur le systeme de fichiers du conteneur (bit SUID de chrome-sandbox),
# sans les dependances Windows ni les artefacts.
tar -cf - package.json package-lock.json src build scripts | tar -xf - -C /build
# Voix de JARVIS deja recuperees cote Windows : reutilisees telles quelles.
for dir in vendor/piper/voices vendor/whisper/models vendor/wakeword/models; do
  if [ -d "$dir" ]; then
    tar -cf - "$dir" | tar -xf - -C /build
  fi
done
cd /build

# Scripts shell venant de Windows : fins de ligne LF.
find build -name '*.sh' -exec sed -i 's/\r$//' {} +

echo ">> npm ci"
npm ci --no-audit --no-fund
echo ">> moteur et voix de JARVIS (Piper Linux)"
node scripts/fetch-voice.js linux
echo ">> electron-builder --linux deb AppImage"
npx --no-install electron-builder --linux deb AppImage --publish never

cp -f dist/*.deb dist/*.AppImage dist/latest-linux.yml /out/
echo ">> Paquets Linux :"
ls -l /out
dpkg-deb -e dist/*.deb /tmp/control
grep -q 'chmod 4755' /tmp/control/postinst && echo ">> postinst : SUID de chrome-sandbox OK"
