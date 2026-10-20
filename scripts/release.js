// Publication d'une version en une commande : npm run release
//
// 1. Verifie que la version de package.json a ses notes dans le CHANGELOG du
//    renderer et que tout est commite.
// 2. Build Windows (installeur NSIS) puis Linux (.deb + AppImage, dans un
//    conteneur Docker jetable). Docker est remis dans son etat de depart :
//    arrete (et WSL coupe) s'il l'etait, laisse tourner sinon.
// 3. Pousse la branche main, cree la release GitHub (tag = version, sans "v"),
//    y envoie les fichiers et la publie.
//
// Le jeton GitHub est lu dans le Gestionnaire d'identifiants Windows
// (scripts/gh-token.ps1 -Set pour l'enregistrer), ou dans la variable GH_TOKEN.
//
// Options : --check (prealables seulement), --skip-win, --skip-linux,
// --no-push, --draft (ne publie pas).
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPO = "TheViking83230/ia-cli-launcher";
const LINUX_IMAGE = "electronuserland/builder:20";
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

function step(message) {
  console.log(`\n=== ${message}`);
}

function fail(message) {
  console.error(`\nECHEC : ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", shell: options.shell || false, ...options });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} (code ${result.status})`);
  }
}

function capture(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { cwd: ROOT, encoding: "utf8", windowsHide: true, ...options });
}

// --- Prealables ----------------------------------------------------------------
function changelogNotes() {
  const source = fs.readFileSync(path.join(ROOT, "src", "renderer", "renderer.js"), "utf8");
  const start = source.indexOf(`"${version}": [`);
  if (start < 0) {
    fail(`aucune note de version "${version}" dans le CHANGELOG de src/renderer/renderer.js.`);
  }
  const open = source.indexOf("[", start);
  const close = source.indexOf("\n  ]", open);
  return JSON.parse(source.slice(open, close + 4).trim());
}

function findGit() {
  const candidates = ["git", path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe")];
  return candidates.find((candidate) => capture(candidate, ["--version"]).status === 0) || fail("git introuvable.");
}

function readToken() {
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN.trim();
  }
  const result = capture("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "scripts", "gh-token.ps1"), "-Get"]);
  if (result.status !== 0 || !result.stdout) {
    fail("aucun jeton GitHub : lance d'abord  powershell -ExecutionPolicy Bypass -File scripts/gh-token.ps1 -Set");
  }
  return result.stdout.trim();
}

// --- Docker (build Linux) --------------------------------------------------------
function findDocker() {
  const candidates = [
    "docker",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe")
  ];
  return candidates.find((candidate) => capture(candidate, ["--version"]).status === 0) || null;
}

function dockerRunning(docker) {
  return capture(docker, ["info", "--format", "{{.ServerVersion}}"], { timeout: 30000 }).status === 0;
}

function startDockerDesktop(docker) {
  const exe = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "DockerDesktop", "Docker Desktop.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe")
  ].find((file) => fs.existsSync(file));
  if (!exe) {
    fail("Docker Desktop introuvable (necessaire au build Linux ; --skip-linux pour l'ignorer).");
  }
  spawnSync("powershell.exe", ["-NoProfile", "-Command", `Start-Process -FilePath '${exe}'`], { windowsHide: true });
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    if (dockerRunning(docker)) {
      return;
    }
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 5"], { windowsHide: true });
  }
  fail("Docker n'a pas demarre en 4 minutes.");
}

function buildLinux(outDir) {
  const docker = findDocker();
  if (!docker) {
    fail("Docker introuvable (necessaire au build Linux ; --skip-linux pour l'ignorer).");
  }
  const wasRunning = dockerRunning(docker);
  if (!wasRunning) {
    console.log("Docker est arrete : demarrage pour le build Linux...");
    startDockerDesktop(docker);
  }
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    run(docker, [
      "run", "--rm",
      "-v", `${ROOT}:/src:ro`,
      "-v", `${outDir}:/out`,
      LINUX_IMAGE,
      "bash", "-c", "sed 's/\\r$//' /src/scripts/docker-linux-build.sh > /tmp/b.sh && bash /tmp/b.sh"
    ]);
  } finally {
    // Docker remis dans son etat de depart : rien ne doit rester actif apres
    // le build s'il ne tournait pas avant.
    if (!wasRunning) {
      console.log("Arret de Docker Desktop et de WSL (ils ne tournaient pas avant le build)...");
      capture(docker, ["desktop", "stop"], { timeout: 120000 });
      capture("wsl.exe", ["--shutdown"], { timeout: 60000 });
    }
  }
}

// --- GitHub ------------------------------------------------------------------------
async function github(token, method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...headers },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} -> HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function publish(token, assets, notes) {
  const api = `https://api.github.com/repos/${REPO}`;
  const existing = await fetch(`${api}/releases/tags/${version}`, { headers: { Authorization: `Bearer ${token}` } });
  if (existing.ok) {
    fail(`la release ${version} existe deja sur GitHub.`);
  }
  const release = await github(token, "POST", `${api}/releases`, JSON.stringify({
    tag_name: version,
    target_commitish: "main",
    name: version,
    body: notes.map((note) => `- ${note}`).join("\n"),
    draft: true
  }), { "Content-Type": "application/json" });
  console.log(`brouillon cree (id ${release.id})`);

  for (const file of assets) {
    const data = fs.readFileSync(file);
    const name = path.basename(file);
    await github(token, "POST",
      `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      data,
      { "Content-Type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream", "Content-Length": String(data.length) });
    console.log(`envoye : ${name} (${(data.length / 1048576).toFixed(1)} Mo)`);
  }

  if (args.has("--draft")) {
    console.log(`Release laissee en brouillon : ${release.html_url}`);
    return;
  }
  const published = await github(token, "PATCH", `${api}/releases/${release.id}`,
    JSON.stringify({ draft: false, make_latest: "true" }), { "Content-Type": "application/json" });
  console.log(`publiee : ${published.html_url} (auteur ${published.author?.login})`);
}

// --- Deroulement ---------------------------------------------------------------------
(async () => {
  step(`Publication de la version ${version}`);
  const notes = changelogNotes();
  console.log(notes.map((note) => `  - ${note}`).join("\n"));

  const git = findGit();
  const dirty = capture(git, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (dirty && !args.has("--check")) {
    fail(`des fichiers suivis ne sont pas commites :\n${dirty}`);
  }
  const token = readToken();

  // --check : verifie seulement les prealables, sans rien construire ni publier.
  if (args.has("--check")) {
    const docker = findDocker();
    console.log(`\nNotes : ${notes.length} | git : ${git} | jeton : ${token ? "trouve" : "absent"}`
      + ` | Docker : ${docker ? (dockerRunning(docker) ? "demarre" : "arrete") : "introuvable"}`
      + ` | fichiers non commites : ${dirty ? dirty.split("\n").length : 0}`);
    return;
  }

  const distDir = path.join(ROOT, "dist");
  const assets = [];
  if (!args.has("--skip-win")) {
    step("Build Windows");
    run("npm", ["run", "dist:installer"], { shell: true });
    const latest = fs.readFileSync(path.join(distDir, "latest.yml"), "utf8");
    if (!latest.startsWith(`version: ${version}`)) {
      fail("dist/latest.yml ne correspond pas a la version.");
    }
    assets.push(
      path.join(distDir, `IA-CLI-Launcher-${version}-x64.exe`),
      path.join(distDir, `IA-CLI-Launcher-${version}-x64.exe.blockmap`),
      path.join(distDir, "latest.yml")
    );
  }
  if (!args.has("--skip-linux")) {
    step("Build Linux (Docker)");
    const linuxDir = path.join(distDir, "linux");
    buildLinux(linuxDir);
    assets.push(
      path.join(linuxDir, `IA-CLI-Launcher-${version}-amd64.deb`),
      path.join(linuxDir, `IA-CLI-Launcher-${version}-x86_64.AppImage`),
      path.join(linuxDir, "latest-linux.yml")
    );
  }
  for (const file of assets) {
    if (!fs.existsSync(file)) {
      fail(`fichier manquant : ${file}`);
    }
  }

  if (!args.has("--no-push")) {
    step("Envoi du code sur GitHub (main)");
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    run(git, ["-c", "credential.helper=", "-c", `http.https://github.com/.extraheader=${header}`, "push", "origin", "main"]);
  }

  step("Release GitHub");
  await publish(token, assets, notes);
  console.log(`\nVersion ${version} publiee.`);
})().catch((error) => fail(error.message));
