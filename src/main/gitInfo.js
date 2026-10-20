// Etat Git du dossier d'un onglet (branche, fichiers modifies) et diff d'un
// fichier, pour verifier d'un coup d'oeil ce que l'IA a change.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MAX_DIFF_BYTES = 400 * 1024;
let gitCommand = null;

// git du PATH, sinon emplacements habituels de Git for Windows.
function findGit() {
  if (gitCommand !== null) {
    return gitCommand;
  }
  gitCommand = "git";
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe")
    ];
    const inPath = (process.env.PATH || "").split(";").some((dir) => dir && fs.existsSync(path.join(dir, "git.exe")));
    if (!inPath) {
      gitCommand = candidates.find((file) => fs.existsSync(file)) || "git";
    }
  }
  return gitCommand;
}

function runGit(cwd, args, maxBuffer = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    execFile(findGit(), ["-C", cwd, ...args], { windowsHide: true, timeout: 15000, maxBuffer, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error });
    });
  });
}

// Libelle lisible d'un code d'etat "git status --porcelain".
function describeStatus(code) {
  if (code === "??") {
    return "nouveau";
  }
  if (code.includes("U") || code === "AA" || code === "DD") {
    return "conflit";
  }
  if (code.includes("D")) {
    return "supprimé";
  }
  if (code.includes("R")) {
    return "renommé";
  }
  if (code.includes("A")) {
    return "ajouté";
  }
  return "modifié";
}

// { isRepo, branch, ahead, behind, files: [{ path, code, label }] }.
async function getStatus(cwd) {
  if (!cwd || !fs.existsSync(cwd)) {
    return { isRepo: false };
  }
  const result = await runGit(cwd, ["status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
  if (!result.ok) {
    return { isRepo: false, error: result.error?.code === "ENOENT" ? "Git introuvable sur ce PC." : "" };
  }
  const parts = result.stdout.split("\0");
  let branch = "";
  let ahead = 0;
  let behind = 0;
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const item = parts[i];
    if (!item) {
      continue;
    }
    if (item.startsWith("## ")) {
      const header = item.slice(3);
      branch = header.replace(/^No commits yet on /, "").split("...")[0].split(" ")[0];
      ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
      behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
      continue;
    }
    const code = item.slice(0, 2);
    const file = item.slice(3);
    // Renommage : l'ancien nom suit dans l'element suivant.
    if (code.includes("R") || code.includes("C")) {
      i += 1;
    }
    files.push({ path: file, code: code.trim() || code, label: describeStatus(code) });
  }
  return { isRepo: true, branch, ahead, behind, files };
}

// Diff d'un fichier par rapport au dernier commit (ou contenu s'il est nouveau).
async function getDiff(cwd, file, untracked) {
  const target = String(file || "");
  if (!cwd || !target) {
    return { ok: false, text: "" };
  }
  let result;
  if (untracked) {
    // Fichier non suivi : on le compare au vide (git rend le code 1 s'il differe).
    result = await runGit(cwd, ["diff", "--no-index", "--no-color", "--", process.platform === "win32" ? "NUL" : "/dev/null", target], MAX_DIFF_BYTES * 4);
    result.ok = Boolean(result.stdout) || result.ok;
  } else {
    result = await runGit(cwd, ["diff", "HEAD", "--no-color", "--", target], MAX_DIFF_BYTES * 4);
    if (!result.ok) {
      // Depot sans aucun commit : diff de l'index.
      result = await runGit(cwd, ["diff", "--cached", "--no-color", "--", target], MAX_DIFF_BYTES * 4);
    }
  }
  if (!result.ok) {
    return { ok: false, text: result.stderr.trim() || "Diff indisponible." };
  }
  let text = result.stdout;
  if (text.length > MAX_DIFF_BYTES) {
    text = `${text.slice(0, MAX_DIFF_BYTES)}\n… (diff tronqué)`;
  }
  return { ok: true, text: text || "Aucune différence." };
}

module.exports = { getStatus, getDiff };
