// Moteur de pipeline IA (mode non-interactif / "headless").
//
// Chaque etape lance une CLI dans son mode one-shot (ex. `claude -p`,
// `codex exec`, `agy "..."`) avec le prompt en dernier argument, capture la
// sortie texte, puis se termine. La sortie d'une etape peut alimenter l'entree
// de la suivante (cf. substitution {{...}} cote renderer).
//
// On reutilise platform.buildCommandLine pour le quoting (gere PowerShell vs
// POSIX), et on execute via child_process (pas de TTY) afin d'obtenir une sortie
// propre et une vraie fin de process.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform");

// Journal de diagnostic du pipeline (pour comprendre les blocages).
const LOG_PATH = path.join(os.tmpdir(), "ia-pipeline.log");
function plog(line) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

// Suppression des sequences ANSI. La regex est construite via fromCharCode pour
// ne jamais embarquer d'octet de controle ESC (0x1B) / CSI (0x9B) dans le source.
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const ANSI_RE = new RegExp(
  "[" + ESC + CSI + "][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]",
  "g"
);
function stripAnsi(text) {
  return String(text || "").replace(ANSI_RE, "");
}

// Lance une etape headless. Renvoie { ok, output, error, code }.
// Process en cours (une etape a la fois) pour permettre l'annulation.
let activeChild = null;

function cancel() {
  if (activeChild) {
    try {
      activeChild.kill();
    } catch {}
    return true;
  }
  return false;
}

function runHeadlessStep({ command, args = [], prompt = "", cwd = "", timeoutMs = 1800000, stdin = false, onChunk } = {}) {
  return new Promise((resolve) => {
    const cmd = String(command || "").trim();
    if (!cmd) {
      resolve({ ok: false, error: "Commande CLI manquante.", output: "" });
      return;
    }

    const fullArgs = Array.isArray(args) ? [...args] : [];
    // En mode stdin, le prompt N'EST PAS mis sur la ligne de commande (il sera
    // ecrit sur l'entree standard) : evite tout re-parsing du shell sur un texte
    // multi-lignes ou contenant des caracteres speciaux.
    if (prompt && !stdin) {
      fullArgs.push(String(prompt));
    }
    const commandLine = platform.buildCommandLine(cmd, fullArgs);

    const shell = platform.isWindows
      ? {
          file: "powershell.exe",
          args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", commandLine]
        }
      : { file: "/bin/sh", args: ["-c", commandLine] };

    const startedAt = Date.now();
    plog(`RUN cmd=[${commandLine}] cwd=[${cwd || "(default)"}] pathHead=[${String(process.env.PATH || "").slice(0, 200)}]`);

    let out = "";
    let err = "";
    let done = false;
    let child;

    const finish = (result) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      if (activeChild === child) {
        activeChild = null;
      }
      plog(`DONE ok=${result.ok} ms=${Date.now() - startedAt} outLen=${(result.output || "").length} err=[${(result.error || "").slice(0, 200)}]`);
      resolve(result);
    };

    try {
      child = spawn(shell.file, shell.args, { cwd: cwd || undefined, windowsHide: true });
      activeChild = child;
    } catch (error) {
      plog(`SPAWN-FAIL ${String(error?.message || error)}`);
      resolve({ ok: false, error: String(error?.message || error), output: "" });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({
        ok: false,
        error: `Délai dépassé (${Math.round(timeoutMs / 60000)} min) : la CLI n'a pas terminé. Tu peux relancer ou augmenter le délai.`,
        output: stripAnsi(out).trim()
      });
    }, timeoutMs);

    let firstChunkAt = 0;
    const noteFirst = (src) => {
      if (!firstChunkAt) {
        firstChunkAt = Date.now();
        plog(`FIRST-CHUNK src=${src} after ${firstChunkAt - startedAt}ms`);
      }
    };
    child.stdout.on("data", (data) => {
      noteFirst("stdout");
      const chunk = data.toString();
      out += chunk;
      if (typeof onChunk === "function") {
        onChunk(stripAnsi(chunk));
      }
    });
    child.stderr.on("data", (data) => {
      noteFirst("stderr");
      const chunk = data.toString();
      err += chunk;
      if (typeof onChunk === "function") {
        onChunk(stripAnsi(chunk));
      }
    });
    child.on("error", (error) => {
      plog(`CHILD-ERROR ${String(error?.message || error)}`);
      finish({ ok: false, error: String(error?.message || error), output: stripAnsi(out).trim() });
    });
    child.on("close", (code) => {
      const text = stripAnsi(out).trim();
      const errText = stripAnsi(err).trim();
      // Succes si code 0, ou si on a quand meme recupere une sortie exploitable.
      if (code === 0 || text) {
        finish({ ok: true, output: text, code, stderr: errText });
      } else {
        finish({ ok: false, error: errText || `Code de sortie ${code}.`, output: text, code });
      }
    });

    // En mode stdin, on ecrit le prompt sur l'entree standard puis on la ferme.
    // En mode argument, on ferme directement (le prompt est deja sur la ligne).
    try {
      if (stdin && prompt) {
        child.stdin.write(String(prompt));
      }
      child.stdin.end();
    } catch {}
  });
}

module.exports = { runHeadlessStep, stripAnsi, cancel };
