// Voix « qualite » de JARVIS : Qwen3-TTS 0.6B sur carte graphique NVIDIA, et
// dictee precise (Whisper large-v3-turbo) sur la meme carte.
//
// L'installeur reste unique : ce pack (Python, PyTorch CUDA, modeles : ~8 Go telecharges, ~11 Go installes) est
// installe depuis la fenetre JARVIS, une seule fois, hors du dossier de
// l'application (il survit aux mises a jour). Sans carte NVIDIA ou sans pack,
// la voix Tom (Piper, processeur) reste utilisee.
//
// Un serveur Python (voice-quality/server.py) garde le modele charge et envoie
// l'audio en flux : le premier son arrive en ~0,3 s. Il est arrete apres
// QUIET_MS sans parole pour liberer la memoire de la carte graphique.
const { app } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const PACK_VERSION = 1;
const PYTHON_URL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
const GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py";
// torchaudio est epingle ici : sinon pip installe une version CPU incompatible.
const PINNED_TORCH = ["torch==2.7.1+cu128", "torchaudio==2.7.1+cu128"];
const TORCH = [...PINNED_TORCH, "--index-url", "https://download.pytorch.org/whl/cu128"];
const PACKAGES = ["faster-qwen3-tts==0.5.4", "transformers==5.15.1", "soundfile"];
const MODEL = { repo: "Qwen/Qwen3-TTS-12Hz-0.6B-Base", revision: "5d83992436eae1d760afd27aff78a71d676296fc" };
const ASR = {
  repo: "openai/whisper-large-v3-turbo",
  revision: "41f01f3fe87f28c78e2fbf8b568835947dd65ed9",
  files: ["*.json", "*.txt", "model.safetensors"]
};
const QUIET_MS = 30 * 60 * 1000;
// Etapes de l'installation : poids dans la barre de progression et, pour les
// telechargements, dossier suivi (peu de fichiers : mesure rapide) et taille
// attendue a la fin de l'etape (Go) ; sinon duree approximative.
const STEPS = [
  { id: "python", label: "Python", weight: 2, seconds: 15 },
  { id: "torch", label: "Téléchargement du moteur PyTorch CUDA (3,3 Go)", weight: 36, dir: "paquets", size: 3.35 },
  { id: "packages", label: "Téléchargement du moteur de voix", weight: 5, dir: "paquets", size: 3.75 },
  { id: "setup", label: "Installation du moteur", weight: 10, seconds: 120 },
  { id: "model", label: "Téléchargement du modèle de voix (2,5 Go)", weight: 27, dir: "modele", size: 2.52 },
  { id: "asr", label: "Téléchargement du modèle de dictée (1,6 Go)", weight: 15, dir: "dictee", size: 1.62 },
  { id: "test", label: "Premier essai de la voix", weight: 5, seconds: 30 }
];

const install = { running: false, percent: 0, step: "", error: "" };
const server = { child: null, ready: null, started: false, asr: false, nextId: 1, pending: new Map(), quietTimer: null };

function packRoot() {
  const base = process.env.LOCALAPPDATA || app.getPath("userData");
  return path.join(base, "IA CLI Launcher", "voix-qualite");
}

function pythonExe() {
  return path.join(packRoot(), "python", "python.exe");
}

function modelDir() {
  return path.join(packRoot(), "modele");
}

function asrDir() {
  return path.join(packRoot(), "dictee");
}

// Le marqueur n'est ecrit qu'une fois le modele de dictee entierement telecharge.
function asrInstalled() {
  return fs.existsSync(path.join(asrDir(), "complet"));
}

function markerFile() {
  return path.join(packRoot(), "installe.json");
}

function serverScript() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "..");
  return path.join(base, "voice-quality", "server.py");
}

function isInstalled() {
  try {
    return JSON.parse(fs.readFileSync(markerFile(), "utf8")).version === PACK_VERSION && fs.existsSync(pythonExe());
  } catch {
    return false;
  }
}

// Carte NVIDIA presente ? nvidia-smi est installe avec le pilote.
let gpuInfo;
function detectGpu() {
  gpuInfo ??= new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      const [name, memory, driver] = error ? [] : String(stdout).split("\n")[0].split(",").map((part) => part.trim());
      resolve(name ? { name, memoryMb: Number(memory) || 0, driver } : null);
    });
  });
  return gpuInfo;
}

async function status() {
  const gpu = await detectGpu();
  return {
    supported: process.platform === "win32",
    gpu,
    enoughMemory: Boolean(gpu && gpu.memoryMb >= 4000),
    installed: isInstalled(),
    asrInstalled: asrInstalled(),
    installing: install.running,
    percent: install.percent,
    step: install.step,
    error: install.error
  };
}

function folderSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // fichier en cours d'ecriture ou supprime
        }
      }
    }
  }
  return total;
}

function run(exe, args, logStream, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1", ...options.env } });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} a échoué (code ${code}), voir ${logStream.path}`))));
  });
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Téléchargement impossible (${response.status}) : ${url}`);
  }
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

// Installe le pack ; onProgress({ percent, step, done, error }) suit l'avancement.
// onlyAsr : ajoute seulement la dictee precise a un pack deja installe.
async function installPack(onProgress, { onlyAsr = false } = {}) {
  if (install.running) {
    return { error: "Installation déjà en cours." };
  }
  if (process.platform !== "win32" || !(await detectGpu())) {
    return { error: "La voix qualité demande Windows et une carte graphique NVIDIA." };
  }
  const root = packRoot();
  if (onlyAsr && !isInstalled()) {
    return { error: "Installe d'abord la voix qualité." };
  }
  stopServer();
  const plan = onlyAsr ? STEPS.filter((step) => step.id === "asr" || step.id === "test") : STEPS;
  const scale = 100 / plan.reduce((sum, step) => sum + step.weight, 0);
  try {
    if (onlyAsr) {
      fs.rmSync(asrDir(), { recursive: true, force: true, maxRetries: 5 });
    } else {
      // Vide le dossier sans le supprimer lui-meme (Windows refuse si un autre
      // programme y a un acces ouvert). Les paquets deja telecharges sont gardes
      // pour qu'un nouvel essai ne reprenne pas tout le telechargement.
      fs.mkdirSync(root, { recursive: true });
      for (const entry of fs.readdirSync(root).filter((name) => name !== "paquets")) {
        fs.rmSync(path.join(root, entry), { recursive: true, force: true, maxRetries: 5 });
      }
      fs.mkdirSync(path.join(root, "python"), { recursive: true });
    }
  } catch (error) {
    install.error = `Dossier ${root} inaccessible : ${error.message}`;
    return { error: install.error };
  }
  Object.assign(install, { running: true, percent: 0, step: "", error: "" });
  const logStream = fs.createWriteStream(path.join(root, "installation.log"), { flags: onlyAsr ? "a" : "w" });
  let done = 0;
  let current = plan[0];
  const report = (extra = {}) => onProgress({ percent: install.percent, step: install.step, ...extra });
  let stepStart = Date.now();
  let sizeBefore = 0;
  const ticker = setInterval(() => {
    const ratio = current.size
      ? (folderSize(path.join(root, current.dir)) / 1e9 - sizeBefore) / (current.size - sizeBefore)
      : (Date.now() - stepStart) / 1000 / current.seconds;
    install.percent = Math.round(done + current.weight * scale * Math.min(0.97, Math.max(0, ratio)));
    report();
  }, 1500);
  const begin = (id) => {
    const previous = current;
    current = STEPS.find((step) => step.id === id);
    sizeBefore = previous !== current && previous.dir === current.dir ? previous.size : 0;
    stepStart = Date.now();
    install.step = current.label;
    logStream.write(`\n=== ${current.label}\n`);
    report();
  };
  const finish = () => {
    done += current.weight * scale;
    install.percent = done;
  };
  const py = pythonExe();
  const fetchModel = (model, dir) =>
    run(
      py,
      [
        "-c",
        "import sys, json\nfrom huggingface_hub import snapshot_download\nsnapshot_download(sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], allow_patterns=json.loads(sys.argv[4]))",
        model.repo,
        model.revision,
        dir,
        JSON.stringify(model.files || ["*"])
      ],
      logStream
    );
  try {
    if (!onlyAsr) {
      await installEngine();
    }
    begin("asr");
    await fetchModel(ASR, asrDir());
    fs.writeFileSync(path.join(asrDir(), "complet"), new Date().toISOString());
    finish();
    begin("test");
    if (!onlyAsr) {
      fs.writeFileSync(markerFile(), JSON.stringify({ version: PACK_VERSION, date: new Date().toISOString() }));
    }
    const result = await speak("Voix de qualité opérationnelle.", () => {});
    if (result.error) {
      if (!onlyAsr) {
        fs.rmSync(markerFile(), { force: true });
      }
      throw new Error(result.error);
    }
    finish();
    install.percent = 100;
    report({ done: true });
    return { ok: true };
  } catch (error) {
    install.error = error.message;
    logStream.write(`\nERREUR : ${error.stack || error.message}\n`);
    report({ done: true, error: error.message });
    return { error: error.message };
  } finally {
    clearInterval(ticker);
    install.running = false;
    logStream.end();
  }

  async function installEngine() {
    begin("python");
    const zip = path.join(root, "python.zip");
    await download(PYTHON_URL, zip);
    await run("tar", ["-xf", zip, "-C", path.dirname(py)], logStream);
    fs.rmSync(zip);
    fs.writeFileSync(path.join(path.dirname(py), "python312._pth"), "python312.zip\r\n.\r\nLib\\site-packages\r\nimport site\r\n");
    await download(GET_PIP_URL, path.join(root, "get-pip.py"));
    await run(py, [path.join(root, "get-pip.py"), "--no-warn-script-location"], logStream);
    // Python embarque : les paquets a compiler (ex. sox) n'y trouvent pas
    // setuptools dans un environnement isole ; ils sont compiles avec celui-ci.
    await run(py, ["-m", "pip", "install", "--no-warn-script-location", "setuptools", "wheel"], logStream);
    finish();
    // Telechargement des paquets dans un dossier a part, puis installation
    // hors ligne depuis ce dossier.
    const wheels = path.join(root, "paquets");
    const pip = ["-m", "pip", "--no-cache-dir"];
    const quiet = ["--progress-bar", "off", "--no-build-isolation"];
    begin("torch");
    await run(py, [...pip, "download", ...quiet, "-d", wheels, ...TORCH], logStream);
    finish();
    begin("packages");
    await run(py, [...pip, "download", ...quiet, "-d", wheels, "--find-links", wheels, ...PINNED_TORCH, ...PACKAGES], logStream);
    finish();
    begin("setup");
    await run(py, [...pip, "install", ...quiet, "--no-warn-script-location", "--no-index", "--find-links", wheels, ...PINNED_TORCH, ...PACKAGES], logStream);
    fs.rmSync(wheels, { recursive: true, force: true });
    finish();
    begin("model");
    await fetchModel(MODEL, modelDir());
    finish();
  }
}

function uninstallPack() {
  stopServer();
  fs.rmSync(packRoot(), { recursive: true, force: true });
  return { ok: true };
}

function failPending(message) {
  for (const request of server.pending.values()) {
    request.resolve({ error: message });
  }
  server.pending.clear();
}

function startServer() {
  if (server.ready) {
    return server.ready;
  }
  server.ready = new Promise((resolve) => {
    const child = spawn(pythonExe(), ["-I", serverScript()], {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        HF_HUB_OFFLINE: "1",
        JARVIS_QUALITY_MODEL: modelDir(),
        JARVIS_ASR_MODEL: asrInstalled() ? asrDir() : ""
      }
    });
    server.child = child;
    const logFile = fs.createWriteStream(path.join(packRoot(), "serveur.log"));
    child.stderr.pipe(logFile);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.ready) {
        server.started = server.child === child;
        server.asr = server.started && Boolean(message.asr);
        resolve({ ok: true });
      } else if (message.fatal) {
        resolve({ error: message.fatal });
      } else {
        const request = server.pending.get(message.id);
        if (!request) {
          return;
        }
        if (message.pcm) {
          request.onChunk({ sampleRate: message.sr, pcm: new Uint8Array(Buffer.from(message.pcm, "base64")) });
        } else {
          server.pending.delete(message.id);
          request.resolve(message.error ? { error: message.error } : typeof message.text === "string" ? { text: message.text } : { ok: true });
        }
      }
    });
    child.on("error", (error) => resolve({ error: `La voix qualité n'a pas pu démarrer : ${error.message}` }));
    child.on("close", (code) => {
      resolve({ error: `La voix qualité s'est arrêtée (code ${code}).` });
      failPending("La voix qualité s'est arrêtée.");
      if (server.child === child) {
        Object.assign(server, { child: null, ready: null, started: false, asr: false });
      }
    });
  });
  return server.ready;
}

function stopServer() {
  clearTimeout(server.quietTimer);
  if (server.child) {
    server.child.stdin.end();
    const child = server.child;
    setTimeout(() => child.kill(), 3000);
  }
  Object.assign(server, { child: null, ready: null, started: false, asr: false });
  failPending("La voix qualité a été arrêtée.");
}

// Dit un texte ; onChunk({ sampleRate, pcm }) recoit l'audio (int16) au fil de
// l'eau. Renvoie { ok } a la fin, ou { error }.
async function speak(text, onChunk) {
  if (!isInstalled()) {
    return { error: "Voix qualité non installée." };
  }
  clearTimeout(server.quietTimer);
  const started = await startServer();
  if (started.error) {
    stopServer();
    return started;
  }
  const id = server.nextId++;
  const result = await new Promise((resolve) => {
    server.pending.set(id, { resolve, onChunk });
    server.child.stdin.write(`${JSON.stringify({ cmd: "speak", id, text: String(text || "") })}\n`);
  });
  clearTimeout(server.quietTimer);
  server.quietTimer = setTimeout(stopServer, QUIET_MS);
  return result;
}

// Dictee precise sur la carte graphique. Seulement si le serveur est deja pret :
// sinon { error } tout de suite, et la dictee sur processeur prend le relais
// (le serveur est demarre pour les suivantes).
function transcribe(wavBytes, prompt = "") {
  if (!server.started || !server.asr) {
    prepare();
    return Promise.resolve({ error: "Dictée précise pas encore prête." });
  }
  const id = server.nextId++;
  return new Promise((resolve) => {
    server.pending.set(id, { resolve, onChunk: () => {} });
    const wav = Buffer.from(wavBytes).toString("base64");
    server.child.stdin.write(`${JSON.stringify({ cmd: "transcribe", id, wav, prompt })}\n`);
  });
}

// Interrompt la phrase en cours et celles en attente.
function stopSpeaking() {
  if (server.child) {
    server.child.stdin.write(`${JSON.stringify({ cmd: "stop" })}\n`);
  }
}

// Charge le modele a l'avance (activation de JARVIS).
function prepare() {
  if (isInstalled() && !install.running) {
    clearTimeout(server.quietTimer);
    server.quietTimer = setTimeout(stopServer, QUIET_MS);
    startServer().then((result) => result.error && stopServer());
  }
}

module.exports = { status, installPack, uninstallPack, speak, transcribe, stopSpeaking, stopServer, prepare };
