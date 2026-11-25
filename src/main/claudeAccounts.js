// Multi-compte Claude Code : chaque compte a son propre dossier de
// configuration (variable CLAUDE_CONFIG_DIR de Claude Code), donc ses propres
// identifiants, conversations et quotas. Le compte "principal" est le dossier
// habituel (~/.claude) ; les autres vivent dans ~/.ia-cli-launcher/claude/<id>.
// La liste est rangee dans ~/.ia-cli-launcher (partagee par l'app installee et
// la version de developpement, jamais synchronisee : les chemins et les
// identifiants sont propres a ce PC).
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ID = "default";
const ROOT = path.join(os.homedir(), ".ia-cli-launcher");
const ACCOUNTS_ROOT = path.join(ROOT, "claude");
const REGISTRY_FILE = path.join(ROOT, "claude-accounts.json");
// Reglages repris du compte principal a la creation d'un compte (jamais les
// identifiants ni les conversations).
const COPIED_FILES = ["settings.json", "CLAUDE.md"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function readRegistry() {
  const data = readJson(REGISTRY_FILE) || {};
  const accounts = Array.isArray(data.accounts) ? data.accounts.filter((a) => a?.id && a.id !== DEFAULT_ID) : [];
  return {
    defaultLabel: String(data.defaultLabel || "Principal"),
    activeId: String(data.activeId || DEFAULT_ID),
    accounts
  };
}

function writeRegistry(registry) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf8");
}

// Dossier de configuration d'un compte (compte inconnu : compte principal).
function configDirFor(accountId) {
  if (!accountId || accountId === DEFAULT_ID) {
    return defaultConfigDir();
  }
  const account = readRegistry().accounts.find((a) => a.id === accountId);
  return account ? path.join(ACCOUNTS_ROOT, account.id) : defaultConfigDir();
}

// Identifiant reellement utilise (un compte supprime retombe sur le principal).
function resolveId(accountId) {
  if (!accountId || accountId === DEFAULT_ID) {
    return DEFAULT_ID;
  }
  return readRegistry().accounts.some((a) => a.id === accountId) ? accountId : DEFAULT_ID;
}

// Compte choisi par defaut pour les nouveaux onglets Claude.
function activeId() {
  return resolveId(readRegistry().activeId);
}

// Variables d'environnement a donner au terminal d'un onglet Claude.
function envFor(accountId) {
  const id = resolveId(accountId);
  return id === DEFAULT_ID ? {} : { CLAUDE_CONFIG_DIR: configDirFor(id) };
}

// Fichier ".claude.json" (compte connecte, preferences) : a cote du dossier
// pour le compte principal sans CLAUDE_CONFIG_DIR, dedans sinon.
function globalConfigFile(accountId) {
  const id = resolveId(accountId);
  if (id === DEFAULT_ID && !process.env.CLAUDE_CONFIG_DIR) {
    return path.join(os.homedir(), ".claude.json");
  }
  return path.join(configDirFor(id), ".claude.json");
}

function describe(id, label) {
  const configDir = configDirFor(id);
  const oauth = readJson(path.join(configDir, ".credentials.json"))?.claudeAiOauth || null;
  const account = readJson(globalConfigFile(id))?.oauthAccount || null;
  return {
    id,
    label,
    configDir,
    isDefault: id === DEFAULT_ID,
    loggedIn: Boolean(oauth?.accessToken || oauth?.refreshToken),
    email: String(account?.emailAddress || ""),
    organization: String(account?.organizationName || ""),
    plan: String(oauth?.subscriptionType || "")
  };
}

function list() {
  const registry = readRegistry();
  return {
    activeId: resolveId(registry.activeId),
    accounts: [
      describe(DEFAULT_ID, registry.defaultLabel),
      ...registry.accounts.map((a) => describe(a.id, a.label))
    ]
  };
}

function add(label) {
  const name = String(label || "").trim().slice(0, 40) || "Compte";
  const registry = readRegistry();
  const id = crypto.randomUUID().slice(0, 8);
  const dir = path.join(ACCOUNTS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of COPIED_FILES) {
    try {
      fs.copyFileSync(path.join(defaultConfigDir(), file), path.join(dir, file));
    } catch {}
  }
  registry.accounts.push({ id, label: name, createdAt: new Date().toISOString() });
  writeRegistry(registry);
  return list();
}

function rename(accountId, label) {
  const name = String(label || "").trim().slice(0, 40);
  if (!name) {
    return list();
  }
  const registry = readRegistry();
  if (accountId === DEFAULT_ID) {
    registry.defaultLabel = name;
  } else {
    const account = registry.accounts.find((a) => a.id === accountId);
    if (account) {
      account.label = name;
    }
  }
  writeRegistry(registry);
  return list();
}

function setActive(accountId) {
  const registry = readRegistry();
  registry.activeId = resolveId(accountId);
  writeRegistry(registry);
  return list();
}

// Retire un compte (jamais le principal). deleteFiles : efface aussi son
// dossier (identifiants, conversations), uniquement sous ACCOUNTS_ROOT.
function remove(accountId, deleteFiles) {
  if (!accountId || accountId === DEFAULT_ID) {
    return list();
  }
  const registry = readRegistry();
  registry.accounts = registry.accounts.filter((a) => a.id !== accountId);
  if (registry.activeId === accountId) {
    registry.activeId = DEFAULT_ID;
  }
  writeRegistry(registry);
  if (deleteFiles && /^[0-9a-f-]+$/i.test(accountId)) {
    const dir = path.join(ACCOUNTS_ROOT, accountId);
    if (path.dirname(dir) === ACCOUNTS_ROOT) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
  return list();
}

// Tous les comptes avec leur dossier (historique, etat des processus...).
function allConfigDirs() {
  const registry = readRegistry();
  const result = [{ id: DEFAULT_ID, label: registry.defaultLabel, configDir: defaultConfigDir() }];
  for (const account of registry.accounts) {
    result.push({ id: account.id, label: account.label, configDir: path.join(ACCOUNTS_ROOT, account.id) });
  }
  return result;
}

module.exports = { DEFAULT_ID, list, add, rename, setActive, remove, configDirFor, resolveId, activeId, envFor, allConfigDirs };
