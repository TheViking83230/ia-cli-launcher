// Coller une image dans la CLI : l'image du presse-papiers (capture d'ecran,
// image copiee depuis un navigateur...) est enregistree en PNG dans un dossier
// temporaire, puis son chemin est colle dans le terminal. Claude Code, Codex,
// etc. reconnaissent un chemin d'image colle et l'analysent.
const { clipboard } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const IMAGE_DIR = path.join(os.tmpdir(), "ia-cli-launcher", "images");
// Les images collees sont supprimees apres une semaine.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function pruneOldImages() {
  try {
    const limit = Date.now() - MAX_AGE_MS;
    for (const name of fs.readdirSync(IMAGE_DIR)) {
      const file = path.join(IMAGE_DIR, name);
      try {
        if (fs.statSync(file).mtimeMs < limit) {
          fs.unlinkSync(file);
        }
      } catch {}
    }
  } catch {}
}

// Enregistre l'image du presse-papiers ; renvoie son chemin, ou null s'il n'y
// a pas d'image.
function saveClipboardImage() {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = path.join(IMAGE_DIR, `image-${stamp}-${Math.random().toString(36).slice(2, 6)}.png`);
  fs.writeFileSync(file, image.toPNG());
  return file;
}

// Fichiers copies dans l'explorateur de fichiers : liste de chemins (vide sinon).
// Windows n'expose a Electron que le premier fichier (FileNameW) : la liste
// complete est lue par PowerShell quand il y en a un.
function readClipboardFiles() {
  if (process.platform === "win32") {
    const first = clipboard.readBuffer("FileNameW").toString("utf16le").replace(/\0+$/, "");
    if (!first) {
      return Promise.resolve([]);
    }
    const script =
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }";
    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        const all = error ? [] : String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        resolve(all.includes(first) ? all : [first]);
      });
    });
  }
  // Linux (GNOME, KDE...) et macOS : liste d'URL file://.
  const raw = [clipboard.read("x-special/gnome-copied-files"), clipboard.read("text/uri-list"), clipboard.read("public.file-url")].join("\n");
  const paths = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("file://")) {
      try {
        const file = decodeURIComponent(new URL(line.trim()).pathname);
        if (fs.existsSync(file) && !paths.includes(file)) {
          paths.push(file);
        }
      } catch {}
    }
  }
  return Promise.resolve(paths);
}

module.exports = { pruneOldImages, saveClipboardImage, readClipboardFiles };
