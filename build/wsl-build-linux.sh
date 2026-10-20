#!/usr/bin/env bash
# Build du paquet .deb dans WSL sur un systeme de fichiers ext4.
# Necessaire car le bit SUID (4755) de chrome-sandbox ne peut pas etre pose
# sur /mnt/c (drvfs). On copie donc le projet vers ~/ia-build (ext4), on build
# la-bas, puis on rapatrie le .deb dans dist/ cote Windows.
set -euo pipefail

# Dossier du projet deduit de l'emplacement du script (build/..) : fonctionne
# sur n'importe quel PC, quel que soit le chemin (ex. /mnt/j/Dev/ia-cli-launcher).
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/ia-build"
TARGET="${1:-deb}"   # "deb" par defaut, "deb AppImage" possible

echo ">> Source : $SRC"
echo ">> Build  : $DEST  (cible: $TARGET)"
mkdir -p "$DEST"

echo ">> Synchronisation du code vers ext4..."
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    "$SRC/" "$DEST/"
else
  # Repli sans rsync : on nettoie tout sauf node_modules puis on recopie.
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  cp -a "$SRC/." "$DEST/"
  rm -rf "$DEST/dist" "$DEST/.git"
fi

cd "$DEST"

echo ">> npm install (dependances Linux)..."
npm install --no-audit --no-fund

echo ">> electron-builder --linux $TARGET ..."
npx --no-install electron-builder --linux $TARGET

echo ">> Rapatriement des artefacts vers dist/ (Windows)..."
mkdir -p "$SRC/dist"
shopt -s nullglob
for f in dist/*.deb dist/*.AppImage; do
  cp -f "$f" "$SRC/dist/"
  echo "   copie -> $(basename "$f")"
done

echo ">> Verification du bit SUID de chrome-sandbox dans le .deb..."
DEB=$(ls -t dist/*.deb | head -n1)
if [ -n "$DEB" ]; then
  dpkg-deb -c "$DEB" | grep chrome-sandbox || true
fi

echo ">> Termine. Artefacts dans : $SRC/dist"
