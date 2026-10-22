// Recupere le moteur Piper et les voix embarquees dans vendor/piper (ignore
// par git), avant le build : electron-builder les copie ensuite dans
// l'application (extraResources). Rien n'est telecharge chez l'utilisateur.
//
// Usage : node scripts/fetch-voice.js [win32|linux]   (defaut : ce systeme)
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_URLS, VOICES_BASE, VOICES } = require("../src/main/piperVoices");

const ROOT = path.resolve(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "piper");
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

(async () => {
  if (!ENGINE_URLS[target]) {
    throw new Error(`plateforme non geree : ${target}`);
  }
  const engineDir = path.join(VENDOR, OS_DIR[target]);
  const exe = path.join(engineDir, "piper", target === "win32" ? "piper.exe" : "piper");
  if (!fs.existsSync(exe)) {
    const archive = path.join(VENDOR, "downloads", path.basename(ENGINE_URLS[target]));
    await download(ENGINE_URLS[target], archive);
    fs.rmSync(engineDir, { recursive: true, force: true });
    fs.mkdirSync(engineDir, { recursive: true });
    if (archive.endsWith(".zip")) {
      execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${engineDir}' -Force`]);
    } else {
      execFileSync("tar", ["-xzf", archive, "-C", engineDir]);
      fs.chmodSync(exe, 0o755);
    }
    console.log(`moteur extrait : ${path.relative(ROOT, engineDir)}`);
  }
  // Les voix retirees de la liste ne doivent pas rester dans l'installateur.
  const bundled = VOICES.filter((item) => item.bundled);
  const keep = new Set(bundled.flatMap((voice) => [`${voice.file}.onnx`, `${voice.file}.onnx.json`]));
  const voicesDir = path.join(VENDOR, "voices");
  for (const name of fs.existsSync(voicesDir) ? fs.readdirSync(voicesDir) : []) {
    if (!keep.has(name)) {
      fs.rmSync(path.join(voicesDir, name), { force: true });
      console.log(`voix retiree : ${name}`);
    }
  }
  for (const voice of bundled) {
    const base = `${VOICES_BASE}/${voice.dir}/${voice.file}.onnx`;
    await download(base, path.join(VENDOR, "voices", `${voice.file}.onnx`));
    await download(`${base}.json`, path.join(VENDOR, "voices", `${voice.file}.onnx.json`));
  }
  console.log("voix JARVIS pretes.");
})().catch((error) => {
  console.error(`ECHEC fetch-voice : ${error.message}`);
  process.exit(1);
});
