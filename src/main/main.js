const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pty = require("@lydell/node-pty");
const { autoUpdater } = require("electron-updater");
const { defaultProfiles, defaultPersonas } = require("./defaultProfiles");
const platform = require("./platform");
const gdrive = require("./gdrive");
const pipeline = require("./pipeline");

// Sous Linux, certaines distributions recentes (Ubuntu 24.04+) bloquent les
// "user namespaces" non privilegies : le sandbox Chromium ne peut alors pas
// demarrer et l'application se ferme sans afficher de fenetre. On desactive le
// sandbox sous Linux (outil interne, pas de contenu web distant).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

const sessions = new Map();
let mainWindow;

// Plafond de la transcription conservee par session (octets).
const TRANSCRIPT_LIMIT = 512 * 1024;
// Nombre maximum de sessions conservees dans l'historique global.
const MAX_HISTORY = 500;

// --- Dossier de donnees : local par defaut, ou dossier synchronise choisi ---
// Le pointeur (sync.json) est garde dans le userData REEL et n'est jamais
// synchronise : chaque PC a son propre chemin de montage du dossier cloud.
let cachedDataDir;

function getSyncSettingsPath() {
  return path.join(app.getPath("userData"), "sync.json");
}

function readSyncDir() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSyncSettingsPath(), "utf8"));
    const dir = String(parsed?.dataDir || "").trim();
    return dir || null;
  } catch {
    return null;
  }
}

// Dossier ou sont reellement lus/ecrits profils, historique et sessions.
function getDataDir() {
  if (cachedDataDir === undefined) {
    cachedDataDir = readSyncDir();
  }
  if (cachedDataDir) {
    try {
      fs.mkdirSync(cachedDataDir, { recursive: true });
      return cachedDataDir;
    } catch {
      // Dossier synchronise indisponible (cloud non monte) : repli local pour
      // ne pas perdre de donnees ni planter.
      return app.getPath("userData");
    }
  }
  return app.getPath("userData");
}

// Copie un fichier seulement s'il manque dans la cible (amorcage non destructif).
function copyFileIfMissing(src, dest) {
  try {
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  } catch {}
}

function copyFileOverwrite(src, dest) {
  try {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  } catch {}
}

const DATA_FILES = ["profiles.json", "history.json", "sessions.json"];

function mergeHistoryFiles(srcDir, destDir) {
  try {
    if (!fs.existsSync(srcDir)) {
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    for (const name of fs.readdirSync(srcDir)) {
      copyFileIfMissing(path.join(srcDir, name), path.join(destDir, name));
    }
  } catch {}
}

// Amorce un dossier cible avec les donnees actuelles SANS ecraser ce qui existe
// (utilise quand on active la synchro : si le dossier cloud est deja peuple par
// un autre PC, on respecte son contenu).
function seedDataDir(fromDir, toDir) {
  if (!fromDir || !toDir || fromDir === toDir) {
    return;
  }
  for (const name of DATA_FILES) {
    copyFileIfMissing(path.join(fromDir, name), path.join(toDir, name));
  }
  mergeHistoryFiles(path.join(fromDir, "history"), path.join(toDir, "history"));
}

// Rapatrie les donnees synchronisees en local en ECRASANT (utilise quand on
// desactive la synchro : le contenu synchronise est la verite a conserver).
function pullDataDir(fromDir, toDir) {
  if (!fromDir || !toDir || fromDir === toDir) {
    return;
  }
  for (const name of DATA_FILES) {
    copyFileOverwrite(path.join(fromDir, name), path.join(toDir, name));
  }
  mergeHistoryFiles(path.join(fromDir, "history"), path.join(toDir, "history"));
}

function relaunchApp() {
  app.relaunch();
  app.exit(0);
}

// --- Push automatique vers Google Drive (si connecte), debounce -------------
// Quand la synchro Google Drive native est active, on pousse les donnees apres
// chaque ecriture, regroupees pour eviter de spammer l'API.
let gdrivePushTimer = null;

function scheduleGdrivePush() {
  if (!gdrive.isConnected()) {
    return;
  }
  clearTimeout(gdrivePushTimer);
  gdrivePushTimer = setTimeout(() => {
    gdrive
      .syncOnce(getDataDir())
      .then((res) => {
        if (res?.ok && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("gdrive:synced", gdrive.getStatus());
        }
      })
      .catch(() => {});
  }, 4000);
}

function getSessionsPath() {
  return path.join(getDataDir(), "sessions.json");
}

// Index de l'historique global (toutes sessions, terminees ou non).
function getHistoryIndexPath() {
  return path.join(getDataDir(), "history.json");
}

// Dossier des transcriptions (sortie terminal capturee), un fichier par session.
function getHistoryDir() {
  return path.join(getDataDir(), "history");
}

function getTranscriptPath(id) {
  return path.join(getHistoryDir(), `${id}.log`);
}

function saveSessionsToDisk() {
  const data = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    title: s.title,
    commandLine: s.command,
    cwd: s.cwd,
    extraArgs: s.extraArgs || "",
    profileId: s.profileId,
    profileLabel: s.profileLabel,
    modeId: s.modeId,
    modeLabel: s.modeLabel
  }));
  try {
    fs.writeFileSync(getSessionsPath(), JSON.stringify(data, null, 2), "utf8");
    scheduleGdrivePush();
  } catch {}
}

function loadSessionsFromDisk() {
  try {
    const raw = fs.readFileSync(getSessionsPath(), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// --- Historique global ---------------------------------------------------

function loadHistoryIndex() {
  try {
    const raw = fs.readFileSync(getHistoryIndexPath(), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistoryIndex(entries) {
  try {
    fs.mkdirSync(getHistoryDir(), { recursive: true });
    fs.writeFileSync(getHistoryIndexPath(), JSON.stringify(entries, null, 2), "utf8");
    scheduleGdrivePush();
  } catch {}
}

// Enregistre une nouvelle session en tete de l'historique (la plus recente
// d'abord), plafonne le nombre d'entrees et supprime les transcriptions des
// entrees evincees.
function addHistoryEntry(session) {
  const entries = loadHistoryIndex().filter((entry) => entry.id !== session.id);
  entries.unshift({
    id: session.id,
    title: session.title || "Session",
    command: session.command || "",
    cwd: session.cwd || "",
    profileId: session.profileId || "",
    profileLabel: session.profileLabel || "",
    modeId: session.modeId || "",
    modeLabel: session.modeLabel || "",
    startedAt: new Date().toISOString(),
    endedAt: null
  });

  const dropped = entries.splice(MAX_HISTORY);
  for (const entry of dropped) {
    deleteTranscript(entry.id);
  }
  saveHistoryIndex(entries);
}

function updateHistoryEntry(id, patch) {
  const entries = loadHistoryIndex();
  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  Object.assign(entry, patch);
  saveHistoryIndex(entries);
}

// Ajoute des donnees a la transcription en memoire, tronquee par l'avant pour
// ne jamais depasser TRANSCRIPT_LIMIT. L'ecriture disque est differee.
function appendTranscript(id, data) {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.output += data;
  if (session.output.length > TRANSCRIPT_LIMIT) {
    session.output = session.output.slice(session.output.length - TRANSCRIPT_LIMIT);
  }
  clearTimeout(session.flushTimer);
  session.flushTimer = setTimeout(() => flushTranscript(session), 1000);
}

function flushTranscript(session) {
  if (!session) {
    return;
  }
  clearTimeout(session.flushTimer);
  try {
    fs.mkdirSync(getHistoryDir(), { recursive: true });
    fs.writeFileSync(getTranscriptPath(session.id), session.output || "", "utf8");
    scheduleGdrivePush();
  } catch {}
}

function flushAllTranscripts() {
  for (const session of sessions.values()) {
    flushTranscript(session);
  }
}

function readTranscript(id) {
  try {
    return fs.readFileSync(getTranscriptPath(id), "utf8");
  } catch {
    return "";
  }
}

function deleteTranscript(id) {
  try {
    fs.unlinkSync(getTranscriptPath(id));
  } catch {}
}

// Au demarrage : plafonne l'index et supprime les transcriptions orphelines
// (fichiers .log qui ne correspondent plus a aucune entree de l'index).
function pruneHistory() {
  let entries = loadHistoryIndex();
  if (entries.length > MAX_HISTORY) {
    const dropped = entries.splice(MAX_HISTORY);
    for (const entry of dropped) {
      deleteTranscript(entry.id);
    }
    saveHistoryIndex(entries);
  }

  try {
    const keep = new Set(entries.map((entry) => entry.id).filter(Boolean));
    const dir = getHistoryDir();
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".log")) {
        continue;
      }
      if (!keep.has(file.slice(0, -4))) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {}
      }
    }
  } catch {}
}

// Supprime une seule session de l'historique (entree + transcription).
function deleteHistoryEntry(id) {
  const entries = loadHistoryIndex().filter((entry) => entry.id !== id);
  saveHistoryIndex(entries);
  deleteTranscript(id);
}

// Vide tout l'historique global (index + transcriptions).
function clearHistory() {
  saveHistoryIndex([]);
  try {
    const dir = getHistoryDir();
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".log")) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {}
        }
      }
    }
  } catch {}
}

function setAppMenu() {
  const template = [
    {
      label: "Fichier",
      submenu: [
        { label: "Vérifier les mises à jour", click: () => checkForUpdatesManual() },
        { type: "separator" },
        { role: "quit", label: "Quitter" }
      ]
    },
    {
      label: "Edition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Refaire" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" }
      ]
    },
    {
      label: "Affichage",
      submenu: [
        // Note : le zoom de la police du terminal (Ctrl+= / Ctrl+- / Ctrl+0) et
        // "Forcer l'actualisation" sont gérés par les raccourcis de l'app. Les
        // rôles Electron correspondants sont retirés ici pour ne pas capter ces
        // touches avant le renderer.
        { role: "reload", label: "Actualiser" },
        { role: "toggleDevTools", label: "Outils de développement" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" }
      ]
    },
    {
      label: "Fenêtre",
      submenu: [
        { role: "minimize", label: "Réduire" },
        // Item personnalisé (sans rôle) pour libérer Ctrl+W au profit du
        // raccourci "Fermer l'onglet" du renderer.
        { label: "Fermer la fenêtre", click: (_item, win) => win && win.close() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#111318",
    title: "IA CLI Launcher",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Synchro Google Drive au demarrage : on tire le contenu distant le plus
  // recent, puis on demande au renderer de recharger config + historique.
  mainWindow.webContents.once("did-finish-load", () => {
    if (!gdrive.isConnected()) {
      return;
    }
    gdrive
      .syncOnce(getDataDir())
      .then((res) => {
        if (res?.ok && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("gdrive:synced", gdrive.getStatus(), res.pulled > 0);
        }
      })
      .catch(() => {});
  });
  mainWindow.on("close", () => {
    flushAllTranscripts();
    saveSessionsToDisk();
  });

  mainWindow.webContents.on("context-menu", (event, params) => {
    // Terminal areas handle their own context menu via IPC; skip when nothing is editable or selected.
    if (!params.isEditable && !params.selectionText) {
      return;
    }
    const menu = Menu.buildFromTemplate([
      { role: "cut", label: "Couper", visible: params.isEditable },
      { role: "copy", label: "Copier", visible: params.selectionText.length > 0 },
      { role: "paste", label: "Coller", visible: params.isEditable },
      { type: "separator" },
      { role: "selectAll", label: "Tout sélectionner" }
    ]);
    menu.popup();
  });

  mainWindow.on("closed", () => {
    for (const session of sessions.values()) {
      try {
        session.pty.kill();
      } catch {
        // Session already closed.
      }
    }
    sessions.clear();
    mainWindow = null;
  });
}

function getConfigPath() {
  return path.join(getDataDir(), "profiles.json");
}

function cloneDefaultProfiles() {
  return JSON.parse(JSON.stringify(defaultProfiles));
}

function cloneDefaultPersonas() {
  return JSON.parse(JSON.stringify(defaultPersonas));
}

// Personas : si la cle est absente on amorce avec la liste par defaut ; si elle
// existe (meme vide, l'utilisateur a tout supprime) on la respecte.
function normalizePersonas(personas) {
  if (!Array.isArray(personas)) {
    return cloneDefaultPersonas();
  }
  return personas
    .filter((persona) => persona && persona.id)
    .map((persona) => ({
      id: String(persona.id),
      name: String(persona.name || "Persona"),
      accent: String(persona.accent || "#64748b"),
      prompt: String(persona.prompt || "")
    }));
}

// --- Injection de persona (system prompt) au lancement d'une CLI -----------
const PERSONA_BLOCK_START = "<!-- IA-CLI-LAUNCHER:PERSONA:start (gere automatiquement, ne pas editer) -->";
const PERSONA_BLOCK_END = "<!-- IA-CLI-LAUNCHER:PERSONA:end -->";
const PERSONA_BLOCK_RE = /\n*<!-- IA-CLI-LAUNCHER:PERSONA:start[\s\S]*?<!-- IA-CLI-LAUNCHER:PERSONA:end -->\n*/g;

// Ecrit la persona dans un fichier temporaire (pour les CLI qui acceptent un
// fichier en argument, ex. Claude --append-system-prompt-file, Aider --read).
function writePersonaTempFile(prompt) {
  const dir = path.join(app.getPath("temp"), "ia-cli-launcher-personas");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `persona-${crypto.randomUUID()}.md`);
  fs.writeFileSync(file, prompt, "utf8");
  return file;
}

// Insere/retire un bloc balise dans le fichier de contexte du projet, en
// preservant le contenu existant hors du bloc.
function applyPersonaToProjectFile(cwd, fileName, prompt) {
  if (!cwd || !fileName) {
    return;
  }
  const filePath = path.join(cwd, fileName);
  let content = "";
  try {
    content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  } catch {
    content = "";
  }

  content = content.replace(PERSONA_BLOCK_RE, "\n").trim();
  if (prompt) {
    // Bloc place EN TETE : certaines CLI (ex. Codex, project_doc_max_bytes)
    // ne lisent que le debut du fichier de contexte. La persona doit donc
    // passer avant le reste pour ne jamais etre tronquee.
    const block = `${PERSONA_BLOCK_START}\n${prompt}\n${PERSONA_BLOCK_END}`;
    content = content ? `${block}\n\n${content}\n` : `${block}\n`;
  } else if (content) {
    content = `${content}\n`;
  }

  try {
    fs.writeFileSync(filePath, content, "utf8");
  } catch {}
}

// Renvoie les args eventuellement enrichis selon la methode d'injection.
function applyPersonaInjection({ injection, prompt, cwd, launchArgs }) {
  const text = String(prompt || "").trim();
  if (!text || !injection || !injection.kind) {
    return launchArgs;
  }
  if (injection.kind === "arg-file" && injection.flag) {
    return [...launchArgs, injection.flag, writePersonaTempFile(text)];
  }
  if (injection.kind === "arg" && injection.flag) {
    return [...launchArgs, injection.flag, text];
  }
  if (injection.kind === "prompt-arg") {
    // Persona injectee comme premier message (consigne forte). On borne la
    // taille pour rester sous la limite de longueur de ligne de commande, et on
    // met tout sur UNE seule ligne : un argument multi-lignes est decoupe par
    // PowerShell/conpty (la CLI recevrait alors plusieurs arguments parasites).
    const MAX_PROMPT = 8000;
    const trimmed = text.length > MAX_PROMPT ? text.slice(-MAX_PROMPT) : text;
    const oneLine = trimmed.replace(/\s+/g, " ").trim();
    const framed = `[Consignes a respecter STRICTEMENT pendant toute cette session, comme si elles faisaient partie de ta configuration] ${oneLine}`;
    return [...launchArgs, framed];
  }
  if (injection.kind === "project-file" && injection.file) {
    applyPersonaToProjectFile(cwd, injection.file, text);
    return launchArgs;
  }
  return launchArgs;
}

function normalizeConfig(config) {
  const incomingProfiles = Array.isArray(config?.profiles) ? config.profiles : [];
  const incomingById = new Map(incomingProfiles.map((profile) => [profile.id, profile]));
  const defaultById = new Map(defaultProfiles.map((profile) => [profile.id, profile]));

  const mergedDefaults = cloneDefaultProfiles().map((defaultProfile) => {
    const incoming = incomingById.get(defaultProfile.id);
    if (!incoming) {
      return defaultProfile;
    }

    const incomingModesById = new Map((incoming.modes || []).map((mode) => [mode.id, mode]));
    const defaultModes = (defaultProfile.modes || []).map((defaultMode) => ({
      ...defaultMode,
      ...(incomingModesById.get(defaultMode.id) || {})
    }));
    const customModes = (incoming.modes || []).filter((mode) => !defaultModes.some((item) => item.id === mode.id));

    return {
      ...defaultProfile,
      ...incoming,
      modes: [...defaultModes, ...customModes],
      // Mecanismes internes (non editables par l'utilisateur) : toujours pris des
      // valeurs par defaut pour que les mises a jour de methode s'appliquent.
      authChecks: defaultProfile.authChecks,
      personaInjection: defaultProfile.personaInjection,
      headless: defaultProfile.headless
    };
  });

  const customProfiles = incomingProfiles.filter((profile) => profile.id && !defaultById.has(profile.id));
  return {
    version: 1,
    profiles: [...mergedDefaults, ...customProfiles],
    personas: normalizePersonas(config?.personas)
  };
}

function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    const initialConfig = normalizeConfig({ version: 1, profiles: defaultProfiles });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf8");
    return initialConfig;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!Array.isArray(parsed.profiles)) {
      throw new Error("profiles manquant");
    }
    const normalized = normalizeConfig(parsed);
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), "utf8");
    return normalized;
  } catch (error) {
    const backupPath = `${configPath}.broken-${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    const fallbackConfig = normalizeConfig({ version: 1, profiles: defaultProfiles });
    fs.writeFileSync(configPath, JSON.stringify(fallbackConfig, null, 2), "utf8");
    return fallbackConfig;
  }
}

function writeConfig(config) {
  const normalized = normalizeConfig(config);
  fs.writeFileSync(getConfigPath(), JSON.stringify(normalized, null, 2), "utf8");
  scheduleGdrivePush();
  return normalized;
}

function splitArgs(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String);
  }

  const input = String(value || "").trim();
  if (!input) {
    return [];
  }

  const args = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function joinCommandChain(commands) {
  return commands.filter((command) => String(command || "").trim()).join("; ");
}

function validateCwd(cwd) {
  if (!cwd || typeof cwd !== "string") {
    throw new Error("Selectionne un dossier de lancement.");
  }

  const resolved = path.resolve(cwd);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Le chemin choisi n'est pas un dossier.");
  }

  return resolved;
}

function isElevated() {
  return platform.isElevated();
}

function checkCommand(command) {
  return platform.checkCommand(command);
}

function expandKnownPath(value) {
  const homePath = app.getPath("home");
  const replacements = {
    APPDATA: process.env.APPDATA || app.getPath("appData"),
    HOME: process.env.HOME || homePath,
    LOCALAPPDATA: process.env.LOCALAPPDATA || "",
    USERPROFILE: process.env.USERPROFILE || homePath
  };

  let expanded = String(value || "").trim();
  expanded = expanded.replace(/^~(?=$|[\\/])/, homePath);
  expanded = expanded.replace(/%([A-Z0-9_]+)%/gi, (_match, name) => replacements[name.toUpperCase()] || "");
  return path.normalize(expanded);
}

function checkAuthFile(rule) {
  const displayPath = String(typeof rule === "string" ? rule : rule?.path || "").trim();
  const label = String(typeof rule === "string" ? rule : rule?.label || displayPath || "Config");
  if (!displayPath) {
    return {
      label,
      path: "",
      ok: false
    };
  }

  const resolvedPath = expandKnownPath(displayPath);
  let ok = false;

  try {
    const stat = fs.statSync(resolvedPath);
    ok = stat.isDirectory() || stat.size > 0;
  } catch {
    ok = false;
  }

  return {
    label,
    path: displayPath,
    ok
  };
}

function getEnvTokenStatus(name) {
  const key = String(name || "").trim();
  return {
    name: key,
    ok: Boolean(key && String(process.env[key] || "").trim())
  };
}

async function getProfileAuthStatus(profile) {
  const command = await checkCommand(profile.command);
  const checks = profile.authChecks || {};
  const envChecks = Array.isArray(checks.env) ? checks.env.map(getEnvTokenStatus).filter((item) => item.name) : [];
  const fileChecks = Array.isArray(checks.files) ? checks.files.map(checkAuthFile) : [];
  const hasToken = envChecks.some((item) => item.ok);
  const hasConfig = fileChecks.some((item) => item.ok);
  const hasRules = envChecks.length > 0 || fileChecks.length > 0;

  let state = "bad";
  let summary = "CLI non detectee";

  if (hasToken || hasConfig) {
    state = "ok";
    summary = hasToken ? "Token detecte" : "Connexion locale detectee";
  } else if (!hasRules) {
    state = command.ok ? "unknown" : "bad";
    summary = command.ok ? "Regles token non configurees" : "CLI non detectee";
  } else if (command.ok) {
    state = "warning";
    summary = "Aucun token visible";
  }

  return {
    id: profile.id,
    label: profile.label,
    command: profile.command,
    commandOk: command.ok,
    commandPath: command.output.split(/\r?\n/)[0] || "",
    state,
    summary,
    envChecks,
    fileChecks
  };
}

async function getAuthStatuses() {
  const config = readConfig();
  const profiles = await Promise.all(config.profiles.map(getProfileAuthStatus));
  return {
    generatedAt: new Date().toISOString(),
    profiles
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function startShellSession(request) {
  const cwd = validateCwd(request.cwd || app.getPath("home"));
  const commandLine = String(request.commandLine || "").trim();
  if (!commandLine) {
    throw new Error("Commande manquante.");
  }

  // Reprise d'une session existante (restauration au demarrage ou bouton
  // "Reprendre" de l'historique) : on reutilise l'identifiant d'origine pour
  // ne pas creer de doublon dans l'historique. Repli sur un nouvel id si cet
  // identifiant correspond deja a une session vivante.
  const resumeId = String(request.resumeId || "").trim();
  const id = resumeId && !sessions.has(resumeId) ? resumeId : crypto.randomUUID();
  const { command: shellCommand, args: shellArgs } = platform.getShell(commandLine);

  const ptyProcess = pty.spawn(shellCommand, shellArgs, {
    name: "xterm-256color",
    cols: Number(request.cols) || 100,
    rows: Number(request.rows) || 30,
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      TERM: "xterm-256color"
    }
  });

  sessions.set(id, {
    id,
    pty: ptyProcess,
    cwd,
    title: request.title,
    command: commandLine,
    extraArgs: String(request.extraArgs || ""),
    output: "",
    flushTimer: null,
    profileId: request.profileId,
    profileLabel: request.profileLabel,
    modeId: request.modeId,
    modeLabel: request.modeLabel
  });
  addHistoryEntry(sessions.get(id));
  saveSessionsToDisk();

  ptyProcess.onData((data) => {
    appendTranscript(id, data);
    sendToRenderer("terminal:data", { id, data });
  });
  ptyProcess.onExit(({ exitCode, signal }) => {
    const session = sessions.get(id);
    if (session) {
      flushTranscript(session);
    }
    // La session terminee reste dans l'historique global (transcription
    // conservee) ; on note seulement l'heure de fin.
    updateHistoryEntry(id, { endedAt: new Date().toISOString() });
    sessions.delete(id);
    saveSessionsToDisk();
    sendToRenderer("terminal:exit", { id, exitCode, signal });
  });

  return {
    id,
    command: commandLine,
    cwd
  };
}

// --- Mise a jour automatique (electron-updater + GitHub Releases) ---------
// Vrai pendant une verification declenchee manuellement (menu Fichier), pour
// afficher un retour visible meme quand aucune mise a jour n'est disponible.
let manualCheck = false;

function setupAutoUpdater() {
  // En developpement, aucune source de mise a jour n'est disponible : on ignore.
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendToRenderer("update:status", { state: "checking", manual: manualCheck });
  });
  autoUpdater.on("update-available", (info) => {
    sendToRenderer("update:status", { state: "available", version: info?.version, manual: manualCheck });
    manualCheck = false;
  });
  autoUpdater.on("update-not-available", () => {
    sendToRenderer("update:status", { state: "none", manual: manualCheck });
    manualCheck = false;
  });
  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update:status", {
      state: "downloading",
      percent: Math.round(progress?.percent || 0)
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("update:status", { state: "downloaded", version: info?.version });
  });
  autoUpdater.on("error", (error) => {
    sendToRenderer("update:status", { state: "error", message: String(error?.message || error), manual: manualCheck });
    manualCheck = false;
  });

  autoUpdater.checkForUpdates().catch(() => {});
  // Verification periodique (toutes les 4 heures) tant que l'app reste ouverte.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// Verification manuelle declenchee par le menu Fichier > Verifier les mises a jour.
function checkForUpdatesManual() {
  if (!app.isPackaged) {
    // En dev, l'updater est inactif : on previent l'utilisateur.
    sendToRenderer("update:status", { state: "dev", manual: true });
    return;
  }
  manualCheck = true;
  sendToRenderer("update:status", { state: "checking", manual: true });
  autoUpdater.checkForUpdates().catch((error) => {
    sendToRenderer("update:status", { state: "error", message: String(error?.message || error), manual: true });
    manualCheck = false;
  });
}

app.whenReady().then(() => {
  pruneHistory();
  setAppMenu();
  createWindow();
  setupAutoUpdater();

  ipcMain.handle("app:get-state", () => ({
    isPackaged: app.isPackaged,
    isElevated: isElevated(),
    userDataPath: app.getPath("userData"),
    homePath: app.getPath("home"),
    appVersion: app.getVersion(),
    platform: process.platform,
    isWindows: platform.isWindows,
    shellLabel: platform.getShellLabel()
  }));

  ipcMain.handle("dialog:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le dossier de lancement",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("config:get", () => readConfig());
  ipcMain.handle("config:save", (_event, config) => writeConfig(config));
  ipcMain.handle("config:reset", () => writeConfig({ version: 1, profiles: defaultProfiles }));
  ipcMain.handle("auth:get-status", () => getAuthStatuses());

  // Synchronisation des donnees du launcher (dossier cloud choisi).
  ipcMain.handle("sync:get", () => {
    const custom = readSyncDir();
    return {
      dataDir: custom || app.getPath("userData"),
      localDir: app.getPath("userData"),
      isCustom: Boolean(custom)
    };
  });

  ipcMain.handle("sync:set", (_event, folder) => {
    const target = String(folder || "").trim();
    if (!target) {
      return { ok: false, error: "Dossier invalide." };
    }
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
    // Amorce le dossier cible avec les donnees actuelles, sans ecraser ce qui
    // s'y trouverait deja (autre PC ayant deja peuple le dossier).
    seedDataDir(getDataDir(), target);
    try {
      fs.writeFileSync(getSyncSettingsPath(), JSON.stringify({ dataDir: target }, null, 2), "utf8");
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
    setTimeout(relaunchApp, 250);
    return { ok: true };
  });

  ipcMain.handle("sync:disable", () => {
    const current = readSyncDir();
    if (current) {
      // Rapatrie les donnees synchronisees en local avant de repasser en local.
      pullDataDir(current, app.getPath("userData"));
    }
    try {
      fs.rmSync(getSyncSettingsPath(), { force: true });
    } catch {}
    setTimeout(relaunchApp, 250);
    return { ok: true };
  });

  // --- Synchronisation native Google Drive (sans Google Drive Desktop) ---
  ipcMain.handle("gdrive:status", () => gdrive.getStatus());

  ipcMain.handle("gdrive:set-credentials", (_event, creds) =>
    gdrive.setCredentials(creds?.clientId, creds?.clientSecret)
  );

  ipcMain.handle("gdrive:connect", async () => {
    const result = await gdrive.connect();
    if (result.ok) {
      // Premiere synchro juste apres la connexion (tire le contenu distant).
      const sync = await gdrive.syncOnce(getDataDir());
      return { ...result, sync, status: gdrive.getStatus() };
    }
    return result;
  });

  ipcMain.handle("gdrive:disconnect", async () => {
    const result = await gdrive.disconnect();
    return { ...result, status: gdrive.getStatus() };
  });

  ipcMain.handle("gdrive:sync-now", async () => {
    const result = await gdrive.syncOnce(getDataDir());
    return { ...result, status: gdrive.getStatus() };
  });

  // Pipeline IA : execute une etape en mode non-interactif et renvoie sa sortie.
  // La sortie est aussi diffusee en direct (streaming) au renderer.
  ipcMain.handle("pipeline:run-step", (event, request) => {
    const runId = request?.runId;
    return pipeline.runHeadlessStep({
      command: request?.command,
      args: Array.isArray(request?.args) ? request.args : [],
      prompt: request?.prompt || "",
      cwd: request?.cwd || "",
      stdin: Boolean(request?.stdin),
      timeoutMs: Number(request?.timeoutMs) || 1800000,
      onChunk: (chunk) => {
        if (runId && !event.sender.isDestroyed()) {
          event.sender.send("pipeline:step-output", { runId, chunk });
        }
      }
    });
  });

  ipcMain.handle("pipeline:cancel", () => pipeline.cancel());

  ipcMain.handle("system:open-url", (_event, url) => {
    const target = String(url || "").trim();
    if (/^https?:\/\//i.test(target)) {
      shell.openExternal(target);
      return true;
    }
    return false;
  });

  ipcMain.handle("system:check-command", async (_event, command) => {
    return checkCommand(command);
  });

  // Indique si un chemin existe et est un dossier (utile pour la reprise d'un
  // historique synchronisé depuis un autre PC : le dossier d'origine peut manquer).
  ipcMain.handle("system:dir-exists", (_event, dirPath) => {
    try {
      return fs.statSync(path.resolve(String(dirPath || ""))).isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle("terminal:start", (_event, request) => {
    const command = String(request.command || "").trim();
    if (!command) {
      throw new Error("Commande CLI manquante.");
    }

    const modeArgs = splitArgs(request.modeArgs);
    const extraArgs = splitArgs(request.extraArgs);
    const resumeArgs = splitArgs(request.resumeArgs);
    const preLaunchCommands = Array.isArray(request.preLaunchCommands) ? request.preLaunchCommands : [];

    // Reprise de conversation :
    // - resumeReplace=true : la sous-commande de reprise remplace les args de mode
    //   (ex. "codex resume --last", "cursor-agent resume").
    // - sinon : on ajoute le flag de reprise aux args habituels
    //   (ex. "claude --continue", "opencode --continue").
    let launchArgs;
    if (request.resumeReplace && resumeArgs.length > 0) {
      launchArgs = resumeArgs;
    } else {
      launchArgs = [...modeArgs, ...extraArgs, ...resumeArgs];
    }

    // Persona (system prompt) : injection par argument ou par fichier de
    // contexte selon la methode declaree par le profil.
    launchArgs = applyPersonaInjection({
      injection: request.personaInjection,
      prompt: request.personaPrompt,
      cwd: request.cwd,
      launchArgs
    });

    const fullCommand = joinCommandChain([
      ...preLaunchCommands,
      platform.buildCommandLine(command, launchArgs)
    ]);

    return startShellSession({
      title: request.title,
      commandLine: fullCommand,
      cwd: request.cwd,
      extraArgs: request.extraArgs,
      resumeId: request.resumeId,
      profileId: request.profileId,
      profileLabel: request.profileLabel,
      modeId: request.modeId,
      modeLabel: request.modeLabel,
      cols: request.cols,
      rows: request.rows
    });
  });

  ipcMain.handle("terminal:run-command", (_event, request) => {
    return startShellSession({
      title: request.title,
      commandLine: request.commandLine,
      cwd: request.cwd || app.getPath("home"),
      resumeId: request.resumeId,
      profileId: request.profileId,
      profileLabel: request.profileLabel,
      modeId: request.modeId,
      modeLabel: request.modeLabel,
      cols: request.cols,
      rows: request.rows
    });
  });

  ipcMain.handle("terminal:input", (_event, { id, data }) => {
    const session = sessions.get(id);
    if (session) {
      session.pty.write(String(data));
    }
  });

  ipcMain.handle("terminal:resize", (_event, { id, cols, rows }) => {
    const session = sessions.get(id);
    if (session) {
      session.pty.resize(Math.max(20, Number(cols) || 80), Math.max(8, Number(rows) || 24));
    }
  });

  ipcMain.handle("terminal:rename", (_event, { id, title }) => {
    const session = sessions.get(id);
    if (session) {
      session.title = String(title || "");
      updateHistoryEntry(id, { title: session.title });
      saveSessionsToDisk();
      return { ok: true, title: session.title };
    }
    return false;
  });

  ipcMain.handle("terminal:kill", (_event, id) => {
    const session = sessions.get(id);
    if (!session) {
      return false;
    }

    flushTranscript(session);
    // La transcription reste dans l'historique global ; on note la fin.
    updateHistoryEntry(id, { endedAt: new Date().toISOString() });
    session.pty.kill();
    sessions.delete(id);
    saveSessionsToDisk();
    return true;
  });

  ipcMain.handle("sessions:get-saved", () => loadSessionsFromDisk());
  ipcMain.handle("sessions:read-scrollback", (_event, id) => readTranscript(id));

  ipcMain.handle("history:list", () => loadHistoryIndex());
  ipcMain.handle("history:read", (_event, id) => readTranscript(id));
  ipcMain.handle("history:delete", (_event, id) => {
    deleteHistoryEntry(id);
    return true;
  });
  ipcMain.handle("history:clear", () => {
    clearHistory();
    return true;
  });

  ipcMain.handle("update:check", () => {
    if (!app.isPackaged) {
      return { ok: false, reason: "dev" };
    }
    autoUpdater.checkForUpdates().catch(() => {});
    return { ok: true };
  });
  ipcMain.handle("update:install", () => {
    // Quitte et installe la mise a jour deja telechargee.
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });

  ipcMain.handle("terminal:context-menu", (_event, { id, selectedText }) => {
    const hasSelection = Boolean(selectedText && selectedText.trim());
    const menuItems = [];

    if (hasSelection) {
      menuItems.push({
        label: "Copier",
        click: () => clipboard.writeText(selectedText)
      });
    }

    menuItems.push({
      label: "Coller",
      click: () => {
        const session = sessions.get(id);
        if (session) {
          const text = clipboard.readText();
          if (text) {
            session.pty.write(text);
          }
        }
      }
    });

    const menu = Menu.buildFromTemplate(menuItems);
    menu.popup({ window: mainWindow });
  });

  ipcMain.handle("terminal:paste-file-path", (_event, { id, filePath }) => {
    const session = sessions.get(id);
    if (!session || !filePath) {
      return false;
    }

    const quotedPath = platform.quoteArg(filePath);
    session.pty.write(quotedPath);
    return true;
  });
});

// Pousse une derniere fois vers Google Drive avant de quitter (si connecte),
// avec un garde-fou de 8 s pour ne jamais bloquer la fermeture.
let finalSyncDone = false;
app.on("before-quit", (event) => {
  if (finalSyncDone || !gdrive.isConnected()) {
    return;
  }
  event.preventDefault();
  finalSyncDone = true;
  try {
    flushAllTranscripts();
    saveSessionsToDisk();
  } catch {}
  Promise.race([
    gdrive.syncOnce(getDataDir()),
    new Promise((resolve) => setTimeout(resolve, 8000))
  ]).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
