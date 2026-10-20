// Suivi en temps reel du quota des CLI IA (affiche dans l'en-tete, a droite du
// titre de l'onglet). Aucune CLI n'est modifiee : on lit seulement ce qu'elles
// exposent deja.
// - Claude Code : endpoint d'utilisation du compte (celui de la commande
//   /usage), appele avec le jeton OAuth que Claude Code stocke localement.
//   Le jeton est seulement lu : son renouvellement reste gere par Claude Code.
// - Codex : les fichiers de session (~/.codex/sessions/**/rollout-*.jsonl)
//   contiennent des evenements "token_count" avec les rate_limits du compte.
// - Les autres CLI n'exposent pas de quota exploitable.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
// Intervalle minimal entre deux appels a l'API, toutes instances confondues
// (le resultat est mis en cache et partage).
const CLAUDE_REFRESH_MS = 2 * 60 * 1000;
// Pause croissante si l'API limite les appels (HTTP 429).
const CLAUDE_BACKOFF_MS = 5 * 60 * 1000;
const CLAUDE_BACKOFF_MAX_MS = 30 * 60 * 1000;

const claudeCache = {
  data: null,
  fetchedAt: 0,
  nextFetchAt: 0,
  error: "",
  pending: null
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

// Libelle lisible d'une fenetre de quota a partir de sa duree en minutes.
function windowLabel(minutes) {
  const value = Number(minutes);
  if (!value) {
    return "";
  }
  if (value % 1440 === 0) {
    return `${value / 1440} j`;
  }
  if (value % 60 === 0) {
    return `${value / 60} h`;
  }
  return `${value} min`;
}

// Une fenetre dont l'heure de reinitialisation est passee repart de zero.
function normalizeWindow({ id, label, usedPercent, resetsAt }) {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) {
    return null;
  }
  if (resetsAt && resetsAt <= Date.now()) {
    return { id, label, usedPercent: 0, resetsAt: null, reset: true };
  }
  return { id, label, usedPercent: Math.max(0, Math.min(100, usedPercent)), resetsAt: resetsAt || null };
}

// --- Claude Code -----------------------------------------------------------

function readClaudeToken() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const oauth = readJson(path.join(configDir, ".credentials.json"))?.claudeAiOauth;
  if (!oauth?.accessToken) {
    return null;
  }
  return { accessToken: oauth.accessToken, expiresAt: Number(oauth.expiresAt) || 0 };
}

function claudeWindows(data) {
  const entries = [
    ["five_hour", "5 h"],
    ["seven_day", "7 j"],
    ["seven_day_opus", "7 j Opus"],
    ["seven_day_sonnet", "7 j Sonnet"]
  ];
  return entries
    .map(([key, label]) => {
      const win = data?.[key];
      if (!win) {
        return null;
      }
      return normalizeWindow({
        id: key,
        label,
        usedPercent: win.utilization,
        resetsAt: Date.parse(win.resets_at || "") || null
      });
    })
    .filter(Boolean);
}

// Cache disque partage par toutes les instances du launcher (app installee,
// version de test...) : une seule interroge Anthropic, les autres relisent ce
// fichier. Il survit aussi aux redemarrages (dernieres valeurs connues).
const SHARED_CACHE_FILE = path.join(os.tmpdir(), "ia-cli-launcher-claude-usage.json");

function loadSharedCache() {
  const shared = readJson(SHARED_CACHE_FILE);
  if (!shared) {
    return;
  }
  if (shared.data && (shared.fetchedAt || 0) > claudeCache.fetchedAt) {
    claudeCache.data = shared.data;
    claudeCache.fetchedAt = shared.fetchedAt;
    claudeCache.error = "";
  }
  claudeCache.nextFetchAt = Math.max(claudeCache.nextFetchAt, shared.nextFetchAt || 0);
  claudeCache.backoffMs = Math.max(claudeCache.backoffMs || 0, shared.backoffMs || 0);
  if (shared.error && !claudeCache.data) {
    claudeCache.error = shared.error;
  }
}

function saveSharedCache() {
  try {
    fs.writeFileSync(SHARED_CACHE_FILE, JSON.stringify({
      data: claudeCache.data,
      fetchedAt: claudeCache.fetchedAt,
      nextFetchAt: claudeCache.nextFetchAt,
      backoffMs: claudeCache.backoffMs || 0,
      error: claudeCache.error
    }), "utf8");
  } catch {}
}

async function fetchClaudeUsage() {
  // Une autre instance a peut-etre deja interroge Anthropic (ou est en pause).
  loadSharedCache();
  if (Date.now() < claudeCache.nextFetchAt) {
    return;
  }
  // On reserve le prochain appel avant meme d'interroger (evite les doublons).
  claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
  saveSharedCache();
  await requestClaudeUsage();
  saveSharedCache();
}

async function requestClaudeUsage() {
  const token = readClaudeToken();
  if (!token) {
    claudeCache.error = "Connecte-toi à Claude Code (abonnement Pro / Max) pour voir le quota.";
    claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
    return;
  }
  // Jeton expire : Claude Code le renouvellera a sa prochaine requete. On garde
  // les dernieres valeurs connues en attendant.
  if (token.expiresAt && token.expiresAt <= Date.now()) {
    claudeCache.error = claudeCache.data ? "" : "Jeton Claude expiré : envoie un message dans Claude pour le renouveler.";
    claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
    return;
  }

  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 429) {
      // Limite d'appels : attente croissante (5, 10, 20 puis 30 min), ou celle
      // demandee par le serveur ; les dernieres valeurs restent affichees.
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      claudeCache.backoffMs = Math.min(CLAUDE_BACKOFF_MAX_MS, claudeCache.backoffMs ? claudeCache.backoffMs * 2 : CLAUDE_BACKOFF_MS);
      claudeCache.nextFetchAt = Date.now() + Math.max(retryAfter || 0, claudeCache.backoffMs);
      const at = new Date(claudeCache.nextFetchAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      claudeCache.error = `Quota limité par Anthropic (trop de demandes) : nouvel essai à ${at}.`;
      return;
    }
    claudeCache.backoffMs = 0;
    if (!response.ok) {
      claudeCache.error = `Quota Claude indisponible (HTTP ${response.status}).`;
      claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
      return;
    }
    claudeCache.data = await response.json();
    claudeCache.fetchedAt = Date.now();
    claudeCache.error = "";
    claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
  } catch {
    claudeCache.error = claudeCache.data ? "" : "Quota Claude injoignable (réseau).";
    claudeCache.nextFetchAt = Date.now() + CLAUDE_REFRESH_MS;
  }
}

async function getClaudeUsage() {
  if (Date.now() >= claudeCache.nextFetchAt) {
    // Un seul appel en vol, partage par toutes les demandes simultanees.
    if (!claudeCache.pending) {
      claudeCache.pending = fetchClaudeUsage().finally(() => {
        claudeCache.pending = null;
      });
    }
    await claudeCache.pending;
  }

  const windows = claudeCache.data ? claudeWindows(claudeCache.data) : [];
  if (!windows.length) {
    return { available: false, reason: claudeCache.error || "Quota Claude indisponible." };
  }
  // "notice" : valeurs affichees mais pas a jour (ex. limite d'appels).
  return { available: true, windows, updatedAt: claudeCache.fetchedAt, notice: claudeCache.error || "" };
}

// --- Codex -----------------------------------------------------------------

function listDirsDesc(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Fichier de session Codex le plus recemment modifie. On ne parcourt que les
// derniers jours (annee/mois/jour) : suffisant pour la session active.
function latestCodexRollout() {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  const days = [];
  outer: for (const year of listDirsDesc(root)) {
    for (const month of listDirsDesc(path.join(root, year))) {
      for (const day of listDirsDesc(path.join(root, year, month))) {
        days.push(path.join(root, year, month, day));
        if (days.length >= 3) {
          break outer;
        }
      }
    }
  }

  let best = null;
  for (const dir of days) {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".jsonl")) {
          continue;
        }
        const full = path.join(dir, file);
        const mtime = fs.statSync(full).mtimeMs;
        if (!best || mtime > best.mtime) {
          best = { file: full, mtime };
        }
      }
    } catch {}
  }
  return best;
}

function readTail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function codexWindow(id, fallbackLabel, win, lineTime) {
  if (!win) {
    return null;
  }
  let resetsAt = null;
  if (typeof win.resets_at === "number") {
    resetsAt = win.resets_at * 1000;
  } else if (typeof win.resets_in_seconds === "number" && lineTime) {
    resetsAt = lineTime + win.resets_in_seconds * 1000;
  }
  return normalizeWindow({
    id,
    label: windowLabel(win.window_minutes) || fallbackLabel,
    usedPercent: win.used_percent,
    resetsAt
  });
}

function getCodexUsage() {
  const rollout = latestCodexRollout();
  if (!rollout) {
    return { available: false, reason: "Aucune session Codex trouvée pour l'instant." };
  }

  // Dernier evenement portant des rate_limits, lu depuis la fin du fichier.
  const lines = readTail(rollout.file, 512 * 1024).split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!line.includes("rate_limits")) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const rateLimits = entry?.payload?.rate_limits || entry?.rate_limits;
    if (!rateLimits) {
      continue;
    }
    const lineTime = Date.parse(entry.timestamp || "") || rollout.mtime;
    const windows = [
      codexWindow("primary", "Court", rateLimits.primary, lineTime),
      codexWindow("secondary", "Long", rateLimits.secondary, lineTime)
    ].filter(Boolean);
    if (windows.length) {
      return { available: true, windows, updatedAt: lineTime };
    }
  }
  return { available: false, reason: "En attente du premier échange avec Codex…" };
}

// --- Point d'entree --------------------------------------------------------

async function getUsage({ profileId } = {}) {
  if (profileId === "claude") {
    return { profileId, ...(await getClaudeUsage()) };
  }
  if (profileId === "codex") {
    return { profileId, ...getCodexUsage() };
  }
  return { profileId, available: false, reason: "Quota non exposé par cette CLI." };
}

module.exports = { getUsage };
