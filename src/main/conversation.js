// Retrouve la conversation exacte tenue par la CLI d'un onglet, pour la
// reprendre apres un redemarrage (ex. mise a jour de la CLI) sans rien perdre.
// - Claude Code : chaque processus interactif ecrit ~/.claude/sessions/<pid>.json
//   (identifiant de conversation, dossier, statut "busy"/"idle"). On repere le
//   processus Claude parmi les descendants du terminal de l'onglet.
// - Codex : chaque conversation est un fichier ~/.codex/sessions/AAAA/MM/JJ/
//   rollout-*.jsonl dont la 1re ligne (session_meta) donne l'id et le dossier.
//   On prend celle du meme dossier creee juste apres le lancement de l'onglet.
// - Autres CLI : pas d'identifiant exploitable (reprise generique ou contexte).
const { exec, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

// Table pid -> pid parent de tous les processus de la machine.
function listProcesses() {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "powershell.exe" : "ps";
    const args = isWindows
      ? ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"]
      : ["-A", "-o", "pid=,ppid="];
    execFile(command, args, { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      const parents = new Map();
      if (!error) {
        for (const line of String(stdout).split(/\r?\n/)) {
          const [pid, ppid] = line.trim().split(/\s+/).map(Number);
          if (pid) {
            parents.set(pid, ppid);
          }
        }
      }
      resolve(parents);
    });
  });
}

// Ensemble du processus racine et de tous ses descendants.
function descendantPids(rootPid, parents) {
  const result = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, ppid] of parents) {
      if (!result.has(pid) && result.has(ppid)) {
        result.add(pid);
        grew = true;
      }
    }
  }
  return result;
}

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Fichier d'etat ecrit par un processus Claude interactif.
function readClaudeProcessFile(pid) {
  const data = readJson(path.join(claudeConfigDir(), "sessions", `${pid}.json`));
  return data?.sessionId ? data : null;
}

// Processus Claude descendant du terminal d'un onglet (et son fichier d'etat).
async function findClaudeProcess(rootPid) {
  const dir = path.join(claudeConfigDir(), "sessions");
  let files;
  try {
    files = fs.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return null;
  }
  if (!files.length) {
    return null;
  }
  const pids = descendantPids(rootPid, await listProcesses());
  for (const name of files) {
    const data = readJson(path.join(dir, name));
    if (data?.sessionId && pids.has(Number(data.pid))) {
      return data;
    }
  }
  return null;
}

async function findClaudeConversation(rootPid) {
  const data = await findClaudeProcess(rootPid);
  return data ? { conversationId: String(data.sessionId), busy: data.status === "busy" } : null;
}

// Premiere ligne d'un fichier (la session_meta de Codex peut etre longue).
function readFirstLine(file, maxBytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, read).toString("utf8").replace(/^﻿/, "");
    const end = text.indexOf("\n");
    return end >= 0 ? text.slice(0, end) : text;
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

function samePath(a, b) {
  const left = path.resolve(String(a || ""));
  const right = path.resolve(String(b || ""));
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function findCodexConversation(cwd, startedAt) {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  const candidates = [];
  // Dossiers des jours couvrant le lancement de l'onglet jusqu'a aujourd'hui.
  const days = new Set();
  for (let time = startedAt - 86400000; time <= Date.now() + 86400000; time += 86400000) {
    const day = new Date(time);
    days.add(path.join(root, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")));
  }
  for (const dir of days) {
    let names;
    try {
      names = fs.readdirSync(dir).filter((name) => /^rollout-.*\.jsonl$/.test(name));
    } catch {
      continue;
    }
    for (const name of names) {
      let meta;
      try {
        meta = JSON.parse(readFirstLine(path.join(dir, name)));
      } catch {
        continue;
      }
      const payload = meta?.payload || {};
      const created = Date.parse(payload.timestamp || meta?.timestamp || "");
      // Petite marge : l'horodatage de la CLI et celui du launcher different un peu.
      if (meta?.type === "session_meta" && payload.id && samePath(payload.cwd, cwd) && created >= startedAt - 5000) {
        candidates.push({ id: String(payload.id), created, cliVersion: String(payload.cli_version || "") });
      }
    }
  }
  // La plus proche du lancement de l'onglet : c'est celle qu'il a creee.
  candidates.sort((a, b) => a.created - b.created);
  return candidates.length
    ? { conversationId: candidates[0].id, busy: false, cliVersion: candidates[0].cliVersion }
    : null;
}

// Renvoie { conversationId, busy } ou null si la conversation est introuvable.
async function getConversationInfo({ profileId, pid, cwd, startedAt }) {
  try {
    if (profileId === "claude" && pid) {
      return await findClaudeConversation(Number(pid));
    }
    if (profileId === "codex" && cwd && startedAt) {
      return findCodexConversation(cwd, Number(startedAt));
    }
  } catch {}
  return null;
}

// --- Etat en direct de l'IA d'un onglet (pastille d'onglet, mise a jour) ----
// Appele toutes les 2 s pour chaque onglet : les recherches couteuses (arbre
// des processus, fichiers Codex) sont mises en cache par terminal d'onglet.
const LOOKUP_RETRY_MS = 10 * 1000;
const INSTALLED_REFRESH_MS = 10 * 60 * 1000;
const liveCache = new Map();
const installedCache = new Map();
const VERSION_COMMANDS = { claude: "claude --version", codex: "codex --version" };

// Version installee de la CLI (rafraichie en arriere-plan, jamais bloquante).
function installedVersion(profileId) {
  const command = VERSION_COMMANDS[profileId];
  if (!command) {
    return "";
  }
  const entry = installedCache.get(profileId) || { version: "", checkedAt: 0, pending: false };
  if (!entry.pending && Date.now() - entry.checkedAt > INSTALLED_REFRESH_MS) {
    entry.pending = true;
    exec(command, { windowsHide: true, timeout: 20000 }, (error, stdout) => {
      const match = String(stdout || "").match(/\d+\.\d+\.\d+/);
      if (!error && match) {
        entry.version = match[0];
      }
      entry.checkedAt = Date.now();
      entry.pending = false;
    });
  }
  installedCache.set(profileId, entry);
  return entry.version;
}

// Vrai si la version a est strictement plus recente que b ("2.1.304" > "2.1.303").
function isNewer(a, b) {
  const left = String(a || "").split(".").map(Number);
  const right = String(b || "").split(".").map(Number);
  if (!a || !b || left.some(Number.isNaN) || right.some(Number.isNaN)) {
    return false;
  }
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

async function claudeLive(rootPid) {
  const cache = liveCache.get(rootPid) || { cliPid: 0, lookupAt: 0 };
  liveCache.set(rootPid, cache);
  let data = cache.cliPid ? readClaudeProcessFile(cache.cliPid) : null;
  if (!data && Date.now() - cache.lookupAt > LOOKUP_RETRY_MS) {
    cache.lookupAt = Date.now();
    data = await findClaudeProcess(rootPid);
    cache.cliPid = data ? Number(data.pid) : 0;
  }
  if (!data) {
    return { state: null, runningVersion: "" };
  }
  return { state: data.status === "busy" ? "busy" : "idle", runningVersion: String(data.version || "") };
}

function codexLive(rootPid, cwd, startedAt) {
  const cache = liveCache.get(rootPid) || { cliVersion: "", lookupAt: 0 };
  liveCache.set(rootPid, cache);
  if (!cache.cliVersion && Date.now() - cache.lookupAt > LOOKUP_RETRY_MS) {
    cache.lookupAt = Date.now();
    cache.cliVersion = findCodexConversation(cwd, startedAt)?.cliVersion || "";
  }
  // Codex n'expose pas son etat : le renderer le deduit de l'activite du terminal.
  return { state: null, runningVersion: cache.cliVersion };
}

// Renvoie { state: "busy"|"idle"|null, runningVersion, installedVersion, updatePending }.
async function getLiveStatus({ profileId, pid, cwd, startedAt }) {
  let live = { state: null, runningVersion: "" };
  try {
    if (profileId === "claude" && pid) {
      live = await claudeLive(Number(pid));
    } else if (profileId === "codex" && pid && cwd && startedAt) {
      live = codexLive(Number(pid), cwd, Number(startedAt));
    }
  } catch {}
  const installed = installedVersion(profileId);
  return {
    ...live,
    installedVersion: installed,
    updatePending: Boolean(live.runningVersion && installed && isNewer(installed, live.runningVersion))
  };
}

// Oubli du cache d'un terminal ferme.
function forgetLive(pid) {
  liveCache.delete(Number(pid));
}

module.exports = { getConversationInfo, getLiveStatus, forgetLive };
