// Module JARVIS (easter egg) : interface alternative facon Iron Man.
//
// Etat garde dans le userData REEL (jamais synchronise : c'est un choix propre
// a chaque PC, comme sync.json). Il peut etre "installe" de deux facons :
//  - case a cocher de l'installateur Windows (valeur de registre HKLM, voir
//    build/installer.nsh), appliquee au premier lancement qui suit ;
//  - depuis l'application (bouton JARVIS ou menu Affichage).
const { app } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_KEY = "HKLM\\Software\\IA CLI Launcher";
const REGISTRY_VALUE = "Jarvis";

function statePath() {
  return path.join(app.getPath("userData"), "jarvis.json");
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return {
      installed: Boolean(parsed.installed),
      active: Boolean(parsed.active),
      pendingIntro: Boolean(parsed.pendingIntro),
      installerStamp: String(parsed.installerStamp || "")
    };
  } catch {
    return { installed: false, active: false, pendingIntro: false, installerStamp: "" };
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

// Valeur ecrite par l'installateur quand la case JARVIS est cochee :
// "1|<date>" ; la date distingue une nouvelle installation d'une ancienne.
function readInstallerChoice() {
  if (process.platform !== "win32") {
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", REGISTRY_KEY, "/v", REGISTRY_VALUE, "/reg:64"],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }
        const match = String(stdout).match(new RegExp(`${REGISTRY_VALUE}\\s+REG_SZ\\s+(.+)`));
        resolve(match ? match[1].trim() : "");
      }
    );
  });
}

async function getState() {
  const current = readState();
  const choice = await readInstallerChoice();
  // Case cochee lors d'une installation pas encore prise en compte : JARVIS est
  // installe et la cinematique se lance au prochain affichage de la fenetre.
  if (choice.startsWith("1") && choice !== current.installerStamp) {
    return writeState({ ...current, installed: true, pendingIntro: true, installerStamp: choice });
  }
  return current;
}

function setState(patch = {}) {
  const current = readState();
  const next = { ...current };
  for (const key of ["installed", "active", "pendingIntro"]) {
    if (key in patch) {
      next[key] = Boolean(patch[key]);
    }
  }
  if (!next.installed) {
    next.active = false;
    next.pendingIntro = false;
  }
  return writeState(next);
}

module.exports = { getState, setState };
