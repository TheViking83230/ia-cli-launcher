// Voix de JARVIS : synthese vocale locale avec Piper (hors ligne, gratuite).
//
// Le moteur et les voix sont embarques dans l'application (extraResources,
// recuperes au build par scripts/fetch-voice.js) : rien a telecharger ni a
// installer pour l'utilisateur, et rien n'est envoye en ligne pour parler.
const { app } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VOICES } = require("./piperVoices");

// Application installee : resources/piper ; en developpement : vendor/piper.
function piperRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "piper") : path.join(__dirname, "..", "..", "vendor", "piper");
}

function engineExe() {
  const engineDir = app.isPackaged ? "engine" : process.platform === "win32" ? "win" : "linux";
  return path.join(piperRoot(), engineDir, "piper", process.platform === "win32" ? "piper.exe" : "piper");
}

function voiceModel(voice) {
  return path.join(piperRoot(), "voices", `${voice.file}.onnx`);
}

function isAvailable(voice) {
  return fs.existsSync(voiceModel(voice)) && fs.existsSync(`${voiceModel(voice)}.json`);
}

function status() {
  return {
    engine: fs.existsSync(engineExe()),
    voices: VOICES.filter(isAvailable).map(({ id, label, license }) => ({ id, label, license }))
  };
}

// Genere la phrase en WAV ; renvoie { audio: Uint8Array } ou { error }.
// lengthScale > 1 ralentit la diction, < 1 l'accelere.
function speak({ text, voiceId, lengthScale = 1 }) {
  return new Promise((resolve) => {
    const voice = VOICES.find((item) => item.id === voiceId && isAvailable(item)) || VOICES.find(isAvailable);
    if (!fs.existsSync(engineExe()) || !voice) {
      resolve({ error: "Voix de JARVIS absente de cette installation." });
      return;
    }
    const content = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!content) {
      resolve({ error: "Rien à dire." });
      return;
    }
    const output = path.join(os.tmpdir(), `jarvis-voice-${process.pid}-${Date.now()}.wav`);
    const args = ["--model", voiceModel(voice), "--output_file", output, "--length_scale", String(Math.min(Math.max(lengthScale, 0.5), 2))];
    if (voice.speaker !== undefined) {
      args.push("--speaker", String(voice.speaker));
    }
    const child = spawn(engineExe(), args, { cwd: path.dirname(engineExe()), windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 60000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ error: `Le moteur vocal n'a pas pu démarrer : ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) {
          throw new Error(stderr.trim().split("\n").pop() || `code ${code}`);
        }
        resolve({ audio: new Uint8Array(fs.readFileSync(output)) });
      } catch (error) {
        resolve({ error: `Échec de la synthèse vocale : ${error.message}` });
      } finally {
        fs.rmSync(output, { force: true });
      }
    });
    child.stdin.end(`${content}\n`, "utf8");
  });
}

module.exports = { status, speak };
