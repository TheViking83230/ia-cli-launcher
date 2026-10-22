// Recupere les composants vocaux de JARVIS dans vendor/ (ignore par git),
// avant le build : electron-builder les copie ensuite dans l'application
// (extraResources). Rien n'est telecharge chez l'utilisateur.
//  - vendor/piper   : moteur Piper + voix embarquees (synthese vocale) ;
//  - vendor/whisper : whisper.cpp + modele (dictee) ;
//  - vendor/wakeword : modeles « Hey Jarvis » + onnxruntime-web (mot d'activation).
//
// Usage : node scripts/fetch-voice.js [win32|linux]   (defaut : ce systeme)
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_URLS, VOICES_BASE, VOICES, WHISPER, WAKEWORD } = require("../src/main/piperVoices");

const ROOT = path.resolve(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor");
const target = process.argv[2] || process.platform;
// Dossiers nommes comme la macro ${os} d'electron-builder.
const OS_DIR = { win32: "win", linux: "linux" };

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    return;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} : ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${dest}.part`, dest);
  console.log(`telecharge : ${path.relative(ROOT, dest)}`);
}

// Telecharge et extrait une archive (zip ou tar.gz) si l'executable manque.
async function ensureArchive(url, destDir, exe) {
  if (fs.existsSync(exe)) {
    return;
  }
  const archive = path.join(VENDOR, "downloads", path.basename(new URL(url).pathname));
  await download(url, archive);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  if (archive.endsWith(".zip")) {
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`]);
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", destDir]);
    fs.chmodSync(exe, 0o755);
  }
  if (!fs.existsSync(exe)) {
    throw new Error(`executable absent apres extraction : ${exe}`);
  }
  console.log(`extrait : ${path.relative(ROOT, destDir)}`);
}

async function fetchPiper() {
  const engineDir = path.join(VENDOR, "piper", OS_DIR[target]);
  await ensureArchive(ENGINE_URLS[target], engineDir, path.join(engineDir, "piper", target === "win32" ? "piper.exe" : "piper"));

  // Les voix retirees de la liste ne doivent pas rester dans l'installateur.
  const bundled = VOICES.filter((item) => item.bundled);
  const keep = new Set(bundled.flatMap((voice) => [`${voice.file}.onnx`, `${voice.file}.onnx.json`]));
  const voicesDir = path.join(VENDOR, "piper", "voices");
  for (const name of fs.existsSync(voicesDir) ? fs.readdirSync(voicesDir) : []) {
    if (!keep.has(name)) {
      fs.rmSync(path.join(voicesDir, name), { force: true });
      console.log(`voix retiree : ${name}`);
    }
  }
  for (const voice of bundled) {
    const base = `${VOICES_BASE}/${voice.dir}/${voice.file}.onnx`;
    await download(base, path.join(voicesDir, `${voice.file}.onnx`));
    await download(`${base}.json`, path.join(voicesDir, `${voice.file}.onnx.json`));
  }
}

async function fetchWhisper() {
  const engineDir = path.join(VENDOR, "whisper", OS_DIR[target]);
  await ensureArchive(WHISPER.urls[target], engineDir, path.join(engineDir, WHISPER.exe[target]));
  await download(WHISPER.modelUrl, path.join(VENDOR, "whisper", "models", WHISPER.model));
  await download(WHISPER.commandModelUrl, path.join(VENDOR, "whisper", "models", WHISPER.commandModel));
}

async function fetchWakeword() {
  const dir = path.join(VENDOR, "wakeword");
  for (const file of Object.values(WAKEWORD.models)) {
    await download(`${WAKEWORD.modelsBase}/${file}`, path.join(dir, "models", file));
  }
  // onnxruntime-web (devDependency) : seuls les fichiers utiles sont embarques.
  const ortDist = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
  fs.mkdirSync(path.join(dir, "ort"), { recursive: true });
  for (const file of WAKEWORD.ortFiles) {
    fs.copyFileSync(path.join(ortDist, file), path.join(dir, "ort", file));
  }
}

(async () => {
  if (!OS_DIR[target]) {
    throw new Error(`plateforme non geree : ${target}`);
  }
  await fetchPiper();
  await fetchWhisper();
  await fetchWakeword();
  console.log("voix JARVIS pretes.");
})().catch((error) => {
  console.error(`ECHEC fetch-voice : ${error.message}`);
  process.exit(1);
});
