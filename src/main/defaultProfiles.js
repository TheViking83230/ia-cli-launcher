const isWindows = process.platform === "win32";

// Choisit la valeur adaptee a la plateforme courante.
function pick(winValue, linuxValue) {
  return isWindows ? winValue : linuxValue;
}

// Installe une CLI npm en global.
// Sous Windows : npm est suppose present (fourni avec Node.js).
// Sous Linux : si npm est absent, on amorce Node.js (LTS) via NodeSource/apt
// (mot de passe sudo demande dans le terminal), puis on installe en sudo.
function npmGlobalInstall(pkg) {
  return pick(
    `npm install -g ${pkg}`,
    "if ! command -v npm >/dev/null 2>&1; then " +
      "echo '==> Node.js absent : installation via NodeSource (mot de passe sudo requis)...'; " +
      "sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg && " +
      "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && " +
      "sudo apt-get install -y nodejs; " +
      "fi && " +
      `sudo npm install -g ${pkg}`
  );
}

// Commande pre-lancement OpenCode (cree opencode.json si absent), par OS.
const opencodeGrantPreLaunch = pick(
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"if (Test-Path -LiteralPath 'opencode.json') { Write-Host 'opencode.json existe deja; aucune modification automatique.' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('eyIkc2NoZW1hIjoiaHR0cHM6Ly9vcGVuY29kZS5haS9jb25maWcuanNvbiIsInBlcm1pc3Npb24iOiJhbGxvdyJ9')) | Set-Content -LiteralPath 'opencode.json' -Encoding UTF8 }\"",
  "if [ -f opencode.json ]; then echo 'opencode.json existe deja; aucune modification automatique.'; else printf '%s' '{\"$schema\":\"https://opencode.ai/config.json\",\"permission\":\"allow\"}' > opencode.json; fi"
);

const defaultProfiles = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    accent: "#8b5cf6",
    favorite: true,
    docsUrl: "https://code.claude.com/docs/en/cli-reference",
    installCommand: npmGlobalInstall("@anthropic-ai/claude-code"),
    // Reprise de la derniere conversation dans le dossier courant.
    resume: { args: ["--continue"] },
    authChecks: {
      env: ["ANTHROPIC_API_KEY"],
      files: [
        { label: "Claude config", path: pick("~\\.claude.json", "~/.claude.json") },
        { label: "Claude dossier", path: pick("~\\.claude", "~/.claude") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: ["--dangerously-skip-permissions"]
      },
      {
        id: "auto",
        label: "Auto",
        args: ["--permission-mode", "auto"]
      },
      {
        id: "plan",
        label: "Plan",
        args: ["--permission-mode", "plan"]
      },
      {
        id: "continue",
        label: "Continuer",
        args: ["--continue"]
      }
    ]
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    command: "codex",
    accent: "#10b981",
    favorite: true,
    docsUrl: "https://developers.openai.com/codex/cli/reference",
    installCommand: npmGlobalInstall("@openai/codex"),
    // "resume --last" est une sous-commande : elle remplace les args de mode.
    resume: { args: ["resume", "--last"], replace: true },
    authChecks: {
      env: ["OPENAI_API_KEY"],
      files: [
        { label: "Codex auth", path: pick("~\\.codex\\auth.json", "~/.codex/auth.json") },
        { label: "Codex config", path: pick("~\\.codex\\config.toml", "~/.codex/config.toml") }
      ]
    },
    defaultModeId: "grant-workspace",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-workspace",
        label: "Grant dossier",
        args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"]
      },
      {
        id: "danger-full",
        label: "Danger total",
        args: ["--dangerously-bypass-approvals-and-sandbox"]
      },
      {
        id: "read-only",
        label: "Lecture seule",
        args: ["--sandbox", "read-only"]
      },
      {
        id: "web-search",
        label: "Web search",
        args: ["--search"]
      }
    ]
  },
  {
    // Antigravity CLI (Google) remplace Gemini CLI depuis juin 2026 :
    // commande "agy", binaire Go, prompt one-shot en mode non-interactif.
    id: "antigravity",
    label: "Antigravity (Google)",
    command: "agy",
    accent: "#4285f4",
    favorite: true,
    docsUrl: "https://antigravity.google",
    installCommand: pick(
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://antigravity.google/cli/install.ps1 | iex\"",
      "curl -fsSL https://antigravity.google/cli/install.sh | bash"
    ),
    authChecks: {
      env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      files: [
        { label: "Antigravity config", path: pick("~\\.antigravity\\config.json", "~/.antigravity/config.json") },
        { label: "Antigravity dossier", path: pick("~\\.antigravity", "~/.antigravity") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "login",
        label: "Connexion",
        args: ["auth", "login"]
      }
    ]
  },
  {
    id: "gemini",
    label: "Gemini CLI (ancien)",
    command: "gemini",
    accent: "#0ea5e9",
    favorite: false,
    docsUrl: "https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html",
    installCommand: npmGlobalInstall("@google/gemini-cli"),
    authChecks: {
      env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      files: [
        { label: "Gemini auth", path: pick("~\\.gemini\\oauth_creds.json", "~/.gemini/oauth_creds.json") },
        { label: "Gemini config", path: pick("~\\.gemini\\settings.json", "~/.gemini/settings.json") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: ["--approval-mode=yolo"]
      },
      {
        id: "auto-edit",
        label: "Auto edit",
        args: ["--approval-mode=auto_edit"]
      },
      {
        id: "sandbox",
        label: "Sandbox",
        args: ["--sandbox"]
      },
      {
        id: "all-files",
        label: "Tout contexte",
        args: ["--all-files"]
      }
    ]
  },
  {
    id: "qwen",
    label: "Qwen Code",
    command: "qwen",
    accent: "#f59e0b",
    favorite: false,
    docsUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/",
    installCommand: npmGlobalInstall("@qwen-code/qwen-code@latest"),
    authChecks: {
      env: ["DASHSCOPE_API_KEY", "OPENAI_API_KEY"],
      files: [
        { label: "Qwen auth", path: pick("~\\.qwen\\oauth_creds.json", "~/.qwen/oauth_creds.json") },
        { label: "Qwen config", path: pick("~\\.qwen\\settings.json", "~/.qwen/settings.json") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: ["--approval-mode", "yolo"]
      },
      {
        id: "auto-edit",
        label: "Auto edit",
        args: ["--approval-mode", "auto-edit"]
      },
      {
        id: "plan",
        label: "Plan",
        args: ["--approval-mode", "plan"]
      }
    ]
  },
  {
    id: "aider",
    label: "Aider",
    command: "aider",
    accent: "#ef4444",
    favorite: false,
    docsUrl: "https://aider.chat/docs/config/options.html",
    // Aider relit l'historique de chat du depot au demarrage.
    resume: { args: ["--restore-chat-history"] },
    installCommand: pick(
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://aider.chat/install.ps1 | iex\"",
      "curl -LsSf https://aider.chat/install.sh | sh"
    ),
    authChecks: {
      env: [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENROUTER_API_KEY",
        "DEEPSEEK_API_KEY",
        "GROQ_API_KEY"
      ],
      files: [
        { label: "Aider config", path: pick("~\\.aider.conf.yml", "~/.aider.conf.yml") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: ["--yes-always"]
      },
      {
        id: "browser",
        label: "Browser",
        args: ["--browser"]
      },
      {
        id: "auto-test",
        label: "Auto test",
        args: ["--auto-test"]
      },
      {
        id: "dry-run",
        label: "Dry run",
        args: ["--dry-run"]
      }
    ]
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    accent: "#06b6d4",
    favorite: false,
    docsUrl: "https://opencode.ai/docs/permissions/",
    installCommand: npmGlobalInstall("opencode-ai"),
    // Reprend la derniere session OpenCode.
    resume: { args: ["--continue"] },
    authChecks: {
      env: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
      files: [
        { label: "OpenCode auth", path: pick("~\\.config\\opencode\\auth.json", "~/.config/opencode/auth.json") },
        { label: "OpenCode data", path: pick("%APPDATA%\\opencode\\auth.json", "~/.local/share/opencode/auth.json") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: [],
        preLaunchCommands: [opencodeGrantPreLaunch]
      },
      {
        id: "web",
        label: "Web",
        args: ["web"]
      }
    ]
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    command: "cursor-agent",
    accent: "#eab308",
    favorite: false,
    docsUrl: "https://docs.cursor.com/en/cli/reference/parameters",
    // "resume" est une sous-commande : elle remplace les args de mode.
    resume: { args: ["resume"], replace: true },
    installCommand: pick(
      "wsl bash -lc \"curl https://cursor.com/install -fsS | bash\"",
      "curl https://cursor.com/install -fsS | bash"
    ),
    authChecks: {
      env: ["CURSOR_API_KEY"],
      files: [
        { label: "Cursor config", path: pick("~\\.cursor", "~/.cursor") },
        { label: "Cursor data", path: pick("%APPDATA%\\Cursor", "~/.config/Cursor") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "grant-access",
        label: "Grant access",
        args: ["--force"]
      },
      {
        id: "print",
        label: "Print",
        args: ["--print", "--output-format", "text"]
      }
    ]
  },
  {
    id: "amp",
    label: "Amp",
    command: "amp",
    accent: "#ec4899",
    favorite: false,
    docsUrl: "https://ampcode.com/manual",
    installCommand: npmGlobalInstall("@sourcegraph/amp"),
    authChecks: {
      env: ["AMP_API_KEY"],
      files: [
        { label: "Amp config", path: pick("~\\.amp", "~/.amp") },
        { label: "Amp data", path: pick("%APPDATA%\\amp", "~/.config/amp") }
      ]
    },
    defaultModeId: "standard",
    modes: [
      {
        id: "standard",
        label: "Standard",
        args: []
      },
      {
        id: "login",
        label: "Login",
        args: ["login"]
      }
    ]
  }
];

// Methode d'injection de "persona" (system prompt) par CLI :
// - arg-file   : la persona est ecrite dans un fichier temporaire passe en
//                argument (rien n'est ecrit dans le projet de l'utilisateur).
// - project-file : la persona est inseree dans un bloc balise du fichier de
//                contexte que la CLI lit automatiquement (le reste du fichier
//                est preserve).
const personaInjectionById = {
  claude: { kind: "arg-file", flag: "--append-system-prompt-file" },
  aider: { kind: "arg-file", flag: "--read" },
  // Codex charge AGENTS.md comme "doc projet" mais n'obeit pas a une persona
  // via ce canal. On l'injecte donc comme premier message (envoye au terminal
  // apres lancement) : c'est ce que Codex respecte vraiment.
  codex: { kind: "first-message" },
  // Antigravity (TUI agentique) : on injecte la persona comme premier message,
  // canal le plus fiable (comme Codex), sans dependre d'un fichier de contexte.
  antigravity: { kind: "first-message" },
  opencode: { kind: "project-file", file: "AGENTS.md" },
  cursor: { kind: "project-file", file: "AGENTS.md" },
  amp: { kind: "project-file", file: "AGENTS.md" },
  gemini: { kind: "project-file", file: "GEMINI.md" },
  qwen: { kind: "project-file", file: "QWEN.md" }
};

for (const profile of defaultProfiles) {
  if (personaInjectionById[profile.id]) {
    profile.personaInjection = personaInjectionById[profile.id];
  }
}

// Mode non-interactif (« headless ») de chaque CLI pour le pipeline : on lance
// la commande avec ces arguments puis le prompt en dernier argument ; la CLI
// execute et rend une sortie texte avant de se terminer. Certains flags sont des
// meilleures-estimations (qwen/amp/opencode) : ils restent editables par etape.
// `stdin: true` => le prompt est envoye par l'entree standard (et NON en argument
// de ligne de commande). Indispensable pour les prompts multi-lignes / avec des
// caracteres speciaux (sinon PowerShell re-parse le texte et plante).
const headlessById = {
  claude: { args: ["-p"], stdin: true },
  // codex exec refuse de tourner hors d'un depot git approuve sans ce flag.
  codex: { args: ["exec", "--skip-git-repo-check"], stdin: true },
  antigravity: { args: [], stdin: true },
  gemini: { args: [], stdin: true },
  qwen: { args: [], stdin: true },
  // Aider attend le message via --message (pas de lecture stdin) : mode argument.
  aider: { args: ["--yes", "--no-stream", "--message"], stdin: false },
  opencode: { args: ["run"], stdin: false },
  cursor: { args: ["--print", "--output-format", "text"], stdin: false },
  amp: { args: [], stdin: true }
};

for (const profile of defaultProfiles) {
  if (headlessById[profile.id]) {
    profile.headless = headlessById[profile.id];
  }
}

// Personas par defaut (agnostiques de la CLI : juste un texte de system prompt).
const defaultPersonas = [
  {
    id: "concise",
    name: "Concis",
    accent: "#38bdf8",
    prompt: "Réponds de façon concise et directe. Va droit au but, sans préambule ni récapitulatif superflu."
  },
  {
    id: "francais",
    name: "Toujours en français",
    accent: "#22c55e",
    prompt: "Réponds toujours en français, y compris pour les commentaires de code et les messages de commit."
  },
  {
    id: "reviewer",
    name: "Relecteur strict",
    accent: "#f59e0b",
    prompt: "Agis comme un relecteur senior exigeant : signale les bugs, cas limites, problèmes de sécurité et de lisibilité. Propose des améliorations concrètes plutôt que de simplement valider."
  },
  {
    id: "pedago",
    name: "Pédagogue",
    accent: "#a78bfa",
    prompt: "Explique ton raisonnement étape par étape et justifie tes choix techniques, comme pour un développeur junior qui souhaite comprendre."
  }
];

module.exports = { defaultProfiles, defaultPersonas };
