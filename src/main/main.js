const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const pty = require("@lydell/node-pty");
const { autoUpdater } = require("electron-updater");
const { defaultProfiles } = require("./defaultProfiles");
const platform = require("./platform");

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

function getSessionsPath() {
  return path.join(app.getPath("userData"), "sessions.json");
}

// Index de l'historique global (toutes sessions, terminees ou non).
function getHistoryIndexPath() {
  return path.join(app.getPath("userData"), "history.json");
}

// Dossier des transcriptions (sortie terminal capturee), un fichier par session.
function getHistoryDir() {
  return path.join(app.getPath("userData"), "history");
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
  return path.join(app.getPath("userData"), "profiles.json");
}

function cloneDefaultProfiles() {
  return JSON.parse(JSON.stringify(defaultProfiles));
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
      modes: [...defaultModes, ...customModes]
    };
  });

  const customProfiles = incomingProfiles.filter((profile) => profile.id && !defaultById.has(profile.id));
  return {
    version: 1,
    profiles: [...mergedDefaults, ...customProfiles]
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
