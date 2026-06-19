// Synchronisation native Google Drive (sans installer Google Drive Desktop).
// L'app garde ses donnees en local (userData) et cette couche les pousse/tire
// vers le dossier prive "appDataFolder" du Drive de l'utilisateur via l'API REST.
//
// - Authentification : OAuth 2.0 PKCE, flux "application de bureau" (loopback).
//   Aucun secret client a cacher. Un seul clic "Autoriser" par PC.
// - Portee : scope `drive.appdata` uniquement -> l'app ne voit qu'un dossier
//   cache qui lui est propre, jamais le reste du Drive. (+ openid/email pour
//   afficher le compte connecte.)
// - Le refresh token est chiffre via safeStorage (DPAPI sous Windows) et garde
//   en local, jamais synchronise.
//
// Aucune dependance externe : on utilise fetch natif (Node 20 / Electron 33).
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, safeStorage, shell } = require("electron");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPES = ["https://www.googleapis.com/auth/drive.appdata", "openid", "email"];

// Fichiers de donnees du launcher synchronises (a la racine du dataDir).
const DATA_FILES = ["profiles.json", "history.json", "sessions.json"];
// Prefixe des transcriptions (un fichier par session, dans history/).
const TRANSCRIPT_PREFIX = "htx__";

// --- Reglages locaux (machine-local, jamais synchronise) -------------------

function settingsPath() {
  return path.join(app.getPath("userData"), "gdrive.json");
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) || {};
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...patch };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {}
  return next;
}

function encryptSecret(value) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return "enc:" + safeStorage.encryptString(String(value)).toString("base64");
    }
  } catch {}
  // Repli (chiffrement OS indisponible) : on stocke en clair, mieux que perdre.
  return "raw:" + String(value);
}

function decryptSecret(stored) {
  const text = String(stored || "");
  if (text.startsWith("enc:")) {
    try {
      return safeStorage.decryptString(Buffer.from(text.slice(4), "base64"));
    } catch {
      return "";
    }
  }
  if (text.startsWith("raw:")) {
    return text.slice(4);
  }
  return "";
}

// --- Etat ------------------------------------------------------------------

function getClientId() {
  return String(loadSettings().clientId || "").trim();
}

// Pour un client OAuth Google de type "Application de bureau", l'echange du code
// exige aussi le client_secret (non confidentiel pour ce type de client).
function getClientSecret() {
  return decryptSecret(loadSettings().clientSecret);
}

function getRefreshToken() {
  return decryptSecret(loadSettings().refreshToken);
}

function isConfigured() {
  return getClientId().length > 0;
}

function isConnected() {
  return isConfigured() && getRefreshToken().length > 0;
}

function getStatus() {
  const s = loadSettings();
  return {
    configured: isConfigured(),
    connected: isConnected(),
    clientId: getClientId(),
    clientSecret: getClientSecret(),
    email: String(s.email || ""),
    lastSync: Number(s.lastSync || 0)
  };
}

function setCredentials(clientId, clientSecret) {
  const id = String(clientId || "").trim();
  const secret = String(clientSecret || "").trim();
  saveSettings({ clientId: id, clientSecret: secret ? encryptSecret(secret) : "" });
  return getStatus();
}

// --- OAuth PKCE ------------------------------------------------------------

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeIdTokenEmail(idToken) {
  try {
    const payload = String(idToken || "").split(".")[1];
    if (!payload) {
      return "";
    }
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return String(json.email || "");
  } catch {
    return "";
  }
}

// Lance le flux d'autorisation : ouvre le navigateur, ecoute le retour loopback,
// echange le code contre les tokens et persiste le refresh token chiffre.
function connect() {
  return new Promise((resolve) => {
    const clientId = getClientId();
    if (!clientId) {
      resolve({ ok: false, error: "Identifiant client Google manquant." });
      return;
    }

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const expectedState = base64url(crypto.randomBytes(16));
    let settled = false;

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const reply = (message) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>IA CLI Launcher</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center}</style>
</head><body><div><h2>${message}</h2><p>Vous pouvez fermer cet onglet et revenir à l'application.</p></div></body></html>`);
        };

        if (error) {
          reply("Autorisation refusée ❌");
          finish({ ok: false, error: `Google a renvoyé : ${error}` });
          return;
        }
        if (!code || state !== expectedState) {
          reply("Réponse invalide ❌");
          finish({ ok: false, error: "Réponse d'autorisation invalide." });
          return;
        }

        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: getClientSecret(),
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
          })
        });
        const data = await tokenRes.json();
        if (!tokenRes.ok || !data.refresh_token) {
          reply("Échec de la connexion ❌");
          finish({
            ok: false,
            error: data.error_description || data.error || "Aucun refresh token reçu (réessayez avec un compte non déjà autorisé)."
          });
          return;
        }
        const email = decodeIdTokenEmail(data.id_token);
        saveSettings({ refreshToken: encryptSecret(data.refresh_token), email });
        cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
        reply("Connexion réussie ✅");
        finish({ ok: true, email });
      } catch (err) {
        finish({ ok: false, error: String(err?.message || err) });
      }
    });

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      try {
        server.close();
      } catch {}
      resolve(result);
    }

    server.on("error", (err) => finish({ ok: false, error: String(err?.message || err) }));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: "code",
        scope: SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
        state: expectedState
      })}`;
      shell.openExternal(authUrl);
    });

    // Securite : abandonne au bout de 5 minutes si l'utilisateur ne valide pas.
    setTimeout(() => finish({ ok: false, error: "Délai d'autorisation dépassé." }), 5 * 60 * 1000);
  });
}

async function disconnect() {
  const token = getRefreshToken();
  if (token) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token })
      });
    } catch {}
  }
  cachedAccessToken = null;
  saveSettings({ refreshToken: "", email: "" });
  return { ok: true };
}

// --- Acces aux tokens ------------------------------------------------------

let cachedAccessToken = null;

async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }
  const clientId = getClientId();
  const refreshToken = getRefreshToken();
  if (!clientId || !refreshToken) {
    throw new Error("Google Drive non connecté.");
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: getClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    // Refresh token revoque/expire : on force une reconnexion.
    if (data.error === "invalid_grant") {
      saveSettings({ refreshToken: "", email: "" });
    }
    throw new Error(data.error_description || data.error || "Échec du rafraîchissement du token.");
  }
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
  return cachedAccessToken.token;
}

// --- API Drive (appDataFolder) ---------------------------------------------

async function driveListAppData() {
  const token = await getAccessToken();
  const url = `${DRIVE_FILES}?${new URLSearchParams({
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    pageSize: "1000"
  })}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Listing Drive impossible.");
  }
  return Array.isArray(data.files) ? data.files : [];
}

async function driveDownload(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error("Téléchargement Drive impossible.");
  }
  return res.text();
}

async function driveCreate(name, content) {
  const token = await getAccessToken();
  const boundary = "ialauncher" + crypto.randomBytes(8).toString("hex");
  const metadata = JSON.stringify({ name, parents: ["appDataFolder"] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Envoi Drive impossible.");
  }
  return data;
}

async function driveUpdate(fileId, content) {
  const token = await getAccessToken();
  const res = await fetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain; charset=UTF-8" },
    body: content
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Mise à jour Drive impossible.");
  }
  return data;
}

// --- Synchronisation bidirectionnelle (le plus recent gagne, par fichier) --

// Convertit un nom Drive en chemin local (et sert aussi a valider un nom connu).
function remoteToLocalPath(dataDir, remoteName) {
  if (DATA_FILES.includes(remoteName)) {
    return path.join(dataDir, remoteName);
  }
  if (remoteName.startsWith(TRANSCRIPT_PREFIX)) {
    return path.join(dataDir, "history", remoteName.slice(TRANSCRIPT_PREFIX.length));
  }
  return null;
}

// Liste les fichiers locaux synchronisables avec leur mtime (ms).
function listLocalFiles(dataDir) {
  const out = new Map(); // remoteName -> { localPath, mtime }
  for (const name of DATA_FILES) {
    const p = path.join(dataDir, name);
    try {
      out.set(name, { localPath: p, mtime: fs.statSync(p).mtimeMs });
    } catch {}
  }
  const historyDir = path.join(dataDir, "history");
  try {
    for (const file of fs.readdirSync(historyDir)) {
      const p = path.join(historyDir, file);
      try {
        if (fs.statSync(p).isFile()) {
          out.set(TRANSCRIPT_PREFIX + file, { localPath: p, mtime: fs.statSync(p).mtimeMs });
        }
      } catch {}
    }
  } catch {}
  return out;
}

// Aligne le mtime local sur celui du Drive pour eviter le ping-pong push/pull.
function touchLocal(localPath, isoTime) {
  try {
    const t = new Date(isoTime);
    fs.utimesSync(localPath, t, t);
  } catch {}
}

let syncing = false;

// Synchronise une fois dans les deux sens. `dataDir` = dossier de donnees local.
async function syncOnce(dataDir) {
  if (!isConnected()) {
    return { ok: false, error: "Google Drive non connecté." };
  }
  if (syncing) {
    return { ok: false, error: "Synchronisation déjà en cours." };
  }
  syncing = true;
  let pulled = 0;
  let pushed = 0;
  try {
    const remoteFiles = await driveListAppData();
    const remoteByName = new Map();
    for (const f of remoteFiles) {
      remoteByName.set(f.name, { id: f.id, mtime: Date.parse(f.modifiedTime) || 0 });
    }
    const localByName = listLocalFiles(dataDir);

    const allNames = new Set([...remoteByName.keys(), ...localByName.keys()]);
    for (const name of allNames) {
      // On ignore tout nom qu'on ne sait pas remapper vers un fichier local.
      if (!remoteToLocalPath(dataDir, name)) {
        continue;
      }
      const remote = remoteByName.get(name);
      const local = localByName.get(name);

      if (remote && !local) {
        // Present seulement sur le Drive -> on tire.
        const localPath = remoteToLocalPath(dataDir, name);
        if (!localPath) {
          continue;
        }
        const content = await driveDownload(remote.id);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, "utf8");
        touchLocal(localPath, new Date(remote.mtime).toISOString());
        pulled += 1;
      } else if (local && !remote) {
        // Present seulement en local -> on pousse.
        const content = fs.readFileSync(local.localPath, "utf8");
        const created = await driveCreate(name, content);
        if (created?.modifiedTime) {
          touchLocal(local.localPath, created.modifiedTime);
        }
        pushed += 1;
      } else if (local && remote) {
        // Present des deux cotes -> le plus recent gagne (tolerance 2 s).
        if (remote.mtime > local.mtime + 2000) {
          const localPath = remoteToLocalPath(dataDir, name);
          const content = await driveDownload(remote.id);
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, content, "utf8");
          touchLocal(localPath, new Date(remote.mtime).toISOString());
          pulled += 1;
        } else if (local.mtime > remote.mtime + 2000) {
          const content = fs.readFileSync(local.localPath, "utf8");
          const updated = await driveUpdate(remote.id, content);
          if (updated?.modifiedTime) {
            touchLocal(local.localPath, updated.modifiedTime);
          }
          pushed += 1;
        }
      }
    }

    saveSettings({ lastSync: Date.now() });
    return { ok: true, pulled, pushed, lastSync: Date.now() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    syncing = false;
  }
}

module.exports = {
  getStatus,
  setCredentials,
  connect,
  disconnect,
  isConnected,
  syncOnce
};
