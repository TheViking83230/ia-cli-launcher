// Prononciation des reponses de l'IA avant la synthese vocale.
//
// Le texte (deja debarrasse du Markdown) est reecrit pour etre bien lu :
//  - structure : chemins et fichiers, versions, identifiants de code
//    (camelCase, snake_case), sigles, symboles, unites ;
//  - lexique « a la francaise » des mots anglais courants en informatique,
//    ecrits phonetiquement pour la voix Piper (eSpeak les lirait en francais :
//    « build » -> « buil-de »). Les moteurs qui connaissent l'anglais
//    (option phonetic: false) gardent les mots tels quels.
//
// Utilisation : JarvisPronounce.pronounce(texte, { phonetic: true })
(function (root) {
  // Mots anglais courants -> orthographe lue correctement par eSpeak (francais).
  const LEXICON = {
    commit: "commite", commits: "commites", commiter: "commiter", push: "pouche", pusher: "poucher", pull: "poule",
    merge: "meurdje", merger: "meurdjé", rebase: "ribaise", build: "bilde", builds: "bildes", release: "rilise",
    releases: "rilises", bug: "beugue", bugs: "beugues", debug: "dibeugue", debugger: "dibeugueur", log: "logue",
    logs: "logues", script: "scripte", scripts: "scriptes", update: "eupdéite", updates: "eupdéites", backend: "bakende",
    frontend: "fronte-ende", framework: "frème-weurque", feature: "fitcheur", features: "fitcheurs", token: "tokène",
    tokens: "tokènes", prompt: "prompte", prompts: "promptes", workflow: "weurque-flo", repo: "répo",
    repository: "ripozitori", checkout: "tchèque-aoute", git: "guite", github: "guite-heub", gitlab: "guite-labe",
    docker: "dokeur", linux: "linukse", windows: "ouinne-dose", claude: "klaude", codex: "codexe", electron: "électronne",
    javascript: "djava-scripte", typescript: "taïpe-scripte", python: "païtonne", node: "naude", nodejs: "naude djé esse",
    readme: "ride-mi", json: "djé-sonne", yaml: "yamel", markdown: "mark-daoune", react: "riakte", vue: "viou",
    widget: "ouidjette", plugin: "pleuguine", plugins: "pleuguines", hook: "houk", hooks: "houks", cache: "cache",
    deploy: "diplo-ï", deployment: "diploïmente", staging: "stéidjingue", pipeline: "païpe-laïne", runtime: "reune-taïme",
    timeout: "taïme-aoute", callback: "cole-bak", array: "euré", string: "strigne", strings: "strignes", boolean: "boulé-ine",
    null: "neul", undefined: "eune-défaïnde", true: "trou", false: "folse", default: "difolte", stack: "stak",
    endpoint: "ende-poïnte", localhost: "local-host", shell: "chèle", powershell: "paoueur-chèle", bash: "bache",
    terminal: "terminal", launcher: "lauwncheur", jarvis: "jarvisse", piper: "païpeur", whisper: "ouisspeur",
    online: "onne-laïne", offline: "off-laïne", email: "imèle", mail: "mèle", design: "dizaïne", layout: "lé-aoute",
    login: "loguine", logout: "logue-aoute", password: "passe-weurde", upload: "eupe-laude", download: "daoune-laude",
    driver: "draïveur", drivers: "draïveurs", gaming: "guéïmingue", streaming: "strimingue", stream: "strime",
    software: "softe-ouère", hardware: "harde-ouère", firmware: "feurme-ouère", benchmark: "bainche-marque",
    issue: "ichou", issues: "ichous", fix: "fixe", fixes: "fixes", patch: "patche", sprint: "sprinte", ok: "okay"
  };

  // Sigles epeles (les autres sigles connus sont dans LEXICON).
  const SPELLED = new Set(["API", "CLI", "UI", "UX", "URL", "HTML", "CSS", "SQL", "PR", "CPU", "GPU", "RAM", "SSD", "USB",
    "PDF", "NPM", "IDE", "SDK", "HTTP", "HTTPS", "SSH", "DNS", "VPN", "IP", "TTS", "LLM", "MCP", "CI", "CD", "VS", "PC", "OS"]);
  const LETTERS = { A: "a", B: "bé", C: "cé", D: "dé", E: "e", F: "èfe", G: "gé", H: "ache", I: "i", J: "ji", K: "ka",
    L: "èle", M: "ème", N: "ène", O: "o", P: "pé", Q: "ku", R: "ère", S: "èsse", T: "té", U: "u", V: "vé", W: "double vé",
    X: "ixe", Y: "i grec", Z: "zède" };
  const UNITS = { Ko: "kilo-octets", Mo: "mégaoctets", Go: "gigaoctets", To: "téraoctets", KB: "kilo-octets",
    MB: "mégaoctets", GB: "gigaoctets", ms: "millisecondes", Hz: "hertz", kHz: "kilohertz", MHz: "mégahertz",
    GHz: "gigahertz", px: "pixels", fps: "images par seconde" };
  const KEYS = { Ctrl: "Contrôle", Maj: "Majuscule", Shift: "Majuscule", Alt: "Alt", Esc: "Échap", Cmd: "Commande" };
  const EXTENSIONS = { js: "J S", ts: "T S", md: "M D", py: "païe", json: "djé-sonne", css: "C S S", html: "H T M L",
    exe: "exe", txt: "texte", sh: "S H", yml: "yamel", yaml: "yamel", jsx: "J S X", tsx: "T S X", png: "P N G",
    jpg: "J P G", wav: "wave", mp3: "M P 3", zip: "zip", log: "logue", ini: "ini", cfg: "config", ps1: "P S 1" };

  const spell = (word) => [...word].map((letter) => LETTERS[letter] || letter).join(" ");

  function pronounce(text, { phonetic = true } = {}) {
    let out = String(text || "");

    // Emojis et pictogrammes : non lus.
    out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "");
    // Raccourcis clavier : Ctrl+Maj+J -> Contrôle Majuscule J.
    out = out.replace(/\b(Ctrl|Maj|Shift|Alt|Esc|Cmd)\s*\+\s*/g, (_, key) => `${KEYS[key]} `);
    // Chemins : seul le nom du fichier est lu (src/main/main.js -> main.js).
    out = out.replace(/(?:[A-Za-z]:)?(?:[\\/]?[\w.-]+[\\/])+([\w-]+\.\w{1,5})\b/g, "$1");
    // Fichiers : main.js -> main point J S.
    out = out.replace(/\b([\w-]+)\.([a-z0-9]{1,5})\b/g, (match, name, ext) =>
      EXTENSIONS[ext] && !/^\d+$/.test(name) ? `${name} point ${EXTENSIONS[ext]}` : match);
    // Versions : 0.1.27 -> 0 point 1 point 27 ; v2.3 -> version 2 point 3.
    out = out.replace(/\bv?(\d+)\.(\d+)\.(\d+)\b/g, "$1 point $2 point $3");
    out = out.replace(/\bv(\d+)\.(\d+)\b/g, "version $1 point $2");
    // Identifiants de code : getLastReply -> get Last Reply ; snake_case -> snake case.
    out = out.replace(/\b([a-z]+)((?:[A-Z][a-z0-9]+)+)\b/g, (_, head, rest) => `${head} ${rest.replace(/([A-Z])/g, " $1").trim()}`);
    out = out.replace(/\b(\w+)_(\w+)\b/g, (match) => match.replace(/_/g, " "));
    // Temperatures et mesures courantes (meteo) : 22 °C -> 22 degrés Celsius,
    // 18–24 -> 18 à 24, −3 -> moins 3, 30 km/h -> 30 kilomètres heure.
    out = out
      .replace(/(\d)\s?[–—]\s?(-?\d)/g, "$1 à $2")
      .replace(/\b([Ee]ntre \d+) à /g, "$1 et ")
      .replace(/[−-](\d)/g, (match, digit, offset, whole) => (/[\w.]/.test(whole[offset - 1] || "") ? match : `moins ${digit}`))
      .replace(/\s?°\s?C\b/g, " degrés Celsius")
      .replace(/\s?°\s?F\b/g, " degrés Fahrenheit")
      .replace(/(\d)\s?°/g, "$1 degrés")
      .replace(/(\d)\s?km\/h\b/g, "$1 kilomètres heure")
      .replace(/(\d)\s?(km|cm|mm)\b/g, (_, digit, unit) => `${digit} ${{ km: "kilomètres", cm: "centimètres", mm: "millimètres" }[unit]}`);
    // Unites apres un nombre : 15 Mo -> 15 mégaoctets.
    out = out.replace(/(\d)\s?(Ko|Mo|Go|To|KB|MB|GB|ms|kHz|MHz|GHz|Hz|px|fps)\b/g, (_, digit, unit) => `${digit} ${UNITS[unit]}`);
    // Symboles.
    out = out
      .replace(/\s*(->|=>|→)\s*/g, " vers ")
      .replace(/\s*(<-|←)\s*/g, " depuis ")
      .replace(/(\d)\s?%/g, "$1 pour cent")
      .replace(/#(\d+)/g, "numéro $1")
      .replace(/\s&\s/g, " et ")
      .replace(/[~≈]\s?(\d)/g, "environ $1")
      .replace(/(\d)\s?[x×]\s?(\d)/g, "$1 fois $2")
      .replace(/(\d)\s?[x×]\b/g, "$1 fois")
      .replace(/\(\s*\)/g, "")
      .replace(/\s\/\s/g, " ou ")
      .replace(/[*_`|<>{}[\]\\^]/g, " ");
    // Sigles epeles : API -> A P I (les moteurs bilingues les lisent seuls).
    out = !phonetic ? out : out.replace(/\b[A-Z]{2,6}s?\b/g, (word) => {
      const bare = word.replace(/s$/, "");
      if (SPELLED.has(bare)) {
        return spell(bare);
      }
      if (LEXICON[bare.toLowerCase()]) {
        return LEXICON[bare.toLowerCase()];
      }
      return word;
    });
    // Mots anglais (voix Piper seulement).
    if (phonetic) {
      out = out.replace(/\b[A-Za-z][A-Za-z]+\b/g, (word) => {
        const spoken = LEXICON[word.toLowerCase()];
        if (!spoken) {
          return word;
        }
        return word[0] === word[0].toUpperCase() ? spoken[0].toUpperCase() + spoken.slice(1) : spoken;
      });
    }
    return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").trim();
  }

  const api = { pronounce, LEXICON };
  root.JarvisPronounce = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
