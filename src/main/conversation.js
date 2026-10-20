// Retrouve la conversation exacte tenue par la CLI d'un onglet, pour la
// reprendre apres un redemarrage (ex. mise a jour de la CLI) sans rien perdre.
// - Claude Code : chaque processus interactif ecrit ~/.claude/sessions/<pid>.json
//   (identifiant de conversation, dossier, statut "busy"/"idle"). On repere le
//   processus Claude parmi les descendants du terminal de l'onglet.
// - Codex : chaque conversation est un fichier ~/.codex/sessions/AAAA/MM/JJ/
//   rollout-*.jsonl dont la 1re ligne (session_meta) donne l'id et le dossier.
//   On prend celle du meme dossier creee juste apres le lancement de l'onglet.
// - Autres CLI : pas d'identifiant exploitable (reprise generique ou contexte).
const { execFile } = require("node:child_process");
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

async function findClaudeConversation(rootPid) {
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
      return { conversationId: String(data.sessionId), busy: data.status === "busy" };
    }
  }
  return null;
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
        candidates.push({ id: String(payload.id), created });
      }
    }
  }
  // La plus proche du lancement de l'onglet : c'est celle qu'il a creee.
  candidates.sort((a, b) => a.created - b.created);
  return candidates.length ? { conversationId: candidates[0].id, busy: false } : null;
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

module.exports = { getConversationInfo };
