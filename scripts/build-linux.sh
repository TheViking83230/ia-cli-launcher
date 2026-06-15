#!/usr/bin/env bash
# Construit l'installateur Linux (.deb) depuis WSL/Ubuntu.
# A lancer depuis WSL :  bash scripts/build-linux.sh
set -euo pipefail

# Force le Node Linux : sous WSL, le PATH contient le Node Windows (/mnt/c/...)
# qui ne peut pas compiler/packager pour Linux. On garde uniquement les chemins Linux.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Dossier source = 1er argument si fourni, sinon deduit de l'emplacement du script.
if [ "${1:-}" != "" ]; then
  SRC="$(cd "$1" && pwd)"
else
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
# Dossier de build dans le systeme de fichiers Linux (rapide + droits POSIX corrects).
BUILD="$HOME/ia-cli-launcher-build"

echo "==> Node $(node --version) / npm $(npm --version)"
echo "==> Source : $SRC"
echo "==> Build  : $BUILD"

rm -rf "$BUILD"
mkdir -p "$BUILD"

echo "==> Copie du projet (sans node_modules/dist/.git)..."
tar -C "$SRC" --exclude=node_modules --exclude=dist --exclude=.git -cf - . \
  | tar -C "$BUILD" -xf -

cd "$BUILD"

echo "==> Installation des dependances Linux..."
npm install

echo "==> Construction des paquets Linux (.deb + AppImage)..."
npm run dist:linux

echo "==> Recuperation des artefacts dans $SRC/dist ..."
mkdir -p "$SRC/dist"
cp "$BUILD"/dist/*.deb "$SRC/dist/" 2>/dev/null || true
cp "$BUILD"/dist/*.AppImage "$SRC/dist/" 2>/dev/null || true
# Metadonnees de mise a jour (presentes apres un build de release).
cp "$BUILD"/dist/latest-linux.yml "$SRC/dist/" 2>/dev/null || true

echo "==> TERMINE"
ls -la "$SRC"/dist/*.deb "$SRC"/dist/*.AppImage 2>/dev/null || true
