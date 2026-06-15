// Couche d'abstraction OS : isole toutes les differences Windows / Linux.
// Le reste de l'application appelle ces fonctions sans connaitre la plateforme.
const childProcess = require("node:child_process");

const isWindows = process.platform === "win32";

// Shell interactif de l'utilisateur sous Linux (repli sur bash).
function getUserShell() {
  return process.env.SHELL || "/bin/bash";
}

// Quoting d'un argument pour le shell cible.
function quoteArg(value) {
  const text = String(value);
  if (isWindows) {
    // PowerShell : single quotes, on double les apostrophes internes.
    if (/^[a-zA-Z0-9_./:=\\-]+$/.test(text)) {
      return text;
    }
    return `'${text.replace(/'/g, "''")}'`;
  }
  // POSIX (bash/zsh) : single quotes, on echappe les apostrophes via '\''.
  if (/^[a-zA-Z0-9_./:=@%+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

// Construit la ligne de commande "executable + args" pour le shell cible.
function buildCommandLine(command, args) {
  const executable = String(command || "").trim();
  const shellArgs = args.filter((part) => String(part).trim().length > 0).map(quoteArg);
  if (isWindows) {
    // PowerShell : l'operateur d'appel "&" permet de lancer un chemin/exe.
    return ["&", quoteArg(executable), ...shellArgs].join(" ");
  }
  // POSIX : pas de prefixe, l'executable est lance directement.
  return [quoteArg(executable), ...shellArgs].join(" ");
}

// Renvoie le shell et ses arguments pour executer commandLine puis rester ouvert.
function getShell(commandLine) {
  if (isWindows) {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", commandLine]
    };
  }
  const userShell = getUserShell();
  // On lance la commande puis on remplace le process par un shell interactif
  // (equivalent du -NoExit de PowerShell : le terminal reste utilisable).
  return {
    command: userShell,
    args: ["-c", `${commandLine}; exec ${quoteArg(userShell)} -i`]
  };
}

// Libelle affiche dans l'UI (pied de page).
function getShellLabel() {
  if (isWindows) {
    return "PowerShell";
  }
  const userShell = getUserShell();
  return userShell.split("/").pop() || "shell";
}

// Verifie qu'une commande est disponible dans le PATH.
function checkCommand(command) {
  const executable = String(command || "").trim();
  if (!executable) {
    return Promise.resolve({ ok: false, output: "" });
  }

  return new Promise((resolve) => {
    if (isWindows) {
      childProcess.execFile("where.exe", [executable], { windowsHide: true }, (error, stdout) => {
        resolve({ ok: !error, output: stdout.trim() });
      });
      return;
    }
    // POSIX : "command -v" est le moyen portable de localiser un executable.
    childProcess.execFile("/bin/sh", ["-c", `command -v -- ${quoteArg(executable)}`], (error, stdout) => {
      resolve({ ok: !error, output: String(stdout || "").trim() });
    });
  });
}

// Indique si le process tourne avec des privileges eleves.
function isElevated() {
  if (isWindows) {
    try {
      childProcess.execFileSync("fltmc.exe", [], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

module.exports = {
  isWindows,
  quoteArg,
  buildCommandLine,
  getShell,
  getShellLabel,
  checkCommand,
  isElevated
};
