// Explorateur des conversations Claude Code passees : Claude enregistre chaque
// conversation dans ~/.claude/projects/<dossier encode>/<id>.jsonl. On en lit
// seulement le debut (dossier, premier message) et la fin (titre, dernier
// message), avec un cache par fichier pour ne pas relire ce qui n'a pas change.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;
const cache = new Map();

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function readSlice(file, start, length) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

function parseLines(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

// Texte d'un message utilisateur "humain" (pas une commande, un resultat
// d'outil ou un message systeme injecte).
function userText(entry) {
  if (entry?.type !== "user" || entry.isMeta || entry.isSidechain) {
    return "";
  }
  const content = entry.message?.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.filter((part) => part?.type === "text").map((part) => part.text).join(" ");
  }
  text = text.trim();
  if (!text || text.startsWith("<") || text.startsWith("[Request interrupted")) {
    return "";
  }
  return text.replace(/\s+/g, " ").slice(0, 300);
}

function summarize(file, stat) {
  const head = parseLines(readSlice(file, 0, HEAD_BYTES));
  const tailStart = Math.max(0, stat.size - TAIL_BYTES);
  const tail = tailStart > 0 ? parseLines(readSlice(file, tailStart, TAIL_BYTES)) : head;

  let cwd = "";
  let gitBranch = "";
  let firstPrompt = "";
  for (const entry of head) {
    cwd = cwd || entry.cwd || "";
    gitBranch = gitBranch || entry.gitBranch || "";
    firstPrompt = firstPrompt || userText(entry);
    if (cwd && firstPrompt) {
      break;
    }
  }

  // Titre : celui donne par l'utilisateur, sinon celui genere par Claude,
  // sinon un ancien resume ; dernier message : "last-prompt" ou dernier user.
  let customTitle = "";
  let aiTitle = "";
  let summary = "";
  let lastPrompt = "";
  for (const entry of tail) {
    if (entry.type === "custom-title" && entry.customTitle) {
      customTitle = String(entry.customTitle);
    } else if (entry.type === "ai-title" && entry.aiTitle) {
      aiTitle = String(entry.aiTitle);
    } else if (entry.type === "summary" && entry.summary) {
      summary = String(entry.summary);
    } else if (entry.type === "last-prompt" && entry.lastPrompt) {
      lastPrompt = String(entry.lastPrompt).replace(/\s+/g, " ").slice(0, 300);
    } else {
      lastPrompt = userText(entry) || lastPrompt;
    }
    cwd = cwd || entry.cwd || "";
  }

  return {
    title: customTitle || aiTitle || summary || firstPrompt.slice(0, 80) || "(sans titre)",
    cwd,
    gitBranch,
    firstPrompt,
    lastPrompt
  };
}

// Liste les conversations, de la plus recente a la plus ancienne.
function listConversations({ limit = 400 } = {}) {
  const root = path.join(claudeConfigDir(), "projects");
  const files = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(root, dir.name)).filter((name) => /^[0-9a-f-]{36}\.jsonl$/i.test(name));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(root, dir.name, name);
      try {
        const stat = fs.statSync(file);
        if (stat.size > 0) {
          files.push({ file, stat });
        }
      } catch {}
    }
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const result = [];
  for (const { file, stat } of files.slice(0, limit)) {
    const key = `${file}|${stat.mtimeMs}|${stat.size}`;
    let info = cache.get(file);
    if (!info || info.key !== key) {
      info = { key, data: summarize(file, stat) };
      cache.set(file, info);
    }
    // Conversation sans aucun message utilisateur (ex. ouverte puis quittee).
    if (!info.data.firstPrompt && !info.data.lastPrompt) {
      continue;
    }
    let dirExists = false;
    try {
      dirExists = Boolean(info.data.cwd) && fs.statSync(info.data.cwd).isDirectory();
    } catch {}
    result.push({
      id: path.basename(file, ".jsonl"),
      ...info.data,
      dirExists,
      updatedAt: stat.mtimeMs,
      size: stat.size
    });
  }
  return result;
}

module.exports = { listConversations };
