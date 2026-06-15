// Génère les icônes de l'app à partir de build/icon.svg :
//   - build/icon.png  (1024x1024, icône principale)
//   - build/icon.ico  (Windows, multi-tailles)
//   - build/icons/NxN.png  (Linux : jeu de tailles standard pour le .deb)
// Usage : npm install --no-save sharp png-to-ico ; node scripts/gen-icons.js
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const buildDir = path.join(__dirname, "..", "build");
const svgPath = path.join(buildDir, "icon.svg");
const pngPath = path.join(buildDir, "icon.png");
const icoPath = path.join(buildDir, "icon.ico");
const linuxIconsDir = path.join(buildDir, "icons");

async function main() {
  const svg = fs.readFileSync(svgPath);

  // PNG principal 1024x1024.
  await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(pngPath);
  console.log("OK  " + pngPath);

  // ICO Windows : on empile plusieurs tailles standard.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(
    icoSizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer())
  );
  fs.writeFileSync(icoPath, await pngToIco(icoBuffers));
  console.log("OK  " + icoPath);

  // Linux : un PNG par taille (electron-builder installe tout le jeu dans le .deb).
  fs.rmSync(linuxIconsDir, { recursive: true, force: true });
  fs.mkdirSync(linuxIconsDir, { recursive: true });
  const pngSizes = [16, 32, 48, 64, 128, 256, 512];
  for (const s of pngSizes) {
    const out = path.join(linuxIconsDir, `${s}x${s}.png`);
    await sharp(svg, { density: 384 }).resize(s, s).png().toFile(out);
    console.log("OK  " + out);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
