// Dictee de JARVIS : reconnaissance vocale locale avec whisper.cpp.
//
// L'executable et le modele sont embarques dans l'application (comme Piper,
// voir scripts/fetch-voice.js). Le renderer envoie l'enregistrement deja
// converti en WAV 16 kHz mono ; rien ne part en ligne.
const { app } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { WHISPER, WAKEWORD } = require("./piperVoices");

function whisperRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "whisper") : path.join(__dirname, "..", "..", "vendor", "whisper");
}

function exePath() {
  const engineDir = app.isPackaged ? "engine" : process.platform === "win32" ? "win" : "linux";
  return path.join(whisperRoot(), engineDir, WHISPER.exe[process.platform] || "");
}

function modelPath() {
  return path.join(whisperRoot(), "models", WHISPER.model);
}

function isAvailable() {
  return Boolean(WHISPER.exe[process.platform]) && fs.existsSync(exePath()) && fs.existsSync(modelPath());
}

// Transcrit un WAV 16 kHz ; renvoie { text } ou { error }. prompt oriente
// la reconnaissance (ex. « JARVIS » pour le mot d'activation).
function transcribe(wavBytes, prompt = "") {
  return new Promise((resolve) => {
    if (!isAvailable()) {
      resolve({ error: "Dictée absente de cette installation." });
      return;
    }
    const input = path.join(os.tmpdir(), `jarvis-dictee-${process.pid}-${Date.now()}.wav`);
    fs.writeFileSync(input, Buffer.from(wavBytes));
    const threads = String(Math.max(1, Math.min(8, os.cpus().length - 1)));
    const exe = exePath();
    const env = { ...process.env };
    if (process.platform === "linux") {
      // Bibliotheques partagees livrees a cote de l'executable.
      env.LD_LIBRARY_PATH = [path.dirname(exe), env.LD_LIBRARY_PATH].filter(Boolean).join(":");
    }
    const args = ["-m", modelPath(), "-f", input, "-l", "fr", "-nt", "-np", "-t", threads];
    if (prompt) {
      args.push("--prompt", prompt);
    }
    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      env,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const finish = (result) => {
      clearTimeout(timer);
      fs.rmSync(input, { force: true });
      resolve(result);
    };
    child.on("error", (error) => finish({ error: `La dictée n'a pas pu démarrer : ${error.message}` }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ error: `Échec de la dictée : ${stderr.trim().split("\n").pop() || `code ${code}`}` });
        return;
      }
      // Whisper note les silences et bruits entre crochets ([Musique], [BLANK_AUDIO]...).
      const text = stdout
        .replace(/\[[^\]]*\]|\([^)]*(musique|bruit|silence|rires?)[^)]*\)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      finish({ text });
    });
  });
}

// Mot d'activation : modeles openWakeWord + dossier d'onnxruntime-web (URL
// chargee par la fenetre). null si absents de cette installation.
function wakewordAssets() {
  const root = app.isPackaged ? path.join(process.resourcesPath, "wakeword") : path.join(__dirname, "..", "..", "vendor", "wakeword");
  try {
    const models = {};
    for (const [key, file] of Object.entries(WAKEWORD.models)) {
      models[key] = new Uint8Array(fs.readFileSync(path.join(root, "models", file)));
    }
    return { ortUrl: `${pathToFileURL(path.join(root, "ort")).href}/`, models };
  } catch {
    return null;
  }
}

// Journal de l'ecoute (diagnostic) : userData/jarvis-ecoute.log, 200 Ko max.
function logListening(line) {
  const file = path.join(app.getPath("userData"), "jarvis-ecoute.log");
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) {
      fs.renameSync(file, `${file}.old`);
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${String(line).slice(0, 500)}\n`);
  } catch {}
}

module.exports = { isAvailable, transcribe, wakewordAssets, logListening };
