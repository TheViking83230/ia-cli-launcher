const state = {
  config: null,
  selectedFolder: "",
  sessions: new Map(),
  activeSessionId: null,
  authStatus: null,
  app: null,
  // Vue partagee : { leftId, rightId } quand deux onglets sont cote a cote,
  // sinon null. activeSessionId = pane ayant le focus (l'un des deux).
  split: null,
  // Saisie synchronisee : ce qu'on tape est envoye aux DEUX panes du split.
  mirrorInput: false
};

const elements = {
  appShell: document.getElementById("appShell"),
  adminStatus: document.getElementById("adminStatus"),
  shellLabel: document.getElementById("shellLabel"),
  appVersionLabel: document.getElementById("appVersionLabel"),
  chooseFolderButton: document.getElementById("chooseFolderButton"),
  folderPath: document.getElementById("folderPath"),
  tabTitleInput: document.getElementById("tabTitleInput"),
  profileSelect: document.getElementById("profileSelect"),
  modeSelect: document.getElementById("modeSelect"),
  personaSelect: document.getElementById("personaSelect"),
  managePersonasButton: document.getElementById("managePersonasButton"),
  extraArgsInput: document.getElementById("extraArgsInput"),
  commandInput: document.getElementById("commandInput"),
  modeArgsInput: document.getElementById("modeArgsInput"),
  installCommandInput: document.getElementById("installCommandInput"),
  docsUrlInput: document.getElementById("docsUrlInput"),
  favoriteProfileButton: document.getElementById("favoriteProfileButton"),
  installProfileButton: document.getElementById("installProfileButton"),
  docsProfileButton: document.getElementById("docsProfileButton"),
  addProfileButton: document.getElementById("addProfileButton"),
  deleteProfileButton: document.getElementById("deleteProfileButton"),
  commandStatus: document.getElementById("commandStatus"),
  refreshAuthButton: document.getElementById("refreshAuthButton"),
  authStatusList: document.getElementById("authStatusList"),
  saveProfileButton: document.getElementById("saveProfileButton"),
  resetProfilesButton: document.getElementById("resetProfilesButton"),
  launchButton: document.getElementById("launchButton"),
  tabs: document.getElementById("tabs"),
  usageBar: document.getElementById("usageBar"),
  terminalHost: document.getElementById("terminalHost"),
  emptyState: document.getElementById("emptyState"),
  activeTitleInput: document.getElementById("activeTitleInput"),
  renameActiveTabButton: document.getElementById("renameActiveTabButton"),
  relaySelect: document.getElementById("relaySelect"),
  restartAiButton: document.getElementById("restartAiButton"),
  gitChip: document.getElementById("gitChip"),
  promptsButton: document.getElementById("promptsButton"),
  conversationsButton: document.getElementById("conversationsButton"),
  jarvisButton: document.getElementById("jarvisButton"),
  headerToolsButton: document.getElementById("headerToolsButton"),
  toolbar: document.getElementById("toolbar"),
  toolbarToggleButton: document.getElementById("toolbarToggleButton"),
  toggleSidebarButton: document.getElementById("toggleSidebarButton"),
  sessionMeta: document.getElementById("sessionMeta"),
  historyButton: document.getElementById("historyButton"),
  shortcutsButton: document.getElementById("shortcutsButton"),
  syncButton: document.getElementById("syncButton"),
  splitButton: document.getElementById("splitButton"),
  mirrorButton: document.getElementById("mirrorButton"),
  pipelineButton: document.getElementById("pipelineButton"),
  historyModal: document.getElementById("historyModal"),
  historySearchInput: document.getElementById("historySearchInput"),
  historyClearButton: document.getElementById("historyClearButton"),
  historyList: document.getElementById("historyList"),
  historyViewerMeta: document.getElementById("historyViewerMeta"),
  historyViewerContent: document.getElementById("historyViewerContent"),
  historyResumeButton: document.getElementById("historyResumeButton"),
  autoRestoreToggle: document.getElementById("autoRestoreToggle"),
  updateBanner: document.getElementById("updateBanner"),
  updateBannerText: document.getElementById("updateBannerText"),
  updateInstallButton: document.getElementById("updateInstallButton"),
  updateBannerClose: document.getElementById("updateBannerClose")
};

function isAutoRestoreEnabled() {
  return window.localStorage.getItem("autoRestore") !== "0";
}

function setAutoRestoreEnabled(enabled) {
  if (enabled) {
    window.localStorage.removeItem("autoRestore");
  } else {
    window.localStorage.setItem("autoRestore", "0");
  }
  if (elements.autoRestoreToggle) {
    elements.autoRestoreToggle.checked = enabled;
  }
}

const historyState = {
  entries: [],
  rawCache: new Map(),
  textCache: new Map(),
  selectedId: null,
  viewer: null
};

function createIcons() {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "stroke-width": 1.8
      }
    });
  }
}

function sortProfiles(profiles) {
  return [...profiles].sort((first, second) => {
    if (Boolean(first.favorite) !== Boolean(second.favorite)) {
      return first.favorite ? -1 : 1;
    }
    return String(first.label || "").localeCompare(String(second.label || ""), "fr");
  });
}

function getSelectedProfile() {
  return state.config.profiles.find((profile) => profile.id === elements.profileSelect.value);
}

function getSelectedMode() {
  const profile = getSelectedProfile();
  return profile?.modes.find((mode) => mode.id === elements.modeSelect.value);
}

function getPersonas() {
  return Array.isArray(state.config?.personas) ? state.config.personas : [];
}

function getPersonaById(id) {
  return getPersonas().find((persona) => persona.id === id) || null;
}

// Remplit le selecteur de persona ("Aucune" + la bibliotheque), en conservant
// la selection courante si possible.
function renderPersonas(selectedId = elements.personaSelect.value) {
  const personas = getPersonas();
  const target = selectedId || window.localStorage.getItem("lastPersonaId") || "";
  elements.personaSelect.innerHTML = "";

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Aucune";
  elements.personaSelect.appendChild(none);

  for (const persona of personas) {
    const option = document.createElement("option");
    option.value = persona.id;
    option.textContent = persona.name;
    elements.personaSelect.appendChild(option);
  }

  elements.personaSelect.value = getPersonaById(target) ? target : "";
}

function getSelectedPersona() {
  return getPersonaById(elements.personaSelect.value);
}

function stringifyArgs(args) {
  return Array.isArray(args) ? args.join(" ") : String(args || "");
}

function splitArgs(value) {
  const input = String(value || "").trim();
  return input ? input.split(/\s+/) : [];
}

function updateFolder(path) {
  state.selectedFolder = path || "";
  elements.folderPath.textContent = state.selectedFolder || "Aucun dossier choisi";
  elements.folderPath.classList.toggle("empty", !state.selectedFolder);
  if (state.selectedFolder) {
    window.localStorage.setItem("lastFolder", state.selectedFolder);
  }
}

function setSidebarCollapsed(collapsed) {
  elements.appShell.classList.toggle("sidebar-collapsed", collapsed);
  elements.toggleSidebarButton.title = collapsed ? "Afficher le menu" : "Masquer le menu";
  elements.toggleSidebarButton.innerHTML = collapsed
    ? '<i data-lucide="panel-left-open"></i>'
    : '<i data-lucide="panel-left-close"></i>';
  window.localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  createIcons();

  const active = state.sessions.get(state.activeSessionId);
  if (active) {
    setTimeout(() => active.fitAddon.fit(), 180);
  }
}

// --- Outils de l'onglet (en-tete) masquables ----------------------------------
function setHeaderToolsHidden(hidden) {
  elements.activeTitleInput.parentElement.classList.toggle("tools-hidden", hidden);
  elements.headerToolsButton.title = hidden ? "Afficher les outils de l'onglet" : "Masquer les outils de l'onglet";
  elements.headerToolsButton.innerHTML = `<i data-lucide="${hidden ? "chevrons-right" : "chevrons-left"}"></i>`;
  window.localStorage.setItem("headerToolsHidden", hidden ? "1" : "0");
  createIcons();
}

// Barre d'outils de droite masquable (le bouton JARVIS reste visible).
function setToolbarHidden(hidden) {
  elements.toolbar.classList.toggle("tools-hidden", hidden);
  elements.toolbarToggleButton.title = hidden ? "Afficher la barre d'outils" : "Masquer la barre d'outils";
  elements.toolbarToggleButton.innerHTML = `<i data-lucide="${hidden ? "chevrons-left" : "chevrons-right"}"></i>`;
  window.localStorage.setItem("toolbarHidden", hidden ? "1" : "0");
  createIcons();
}

// --- Sections repliables du menu lateral -----------------------------------------
// Etat garde par titre de section ; "Profil actif" (reglages avances, peu
// utilises) est replie par defaut.
const PANELS_COLLAPSED_BY_DEFAULT = ["Profil actif"];

function loadCollapsedPanels() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("collapsedPanels"));
    if (Array.isArray(saved)) {
      return new Set(saved);
    }
  } catch {}
  return new Set(PANELS_COLLAPSED_BY_DEFAULT);
}

function setupCollapsiblePanels() {
  const collapsed = loadCollapsedPanels();
  for (const panel of document.querySelectorAll(".sidebar .panel")) {
    const title = panel.querySelector(":scope > .section-title");
    if (!title) {
      continue;
    }
    const name = title.textContent.trim();
    const chevron = document.createElement("span");
    chevron.className = "panel-chevron";
    chevron.innerHTML = '<i data-lucide="chevron-down"></i>';
    title.prepend(chevron);
    title.classList.add("collapsible");
    title.tabIndex = 0;
    title.setAttribute("role", "button");

    const apply = (isCollapsed) => {
      panel.classList.toggle("collapsed", isCollapsed);
      title.setAttribute("aria-expanded", String(!isCollapsed));
      title.title = isCollapsed ? "Afficher la section" : "Replier la section";
    };
    const toggle = () => {
      const next = !panel.classList.contains("collapsed");
      apply(next);
      if (next) {
        collapsed.add(name);
      } else {
        collapsed.delete(name);
      }
      window.localStorage.setItem("collapsedPanels", JSON.stringify([...collapsed]));
    };

    apply(collapsed.has(name));
    title.addEventListener("click", (event) => {
      // Les boutons du titre (ex. actualiser les tokens) gardent leur action.
      if (!event.target.closest("button")) {
        toggle();
      }
    });
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }
}

function renderProfiles(selectedId = elements.profileSelect.value) {
  elements.profileSelect.innerHTML = "";

  const sortedProfiles = sortProfiles(state.config.profiles);
  for (const profile of sortedProfiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.favorite ? "[F] " : ""}${profile.label}`;
    elements.profileSelect.appendChild(option);
  }

  const nextSelected = state.config.profiles.some((profile) => profile.id === selectedId)
    ? selectedId
    : sortedProfiles[0]?.id;

  if (nextSelected) {
    elements.profileSelect.value = nextSelected;
  }

  renderModes();
  renderProfileSettings();
}

function renderModes(selectedId) {
  const profile = getSelectedProfile();
  elements.modeSelect.innerHTML = "";

  if (!profile) {
    return;
  }

  for (const mode of profile.modes) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label;
    elements.modeSelect.appendChild(option);
  }

  const nextSelected = profile.modes.some((mode) => mode.id === selectedId)
    ? selectedId
    : profile.defaultModeId || profile.modes[0]?.id || "";
  elements.modeSelect.value = nextSelected;
  renderProfileSettings();
}

async function renderProfileSettings() {
  const profile = getSelectedProfile();
  const mode = getSelectedMode();
  elements.commandInput.value = profile?.command || "";
  elements.modeArgsInput.value = stringifyArgs(mode?.args);
  elements.installCommandInput.value = profile?.installCommand || "";
  elements.docsUrlInput.value = profile?.docsUrl || "";
  elements.favoriteProfileButton.classList.toggle("active", Boolean(profile?.favorite));
  elements.installProfileButton.disabled = !profile?.installCommand;
  elements.docsProfileButton.disabled = !profile?.docsUrl;
  elements.deleteProfileButton.disabled = !profile?.custom;
  elements.commandStatus.textContent = "";

  if (profile?.command) {
    const status = await window.launcher.checkCommand(profile.command);
    elements.commandStatus.textContent = status.ok ? `Detecte: ${status.output.split(/\r?\n/)[0]}` : "Non detecte dans le PATH";
    elements.commandStatus.classList.toggle("bad", !status.ok);
  }
}

function countOk(items) {
  return items.filter((item) => item.ok).length;
}

function buildAuthTooltip(status) {
  const lines = [
    `${status.label}`,
    `Commande: ${status.commandOk ? status.commandPath : "non detectee"}`,
    `Etat: ${status.summary}`
  ];

  if (status.envChecks.length > 0) {
    lines.push("");
    lines.push("Variables:");
    for (const check of status.envChecks) {
      lines.push(`- ${check.name}: ${check.ok ? "detectee" : "absente"}`);
    }
  }

  if (status.fileChecks.length > 0) {
    lines.push("");
    lines.push("Fichiers/config:");
    for (const check of status.fileChecks) {
      lines.push(`- ${check.label}: ${check.ok ? "detecte" : "absent"} (${check.path})`);
    }
  }

  return lines.join("\n");
}

function renderAuthStatusList(statuses = state.authStatus?.profiles || []) {
  elements.authStatusList.innerHTML = "";

  if (!statuses.length) {
    const empty = document.createElement("div");
    empty.className = "auth-empty";
    empty.textContent = "Aucun profil a verifier.";
    elements.authStatusList.appendChild(empty);
    return;
  }

  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const sortedProfiles = sortProfiles(state.config.profiles);
  const fragment = document.createDocumentFragment();

  for (const profile of sortedProfiles) {
    const status = statusById.get(profile.id);
    if (!status) {
      continue;
    }

    const row = document.createElement("button");
    row.type = "button";
    row.className = `auth-row ${status.state}`;
    row.title = buildAuthTooltip(status);
    row.addEventListener("click", () => {
      elements.profileSelect.value = profile.id;
      renderModes();
      renderProfileSettings();
    });

    const dot = document.createElement("span");
    dot.className = "auth-dot";

    const main = document.createElement("div");
    main.className = "auth-main";

    const title = document.createElement("div");
    title.className = "auth-title";

    const name = document.createElement("strong");
    name.textContent = status.label;
    title.appendChild(name);

    const summary = document.createElement("div");
    summary.className = "auth-summary";
    summary.textContent = status.summary;

    const tags = document.createElement("div");
    tags.className = "auth-tags";

    const commandTag = document.createElement("span");
    commandTag.className = `auth-tag ${status.commandOk ? "ok" : "bad"}`;
    commandTag.textContent = status.commandOk ? "CLI OK" : "CLI absente";
    tags.appendChild(commandTag);

    if (status.envChecks.length > 0) {
      const envTag = document.createElement("span");
      envTag.className = `auth-tag ${countOk(status.envChecks) > 0 ? "ok" : "bad"}`;
      envTag.textContent = `ENV ${countOk(status.envChecks)}/${status.envChecks.length}`;
      tags.appendChild(envTag);
    }

    if (status.fileChecks.length > 0) {
      const fileTag = document.createElement("span");
      fileTag.className = `auth-tag ${countOk(status.fileChecks) > 0 ? "ok" : "bad"}`;
      fileTag.textContent = `Config ${countOk(status.fileChecks)}/${status.fileChecks.length}`;
      tags.appendChild(fileTag);
    }

    main.append(title, summary, tags);
    row.append(dot, main);
    fragment.appendChild(row);
  }

  elements.authStatusList.appendChild(fragment);
}

async function refreshAuthStatus() {
  elements.authStatusList.innerHTML = '<div class="auth-empty">Verification...</div>';
  elements.refreshAuthButton.disabled = true;

  try {
    state.authStatus = await window.launcher.getAuthStatus();
    renderAuthStatusList();
  } catch (error) {
    elements.authStatusList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "auth-empty";
    empty.textContent = error.message || String(error);
    elements.authStatusList.appendChild(empty);
  } finally {
    elements.refreshAuthButton.disabled = false;
    createIcons();
  }
}

const TERMINAL_THEME = {
  background: "#0d0f14",
  foreground: "#e6e8ee",
  cursor: "#f6c85f",
  selectionBackground: "#2f6f9f66",
  black: "#111318",
  red: "#ff6b6b",
  green: "#45d483",
  yellow: "#f6c85f",
  blue: "#5aa9ff",
  magenta: "#b48cff",
  cyan: "#42d7d2",
  white: "#eceff4"
};

// Variante du theme pour l'interface JARVIS (memes couleurs ANSI).
const JARVIS_TERMINAL_THEME = {
  ...TERMINAL_THEME,
  background: "#02090f",
  foreground: "#d8f7ff",
  cursor: "#38e8ff",
  selectionBackground: "#38e8ff44"
};

function currentTerminalTheme() {
  return document.body.classList.contains("jarvis") ? JARVIS_TERMINAL_THEME : TERMINAL_THEME;
}

function getTerminalGlobals() {
  return {
    TerminalCtor: window.Terminal,
    FitAddonCtor: window.FitAddon?.FitAddon,
    SearchAddonCtor: window.SearchAddon?.SearchAddon
  };
}

// --- Taille de police du terminal (zoom) -----------------------------------
const FONT_MIN = 8;
const FONT_MAX = 28;
const FONT_DEFAULT = 13;

function getTerminalFontSize() {
  const value = parseInt(window.localStorage.getItem("terminalFontSize"), 10);
  return Number.isFinite(value) && value >= FONT_MIN && value <= FONT_MAX ? value : FONT_DEFAULT;
}

// Applique une taille de police a tous les terminaux ouverts et la persiste.
function applyTerminalFontSize(size) {
  const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
  window.localStorage.setItem("terminalFontSize", String(clamped));
  // La taille s'applique a tous les terminaux ; seul l'onglet visible est
  // re-ajuste maintenant (les autres le seront a leur activation, fit() sur un
  // conteneur masque etant peu fiable).
  for (const session of state.sessions.values()) {
    session.terminal.options.fontSize = clamped;
  }
  const active = state.sessions.get(state.activeSessionId);
  if (active) {
    active.fitAddon.fit();
    window.launcher.resizeTerminal(active.id, active.terminal.cols, active.terminal.rows);
  }
  return clamped;
}

function changeTerminalFontSize(delta) {
  if (!state.sessions.size) {
    flashStatus("Aucun terminal ouvert.");
    return;
  }
  const next = applyTerminalFontSize(getTerminalFontSize() + delta);
  flashStatus(`Police du terminal : ${next} px`);
}

function resetTerminalFontSize() {
  applyTerminalFontSize(FONT_DEFAULT);
  flashStatus(`Police du terminal : ${FONT_DEFAULT} px`);
}

// Message bref dans la barre de statut, restaure ensuite l'info de la session.
let statusRestoreTimer = null;
function flashStatus(message) {
  elements.sessionMeta.textContent = message;
  window.clearTimeout(statusRestoreTimer);
  statusRestoreTimer = window.setTimeout(() => {
    const active = state.sessions.get(state.activeSessionId);
    elements.sessionMeta.textContent = active ? `${active.command} | ${active.cwd}` : "Pret";
  }, 1800);
}

function createTerminal() {
  const { TerminalCtor, FitAddonCtor, SearchAddonCtor } = getTerminalGlobals();
  const terminal = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: "bar",
    convertEol: true,
    copyOnSelect: true,
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: getTerminalFontSize(),
    lineHeight: 1.2,
    scrollback: 10000,
    theme: currentTerminalTheme()
  });
  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);
  let searchAddon = null;
  if (SearchAddonCtor) {
    searchAddon = new SearchAddonCtor();
    terminal.loadAddon(searchAddon);
  }
  return { terminal, fitAddon, searchAddon };
}

// Terminal en lecture seule pour la visionneuse d'historique : conserve les
// couleurs ANSI et le rendu fidele des CLI plein ecran (TUI).
function createViewerTerminal() {
  const { TerminalCtor, FitAddonCtor } = getTerminalGlobals();
  const terminal = new TerminalCtor({
    cursorBlink: false,
    cursorStyle: "bar",
    convertEol: true,
    copyOnSelect: true,
    disableStdin: true,
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.3,
    scrollback: 20000,
    theme: TERMINAL_THEME
  });
  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);
  return { terminal, fitAddon };
}

function setActiveSession(id) {
  // En vue partagee, cliquer un onglet absent du split le charge dans le pane
  // ayant le focus ; cliquer/focus un pane deja affiche deplace juste le focus.
  if (state.split && id && id !== state.split.leftId && id !== state.split.rightId) {
    if (state.activeSessionId === state.split.rightId) {
      state.split.rightId = id;
    } else {
      state.split.leftId = id;
    }
  }
  state.activeSessionId = id;
  layoutPanes();
}

// Applique l'agencement courant (simple ou partage) : classes CSS des panes et
// des onglets, en-tete, etat des boutons, et ajustement des terminaux visibles.
function layoutPanes() {
  // La vue partagee n'est valide que si ses deux sessions existent encore.
  if (state.split && !(state.sessions.has(state.split.leftId) && state.sessions.has(state.split.rightId))) {
    state.split = null;
    state.mirrorInput = false;
  }
  const split = state.split;
  elements.terminalHost.classList.toggle("split", Boolean(split));

  for (const session of state.sessions.values()) {
    session.container.classList.remove("active", "pane-left", "pane-right", "pane-focused");
    session.tab.classList.remove("active", "split-left", "split-right");
  }

  if (split) {
    const left = state.sessions.get(split.leftId);
    const right = state.sessions.get(split.rightId);
    left.container.classList.add("pane-left");
    right.container.classList.add("pane-right");
    left.tab.classList.add("split-left");
    right.tab.classList.add("split-right");
    const focused = state.sessions.get(state.activeSessionId) || left;
    focused.container.classList.add("pane-focused");
    focused.tab.classList.add("active");
  } else {
    const active = state.sessions.get(state.activeSessionId);
    if (active) {
      active.container.classList.add("active");
      active.tab.classList.add("active");
    }
  }

  clearVisibleAttention();
  updateSessionHeader();
  updateSplitControls();
  fitVisible();
}

function updateSessionHeader() {
  const active = state.sessions.get(state.activeSessionId);
  const isPipeline = active?.type === "pipeline";
  elements.emptyState.classList.toggle("hidden", state.sessions.size > 0);
  elements.activeTitleInput.disabled = !active;
  elements.renameActiveTabButton.disabled = !active;
  // Redemarrage possible seulement pour un onglet lance depuis un profil CLI.
  elements.restartAiButton.disabled = !active || isPipeline || active.spec?.kind !== "profile";
  updateRestartButton();
  refreshGitChip();
  if (elements.relaySelect) {
    // Le relais ne s'applique qu'aux onglets terminaux.
    elements.relaySelect.disabled = !active || isPipeline;
    elements.relaySelect.value = "";
  }
  elements.activeTitleInput.value = active?.title || "Aucun onglet";
  elements.sessionMeta.textContent = active
    ? isPipeline ? "Pipeline IA" : `${active.command} | ${active.cwd}`
    : "Pret";
  refreshUsageBar();
}

// --- Quota de l'IA de l'onglet actif (en-tete, a droite du titre) ----------
// Rafraichi periodiquement ; le processus principal met en cache les appels.
const USAGE_POLL_MS = 2000;
let usageRequestToken = 0;

function sessionProfileId(session) {
  return session?.spec?.profileId || session?.profileId || "";
}

// Temps restant avant reinitialisation, ex. "2 h 05", "3 j 4 h", "12 min".
function formatResetIn(resetsAt) {
  const ms = resetsAt - Date.now();
  if (!(ms > 0)) {
    return "";
  }
  const minutes = Math.ceil(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `${days} j ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h ${String(mins).padStart(2, "0")}`;
  }
  return `${mins} min`;
}

function usageLevel(percent) {
  if (percent >= 90) {
    return "danger";
  }
  return percent >= 70 ? "warning" : "ok";
}

function createUsageMeter(label, percent, detail, title) {
  const item = document.createElement("div");
  item.className = `usage-item ${usageLevel(percent)}`;
  if (title) {
    item.title = title;
  }

  const name = document.createElement("span");
  name.textContent = label;

  const track = document.createElement("div");
  track.className = "usage-track";
  const fill = document.createElement("div");
  fill.className = "usage-fill";
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  track.appendChild(fill);

  const value = document.createElement("span");
  value.className = "usage-value";
  value.textContent = `${Math.round(percent)} %`;

  item.append(name, track, value);
  if (detail) {
    const extra = document.createElement("span");
    extra.className = "usage-detail";
    extra.textContent = detail;
    item.appendChild(extra);
  }
  return item;
}

function renderUsageBar(session, profile, data) {
  const bar = elements.usageBar;
  bar.innerHTML = "";
  if (!session) {
    bar.classList.add("empty");
    return;
  }
  bar.classList.remove("empty");
  bar.style.setProperty("--usage-accent", profile?.accent || session.accent || "#10b981");

  const head = document.createElement("div");
  head.className = "usage-head";
  const dot = document.createElement("span");
  dot.className = "usage-dot";
  const name = document.createElement("strong");
  name.textContent = profile?.label || "CLI";
  head.append(dot, name);
  bar.appendChild(head);

  if (data?.available) {
    const updated = data.updatedAt ? ` · mis à jour à ${new Date(data.updatedAt).toLocaleTimeString("fr-FR")}` : "";
    for (const win of data.windows || []) {
      let detail = "";
      let title = `Quota ${win.label} consommé`;
      if (win.reset) {
        detail = "réinitialisé";
      } else if (win.resetsAt) {
        detail = `↻ ${formatResetIn(win.resetsAt)}`;
        title += ` · réinitialisation le ${new Date(win.resetsAt).toLocaleString("fr-FR")}`;
      }
      bar.appendChild(createUsageMeter(win.label, win.usedPercent, detail, title + updated));
    }
    renderQuotaAlert(bar, session, profile, data.windows || []);
    if (data.notice) {
      // Dernieres valeurs connues, pas a jour : on le signale discretement.
      const stale = document.createElement("span");
      stale.className = "usage-stale";
      stale.textContent = "⚠";
      stale.title = `${data.notice}${updated}`;
      bar.appendChild(stale);
    }
  } else {
    const note = document.createElement("span");
    note.className = "usage-note";
    note.textContent = data?.reason || "Quota indisponible.";
    note.title = note.textContent;
    bar.appendChild(note);
  }
  renderContextMeter(bar, session);
}

// "276599" -> "277 k", "1000000" -> "1 M".
function formatTokens(count) {
  const value = Number(count) || 0;
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1).replace(".", ",")} M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)} k`;
  }
  return String(value);
}

// Remplissage de la memoire de travail de la conversation de l'onglet.
function renderContextMeter(bar, session) {
  const context = session.context;
  if (!context?.window) {
    return;
  }
  const detail = `${formatTokens(context.tokens)} / ${formatTokens(context.window)}`;
  const title = `Contexte de la conversation : ${context.tokens.toLocaleString("fr-FR")} tokens sur ${context.window.toLocaleString("fr-FR")}`
    + (context.model ? ` (${context.model})` : "")
    + ". Pense à /compact avant qu'il ne soit plein.";
  const meter = createUsageMeter("Contexte", context.percent, detail, title);
  meter.classList.add("usage-context");
  bar.appendChild(meter);
}

// Quota presque epuise (>= 90 %) : bouton pour passer le relais a une autre
// IA, et une alerte unique par fenetre de quota (jusqu'a sa reinitialisation).
const QUOTA_ALERT_PERCENT = 90;
const quotaAlertsShown = new Set();

function renderQuotaAlert(bar, session, profile, windows) {
  const critical = windows
    .filter((win) => !win.reset && win.usedPercent >= QUOTA_ALERT_PERCENT)
    .sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (!critical) {
    return;
  }
  const label = profile?.label || "Cette IA";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "usage-relay";
  button.textContent = "Relais →";
  button.title = `Quota ${critical.label} de ${label} à ${Math.round(critical.usedPercent)} % : passer la conversation à une autre IA`;
  button.addEventListener("click", () => openRelayPicker());
  bar.appendChild(button);

  const key = `${sessionProfileId(session)}|${critical.id}|${critical.resetsAt || ""}`;
  if (!quotaAlertsShown.has(key)) {
    quotaAlertsShown.add(key);
    const message = `Quota ${critical.label} de ${label} à ${Math.round(critical.usedPercent)} % : tu peux passer le relais à une autre IA (bouton « Relais → »).`;
    flashStatus(message);
    if (notificationsEnabled()) {
      window.launcher.notify({ title: "Quota presque épuisé", body: message, sessionId: session.id }).catch(() => {});
    }
  }
}

// Ouvre la liste de relais de l'en-tete.
function openRelayPicker() {
  const select = elements.relaySelect;
  if (!select || select.disabled) {
    return;
  }
  select.focus();
  try {
    select.showPicker();
  } catch {}
}

async function refreshUsageBar() {
  const session = state.sessions.get(state.activeSessionId);
  const token = ++usageRequestToken;
  if (!session || session.type !== "terminal") {
    renderUsageBar(null);
    return;
  }
  const profileId = sessionProfileId(session);
  const profile = state.config?.profiles.find((p) => p.id === profileId);
  let data = null;
  try {
    data = await window.launcher.getUsage(profileId);
  } catch {
    data = null;
  }
  // Une requete plus recente (changement d'onglet) a pris le relais.
  if (token !== usageRequestToken) {
    return;
  }
  renderUsageBar(session, profile, data);
}

// --- Etat des IA dans les onglets + mise a jour en attente -----------------
// Claude indique lui-meme s'il travaille ; pour les autres CLI on le deduit de
// l'activite du terminal (une CLI qui travaille redessine son ecran en continu).
const LIVE_POLL_MS = 2000;
const OUTPUT_BUSY_MS = 2500;
// Duree minimale de travail (CLI sans etat exact) avant de notifier la fin.
const HEURISTIC_MIN_BUSY_MS = 8000;
let livePollRunning = false;

function notificationsEnabled() {
  try {
    return window.localStorage.getItem("aiDoneNotifications") !== "off";
  } catch {
    return true;
  }
}

function toggleNotifications() {
  const enabled = !notificationsEnabled();
  try {
    window.localStorage.setItem("aiDoneNotifications", enabled ? "on" : "off");
  } catch {}
  flashStatus(enabled
    ? "Notifications de fin de tâche activées."
    : "Notifications de fin de tâche désactivées.");
}

function isSessionVisible(session) {
  if (state.split) {
    return session.id === state.split.leftId || session.id === state.split.rightId;
  }
  return session.id === state.activeSessionId;
}

// Un onglet affiche et regarde n'a plus besoin d'attirer l'attention.
function clearVisibleAttention() {
  if (!document.hasFocus()) {
    return;
  }
  for (const session of state.sessions.values()) {
    if (session.attention && isSessionVisible(session)) {
      session.attention = false;
      session.tab.classList.remove("ai-attention");
    }
  }
}

// Libelle de ce que Claude attend (champ "waitingFor" de son fichier d'etat).
function describeWaiting(waitingFor) {
  const reason = String(waitingFor || "").toLowerCase();
  if (!reason || reason.includes("permission") || reason.includes("approv")) {
    return "attend ton accord";
  }
  if (reason.includes("input") || reason.includes("question")) {
    return "attend ta réponse";
  }
  return `attend : ${waitingFor}`;
}

function notifySession(session, body) {
  if (notificationsEnabled()) {
    window.launcher.notify({ title: session.title, body, sessionId: session.id }).catch(() => {});
  }
}

function applyAiState(session, aiState, exact, waitingFor) {
  const previous = session.aiState;
  const now = Date.now();
  const unseen = !isSessionVisible(session) || !document.hasFocus();
  const label = getProfileLabel(sessionProfileId(session)) || "L'IA";
  if (aiState === "busy" && previous !== "busy") {
    session.busySince = now;
  }
  if (aiState === "waiting" && previous !== "waiting") {
    // Bloquee sur une autorisation ou une question : a signaler tout de suite.
    if (unseen) {
      session.attention = true;
      notifySession(session, `${label} ${describeWaiting(waitingFor)}.`);
    }
  } else if (previous === "busy" && aiState === "idle") {
    const longEnough = exact || now - (session.busySince || now) >= HEURISTIC_MIN_BUSY_MS;
    if (longEnough && unseen) {
      session.attention = true;
      notifySession(session, `${label} a terminé et attend ta réponse.`);
    }
    if (longEnough && isSessionVisible(session)) {
      jarvisAutoReadReply(session);
    }
  }
  session.aiState = aiState;
  session.waitingFor = aiState === "waiting" ? waitingFor : "";
  session.tab.classList.toggle("ai-busy", aiState === "busy");
  session.tab.classList.toggle("ai-waiting", aiState === "waiting");
  session.tab.classList.toggle("ai-attention", Boolean(session.attention));
}

function applyUpdateState(session, status) {
  const pending = Boolean(status?.updatePending);
  if (pending && !session.updatePending) {
    const label = getProfileLabel(sessionProfileId(session)) || "La CLI";
    flashStatus(`${label} ${status.installedVersion} est installé (onglet « ${session.title} » en ${status.runningVersion}) : clique ↻ pour l'appliquer.`);
  }
  session.updatePending = pending;
  session.versions = status ? { running: status.runningVersion, installed: status.installedVersion } : null;
  session.tab.classList.toggle("ai-update", pending);
  session.tab.title = pending
    ? `Mise à jour en attente : ${status.runningVersion} → ${status.installedVersion} (↻ pour l'appliquer)`
    : "";
}

function updateRestartButton() {
  const active = state.sessions.get(state.activeSessionId);
  const button = elements.restartAiButton;
  const pending = Boolean(active?.updatePending);
  button.classList.toggle("has-update", pending);
  button.title = pending
    ? `Mise à jour disponible (${active.versions.running} → ${active.versions.installed}) : redémarrer l'IA pour l'appliquer, en reprenant la conversation`
    : "Redémarrer l'IA de l'onglet (ex. après une mise à jour) en reprenant la conversation";
}

async function refreshLiveStatus() {
  if (livePollRunning) {
    return;
  }
  livePollRunning = true;
  try {
    const watched = [...state.sessions.values()].filter(
      (s) => s.type === "terminal" && s.spec?.kind === "profile" && !s.tab.classList.contains("ended") && !s.relaying
    );
    if (!watched.length) {
      return;
    }
    let statuses = {};
    try {
      statuses = (await window.launcher.getLiveStatus(watched.map((s) => s.id))) || {};
    } catch {}
    for (const session of watched) {
      // Session redemarree ou fermee pendant la requete.
      if (state.sessions.get(session.id) !== session || session.relaying) {
        continue;
      }
      const status = statuses[session.id];
      const exact = Boolean(status?.state);
      const aiState = exact
        ? status.state
        : Date.now() - (session.lastOutputAt || 0) < OUTPUT_BUSY_MS ? "busy" : "idle";
      applyAiState(session, aiState, exact, status?.waitingFor || "");
      applyUpdateState(session, status);
      session.context = status?.context || null;
      session.conversationId = status?.conversationId || session.conversationId || "";
    }
    updateRestartButton();
  } finally {
    livePollRunning = false;
  }
}

// Relance l'une apres l'autre les IA choisies (chacune reprend sa conversation).
async function restartSessions(sessions, label) {
  if (!sessions.length) {
    flashStatus(`Aucun onglet à redémarrer (${label}).`);
    return;
  }
  const titles = sessions.map((s) => `• ${s.title}`).join("\n");
  if (!window.confirm(`Redémarrer ${sessions.length} onglet(s) (${label}) en reprenant leur conversation ?\n\n${titles}`)) {
    return;
  }
  for (const session of sessions) {
    if (state.sessions.get(session.id) === session) {
      await restartSession(session.id);
    }
  }
}

function restartAllWithUpdate() {
  const sessions = [...state.sessions.values()].filter((s) => s.updatePending);
  restartSessions(sessions, "mise à jour en attente");
}

function restartAllSameCli() {
  const active = state.sessions.get(state.activeSessionId);
  const profileId = sessionProfileId(active);
  if (!profileId) {
    flashStatus("Aucun onglet IA actif.");
    return;
  }
  const sessions = [...state.sessions.values()].filter(
    (s) => s.type === "terminal" && s.spec?.kind === "profile" && sessionProfileId(s) === profileId
  );
  restartSessions(sessions, `toutes les IA ${getProfileLabel(profileId) || profileId}`);
}

// Fenetres modales : un clic sur le fond ne ferme la fenetre que s'il y a aussi
// commence. Sans ca, une selection de texte relachee hors de la fenetre
// produit un "clic" sur le fond et la ferme.
let pointerDownTarget = null;
document.addEventListener("mousedown", (event) => {
  pointerDownTarget = event.target;
}, true);
document.addEventListener("click", (event) => {
  const backdrop = event.target instanceof Element && event.target.matches(".changelog-modal, .history-backdrop");
  if (backdrop && pointerDownTarget !== event.target) {
    event.stopImmediatePropagation();
  }
}, true);

// --- Fenetre modale generique (meme style que les notes de version) --------
function createModal({ icon, title, sub, dialogClass = "" }) {
  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";
  const dialog = document.createElement("div");
  dialog.className = `changelog-dialog ${dialogClass}`.trim();

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = `<i data-lucide="${icon}"></i><span></span>`;
  header.querySelector("span").textContent = title;
  dialog.appendChild(header);

  if (sub) {
    const subtitle = document.createElement("div");
    subtitle.className = "changelog-sub";
    subtitle.textContent = sub;
    dialog.appendChild(subtitle);
  }

  const body = document.createElement("div");
  body.className = "changelog-body";
  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions";
  dialog.appendChild(actions);

  const onKey = (event) => {
    if (event.key === "Escape") {
      close();
    }
  };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "primary-button";
  closeButton.textContent = "Fermer";
  closeButton.addEventListener("click", close);
  actions.appendChild(closeButton);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  return { overlay, dialog, header, body, actions, close };
}

function formatRelativeDate(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) {
    return "à l'instant";
  }
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `il y a ${hours} h`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `il y a ${days} j`;
  }
  return new Date(time).toLocaleDateString("fr-FR");
}

// --- Changements Git du dossier de l'onglet ----------------------------------
const GIT_POLL_MS = 5000;
let gitRequestToken = 0;

function gitSessionOf(session) {
  return session && session.type === "terminal" && session.cwd ? session : null;
}

async function refreshGitChip() {
  const session = gitSessionOf(state.sessions.get(state.activeSessionId));
  const chip = elements.gitChip;
  const token = ++gitRequestToken;
  if (!session) {
    chip.classList.add("hidden");
    return;
  }
  let status = null;
  try {
    status = await window.launcher.gitStatus(session.cwd);
  } catch {}
  if (token !== gitRequestToken) {
    return;
  }
  if (!status?.isRepo) {
    chip.classList.add("hidden");
    return;
  }
  // Etat de depart : ce qui etait deja modifie a l'ouverture de l'onglet.
  if (!session.gitBaseline) {
    session.gitBaseline = new Set(status.files.map((f) => `${f.code}|${f.path}`));
  }
  session.gitStatus = status;
  const sessionCount = status.files.filter((f) => !session.gitBaseline.has(`${f.code}|${f.path}`)).length;
  chip.classList.remove("hidden");
  chip.innerHTML = '<i data-lucide="git-branch"></i><span class="git-branch"></span><span class="git-count"></span>';
  chip.querySelector(".git-branch").textContent = status.branch || "(détaché)";
  const count = chip.querySelector(".git-count");
  count.textContent = String(status.files.length);
  count.classList.toggle("hidden", status.files.length === 0);
  count.classList.toggle("fresh", sessionCount > 0);
  chip.title = `Branche ${status.branch || "?"}`
    + (status.ahead ? ` · ${status.ahead} commit(s) à pousser` : "")
    + (status.behind ? ` · ${status.behind} en retard` : "")
    + ` · ${status.files.length} fichier(s) modifié(s)`
    + (sessionCount ? `, dont ${sessionCount} pendant cette session` : "")
    + "\nCliquer pour voir les changements";
  createIcons();
}

function renderDiff(container, text) {
  container.innerHTML = "";
  for (const line of String(text).split("\n")) {
    const row = document.createElement("div");
    row.textContent = line || " ";
    if (line.startsWith("+") && !line.startsWith("+++")) {
      row.className = "diff-add";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      row.className = "diff-del";
    } else if (line.startsWith("@@")) {
      row.className = "diff-hunk";
    } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file)/.test(line)) {
      row.className = "diff-meta";
    }
    container.appendChild(row);
  }
}

async function openGitChanges() {
  const session = gitSessionOf(state.sessions.get(state.activeSessionId));
  if (!session) {
    flashStatus("Aucun onglet actif.");
    return;
  }
  const status = await window.launcher.gitStatus(session.cwd).catch(() => null);
  if (!status?.isRepo) {
    flashStatus(status?.error || "Le dossier de cet onglet n'est pas un dépôt Git.");
    return;
  }
  const baseline = session.gitBaseline || new Set();
  const modal = createModal({
    icon: "git-branch",
    title: `Changements Git — ${status.branch || "?"}`,
    sub: `${session.cwd} · ${status.files.length} fichier(s) modifié(s) non commité(s). « session » = modifié depuis l'ouverture de l'onglet.`,
    dialogClass: "git-dialog"
  });
  modal.body.classList.add("git-body");
  const list = document.createElement("div");
  list.className = "git-file-list";
  const viewer = document.createElement("div");
  viewer.className = "git-diff";
  viewer.textContent = status.files.length ? "Sélectionne un fichier." : "Aucun changement : tout est commité.";
  modal.body.append(list, viewer);

  // Fichiers touches pendant la session d'abord.
  const files = [...status.files].sort((a, b) => {
    const fa = baseline.has(`${a.code}|${a.path}`) ? 1 : 0;
    const fb = baseline.has(`${b.code}|${b.path}`) ? 1 : 0;
    return fa - fb || a.path.localeCompare(b.path);
  });
  for (const file of files) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "git-file";
    const badge = document.createElement("span");
    badge.className = `git-file-status s-${file.code === "??" ? "new" : file.label}`;
    badge.textContent = file.label;
    const name = document.createElement("span");
    name.className = "git-file-name";
    name.textContent = file.path;
    name.title = file.path;
    item.append(badge, name);
    if (!baseline.has(`${file.code}|${file.path}`)) {
      const fresh = document.createElement("span");
      fresh.className = "git-file-fresh";
      fresh.textContent = "session";
      item.appendChild(fresh);
    }
    item.addEventListener("click", async () => {
      for (const other of list.querySelectorAll(".git-file.active")) {
        other.classList.remove("active");
      }
      item.classList.add("active");
      viewer.textContent = "Chargement…";
      const diff = await window.launcher.gitDiff(session.cwd, file.path, file.code === "??").catch(() => null);
      renderDiff(viewer, diff?.text || "Diff indisponible.");
    });
    list.appendChild(item);
  }
  list.querySelector(".git-file")?.click();
  createIcons();
}

// --- Explorateur des conversations Claude ------------------------------------
async function resumeClaudeConversation(conversation) {
  const open = [...state.sessions.values()].find((s) => s.conversationId === conversation.id);
  if (open) {
    setActiveSession(open.id);
    return;
  }
  const profile = state.config.profiles.find((p) => p.id === "claude");
  const mode = profile?.modes.find((m) => m.id === profile.defaultModeId) || profile?.modes?.[0];
  if (!profile || !mode) {
    flashStatus("Profil Claude introuvable.");
    return;
  }
  if (!conversation.dirExists) {
    flashStatus(`Dossier introuvable sur ce PC : ${conversation.cwd}`);
    return;
  }
  const title = conversation.title.slice(0, 60);
  const spec = { kind: "profile", title, accent: profile.accent, profileId: profile.id, modeId: mode.id, extraArgs: "", cwd: conversation.cwd };
  const session = await openTerminalSession({
    title,
    accent: profile.accent,
    spec,
    starter: ({ cols, rows }) =>
      window.launcher.startTerminal({
        title,
        command: profile.command,
        modeArgs: mode.args || [],
        preLaunchCommands: mode.preLaunchCommands || [],
        extraArgs: "",
        cwd: conversation.cwd,
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: mode.id,
        modeLabel: mode.label,
        resumeArgs: ["--resume", conversation.id],
        stripArgs: ["--continue", "-c"],
        cols,
        rows
      })
  });
  if (session) {
    session.conversationId = conversation.id;
  }
}

async function openConversations() {
  const modal = createModal({
    icon: "messages-square",
    title: "Conversations Claude",
    sub: "Toutes tes conversations Claude Code, y compris celles lancées hors du launcher. Clique pour la reprendre dans un nouvel onglet.",
    dialogClass: "conversations-dialog"
  });
  const search = document.createElement("input");
  search.type = "text";
  search.className = "conversations-search";
  search.placeholder = "Rechercher (titre, dossier, message)…";
  modal.body.before(search);
  const list = document.createElement("div");
  list.className = "conversations-list";
  list.textContent = "Chargement…";
  modal.body.appendChild(list);
  createIcons();

  let conversations = [];
  try {
    conversations = await window.launcher.listClaudeConversations();
  } catch {}

  const render = () => {
    const query = search.value.trim().toLowerCase();
    const openIds = new Set([...state.sessions.values()].map((s) => s.conversationId).filter(Boolean));
    list.innerHTML = "";
    const shown = conversations.filter((c) => !query
      || `${c.title} ${c.cwd} ${c.firstPrompt} ${c.lastPrompt} ${c.gitBranch}`.toLowerCase().includes(query));
    if (!shown.length) {
      list.textContent = conversations.length ? "Aucune conversation ne correspond." : "Aucune conversation Claude trouvée.";
      return;
    }
    for (const conversation of shown) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "conversation-item";
      item.disabled = !conversation.dirExists;

      const top = document.createElement("div");
      top.className = "conversation-top";
      const title = document.createElement("span");
      title.className = "conversation-title";
      title.textContent = conversation.title;
      const date = document.createElement("span");
      date.className = "conversation-date";
      date.textContent = formatRelativeDate(conversation.updatedAt);
      date.title = new Date(conversation.updatedAt).toLocaleString("fr-FR");
      top.append(title, date);
      if (openIds.has(conversation.id)) {
        const badge = document.createElement("span");
        badge.className = "conversation-open";
        badge.textContent = "ouverte";
        top.insertBefore(badge, date);
      }

      const meta = document.createElement("div");
      meta.className = "conversation-meta";
      meta.textContent = conversation.cwd + (conversation.gitBranch ? ` · ${conversation.gitBranch}` : "")
        + (conversation.dirExists ? "" : " · dossier introuvable sur ce PC");

      const preview = document.createElement("div");
      preview.className = "conversation-preview";
      preview.textContent = conversation.lastPrompt || conversation.firstPrompt;

      item.append(top, meta, preview);
      item.addEventListener("click", () => {
        modal.close();
        resumeClaudeConversation(conversation);
      });
      list.appendChild(item);
    }
  };
  search.addEventListener("input", render);
  render();
  search.focus();
}

// --- Bibliotheque de prompts ---------------------------------------------------
// Colle le texte dans la CLI (collage "bracketed paste" : les retours a la
// ligne ne valident pas le message), puis l'envoie si demande.
function pasteToSession(session, text, submit) {
  if (!session || !text) {
    return;
  }
  // CLI sans collage "bracketed" : on met tout sur une ligne pour qu'un retour
  // a la ligne n'envoie pas un message tronque.
  const bracketed = Boolean(session.terminal?.modes?.bracketedPasteMode);
  window.launcher.writeTerminal(session.id, bracketed ? `\x1b[200~${text}\x1b[201~` : text.replace(/\s*\n\s*/g, " "));
  if (submit) {
    window.setTimeout(() => window.launcher.writeTerminal(session.id, "\r"), 250);
  }
}

// --- Images et fichiers colles dans la CLI ---------------------------------------
// Les CLI (Claude Code, Codex...) reconnaissent un chemin d'image colle et
// l'analysent : on colle donc des chemins, entre guillemets si besoin.
async function pastePathsToSession(session, paths) {
  const text = await window.launcher.quotePaths(paths);
  if (text) {
    pasteWithTrailingSpace(session, text);
    flashStatus(paths.length > 1 ? `${paths.length} fichiers collés` : `Fichier collé : ${paths[0]}`);
  }
}

// L'espace est tape apres le collage : un chemin colle seul est reconnu
// comme image par Claude Code (affiche [Image #1]).
function pasteWithTrailingSpace(session, text) {
  pasteToSession(session, text, false);
  window.launcher.writeTerminal(session.id, " ");
}

// Image du presse-papiers (capture d'ecran...) : enregistree en PNG
// temporaire puis collee sous forme de chemin. Renvoie false sans image.
async function pasteClipboardImage(session) {
  const saved = await window.launcher.saveClipboardImage();
  if (!saved) {
    return false;
  }
  pasteWithTrailingSpace(session, saved.text);
  flashStatus("Image collée : l'IA va l'analyser avec ton message");
  return true;
}

// Ctrl+V dans un terminal : le texte reste gere par xterm ; une image ou des
// fichiers copies (Explorateur) sont interceptes et colles comme chemins.
function handleTerminalPaste(session, event) {
  const data = event.clipboardData;
  if (!data || data.types.includes("text/plain")) {
    return;
  }
  const files = Array.from(data.files || []);
  const paths = files.map((file) => window.launcher.getPathForFile(file)).filter(Boolean);
  const hasImage = Array.from(data.items || []).some((item) => item.type.startsWith("image/"));
  if (!paths.length && !hasImage) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (paths.length) {
    pastePathsToSession(session, paths);
  } else {
    pasteClipboardImage(session);
  }
}

function terminalSessions() {
  return [...state.sessions.values()].filter((s) => s.type === "terminal" && !s.tab.classList.contains("ended"));
}

async function savePrompts(prompts) {
  state.config.prompts = prompts;
  state.config = await window.launcher.saveConfig(state.config);
}

function openPrompts() {
  const modal = createModal({
    icon: "library",
    title: "Bibliothèque de prompts",
    sub: "Insérer colle le texte dans l'onglet actif sans l'envoyer ; Envoyer le valide aussitôt ; « Plusieurs onglets » l'envoie à ceux que tu coches.",
    dialogClass: "prompts-dialog"
  });
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "ghost-button";
  addButton.innerHTML = '<i data-lucide="plus"></i> Nouveau prompt';
  modal.actions.insertBefore(addButton, modal.actions.firstChild);
  modal.actions.classList.add("prompts-actions");

  const render = () => {
    modal.body.innerHTML = "";
    const prompts = state.config.prompts || [];
    if (!prompts.length) {
      modal.body.textContent = "Aucun prompt enregistré. Crée le premier avec « Nouveau prompt ».";
    }
    for (const prompt of prompts) {
      modal.body.appendChild(renderPromptCard(prompt));
    }
    createIcons();
  };

  function button(icon, label, handler, extraClass = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ghost-button prompt-btn ${extraClass}`.trim();
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
    btn.append(label);
    btn.addEventListener("click", handler);
    return btn;
  }

  function renderPromptCard(prompt) {
    const card = document.createElement("div");
    card.className = "prompt-card";
    const title = document.createElement("div");
    title.className = "prompt-title";
    title.textContent = prompt.title;
    const text = document.createElement("div");
    text.className = "prompt-text";
    text.textContent = prompt.text;
    const row = document.createElement("div");
    row.className = "prompt-buttons";
    const active = () => {
      const session = state.sessions.get(state.activeSessionId);
      if (!session || session.type !== "terminal") {
        flashStatus("Aucun onglet terminal actif.");
        return null;
      }
      return session;
    };
    row.append(
      button("text-cursor-input", "Insérer", () => {
        const session = active();
        if (session) {
          modal.close();
          pasteToSession(session, prompt.text, false);
          session.terminal.focus();
        }
      }),
      button("send-horizontal", "Envoyer", () => {
        const session = active();
        if (session) {
          modal.close();
          pasteToSession(session, prompt.text, true);
          session.terminal.focus();
        }
      }),
      button("send", "Plusieurs onglets…", () => renderMultiSend(card, prompt)),
      button("pencil", "Modifier", () => card.replaceWith(renderPromptEditor(prompt))),
      button("trash-2", "Supprimer", async () => {
        if (window.confirm(`Supprimer le prompt « ${prompt.title} » ?`)) {
          await savePrompts((state.config.prompts || []).filter((p) => p.id !== prompt.id));
          render();
        }
      }, "danger")
    );
    card.append(title, text, row);
    return card;
  }

  function renderMultiSend(card, prompt) {
    card.querySelector(".prompt-multi")?.remove();
    const box = document.createElement("div");
    box.className = "prompt-multi";
    const sessions = terminalSessions();
    if (!sessions.length) {
      box.textContent = "Aucun onglet ouvert.";
      card.appendChild(box);
      return;
    }
    for (const session of sessions) {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.value = session.id;
      check.checked = session.id === state.activeSessionId;
      label.append(check, ` ${session.title}`);
      box.appendChild(label);
    }
    const send = document.createElement("button");
    send.type = "button";
    send.className = "primary-button";
    send.textContent = "Envoyer aux onglets cochés";
    send.addEventListener("click", () => {
      const ids = [...box.querySelectorAll("input:checked")].map((c) => c.value);
      for (const id of ids) {
        pasteToSession(state.sessions.get(id), prompt.text, true);
      }
      modal.close();
      flashStatus(`Prompt « ${prompt.title} » envoyé à ${ids.length} onglet(s).`);
    });
    box.appendChild(send);
    card.appendChild(box);
  }

  function renderPromptEditor(prompt) {
    const editor = document.createElement("div");
    editor.className = "prompt-card prompt-editor";
    const title = document.createElement("input");
    title.type = "text";
    title.placeholder = "Titre";
    title.value = prompt?.title || "";
    const text = document.createElement("textarea");
    text.rows = 6;
    text.placeholder = "Texte du prompt";
    text.value = prompt?.text || "";
    const row = document.createElement("div");
    row.className = "prompt-buttons";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-button";
    save.textContent = "Enregistrer";
    save.addEventListener("click", async () => {
      if (!text.value.trim()) {
        text.focus();
        return;
      }
      const entry = {
        id: prompt?.id || `p-${Date.now().toString(36)}`,
        title: title.value.trim() || text.value.trim().slice(0, 40),
        text: text.value.trim()
      };
      const prompts = [...(state.config.prompts || [])];
      const index = prompts.findIndex((p) => p.id === entry.id);
      if (index >= 0) {
        prompts[index] = entry;
      } else {
        prompts.unshift(entry);
      }
      await savePrompts(prompts);
      render();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost-button";
    cancel.textContent = "Annuler";
    cancel.addEventListener("click", render);
    row.append(save, cancel);
    editor.append(title, text, row);
    window.setTimeout(() => (prompt ? text : title).focus(), 0);
    return editor;
  }

  addButton.addEventListener("click", () => {
    modal.body.querySelector(".prompt-editor:not([data-existing])")?.remove();
    modal.body.prepend(renderPromptEditor(null));
  });
  render();
}

// Ajuste la taille des terminaux actuellement visibles puis redonne le focus.
function fitVisible() {
  const ids = state.split ? [state.split.leftId, state.split.rightId] : [state.activeSessionId];
  setTimeout(() => {
    for (const id of ids) {
      const s = state.sessions.get(id);
      if (s) {
        try {
          s.fitAddon.fit();
        } catch {}
      }
    }
    state.sessions.get(state.activeSessionId)?.terminal?.focus();
  }, 30);
}

function updateSplitControls() {
  const inSplit = Boolean(state.split);
  if (elements.splitButton) {
    elements.splitButton.classList.toggle("toggle-on", inSplit);
    elements.splitButton.title = inSplit
      ? "Fermer la vue partagée"
      : "Vue partagée (deux onglets côte à côte)";
  }
  if (elements.mirrorButton) {
    elements.mirrorButton.disabled = !inSplit;
    elements.mirrorButton.classList.toggle("toggle-on", state.mirrorInput && inSplit);
    elements.mirrorButton.title = state.mirrorInput
      ? "Saisie synchronisée : ACTIVE (on tape dans les deux panes)"
      : "Saisie synchronisée (taper dans les deux panes à la fois)";
  }
}

// En miroir, renvoie l'id de l'autre pane du split (pour dupliquer la saisie).
function mirrorPartnerOf(id) {
  if (!state.split) {
    return null;
  }
  if (id === state.split.leftId) {
    return state.split.rightId;
  }
  if (id === state.split.rightId) {
    return state.split.leftId;
  }
  return null;
}

function toggleSplit() {
  if (state.split) {
    state.split = null;
    state.mirrorInput = false;
    layoutPanes();
    flashStatus("Vue partagée fermée.");
    return;
  }
  if (!state.activeSessionId || state.sessions.size < 2) {
    flashStatus("Ouvre au moins deux onglets pour la vue partagée.");
    return;
  }
  const partner = [...state.sessions.keys()].find((id) => id !== state.activeSessionId);
  state.split = { leftId: state.activeSessionId, rightId: partner };
  layoutPanes();
  flashStatus("Vue partagée : clique un onglet pour changer le pane sélectionné · bouton 🔗 pour synchroniser la saisie.");
}

function toggleMirror() {
  if (!state.split) {
    flashStatus("Active d'abord la vue partagée pour synchroniser la saisie.");
    return;
  }
  state.mirrorInput = !state.mirrorInput;
  updateSplitControls();
  flashStatus(
    state.mirrorInput
      ? "Saisie synchronisée activée : tu prompts les deux IA en même temps."
      : "Saisie synchronisée désactivée."
  );
}

function createTab(session) {
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.type = "button";
  tab.innerHTML = `
    <span class="tab-dot"></span>
    <span class="tab-title"></span>
    <span class="tab-close" title="Fermer">x</span>
  `;
  const titleSpan = tab.querySelector(".tab-title");
  titleSpan.textContent = session.title;
  tab.style.setProperty("--tab-accent", session.accent || "#10b981");

  function startInlineEdit() {
    setActiveSession(session.id);
    titleSpan.contentEditable = "true";
    titleSpan.classList.add("editing");
    titleSpan.focus();
    const range = document.createRange();
    range.selectNodeContents(titleSpan);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }

  function commitInlineEdit() {
    const newTitle = titleSpan.textContent.trim() || session.title;
    titleSpan.contentEditable = "false";
    titleSpan.classList.remove("editing");
    titleSpan.textContent = newTitle;
    if (newTitle !== session.title) {
      session.title = newTitle;
      if (state.activeSessionId === session.id) {
        elements.activeTitleInput.value = newTitle;
        elements.sessionMeta.textContent = `${session.command} | ${session.cwd}`;
      }
      persistSessionTitle(session);
    }
  }

  titleSpan.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitInlineEdit();
      titleSpan.blur();
    } else if (event.key === "Escape") {
      titleSpan.textContent = session.title;
      titleSpan.contentEditable = "false";
      titleSpan.classList.remove("editing");
    }
    event.stopPropagation();
  });

  titleSpan.addEventListener("blur", () => {
    if (titleSpan.contentEditable === "true") {
      commitInlineEdit();
    }
  });

  titleSpan.addEventListener("click", (event) => {
    if (titleSpan.contentEditable === "true") {
      event.stopPropagation();
    }
  });

  tab.addEventListener("click", (event) => {
    if (event.target.classList.contains("tab-close")) {
      closeSession(session.id);
      return;
    }
    if (titleSpan.contentEditable === "true") {
      return;
    }
    setActiveSession(session.id);
  });

  tab.addEventListener("dblclick", (event) => {
    if (!event.target.classList.contains("tab-close")) {
      event.preventDefault();
      startInlineEdit();
    }
  });

  elements.tabs.appendChild(tab);
  return tab;
}

async function persistSessionTitle(session) {
  if (!session) {
    return;
  }

  try {
    await window.launcher.renameTerminal(session.id, session.title);
  } catch (error) {
    elements.sessionMeta.textContent = error.message || String(error);
  }
}

function renameActiveSession(title, persist = true) {
  const session = state.sessions.get(state.activeSessionId);
  if (!session) {
    return;
  }

  session.title = title || "Session";
  session.tab.querySelector(".tab-title").textContent = session.title;

  if (persist) {
    window.clearTimeout(session.renameTimer);
    session.renameTimer = window.setTimeout(() => persistSessionTitle(session), 250);
  }
}

function promptRenameSession(id) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }

  const title = window.prompt("Nouveau titre de l'onglet", session.title);
  if (!title) {
    return;
  }

  setActiveSession(id);
  elements.activeTitleInput.value = title;
  renameActiveSession(title, false);
  persistSessionTitle(session);
}

async function closeSession(id) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }

  if (session.spec) {
    lastClosedSpec = { ...session.spec, title: session.title };
  }

  // Si l'onglet ferme faisait partie de la vue partagee, on referme le split
  // et on garde l'autre pane comme onglet courant.
  let survivor = null;
  if (state.split && (id === state.split.leftId || id === state.split.rightId)) {
    survivor = id === state.split.leftId ? state.split.rightId : state.split.leftId;
    state.split = null;
    state.mirrorInput = false;
  }

  if (session.type === "terminal") {
    await window.launcher.killTerminal(id);
    session.terminal.dispose();
  }
  session.tab.remove();
  session.container.remove();
  state.sessions.delete(id);

  const next = (survivor && state.sessions.has(survivor) ? survivor : state.sessions.keys().next().value) || null;
  setActiveSession(next);
}

function createTerminalContainer(id) {
  const container = document.createElement("div");
  container.className = "terminal-pane";
  container.dataset.sessionId = id;
  // Le terminal xterm est monte dans un sous-noeud dedie : on peut ainsi
  // afficher un panneau d'historique au-dessus sans qu'il soit efface par la
  // CLI (lors d'un relais).
  const mount = document.createElement("div");
  mount.className = "terminal-mount";
  container.appendChild(mount);
  elements.terminalHost.appendChild(container);
  return container;
}

function registerSession(session) {
  session.tab = createTab(session);
  state.sessions.set(session.id, session);
  setActiveSession(session.id);
}

async function openTerminalSession({ title, accent, starter, replayText, spec }) {
  const { terminal, fitAddon, searchAddon } = createTerminal();
  let startResult;

  try {
    startResult = await starter({ cols: 120, rows: 32 });
  } catch (error) {
    elements.sessionMeta.textContent = error.message || String(error);
    terminal.dispose();
    return;
  }

  const session = {
    id: startResult.id,
    type: "terminal",
    title,
    command: startResult.command,
    cwd: startResult.cwd,
    profileId: startResult.profileId || "",
    terminal,
    fitAddon,
    searchAddon,
    accent,
    spec: spec || null,
    tab: null,
    container: createTerminalContainer(startResult.id)
  };

  terminal.open(session.container.querySelector(".terminal-mount"));
  fitAddon.fit();

  // Rejoue l'historique sauvegarde avant que la session ne soit enregistree,
  // donc avant que la sortie live ne commence a s'afficher.
  if (replayText) {
    terminal.write(replayText);
    terminal.write("\r\n\x1b[2m──────── reprise de session ────────\x1b[0m\r\n");
  }
  terminal.onData((data) => {
    window.launcher.writeTerminal(session.id, data);
    // Saisie synchronisee : on duplique vers l'autre pane du split. onData ne se
    // declenche que pour la frappe utilisateur (pas la sortie programme), donc
    // ecrire dans l'autre pty ne provoque aucune boucle.
    if (state.mirrorInput) {
      const partner = mirrorPartnerOf(session.id);
      if (partner) {
        window.launcher.writeTerminal(partner, data);
      }
    }
  });
  terminal.onResize(({ cols: nextCols, rows: nextRows }) => {
    window.launcher.resizeTerminal(session.id, nextCols, nextRows);
  });

  // En vue partagee, cliquer dans un terminal lui donne le focus (et donc le
  // statut de pane actif, sans changer la disposition gauche/droite).
  session.container.addEventListener("focusin", () => {
    if (state.split && state.activeSessionId !== session.id) {
      setActiveSession(session.id);
    }
  });

  session.container.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.launcher.showTerminalContextMenu(session.id, terminal.getSelection());
  });

  // Phase de capture : passe avant le collage texte de xterm.
  session.container.addEventListener("paste", (event) => handleTerminalPaste(session, event), true);

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }
    // Raccourci de l'application (gere par le document) : rien n'est envoye a
    // la CLI (ex. Ctrl+Maj+Espace produirait un caractere nul).
    if (chordToActionId(eventToChord(event))) {
      return false;
    }
    if (event.ctrlKey && event.shiftKey && event.key === "C") {
      const selected = terminal.getSelection();
      if (selected) {
        navigator.clipboard.writeText(selected);
      }
      return false;
    }
    if (event.ctrlKey && event.shiftKey && event.key === "V") {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          window.launcher.writeTerminal(session.id, text);
        } else {
          pasteClipboardImage(session);
        }
      });
      return false;
    }
    return true;
  });

  registerSession(session);
  return session;
}

async function restoreSession(saved) {
  const profile = state.config.profiles.find((p) => p.id === saved.profileId);
  const mode = profile?.modes.find((m) => m.id === saved.modeId);
  const resume = profile?.resume;
  const canResume = Boolean(resume && Array.isArray(resume.args) && resume.args.length > 0);

  // Le dossier d'origine peut ne pas exister sur ce PC (historique synchronisé
  // depuis une autre machine). On bascule alors sur le dossier sélectionné, ou
  // on en demande un, au lieu d'échouer.
  let cwd = saved.cwd || "";
  let cwdChanged = false;
  if (cwd && !(await window.launcher.dirExists(cwd))) {
    let fallback = "";
    if (state.selectedFolder && (await window.launcher.dirExists(state.selectedFolder))) {
      fallback = state.selectedFolder;
    } else {
      flashStatus("Dossier d'origine introuvable sur ce PC — choisis un dossier pour reprendre.");
      fallback = await window.launcher.chooseFolder();
    }
    if (!fallback) {
      flashStatus("Reprise annulée (aucun dossier sélectionné).");
      return;
    }
    cwd = fallback;
    cwdChanged = true;
  }

  // Une CLI stocke sa conversation PAR dossier : si on a dû changer de dossier,
  // elle ne peut pas reprendre la session d'origine → on rejoue le transcript
  // sauvegardé et on démarre une CLI fraîche dans le dossier choisi.
  const useResume = canResume && !cwdChanged;

  // Si la CLI reprend elle-meme la conversation, inutile de rejouer (doublon).
  // Sinon (ou dossier changé) on rejoue le texte sauvegarde pour voir le fil.
  let replayText = "";
  if (!useResume && saved.id) {
    try {
      replayText = await window.launcher.readScrollback(saved.id);
    } catch {
      replayText = "";
    }
  }

  // Spec de relance (dupliquer / relancer / rouvrir) si le profil existe.
  const spec = profile && mode
    ? {
        kind: "profile",
        title: saved.title,
        accent: profile.accent,
        profileId: saved.profileId,
        modeId: saved.modeId,
        extraArgs: saved.extraArgs || "",
        cwd
      }
    : null;

  await openTerminalSession({
    title: saved.title,
    accent: profile?.accent || "#10b981",
    replayText,
    spec,
    starter: ({ cols, rows }) => {
      if (profile && mode) {
        return window.launcher.startTerminal({
          title: saved.title,
          command: profile.command,
          modeArgs: mode.args || [],
          preLaunchCommands: mode.preLaunchCommands || [],
          extraArgs: saved.extraArgs || "",
          resumeArgs: useResume ? (resume?.args || []) : [],
          resumeReplace: useResume ? Boolean(resume?.replace) : false,
          resumeId: saved.id,
          cwd,
          profileId: saved.profileId,
          profileLabel: saved.profileLabel,
          modeId: saved.modeId,
          modeLabel: saved.modeLabel,
          cols,
          rows
        });
      }
      // Repli : profil introuvable (ex. profil personnalise supprime) -> on
      // relance la ligne de commande brute telle qu'elle avait ete lancee.
      return window.launcher.runCommand({
        title: saved.title,
        commandLine: saved.commandLine,
        cwd,
        resumeId: saved.id,
        profileId: saved.profileId,
        profileLabel: saved.profileLabel,
        modeId: saved.modeId,
        modeLabel: saved.modeLabel,
        cols,
        rows
      });
    }
  });
}

function renderRestoreSection(savedSessions) {
  if (!savedSessions || !savedSessions.length) {
    return;
  }

  const section = document.createElement("div");
  section.className = "restore-section";

  const title = document.createElement("div");
  title.className = "restore-section-title";
  const n = savedSessions.length;
  title.textContent = `${n} session${n > 1 ? "s" : ""} précédente${n > 1 ? "s" : ""}`;
  section.appendChild(title);

  for (const saved of savedSessions) {
    const card = document.createElement("div");
    card.className = "restore-card";

    const dot = document.createElement("span");
    dot.className = "restore-dot";
    const profile = state.config.profiles.find((p) => p.id === saved.profileId);
    dot.style.background = profile?.accent || "#10b981";

    const info = document.createElement("div");
    info.className = "restore-card-info";

    const titleEl = document.createElement("div");
    titleEl.className = "restore-card-title";
    titleEl.textContent = saved.title;

    const meta = document.createElement("div");
    meta.className = "restore-card-meta";
    meta.textContent = saved.cwd;

    info.append(titleEl, meta);

    const btn = document.createElement("button");
    btn.className = "ghost-button restore-card-btn";
    btn.type = "button";
    btn.textContent = "Restaurer";
    btn.addEventListener("click", async () => {
      card.remove();
      if (!section.querySelector(".restore-card")) {
        section.remove();
      }
      await restoreSession(saved);
    });

    card.append(dot, info, btn);
    section.appendChild(card);
  }

  const actions = document.createElement("div");
  actions.className = "restore-actions";

  const restoreAll = document.createElement("button");
  restoreAll.className = "primary-button";
  restoreAll.type = "button";
  restoreAll.textContent = `Tout restaurer (${n})`;
  restoreAll.addEventListener("click", async () => {
    section.remove();
    for (const saved of savedSessions) {
      await restoreSession(saved);
    }
  });

  const dismiss = document.createElement("button");
  dismiss.className = "ghost-button";
  dismiss.type = "button";
  dismiss.textContent = "Ignorer";
  dismiss.addEventListener("click", () => section.remove());

  actions.append(restoreAll, dismiss);
  section.appendChild(actions);

  elements.emptyState.appendChild(section);
}

// Lance une session a partir d'un profil/mode/dossier. Centralise pour etre
// reutilise par le bouton "Lancer" comme par les raccourcis (dupliquer,
// relancer, rouvrir la derniere session fermee).
// Envoie un texte comme PREMIER message dans le terminal d'une session, une
// fois la CLI prete (utilise pour les CLI qui n'ont pas de canal "instructions"
// fiable, ex. Codex : la persona/contexte est tape comme message d'ouverture).
function sendFirstMessage(session, text) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return;
  }
  const started = Date.now();
  const attempt = () => {
    if (!state.sessions.has(session.id)) {
      return; // session fermee entre-temps
    }
    // On attend que la CLI ait affiche quelque chose (prete a recevoir), avec
    // un repli au bout de 6 s.
    if (session.hasOutput || Date.now() - started > 6000) {
      window.setTimeout(() => {
        if (state.sessions.has(session.id)) {
          window.launcher.writeTerminal(session.id, `${oneLine}\r`);
        }
      }, 1500);
    } else {
      window.setTimeout(attempt, 300);
    }
  };
  attempt();
}

function framePersonaMessage(personaPrompt) {
  return `Consigne de session à respecter STRICTEMENT pour toutes tes réponses, comme si elle faisait partie de ta configuration : ${personaPrompt} — Réponds simplement « Compris. » puis attends ma demande.`;
}

async function launchFromProfile({ profileId, modeId, extraArgs, cwd, title, accent, personaId }) {
  const profile = state.config.profiles.find((p) => p.id === profileId);
  const mode = profile?.modes.find((m) => m.id === modeId);
  if (!profile || !mode) {
    flashStatus("Profil indisponible pour cette action.");
    return;
  }

  const persona = personaId ? getPersonaById(personaId) : null;
  const finalTitle = title || profile.label;
  const spec = {
    kind: "profile",
    title: finalTitle,
    accent: accent || profile.accent,
    profileId,
    modeId,
    extraArgs: extraArgs || "",
    cwd,
    personaId: persona ? personaId : ""
  };

  const session = await openTerminalSession({
    title: finalTitle,
    accent: spec.accent,
    spec,
    starter: ({ cols, rows }) =>
      window.launcher.startTerminal({
        title: finalTitle,
        command: profile.command,
        modeArgs: mode.args || [],
        preLaunchCommands: mode.preLaunchCommands || [],
        extraArgs: extraArgs || "",
        cwd,
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: mode.id,
        modeLabel: mode.label,
        personaPrompt: persona?.prompt || "",
        personaInjection: persona ? profile.personaInjection || null : null,
        cols,
        rows
      })
  });

  // CLI sans canal d'instructions fiable (ex. Codex) : on envoie la persona
  // comme premier message une fois la CLI prete.
  if (session && persona && profile.personaInjection?.kind === "first-message") {
    sendFirstMessage(session, framePersonaMessage(persona.prompt));
  }

  return session;
}

async function launchSession() {
  const profile = getSelectedProfile();
  const mode = getSelectedMode();

  if (!state.selectedFolder) {
    elements.sessionMeta.textContent = "Choisis d'abord un dossier.";
    return;
  }

  if (!profile || !mode) {
    elements.sessionMeta.textContent = "Profil CLI incomplet.";
    return;
  }

  const persona = getSelectedPersona();
  window.localStorage.setItem("lastPersonaId", persona?.id || "");

  const title = elements.tabTitleInput.value.trim() || profile.label;
  await launchFromProfile({
    profileId: profile.id,
    modeId: mode.id,
    extraArgs: elements.extraArgsInput.value,
    cwd: state.selectedFolder,
    title,
    accent: profile.accent,
    personaId: persona?.id || ""
  });
}

// --- Actions onglets (utilisees par les raccourcis clavier) ----------------
function orderedSessionIds() {
  return [...state.sessions.keys()];
}

function cycleTab(direction) {
  const ids = orderedSessionIds();
  if (ids.length <= 1) {
    return;
  }
  const index = ids.indexOf(state.activeSessionId);
  const next = ids[(index + direction + ids.length) % ids.length];
  setActiveSession(next);
}

function gotoTab(position) {
  const id = orderedSessionIds()[position - 1];
  if (id) {
    setActiveSession(id);
  }
}

function focusRenameActive() {
  if (!state.activeSessionId) {
    return;
  }
  elements.activeTitleInput.focus();
  elements.activeTitleInput.select();
}

function duplicateSession(id) {
  const session = state.sessions.get(id);
  if (!session?.spec || session.spec.kind !== "profile") {
    flashStatus("Duplication indisponible pour cet onglet.");
    return;
  }
  launchFromProfile({ ...session.spec, title: `${session.title} (copie)` });
}

async function relaunchSession(id) {
  const session = state.sessions.get(id);
  if (!session?.spec || session.spec.kind !== "profile") {
    flashStatus("Relance indisponible pour cet onglet.");
    return;
  }
  const spec = session.spec;
  const title = session.title;
  await closeSession(id);
  await launchFromProfile({ ...spec, title });
}

// Derniere session fermee, pour la rouvrir au clavier.
let lastClosedSpec = null;
function reopenLastClosed() {
  if (!lastClosedSpec) {
    flashStatus("Aucune session récente à rouvrir.");
    return;
  }
  if (lastClosedSpec.kind === "profile") {
    launchFromProfile(lastClosedSpec);
  } else {
    flashStatus("Réouverture indisponible pour cette session.");
  }
}

// --- Relais : passer la main à une autre IA dans le MÊME onglet ------------
function getProfileLabel(profileId) {
  return state.config.profiles.find((p) => p.id === profileId)?.label || "";
}

// Remplit le selecteur de relais (placeholder + toutes les CLI).
function renderRelayOptions() {
  if (!elements.relaySelect) {
    return;
  }
  elements.relaySelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Relais →";
  elements.relaySelect.appendChild(placeholder);
  for (const profile of sortProfiles(state.config.profiles)) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    elements.relaySelect.appendChild(option);
  }
  elements.relaySelect.value = "";
}

// Construit le contexte injecte silencieusement a la nouvelle IA pour qu'elle
// poursuive la conversation comme si elle y avait toujours ete.
const HANDOFF_MAX_CHARS = 60000;
function buildHandoffPrompt(conversationText, fromName, personaText) {
  let convo = String(conversationText || "").trim();
  if (convo.length > HANDOFF_MAX_CHARS) {
    convo = `[…début de la conversation tronqué…]\n${convo.slice(-HANDOFF_MAX_CHARS)}`;
  }
  const preamble = [
    "Tu poursuis une conversation de développement déjà en cours : l'assistant précédent te passe la main.",
    "Continue naturellement, comme si tu y avais participé depuis le début. Ne mentionne PAS ce changement d'assistant et n'en parle pas à l'utilisateur.",
    "Le dossier de travail et les fichiers déjà modifiés sont intacts ; appuie-toi dessus.",
    "",
    "=== Conversation jusqu'ici ===",
    convo,
    "=== Fin de la conversation, à toi de continuer ==="
  ].join("\n");
  return personaText ? `${personaText}\n\n${preamble}` : preamble;
}

// Affiche/actualise le panneau d'historique (hors terminal) d'une session.
function showRelayHistory(session) {
  const container = session.container;
  let panel = container.querySelector(".relay-history");
  if (!panel) {
    panel = document.createElement("div");
    // Replie par defaut : le terminal affiche uniquement la nouvelle IA. Le
    // fil complet reste accessible ici (depliable) et dans l'Historique global.
    panel.className = "relay-history collapsed";

    const head = document.createElement("div");
    head.className = "relay-history-head";
    const title = document.createElement("span");
    title.className = "relay-history-title";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "relay-history-toggle";
    toggle.textContent = "Afficher ▸";
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "Afficher ▸" : "Masquer ▾";
      const active = state.sessions.get(state.activeSessionId);
      if (active) {
        active.fitAddon.fit();
        window.launcher.resizeTerminal(active.id, active.terminal.cols, active.terminal.rows);
      }
    });
    head.append(title, toggle);

    const body = document.createElement("pre");
    body.className = "relay-history-body";

    panel.append(head, body);
    container.insertBefore(panel, container.firstChild);
  }

  panel.querySelector(".relay-history-title").textContent = `Historique de la conversation — ${session.relayChain}`;
  const body = panel.querySelector(".relay-history-body");
  body.textContent = session.relayHistory;
  body.scrollTop = body.scrollHeight;

  // Le terminal a perdu de la hauteur : on reajuste apres le rendu.
  setTimeout(() => {
    session.fitAddon.fit();
    window.launcher.resizeTerminal(session.id, session.terminal.cols, session.terminal.rows);
  }, 30);
}

async function relaySession(id, profileId) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }
  const profile = state.config.profiles.find((p) => p.id === profileId);
  const mode = profile?.modes.find((m) => m.id === profile.defaultModeId) || profile?.modes?.[0];
  if (!profile || !mode) {
    flashStatus("CLI cible indisponible pour le relais.");
    return;
  }

  const fromName = getProfileLabel(session.spec?.profileId) || "l'assistant précédent";
  flashStatus(`Relais vers ${profile.label}…`);

  // 1. Capture de la conversation en cours (transcription nettoyee).
  let raw = "";
  try {
    raw = await window.launcher.readScrollback(session.id);
  } catch {}
  const segment = stripAnsi(raw).trim();
  // On accumule l'historique a travers les relais successifs (chaque CLI a sa
  // propre transcription) pour ne jamais perdre le fil complet.
  const fullHistory = session.relayHistory
    ? `${session.relayHistory}\n\n──── ${fromName} → ${profile.label} ────\n\n${segment}`
    : segment;
  session.relayHistory = fullHistory;
  session.relayChain = session.relayChain ? `${session.relayChain} → ${profile.label}` : `${fromName} → ${profile.label}`;
  const personaText = session.spec?.personaId ? getPersonaById(session.spec.personaId)?.prompt || "" : "";
  const handoff = buildHandoffPrompt(fullHistory, fromName, personaText);

  // 2. Historique conserve dans un panneau HTML AU-DESSUS du terminal : la CLI
  //    plein ecran qui prend le relais efface le terminal, mais pas ce panneau.
  showRelayHistory(session);

  // 3. On coupe le message de fin de process pour ce relais.
  session.relaying = true;

  // 4. On arrete l'IA en cours.
  try {
    await window.launcher.killTerminal(session.id);
  } catch {}

  // 5. On relance la nouvelle IA dans le MÊME dossier, contexte injecte en
  //    silencieux (system prompt / fichier de contexte selon la CLI).
  let startResult;
  try {
    startResult = await window.launcher.startTerminal({
      title: session.title,
      command: profile.command,
      modeArgs: mode.args || [],
      preLaunchCommands: mode.preLaunchCommands || [],
      extraArgs: "",
      cwd: session.cwd,
      profileId: profile.id,
      profileLabel: profile.label,
      modeId: mode.id,
      modeLabel: mode.label,
      personaPrompt: handoff,
      personaInjection: profile.personaInjection || null,
      cols: session.terminal.cols,
      rows: session.terminal.rows
    });
  } catch (error) {
    session.relaying = false;
    session.terminal.writeln(`\r\n[relais échoué: ${error.message || error}]`);
    session.tab.classList.add("ended");
    return;
  }

  // 6. On rebranche le MÊME onglet/terminal sur le nouveau process (nouvel id).
  // Contexte gardé pour le réinjecter si cette IA est redémarrée plus tard.
  session.handoffPrompt = handoff;
  rebindSession(session, id, startResult, profile, {
    kind: "profile",
    title: session.title,
    accent: profile.accent,
    profileId: profile.id,
    modeId: mode.id,
    extraArgs: "",
    cwd: startResult.cwd,
    personaId: session.spec?.personaId || ""
  });

  // CLI sans canal d'instructions fiable (ex. Codex) : le contexte de relais
  // est envoye comme premier message une fois la nouvelle CLI prete.
  if (profile.personaInjection?.kind === "first-message") {
    session.hasOutput = false;
    sendFirstMessage(session, handoff);
  }
}

// Rebranche un onglet existant (meme terminal xterm) sur un nouveau process.
// Les handlers d'entree/sortie lisent session.id en direct : il suffit de
// re-cler la session dans la Map.
function rebindSession(session, oldId, startResult, profile, spec) {
  state.sessions.delete(oldId);
  session.id = startResult.id;
  session.command = startResult.command;
  session.cwd = startResult.cwd;
  session.profileId = startResult.profileId || profile.id;
  session.accent = profile.accent;
  session.spec = spec;
  session.container.dataset.sessionId = session.id;
  state.sessions.set(session.id, session);
  session.relaying = false;
  // Nouveau process : etat et version seront relus au prochain sondage.
  session.aiState = null;
  session.attention = false;
  session.lastOutputAt = 0;
  applyUpdateState(session, null);
  session.context = null;
  session.tab.classList.remove("ended", "ai-busy", "ai-waiting", "ai-attention");
  session.tab.style.setProperty("--tab-accent", profile.accent);
  if (state.split) {
    if (state.split.leftId === oldId) {
      state.split.leftId = session.id;
    }
    if (state.split.rightId === oldId) {
      state.split.rightId = session.id;
    }
  }
  // Un onglet en arriere-plan (redemarrage groupe) reste en arriere-plan.
  if (state.activeSessionId === oldId) {
    setActiveSession(session.id);
  } else {
    layoutPanes();
  }
}

// --- Redemarrage de l'IA d'un onglet (ex. apres une mise a jour de la CLI) --
// La CLI est relancee dans le MEME onglet et reprend sa conversation :
// 1. par son identifiant exact quand on le connait (Claude, Codex) ;
// 2. sinon par la reprise generique du profil (derniere conversation du dossier) ;
// 3. sinon (CLI sans reprise) en lui reinjectant la conversation affichee.
function conversationResume(profileId, conversationId) {
  if (profileId === "claude") {
    return { resumeArgs: ["--resume", conversationId], resumeReplace: false, stripArgs: ["--continue", "-c"] };
  }
  if (profileId === "codex") {
    return { resumeArgs: ["resume", conversationId], resumeReplace: true };
  }
  return null;
}

function buildRestartPrompt(conversationText, personaText) {
  let convo = String(conversationText || "").trim();
  if (convo.length > HANDOFF_MAX_CHARS) {
    convo = `[…début de la conversation tronqué…]\n${convo.slice(-HANDOFF_MAX_CHARS)}`;
  }
  const preamble = [
    "Tu viens d'être redémarré (mise à jour de l'outil) au milieu d'une conversation de développement.",
    "Continue naturellement là où elle s'est arrêtée, sans commenter ce redémarrage.",
    "Le dossier de travail et les fichiers déjà modifiés sont intacts ; appuie-toi dessus.",
    "",
    "=== Conversation jusqu'ici ===",
    convo,
    "=== Fin de la conversation, à toi de continuer ==="
  ].join("\n");
  return personaText ? `${personaText}\n\n${preamble}` : preamble;
}

async function restartSession(id) {
  const session = state.sessions.get(id);
  if (!session || session.type !== "terminal" || session.spec?.kind !== "profile") {
    flashStatus("Redémarrage indisponible pour cet onglet.");
    return;
  }
  if (session.restarting) {
    return;
  }
  const spec = session.spec;
  const profile = state.config.profiles.find((p) => p.id === spec.profileId);
  const mode = profile?.modes.find((m) => m.id === spec.modeId)
    || profile?.modes.find((m) => m.id === profile.defaultModeId)
    || profile?.modes?.[0];
  if (!profile || !mode) {
    flashStatus("Profil introuvable : redémarrage impossible.");
    return;
  }

  session.restarting = true;
  try {
    let info = null;
    try {
      info = await window.launcher.getConversationInfo(session.id);
    } catch {}
    if (info?.busy && !window.confirm(`${profile.label} est en train de travailler : le redémarrer maintenant interrompt la tâche en cours (la conversation est conservée).\n\nRedémarrer quand même ?`)) {
      return;
    }

    const exact = info?.conversationId ? conversationResume(profile.id, info.conversationId) : null;
    const generic = Array.isArray(profile.resume?.args) && profile.resume.args.length
      ? { resumeArgs: profile.resume.args, resumeReplace: Boolean(profile.resume.replace) }
      : null;
    const plan = exact || generic;

    // Les CLI ne gardent pas les consignes systeme d'une session : on remet la
    // persona (ou le contexte d'un relais). Un premier message envoye au depart
    // fait deja partie de la conversation reprise : on ne le renvoie pas.
    const personaText = spec.personaId ? getPersonaById(spec.personaId)?.prompt || "" : "";
    let contextPrompt = session.handoffPrompt || personaText;
    if (!plan) {
      let raw = "";
      try {
        raw = await window.launcher.readScrollback(session.id);
      } catch {}
      const segment = stripAnsi(raw).trim();
      const history = session.relayHistory ? `${session.relayHistory}\n\n${segment}` : segment;
      contextPrompt = buildRestartPrompt(history, personaText);
      session.handoffPrompt = contextPrompt;
    }
    const firstMessage = profile.personaInjection?.kind === "first-message";
    const injectNow = Boolean(contextPrompt) && !(plan && firstMessage);

    flashStatus(`Redémarrage de ${profile.label}…`);
    session.relaying = true;
    try {
      await window.launcher.killTerminal(session.id);
    } catch {}
    session.terminal.write(`\r\n\x1b[2m──────── redémarrage de ${profile.label} ────────\x1b[0m\r\n`);

    const oldId = session.id;
    let startResult;
    try {
      startResult = await window.launcher.startTerminal({
        title: session.title,
        command: profile.command,
        modeArgs: mode.args || [],
        preLaunchCommands: mode.preLaunchCommands || [],
        extraArgs: spec.extraArgs || "",
        cwd: session.cwd,
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: mode.id,
        modeLabel: mode.label,
        resumeArgs: plan?.resumeArgs || [],
        resumeReplace: Boolean(plan?.resumeReplace),
        stripArgs: plan?.stripArgs || [],
        personaPrompt: injectNow ? contextPrompt : "",
        personaInjection: injectNow ? profile.personaInjection || null : null,
        cols: session.terminal.cols,
        rows: session.terminal.rows
      });
    } catch (error) {
      session.relaying = false;
      session.terminal.writeln(`\r\n[redémarrage échoué: ${error.message || error}]`);
      session.tab.classList.add("ended");
      return;
    }

    rebindSession(session, oldId, startResult, profile, { ...spec, modeId: mode.id, cwd: startResult.cwd });

    if (!plan && firstMessage && contextPrompt) {
      session.hasOutput = false;
      sendFirstMessage(session, contextPrompt);
    }
    flashStatus(exact
      ? `${profile.label} redémarré : conversation reprise.`
      : plan
        ? `${profile.label} redémarré : reprise de la dernière conversation du dossier.`
        : `${profile.label} redémarré : conversation réinjectée comme contexte.`);
  } finally {
    session.restarting = false;
  }
}

async function installSelectedProfile() {
  const profile = getSelectedProfile();
  if (!profile?.installCommand) {
    elements.sessionMeta.textContent = "Commande d'installation manquante.";
    return;
  }

  const title = `Installer ${profile.label}`;
  await openTerminalSession({
    title,
    accent: profile.accent,
    starter: ({ cols, rows }) =>
      window.launcher.runCommand({
        title,
        commandLine: profile.installCommand,
        cwd: state.selectedFolder || state.app.homePath,
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: "install",
        modeLabel: "Installation",
        cols,
        rows
      })
  });
}

async function handleDrop(event) {
  event.preventDefault();
  elements.terminalHost.classList.remove("dragging");

  const files = Array.from(event.dataTransfer?.files || []);
  const active = state.sessions.get(state.activeSessionId);
  if (!active || files.length === 0) {
    return;
  }

  // Electron 32+ : plus de File.path, le chemin passe par le preload.
  const paths = files.map((file) => window.launcher.getPathForFile(file)).filter(Boolean);
  if (paths.length) {
    await pastePathsToSession(active, paths);
  }
}

async function saveProfileEdits() {
  const profile = getSelectedProfile();
  const mode = getSelectedMode();
  if (!profile || !mode) {
    return;
  }

  profile.command = elements.commandInput.value.trim();
  profile.installCommand = elements.installCommandInput.value.trim();
  profile.docsUrl = elements.docsUrlInput.value.trim();
  mode.args = splitArgs(elements.modeArgsInput.value);
  state.config = await window.launcher.saveConfig(state.config);
  renderProfiles(profile.id);
  refreshAuthStatus();
}

async function toggleFavorite() {
  const profile = getSelectedProfile();
  if (!profile) {
    return;
  }

  profile.favorite = !profile.favorite;
  state.config = await window.launcher.saveConfig(state.config);
  renderProfiles(profile.id);
  renderAuthStatusList();
}

async function addCustomProfile() {
  const label = window.prompt("Nom du CLI");
  if (!label) {
    return;
  }

  const command = window.prompt("Commande a lancer", label.toLowerCase().replace(/\s+/g, "-"));
  if (!command) {
    return;
  }

  const id = `custom-${Date.now()}`;
  state.config.profiles.push({
    id,
    label,
    command,
    accent: "#94a3b8",
    favorite: true,
    custom: true,
    docsUrl: "",
    installCommand: "",
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
        args: []
      }
    ]
  });

  state.config = await window.launcher.saveConfig(state.config);
  renderProfiles(id);
  refreshAuthStatus();
}

async function deleteCustomProfile() {
  const profile = getSelectedProfile();
  if (!profile?.custom) {
    elements.sessionMeta.textContent = "Seuls les profils ajoutes peuvent etre supprimes.";
    return;
  }

  state.config.profiles = state.config.profiles.filter((item) => item.id !== profile.id);
  state.config = await window.launcher.saveConfig(state.config);
  renderProfiles();
  refreshAuthStatus();
}

// --- Recherche dans le terminal (addon-search) -----------------------------
let searchBar = null;

function ensureSearchBar() {
  if (searchBar) {
    return searchBar;
  }
  const bar = document.createElement("div");
  bar.className = "term-search hidden";
  bar.innerHTML = `
    <input type="text" class="term-search-input" placeholder="Rechercher dans le terminal…" />
    <button class="term-search-btn" data-dir="prev" type="button" title="Précédent (Maj+Entrée)">↑</button>
    <button class="term-search-btn" data-dir="next" type="button" title="Suivant (Entrée)">↓</button>
    <button class="term-search-btn" data-close type="button" title="Fermer (Échap)">×</button>
  `;
  document.body.appendChild(bar);

  const input = bar.querySelector(".term-search-input");
  const run = (dir) => {
    const term = input.value;
    const session = state.sessions.get(state.activeSessionId);
    if (!session?.searchAddon || !term) {
      return;
    }
    if (dir === "prev") {
      session.searchAddon.findPrevious(term);
    } else {
      session.searchAddon.findNext(term);
    }
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      run(event.shiftKey ? "prev" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeTerminalSearch();
    }
    event.stopPropagation();
  });
  input.addEventListener("input", () => run("next"));
  bar.querySelector("[data-dir=prev]").addEventListener("click", () => run("prev"));
  bar.querySelector("[data-dir=next]").addEventListener("click", () => run("next"));
  bar.querySelector("[data-close]").addEventListener("click", closeTerminalSearch);

  searchBar = bar;
  return bar;
}

function openTerminalSearch() {
  const session = state.sessions.get(state.activeSessionId);
  if (!session?.searchAddon) {
    flashStatus("Recherche indisponible dans ce terminal.");
    return;
  }
  const bar = ensureSearchBar();
  bar.classList.remove("hidden");
  const input = bar.querySelector(".term-search-input");
  input.focus();
  input.select();
}

function closeTerminalSearch() {
  if (searchBar) {
    searchBar.classList.add("hidden");
  }
  const session = state.sessions.get(state.activeSessionId);
  session?.searchAddon?.clearDecorations?.();
  session?.terminal?.focus();
}

// --- Raccourcis clavier : registre, defaut, persistance, dispatch ----------
const SHORTCUT_ACTIONS = [
  { id: "newTab", label: "Nouvelle session", category: "Onglets", run: () => launchSession() },
  { id: "closeTab", label: "Fermer l'onglet actif", category: "Onglets", run: () => state.activeSessionId && closeSession(state.activeSessionId) },
  { id: "nextTab", label: "Onglet suivant", category: "Onglets", run: () => cycleTab(1) },
  { id: "prevTab", label: "Onglet précédent", category: "Onglets", run: () => cycleTab(-1) },
  { id: "reopenTab", label: "Rouvrir la dernière session fermée", category: "Onglets", run: () => reopenLastClosed() },
  { id: "duplicateTab", label: "Dupliquer l'onglet", category: "Onglets", run: () => state.activeSessionId && duplicateSession(state.activeSessionId) },
  { id: "relaunchTab", label: "Relancer l'onglet (nouvelle session)", category: "Onglets", run: () => state.activeSessionId && relaunchSession(state.activeSessionId) },
  { id: "restartAi", label: "Redémarrer l'IA (reprendre la conversation)", category: "Onglets", run: () => state.activeSessionId && restartSession(state.activeSessionId) },
  { id: "restartAllUpdates", label: "Redémarrer toutes les IA ayant une mise à jour en attente", category: "Onglets", run: () => restartAllWithUpdate() },
  { id: "restartAllSameCli", label: "Redémarrer toutes les IA du même type que l'onglet actif", category: "Onglets", run: () => restartAllSameCli() },
  { id: "toggleNotifications", label: "Activer / désactiver les notifications de fin de tâche", category: "Onglets", run: () => toggleNotifications() },
  { id: "openConversations", label: "Conversations Claude (reprendre une conversation)", category: "Navigation", run: () => openConversations() },
  { id: "openPrompts", label: "Bibliothèque de prompts", category: "Navigation", run: () => openPrompts() },
  { id: "openJarvis", label: "JARVIS", category: "Navigation", run: () => openJarvis() },
  { id: "jarvisDictate", label: "JARVIS : parler à l'IA (écoute / annuler)", category: "JARVIS", run: () => toggleJarvisDictation() },
  { id: "jarvisReadReply", label: "JARVIS : lire la dernière réponse de l'IA", category: "JARVIS", run: () => jarvisReadReply() },
  { id: "jarvisAutoRead", label: "JARVIS : lecture automatique des réponses (activer / désactiver)", category: "JARVIS", run: () => toggleJarvisAutoRead() },
  { id: "openGitChanges", label: "Changements Git de l'onglet", category: "Navigation", run: () => openGitChanges() },
  { id: "renameTab", label: "Renommer l'onglet actif", category: "Onglets", run: () => focusRenameActive() },
  { id: "toggleSplit", label: "Vue partagée (deux onglets côte à côte)", category: "Vue partagée", run: () => toggleSplit() },
  { id: "toggleMirror", label: "Saisie synchronisée (miroir)", category: "Vue partagée", run: () => toggleMirror() },
  { id: "openPipeline", label: "Pipeline IA (enchaîner des IA)", category: "Vue partagée", run: () => openPipelineTab() },
  { id: "toggleSidebar", label: "Afficher / masquer le menu", category: "Navigation", run: () => setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed")) },
  { id: "openHistory", label: "Ouvrir l'historique global", category: "Navigation", run: () => openHistory() },
  { id: "openShortcuts", label: "Réglages des raccourcis", category: "Navigation", run: () => openShortcutsModal() },
  { id: "showHelp", label: "Aide : liste des raccourcis", category: "Navigation", run: () => openHelpOverlay() },
  { id: "zoomIn", label: "Agrandir la police du terminal", category: "Terminal", run: () => changeTerminalFontSize(1) },
  { id: "zoomOut", label: "Réduire la police du terminal", category: "Terminal", run: () => changeTerminalFontSize(-1) },
  { id: "zoomReset", label: "Police du terminal par défaut", category: "Terminal", run: () => resetTerminalFontSize() },
  { id: "findInTerminal", label: "Rechercher dans le terminal", category: "Terminal", run: () => openTerminalSearch() }
];

const DEFAULT_KEYBINDINGS = {
  newTab: "Ctrl+T",
  closeTab: "Ctrl+W",
  nextTab: "Ctrl+Tab",
  prevTab: "Ctrl+Shift+Tab",
  reopenTab: "Ctrl+Shift+T",
  duplicateTab: "Ctrl+Shift+D",
  relaunchTab: "Ctrl+Shift+R",
  restartAi: "Ctrl+Shift+U",
  openConversations: "Ctrl+Shift+O",
  openPrompts: "Ctrl+Shift+L",
  openGitChanges: "Ctrl+Shift+G",
  renameTab: "F2",
  toggleSplit: "Ctrl+\\",
  toggleMirror: "Ctrl+Shift+M",
  openPipeline: "Ctrl+Shift+P",
  toggleSidebar: "Ctrl+B",
  openHistory: "Ctrl+Shift+H",
  openShortcuts: "Ctrl+,",
  showHelp: "F1",
  zoomIn: "Ctrl+=",
  zoomOut: "Ctrl+-",
  zoomReset: "Ctrl+0",
  findInTerminal: "Ctrl+Shift+F",
  jarvisDictate: "Ctrl+Shift+Space",
  jarvisReadReply: "Ctrl+Shift+J"
};

// keybindings : actionId -> chord ("" = desactive). Charge depuis localStorage,
// fusionne avec les valeurs par defaut (on ne stocke que les differences).
let keybindings = loadKeybindings();

function loadKeybindings() {
  const merged = { ...DEFAULT_KEYBINDINGS };
  try {
    const saved = JSON.parse(window.localStorage.getItem("keybindings") || "{}");
    for (const [id, chord] of Object.entries(saved)) {
      if (id in DEFAULT_KEYBINDINGS) {
        merged[id] = String(chord || "");
      }
    }
  } catch {}
  return merged;
}

function saveKeybindings() {
  const diff = {};
  for (const [id, chord] of Object.entries(keybindings)) {
    if (chord !== DEFAULT_KEYBINDINGS[id]) {
      diff[id] = chord;
    }
  }
  window.localStorage.setItem("keybindings", JSON.stringify(diff));
}

function resetKeybindings() {
  keybindings = { ...DEFAULT_KEYBINDINGS };
  window.localStorage.removeItem("keybindings");
}

// Touche principale d'un evenement, basee sur event.code pour rester fiable
// quelle que soit la disposition clavier (AZERTY inclus : les chiffres et
// symboles ne dependent pas de Maj/AltGr).
function mainKeyFromEvent(event) {
  const code = event.code || "";
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  const codeMap = {
    Equal: "=", Minus: "-", Comma: ",", Period: ".", Slash: "/",
    Semicolon: ";", Backquote: "`", Space: "Space"
  };
  if (code in codeMap) {
    return codeMap[code];
  }
  const key = event.key;
  if (!key || ["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return "";
  }
  if (key === " ") {
    return "Space";
  }
  if (/^F\d{1,2}$/.test(key)) {
    return key;
  }
  const named = [
    "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert",
    "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
  ];
  if (named.includes(key)) {
    return key;
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

function eventToChord(event) {
  const key = mainKeyFromEvent(event);
  if (!key) {
    return "";
  }
  const parts = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
}

function chordToActionId(chord) {
  if (!chord) {
    return null;
  }
  for (const [id, value] of Object.entries(keybindings)) {
    if (value && value === chord) {
      return id;
    }
  }
  return null;
}

function isEditableTarget(target) {
  return Boolean(target) && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

// Callback actif uniquement pendant la capture d'un raccourci (reglages).
let chordCaptureCallback = null;

function handleShortcut(event) {
  const chord = eventToChord(event);
  if (!chord) {
    return false;
  }

  // Dans un champ texte, on ne deroute pas les frappes "simples" (sans Ctrl/Alt
  // ni touche de fonction) pour ne pas empecher la saisie.
  const hasModifier = event.ctrlKey || event.altKey || event.metaKey;
  const isFunctionKey = /^F\d/.test(chord);
  if (isEditableTarget(event.target) && !hasModifier && !isFunctionKey) {
    return false;
  }

  // Alt+1..9 : aller directement a l'onglet N (fixe, non remappable).
  const gotoMatch = /^Alt\+([1-9])$/.exec(chord);
  if (gotoMatch) {
    event.preventDefault();
    gotoTab(parseInt(gotoMatch[1], 10));
    return true;
  }

  const id = chordToActionId(chord);
  if (!id) {
    return false;
  }
  const action = SHORTCUT_ACTIONS.find((item) => item.id === id);
  if (!action) {
    return false;
  }
  event.preventDefault();
  try {
    action.run();
  } catch {}
  return true;
}

function setupShortcuts() {
  document.addEventListener(
    "keydown",
    (event) => {
      // Mode capture (reglage d'un raccourci) : on intercepte tout.
      if (chordCaptureCallback) {
        event.preventDefault();
        event.stopPropagation();
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
          return;
        }
        const chord = eventToChord(event);
        const callback = chordCaptureCallback;
        chordCaptureCallback = null;
        callback(chord);
        return;
      }
      handleShortcut(event);
    },
    true
  );
}

// --- Affichage des raccourcis ----------------------------------------------
const CHORD_DISPLAY = { " ": "Espace", Space: "Espace", Escape: "Échap", Enter: "Entrée", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

function renderChord(chord, target) {
  if (!chord) {
    const none = document.createElement("span");
    none.className = "chord-none";
    none.textContent = "—";
    target.appendChild(none);
    return;
  }
  const parts = chord.split("+");
  parts.forEach((part, index) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = CHORD_DISPLAY[part] || part;
    target.appendChild(kbd);
    if (index < parts.length - 1) {
      const plus = document.createElement("span");
      plus.className = "chord-plus";
      plus.textContent = "+";
      target.appendChild(plus);
    }
  });
}

function groupActionsByCategory() {
  const groups = new Map();
  for (const action of SHORTCUT_ACTIONS) {
    if (!groups.has(action.category)) {
      groups.set(action.category, []);
    }
    groups.get(action.category).push(action);
  }
  return groups;
}

// --- Modale de personnalisation des raccourcis -----------------------------
function openShortcutsModal() {
  const overlay = document.createElement("div");
  overlay.className = "changelog-modal shortcuts-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="keyboard"></i><span>Raccourcis clavier</span>';
  dialog.appendChild(header);

  const sub = document.createElement("div");
  sub.className = "changelog-sub";
  sub.textContent = "Cliquez sur un raccourci puis tapez la combinaison. Retour arrière pour désactiver, Échap pour annuler.";
  dialog.appendChild(sub);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";
  dialog.appendChild(body);

  const notice = document.createElement("div");
  notice.className = "shortcuts-notice";
  dialog.appendChild(notice);

  function flashNotice(message) {
    notice.textContent = message || "";
    notice.classList.toggle("visible", Boolean(message));
  }

  function renderRows() {
    body.innerHTML = "";
    for (const [category, actions] of groupActionsByCategory()) {
      const section = document.createElement("div");
      section.className = "shortcuts-section";

      const title = document.createElement("div");
      title.className = "shortcuts-section-title";
      title.textContent = category;
      section.appendChild(title);

      for (const action of actions) {
        const row = document.createElement("div");
        row.className = "shortcuts-row";

        const label = document.createElement("span");
        label.className = "shortcuts-label";
        label.textContent = action.label;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "shortcuts-chord-btn";
        renderChord(keybindings[action.id], btn);

        btn.addEventListener("click", () => {
          if (chordCaptureCallback) {
            return;
          }
          btn.classList.add("capturing");
          btn.textContent = "Appuyez sur une touche…";
          chordCaptureCallback = (chord) => {
            btn.classList.remove("capturing");
            if (!chord || chord === "Escape") {
              renderRows();
              return;
            }
            if (chord === "Backspace" || chord === "Delete") {
              keybindings[action.id] = "";
              saveKeybindings();
              renderRows();
              flashNotice(`« ${action.label} » désactivé.`);
              return;
            }
            const owner = chordToActionId(chord);
            if (owner && owner !== action.id) {
              keybindings[owner] = "";
              const ownerLabel = SHORTCUT_ACTIONS.find((a) => a.id === owner)?.label || owner;
              flashNotice(`Raccourci réassigné (retiré de « ${ownerLabel} »).`);
            } else {
              flashNotice("");
            }
            keybindings[action.id] = chord;
            saveKeybindings();
            renderRows();
          };
        });

        row.append(label, btn);
        section.appendChild(row);
      }
      body.appendChild(section);
    }

    const fixed = document.createElement("div");
    fixed.className = "shortcuts-section";
    fixed.innerHTML = '<div class="shortcuts-section-title">Fixes</div>'
      + '<div class="shortcuts-row"><span class="shortcuts-label">Aller à l\'onglet 1 à 9</span>'
      + '<span class="shortcuts-chord-static"><kbd>Alt</kbd><span class="chord-plus">+</span><kbd>1…9</kbd></span></div>'
      + '<div class="shortcuts-row"><span class="shortcuts-label">Copier / Coller dans le terminal</span>'
      + '<span class="shortcuts-chord-static"><kbd>Ctrl</kbd><span class="chord-plus">+</span><kbd>Maj</kbd><span class="chord-plus">+</span><kbd>C</kbd> / <kbd>V</kbd></span></div>';
    body.appendChild(fixed);
  }

  renderRows();

  const actions = document.createElement("div");
  actions.className = "changelog-actions shortcuts-actions";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost-button danger";
  reset.textContent = "Tout réinitialiser";
  reset.addEventListener("click", () => {
    resetKeybindings();
    renderRows();
    flashNotice("Raccourcis réinitialisés.");
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "primary-button";
  close.textContent = "Fermer";
  close.addEventListener("click", () => {
    chordCaptureCallback = null;
    overlay.remove();
  });

  actions.append(reset, close);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      chordCaptureCallback = null;
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  createIcons();
}

// --- Overlay d'aide (liste en lecture seule) -------------------------------
function openHelpOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="keyboard"></i><span>Raccourcis clavier</span>';
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";
  for (const [category, actions] of groupActionsByCategory()) {
    const section = document.createElement("div");
    section.className = "shortcuts-section";
    const title = document.createElement("div");
    title.className = "shortcuts-section-title";
    title.textContent = category;
    section.appendChild(title);
    for (const action of actions) {
      if (!keybindings[action.id]) {
        continue;
      }
      const row = document.createElement("div");
      row.className = "shortcuts-row";
      const label = document.createElement("span");
      label.className = "shortcuts-label";
      label.textContent = action.label;
      const chord = document.createElement("span");
      chord.className = "shortcuts-chord-static";
      renderChord(keybindings[action.id], chord);
      row.append(label, chord);
      section.appendChild(row);
    }
    body.appendChild(section);
  }
  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions";
  const customize = document.createElement("button");
  customize.type = "button";
  customize.className = "ghost-button";
  customize.textContent = "Personnaliser…";
  customize.addEventListener("click", () => {
    overlay.remove();
    openShortcutsModal();
  });
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary-button";
  ok.textContent = "Compris";
  ok.addEventListener("click", () => overlay.remove());
  actions.append(customize, ok);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
  createIcons();
}

// --- Gestionnaire de personas (Gems) ---------------------------------------
async function persistPersonas() {
  state.config = await window.launcher.saveConfig(state.config);
  renderPersonas();
}

function openPersonasModal() {
  const overlay = document.createElement("div");
  overlay.className = "changelog-modal shortcuts-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="sparkles"></i><span>Personas</span>';
  dialog.appendChild(header);

  const sub = document.createElement("div");
  sub.className = "changelog-sub";
  sub.textContent = "Une persona ajoute des instructions (system prompt) à la CLI au lancement. Sélectionne-la ensuite dans « Nouvel onglet ».";
  dialog.appendChild(sub);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";
  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions shortcuts-actions";
  dialog.appendChild(actions);

  function close() {
    overlay.remove();
  }

  function renderList() {
    body.innerHTML = "";
    actions.innerHTML = "";

    const personas = getPersonas();
    if (!personas.length) {
      const empty = document.createElement("div");
      empty.className = "shortcuts-label";
      empty.textContent = "Aucune persona. Crée la première avec « Ajouter ».";
      body.appendChild(empty);
    }

    for (const persona of personas) {
      const row = document.createElement("div");
      row.className = "shortcuts-row persona-row";

      const info = document.createElement("div");
      info.className = "persona-info";
      const dot = document.createElement("span");
      dot.className = "persona-dot";
      dot.style.background = persona.accent || "#64748b";
      const texts = document.createElement("div");
      const name = document.createElement("div");
      name.className = "persona-name";
      name.textContent = persona.name;
      const preview = document.createElement("div");
      preview.className = "persona-preview";
      preview.textContent = persona.prompt;
      texts.append(name, preview);
      info.append(dot, texts);

      const btns = document.createElement("div");
      btns.className = "persona-row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "ghost-button";
      edit.textContent = "Éditer";
      edit.addEventListener("click", () => renderEditor(persona));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ghost-button danger";
      del.textContent = "Suppr.";
      del.addEventListener("click", async () => {
        if (!window.confirm(`Supprimer la persona « ${persona.name} » ?`)) {
          return;
        }
        state.config.personas = getPersonas().filter((item) => item.id !== persona.id);
        await persistPersonas();
        renderList();
      });
      btns.append(edit, del);

      row.append(info, btns);
      body.appendChild(row);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "ghost-button";
    add.textContent = "Ajouter";
    add.addEventListener("click", () => renderEditor(null));
    const done = document.createElement("button");
    done.type = "button";
    done.className = "primary-button";
    done.textContent = "Fermer";
    done.addEventListener("click", close);
    actions.append(add, done);
  }

  function renderEditor(persona) {
    body.innerHTML = "";
    actions.innerHTML = "";
    const editing = Boolean(persona);

    const nameField = document.createElement("label");
    nameField.className = "field";
    nameField.innerHTML = "<span>Nom</span>";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = persona?.name || "";
    nameInput.placeholder = "ex. Relecteur strict";
    nameField.appendChild(nameInput);

    const colorField = document.createElement("label");
    colorField.className = "field";
    colorField.innerHTML = "<span>Couleur</span>";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = persona?.accent || "#64748b";
    colorField.appendChild(colorInput);

    const promptField = document.createElement("label");
    promptField.className = "field";
    promptField.innerHTML = "<span>Instructions (system prompt)</span>";
    const promptInput = document.createElement("textarea");
    promptInput.className = "persona-textarea";
    promptInput.rows = 8;
    promptInput.value = persona?.prompt || "";
    promptInput.placeholder = "Décris la personnalité / les règles à appliquer à l'IA…";
    promptField.appendChild(promptInput);

    body.append(nameField, colorField, promptField);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost-button";
    cancel.textContent = "Annuler";
    cancel.addEventListener("click", renderList);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-button";
    save.textContent = "Enregistrer";
    save.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const prompt = promptInput.value.trim();
      if (!name || !prompt) {
        flashStatus("Nom et instructions requis pour la persona.");
        return;
      }
      if (!Array.isArray(state.config.personas)) {
        state.config.personas = [];
      }
      if (editing) {
        const target = state.config.personas.find((item) => item.id === persona.id);
        if (target) {
          target.name = name;
          target.prompt = prompt;
          target.accent = colorInput.value;
        }
      } else {
        state.config.personas.push({
          id: `persona-${Date.now()}`,
          name,
          accent: colorInput.value,
          prompt
        });
      }
      await persistPersonas();
      renderList();
    });

    actions.append(cancel, save);
  }

  renderList();
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.body.appendChild(overlay);
  createIcons();
}

// --- Synchronisation des donnees (dossier cloud) ---------------------------
// ===================== Pipeline IA (enchaînement de CLI) =====================

const PIPELINE_KEY = "pipeline.v1";

// Modèle = dernière config utilisée (point de départ des nouvelles pipelines).
// Chaque onglet pipeline a ENSUITE sa propre copie indépendante (session.pipeline).
function clonePipelineDef(pdef) {
  return {
    cwd: pdef?.cwd || "",
    autoMode: pdef?.autoMode !== false,
    steps: (pdef?.steps || []).map((s) => ({ profileId: s.profileId, prompt: s.prompt, args: s.args ?? null }))
  };
}

function loadPipelineTemplate() {
  try {
    const s = JSON.parse(window.localStorage.getItem(PIPELINE_KEY) || "null");
    if (s && Array.isArray(s.steps) && s.steps.length) {
      return clonePipelineDef(s);
    }
  } catch {}
  return null;
}

function savePipelineTemplate(pdef) {
  try {
    window.localStorage.setItem(PIPELINE_KEY, JSON.stringify(clonePipelineDef(pdef)));
  } catch {}
}

function newPipelineDef() {
  return loadPipelineTemplate() || { cwd: "", autoMode: true, steps: [{ profileId: defaultStepProfileId(), prompt: "", args: null }] };
}

function pipelineProfiles() {
  return state.config?.profiles || [];
}

function defaultStepProfileId() {
  const profiles = pipelineProfiles();
  return (profiles.find((p) => p.favorite) || profiles[0])?.id || "";
}

// Remplace {{entrée}}, {{précédent}} et {{étapeN}} par les valeurs du contexte.
function substituteVars(template, ctx) {
  const map = {
    "entrée": ctx.input, "entree": ctx.input, "input": ctx.input,
    "précédent": ctx.prev, "precedent": ctx.prev, "prev": ctx.prev, "sortie": ctx.prev
  };
  return String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, key) => {
    const k = String(key).toLowerCase().trim();
    if (k in map) {
      return map[k] ?? "";
    }
    const stepMatch = k.match(/^(?:étape|etape|step)\s*(\d+)$/);
    if (stepMatch) {
      return ctx.outputs[parseInt(stepMatch[1], 10) - 1] ?? "";
    }
    return whole;
  });
}

// Decoupe une chaine de flags en respectant les guillemets.
function splitFlagString(value) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(value || ""))) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

// Arguments headless effectifs d'une etape : override utilisateur sinon defaut CLI.
function stepArgs(step, profile) {
  if (step.args != null && String(step.args).trim() !== "") {
    return splitFlagString(step.args);
  }
  return profile?.headless?.args || [];
}

function defaultArgsString(profile) {
  return (profile?.headless?.args || []).join(" ");
}

// Rendu de la liste d'étapes (éditeur) pour une définition de pipeline donnée.
function renderPipelineSteps(stepsEl, pdef) {
  stepsEl.innerHTML = "";
  pdef.steps.forEach((step, index) => {
    const profile = pipelineProfiles().find((p) => p.id === step.profileId);

    const card = document.createElement("div");
    card.className = "pipeline-step";

    const head = document.createElement("div");
    head.className = "pipeline-step-head";
    const num = document.createElement("span");
    num.className = "pipeline-step-num";
    num.textContent = `Étape ${index + 1}`;

    const cliSelect = document.createElement("select");
    cliSelect.className = "relay-select pipeline-cli";
    for (const p of pipelineProfiles()) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      if (p.id === step.profileId) {
        opt.selected = true;
      }
      cliSelect.appendChild(opt);
    }
    cliSelect.addEventListener("change", () => {
      step.profileId = cliSelect.value;
      step.args = null;
      savePipelineTemplate(pdef);
      renderPipelineSteps(stepsEl, pdef);
      createIcons();
    });

    const tools = document.createElement("div");
    tools.className = "pipeline-step-tools";
    const move = (delta) => {
      const target = index + delta;
      if (target < 0 || target >= pdef.steps.length) {
        return;
      }
      const [m] = pdef.steps.splice(index, 1);
      pdef.steps.splice(target, 0, m);
      savePipelineTemplate(pdef);
      renderPipelineSteps(stepsEl, pdef);
      createIcons();
    };
    const delBtn = mkIconBtn("trash-2", "Supprimer", () => {
      pdef.steps.splice(index, 1);
      if (!pdef.steps.length) {
        pdef.steps.push({ profileId: defaultStepProfileId(), prompt: "", args: null });
      }
      savePipelineTemplate(pdef);
      renderPipelineSteps(stepsEl, pdef);
      createIcons();
    });
    tools.append(mkIconBtn("chevron-up", "Monter", () => move(-1)), mkIconBtn("chevron-down", "Descendre", () => move(1)), delBtn);

    head.append(num, cliSelect, tools);
    card.appendChild(head);

    const promptArea = document.createElement("textarea");
    promptArea.className = "pipeline-textarea";
    promptArea.rows = 4;
    promptArea.placeholder = index === 0
      ? "Prompt de départ pour cette IA…"
      : "Prompt — utilise {{précédent}} pour la sortie de l'étape d'avant";
    promptArea.value = step.prompt || "";
    promptArea.addEventListener("input", () => {
      step.prompt = promptArea.value;
      savePipelineTemplate(pdef);
    });
    card.appendChild(promptArea);

    // Commande headless (visible + editable).
    const cmdRow = document.createElement("div");
    cmdRow.className = "pipeline-cmd-row";
    const cmdPrefix = document.createElement("span");
    cmdPrefix.className = "pipeline-cmd-prefix";
    cmdPrefix.textContent = `${profile?.command || "?"} `;
    const argsInput = document.createElement("input");
    argsInput.type = "text";
    argsInput.className = "text-input pipeline-args";
    argsInput.placeholder = defaultArgsString(profile) || "(aucun flag)";
    argsInput.value = step.args != null ? step.args : "";
    argsInput.title = "Flags du mode non-interactif (vide = défaut de la CLI). Le prompt est ajouté en dernier.";
    argsInput.addEventListener("input", () => {
      step.args = argsInput.value.trim() === "" ? null : argsInput.value;
      savePipelineTemplate(pdef);
    });
    const cmdSuffix = document.createElement("span");
    cmdSuffix.className = "pipeline-cmd-suffix";
    cmdSuffix.textContent = ' "«prompt»"';
    cmdRow.append(cmdPrefix, argsInput, cmdSuffix);
    card.appendChild(cmdRow);

    stepsEl.appendChild(card);
  });
}

// Menu de configuration d'UNE pipeline (liée à son onglet d'exécution).
function openPipelineConfig(session) {
  const pdef = session.pipeline;
  for (const step of pdef.steps) {
    if (!step.profileId || !pipelineProfiles().some((p) => p.id === step.profileId)) {
      step.profileId = defaultStepProfileId();
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";
  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog pipeline-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = `<i data-lucide="workflow"></i><span>${session.title} — configuration</span>`;
  dialog.appendChild(header);

  const sub = document.createElement("div");
  sub.className = "changelog-sub";
  sub.textContent = "Enchaîne plusieurs IA : la réponse d'une étape devient l'entrée de la suivante.";
  dialog.appendChild(sub);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";

  // Bloc d'aide détaillé (ouvert par défaut).
  const help = document.createElement("details");
  help.className = "pipeline-help";
  help.open = true;
  help.innerHTML = `
    <summary>❔ Comment ça marche ?</summary>
    <div class="pipeline-help-body">
      <p>Une <b>pipeline</b> exécute tes étapes l'une après l'autre. La réponse d'une étape peut être réinjectée dans la suivante — parfait pour « une IA analyse, une autre corrige ».</p>
      <p><b>Variables</b> à écrire dans le prompt d'une étape :</p>
      <ul>
        <li><code>{{précédent}}</code> → la réponse de l'étape juste avant.</li>
        <li><code>{{étape1}}</code>, <code>{{étape2}}</code>… → la réponse d'une étape précise.</li>
      </ul>
      <p><b>Exemple en 2 étapes :</b></p>
      <ol>
        <li><b>Codex</b> — <code>Analyse ce projet et liste tous les bugs, sans corriger.</code></li>
        <li><b>Claude</b> — <code>Corrige ces bugs un par un : {{précédent}}</code></li>
      </ol>
      <p><b>Bon à savoir :</b></p>
      <ul>
        <li>Chaque IA doit être <b>installée et connectée</b> (teste-la d'abord dans un onglet normal).</li>
        <li><b>Auto</b> = tout s'enchaîne tout seul ; décoché = <b>pas-à-pas</b> (tu valides chaque passage).</li>
        <li>Le petit champ à côté du nom de la CLI = <b>options de la commande</b> (laisse vide = réglage par défaut). <b>Le prompt ne va pas là</b>, mais dans la grande zone de texte.</li>
        <li><b>Dossier de travail</b> = là où les IA agissent (par défaut : le dossier sélectionné dans le menu de gauche).</li>
        <li>Après « Lancer », le déroulé s'affiche <b>en direct</b> dans l'onglet ; une grosse tâche peut prendre plusieurs minutes (bouton ⏹ pour annuler).</li>
      </ul>
    </div>`;
  body.appendChild(help);

  // Dossier de travail (cwd).
  const cwdRow = document.createElement("div");
  cwdRow.className = "pipeline-cwd-row";
  const cwdInput = document.createElement("input");
  cwdInput.type = "text";
  cwdInput.className = "text-input";
  cwdInput.placeholder = "Dossier de travail (par défaut : dossier sélectionné)";
  cwdInput.value = pdef.cwd || state.selectedFolder || "";
  cwdInput.addEventListener("input", () => {
    pdef.cwd = cwdInput.value;
    savePipelineTemplate(pdef);
  });
  const cwdBtn = document.createElement("button");
  cwdBtn.type = "button";
  cwdBtn.className = "ghost-button";
  cwdBtn.textContent = "Choisir…";
  cwdBtn.addEventListener("click", async () => {
    const folder = await window.launcher.chooseFolder();
    if (folder) {
      cwdInput.value = folder;
      pdef.cwd = folder;
      savePipelineTemplate(pdef);
    }
  });
  cwdRow.append(cwdInput, cwdBtn);
  body.appendChild(cwdRow);

  const stepsEl = document.createElement("div");
  stepsEl.className = "pipeline-steps";
  body.appendChild(stepsEl);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ghost-button pipeline-add";
  addBtn.innerHTML = '<i data-lucide="plus"></i> Ajouter une étape';
  addBtn.addEventListener("click", () => {
    pdef.steps.push({ profileId: defaultStepProfileId(), prompt: "{{précédent}}", args: null });
    savePipelineTemplate(pdef);
    renderPipelineSteps(stepsEl, pdef);
    createIcons();
  });
  body.appendChild(addBtn);
  dialog.appendChild(body);

  // Actions.
  const actions = document.createElement("div");
  actions.className = "changelog-actions shortcuts-actions";
  const left = document.createElement("label");
  left.className = "pipeline-mode";
  const modeCheck = document.createElement("input");
  modeCheck.type = "checkbox";
  modeCheck.checked = pdef.autoMode !== false;
  modeCheck.addEventListener("change", () => {
    pdef.autoMode = modeCheck.checked;
    savePipelineTemplate(pdef);
  });
  const modeText = document.createElement("span");
  modeText.textContent = "Enchaînement automatique (sinon pas-à-pas)";
  left.append(modeCheck, modeText);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";
  const launchBtn = document.createElement("button");
  launchBtn.type = "button";
  launchBtn.className = "primary-button";
  launchBtn.innerHTML = '<i data-lucide="play"></i> Lancer le pipeline';
  launchBtn.addEventListener("click", () => {
    overlay.remove();
    setActiveSession(session.id);
    runPipeline(session);
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ghost-button";
  closeBtn.textContent = "Fermer";
  closeBtn.addEventListener("click", () => overlay.remove());
  right.append(launchBtn, closeBtn);
  actions.append(left, right);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
  renderPipelineSteps(stepsEl, pdef);
  createIcons();
}

// Crée TOUJOURS un nouvel onglet d'exécution (pipeline indépendante).
function createPipelineExecTab(pdef) {
  const sessionId = "pipeline-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const container = document.createElement("div");
  container.className = "terminal-pane pipeline-pane-host";
  container.dataset.sessionId = sessionId;
  const pane = document.createElement("div");
  pane.className = "pipeline-pane pipeline-exec";
  container.appendChild(pane);
  elements.terminalHost.appendChild(container);

  const count = [...state.sessions.values()].filter((s) => s.type === "pipeline").length + 1;
  const session = { id: sessionId, type: "pipeline", title: "Pipeline " + count, accent: "#a855f7", tab: null, container, pipeline: pdef };
  session.tab = createTab(session);
  state.sessions.set(sessionId, session);

  const head = document.createElement("div");
  head.className = "pipeline-exec-head";
  const title = document.createElement("span");
  title.className = "pipeline-exec-title";
  title.innerHTML = '<i data-lucide="workflow"></i> ' + session.title;

  const headTools = document.createElement("div");
  headTools.className = "pipeline-exec-tools";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "ghost-button danger";
  cancelBtn.textContent = "⏹ Annuler";
  cancelBtn.style.display = "none";
  cancelBtn.addEventListener("click", () => {
    window.launcher.cancelPipeline();
    flashStatus("Annulation du pipeline…");
  });
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ghost-button";
  editBtn.innerHTML = '<i data-lucide="settings-2"></i> Modifier';
  editBtn.addEventListener("click", () => openPipelineConfig(session));
  const relaunchBtn = document.createElement("button");
  relaunchBtn.type = "button";
  relaunchBtn.className = "primary-button";
  relaunchBtn.innerHTML = '<i data-lucide="play"></i> Relancer';
  relaunchBtn.addEventListener("click", () => runPipeline(session));
  headTools.append(cancelBtn, editBtn, relaunchBtn);
  head.append(title, headTools);
  pane.appendChild(head);

  const results = document.createElement("div");
  results.className = "pipeline-results pipeline-exec-results";
  pane.appendChild(results);

  session.results = results;
  session.relaunchBtn = relaunchBtn;
  session.cancelBtn = cancelBtn;
  setActiveSession(sessionId);
  createIcons();
  return session;
}

// Bouton barre d'outils / raccourci : NOUVELLE pipeline (onglet séparé) + config.
function openPipelineTab() {
  const session = createPipelineExecTab(newPipelineDef());
  openPipelineConfig(session);
}

function mkIconBtn(icon, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-button pipeline-mini";
  btn.title = title;
  btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  btn.addEventListener("click", onClick);
  return btn;
}

async function runPipeline(session) {
  const pdef = session.pipeline;
  const resultsEl = session.results;
  const runBtn = session.relaunchBtn;
  const cancelBtn = session.cancelBtn;
  savePipelineTemplate(pdef);
  resultsEl.innerHTML = "";
  runBtn.disabled = true;

  const heading = document.createElement("div");
  heading.className = "pipeline-results-heading";
  heading.textContent = "── Résultats (en direct) ──";
  resultsEl.appendChild(heading);
  heading.scrollIntoView({ block: "start", behavior: "smooth" });

  const ctx = { input: "", prev: "", outputs: [] };
  const cwd = pdef.cwd || state.selectedFolder || "";
  const steps = pdef.steps;

  if (!steps.length) {
    const msg = document.createElement("div");
    msg.className = "pipeline-stop";
    msg.textContent = "Aucune étape. Ajoute au moins une étape.";
    resultsEl.appendChild(msg);
    runBtn.disabled = false;
    return;
  }

  const runLabel = runBtn.innerHTML;
  runBtn.innerHTML = "⏳ En cours…";
  if (cancelBtn) {
    cancelBtn.style.display = "";
  }

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const profile = pipelineProfiles().find((p) => p.id === step.profileId);
      const block = renderResultBlock(resultsEl, i, profile);
      if (!profile) {
        updateResultBlock(block, { ok: false, error: "CLI introuvable." });
        break;
      }
      const prompt = substituteVars(step.prompt, ctx);
      const args = stepArgs(step, profile);
      block.cmd.textContent = `$ ${profile.command} ${args.join(" ")} "…"`.replace(/\s+/g, " ");
      block.preview.textContent = prompt.length > 400 ? prompt.slice(0, 400) + "…" : prompt;

      if (!prompt.trim()) {
        updateResultBlock(block, { ok: false, error: "Prompt vide : écris un prompt dans cette étape (ou utilise {{précédent}})." });
        const stop = document.createElement("div");
        stop.className = "pipeline-stop";
        stop.textContent = "⛔ Pipeline arrêté (prompt vide).";
        resultsEl.appendChild(stop);
        break;
      }

      // Sortie en direct + indicateur d'activité (chrono + octets reçus), car
      // certaines CLI (ex. codex exec) ne crachent leur sortie qu'à la fin.
      let res;
      const runId = `step-${Date.now()}-${i}`;
      const startedAt = Date.now();
      let received = 0;
      block.output.textContent = "";
      const tick = () => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        const mm = Math.floor(s / 60);
        const ss = String(s % 60).padStart(2, "0");
        block.stateEl.textContent = `▶ en cours… ${mm}:${ss} · ${received} caractères reçus`;
      };
      tick();
      const heartbeat = window.setInterval(tick, 1000);
      const unsub = window.launcher.onPipelineStepOutput((payload) => {
        if (payload.runId === runId) {
          received += payload.chunk.length;
          block.output.textContent += payload.chunk;
          block.output.scrollTop = block.output.scrollHeight;
          tick();
        }
      });
      try {
        res = await window.launcher.runPipelineStep({
          command: profile.command,
          args,
          prompt,
          cwd,
          stdin: Boolean(profile.headless?.stdin),
          runId
        });
      } catch (error) {
        res = { ok: false, error: String(error?.message || error) };
      } finally {
        window.clearInterval(heartbeat);
        if (unsub) {
          unsub();
        }
      }
      updateResultBlock(block, res);

      if (res.ok) {
        ctx.prev = res.output || "";
        ctx.outputs.push(ctx.prev);
        flashStatus(`Pipeline : étape ${i + 1} OK (${ctx.prev.length} caractères).`);
      } else {
        ctx.outputs.push("");
        const stop = document.createElement("div");
        stop.className = "pipeline-stop";
        stop.textContent = "⛔ Étape en échec — pipeline arrêté. (détail dans le bloc rouge ci-dessus)";
        resultsEl.appendChild(stop);
        block.block.scrollIntoView({ block: "center" });
        flashStatus(`Pipeline : étape ${i + 1} en échec — ${(res.error || "").split("\n")[0].slice(0, 120)}`);
        break;
      }

      if (!pdef.autoMode && i < steps.length - 1) {
        await waitForContinue(resultsEl, `Continuer → étape ${i + 2}`);
      }
    }
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = runLabel;
    if (cancelBtn) {
      cancelBtn.style.display = "none";
    }
  }
}

function renderResultBlock(resultsEl, index, profile) {
  const block = document.createElement("div");
  block.className = "pipeline-result running";
  const head = document.createElement("div");
  head.className = "pipeline-result-head";
  head.innerHTML = `<span class="pipeline-step-num">Étape ${index + 1}</span><span class="pipeline-result-cli">${profile?.label || "?"}</span><span class="pipeline-result-state">en cours…</span>`;
  const cmd = document.createElement("div");
  cmd.className = "pipeline-result-cmd";
  const preview = document.createElement("div");
  preview.className = "pipeline-result-prompt";
  const output = document.createElement("pre");
  output.className = "pipeline-result-output";
  block.append(head, cmd, preview, output);
  resultsEl.appendChild(block);
  resultsEl.scrollTop = resultsEl.scrollHeight;
  // Amène le bloc en cours à l'écran (sinon il reste en bas, hors de vue).
  block.scrollIntoView({ block: "center", behavior: "smooth" });
  return { block, head, cmd, preview, output, stateEl: head.querySelector(".pipeline-result-state") };
}

function updateResultBlock(block, res) {
  block.block.classList.remove("running");
  if (res.ok) {
    block.block.classList.add("done");
    block.stateEl.textContent = "✓ terminé";
    block.output.textContent = res.output || "(sortie vide)";
  } else {
    block.block.classList.add("failed");
    block.stateEl.textContent = "✗ échec";
    block.output.textContent = res.error || res.output || "(erreur inconnue)";
  }
  block.block.scrollIntoView({ block: "nearest" });
}

function waitForContinue(container, label) {
  return new Promise((resolve) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary-button pipeline-continue";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      btn.remove();
      resolve();
    });
    container.appendChild(btn);
    btn.scrollIntoView({ block: "nearest" });
  });
}

function formatLastSync(ts) {
  if (!ts) {
    return "jamais";
  }
  try {
    return new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

// Construit le bloc "Google Drive" de la modale de synchronisation.
// `gstatus` = { configured, connected, clientId, email, lastSync }.
function buildGdriveSection(gstatus) {
  const section = document.createElement("div");
  section.className = "gdrive-section";

  const title = document.createElement("div");
  title.className = "gdrive-title";
  title.innerHTML = '<i data-lucide="hard-drive"></i><span>Google Drive (sans logiciel à installer)</span>';
  section.appendChild(title);

  const desc = document.createElement("div");
  desc.className = "gdrive-desc";
  desc.textContent = "Connecte directement ton Drive : pas besoin de Google Drive Desktop. Les données sont rangées dans un dossier privé propre à l'app (l'app ne voit rien d'autre de ton Drive).";
  section.appendChild(desc);

  const render = () => {
    // On reconstruit le corps a chaque changement d'etat.
    [...section.querySelectorAll(".gdrive-body")].forEach((n) => n.remove());
    const sbody = document.createElement("div");
    sbody.className = "gdrive-body";

    if (gstatus.connected) {
      const badge = document.createElement("div");
      badge.className = "sync-status";
      badge.innerHTML = `<span class="sync-badge on">Connecté</span><span class="gdrive-email">${gstatus.email || ""}</span>`;
      sbody.appendChild(badge);

      const last = document.createElement("div");
      last.className = "gdrive-last";
      last.textContent = `Dernière synchro : ${formatLastSync(gstatus.lastSync)}`;
      sbody.appendChild(last);

      const row = document.createElement("div");
      row.className = "gdrive-actions";

      const syncNow = document.createElement("button");
      syncNow.type = "button";
      syncNow.className = "primary-button";
      syncNow.textContent = "Synchroniser maintenant";
      syncNow.addEventListener("click", async () => {
        syncNow.disabled = true;
        syncNow.textContent = "Synchronisation…";
        const res = await window.launcher.gdriveSyncNow();
        if (res?.ok) {
          gstatus = res.status || gstatus;
          flashStatus(`Drive synchronisé (${res.pulled || 0} reçus, ${res.pushed || 0} envoyés).`);
          if (res.pulled > 0) {
            await reloadAfterGdrivePull();
          }
        } else {
          flashStatus(`Synchro Drive impossible : ${res?.error || "erreur"}`);
        }
        render();
        createIcons();
      });

      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "ghost-button danger";
      disconnect.textContent = "Déconnecter";
      disconnect.addEventListener("click", async () => {
        if (!window.confirm("Déconnecter Google Drive ? Les données locales sont conservées, mais ne seront plus synchronisées.")) {
          return;
        }
        const res = await window.launcher.gdriveDisconnect();
        gstatus = res?.status || { ...gstatus, connected: false };
        render();
        createIcons();
      });

      row.append(syncNow, disconnect);
      sbody.appendChild(row);
    } else {
      // Champ identifiant client (PKCE desktop, non secret).
      const idLabel = document.createElement("div");
      idLabel.className = "shortcuts-label";
      idLabel.textContent = "Identifiant client OAuth Google (type « Application de bureau ») :";
      const idInput = document.createElement("input");
      idInput.type = "text";
      idInput.className = "text-input gdrive-clientid";
      idInput.placeholder = "xxxxxxxx.apps.googleusercontent.com";
      idInput.value = gstatus.clientId || "";
      sbody.append(idLabel, idInput);

      const secretLabel = document.createElement("div");
      secretLabel.className = "shortcuts-label";
      secretLabel.textContent = "Secret client (fourni avec l'identifiant « Application de bureau ») :";
      const secretInput = document.createElement("input");
      secretInput.type = "text";
      secretInput.className = "text-input gdrive-clientsecret";
      secretInput.placeholder = "GOCSPX-…";
      secretInput.value = gstatus.clientSecret || "";
      sbody.append(secretLabel, secretInput);

      const help = document.createElement("button");
      help.type = "button";
      help.className = "link-button";
      help.textContent = "Comment obtenir cet identifiant ? (guide)";
      help.addEventListener("click", () => openGdriveHelp());
      sbody.appendChild(help);

      const row = document.createElement("div");
      row.className = "gdrive-actions";

      const connect = document.createElement("button");
      connect.type = "button";
      connect.className = "primary-button";
      connect.textContent = "Connecter Google Drive";
      connect.addEventListener("click", async () => {
        const clientId = idInput.value.trim();
        const clientSecret = secretInput.value.trim();
        if (!clientId || !clientSecret) {
          flashStatus("Renseigne l'identifiant client ET le secret client Google.");
          return;
        }
        await window.launcher.gdriveSetCredentials(clientId, clientSecret);
        connect.disabled = true;
        connect.textContent = "Autorisation dans le navigateur…";
        const res = await window.launcher.gdriveConnect();
        if (res?.ok) {
          gstatus = res.status || { ...gstatus, connected: true, email: res.email };
          flashStatus(`Google Drive connecté (${res.email || ""}).`);
          if (res.sync?.pulled > 0) {
            await reloadAfterGdrivePull();
          }
          render();
          createIcons();
        } else {
          connect.disabled = false;
          connect.textContent = "Connecter Google Drive";
          flashStatus(`Connexion Drive impossible : ${res?.error || "erreur"}`);
        }
      });

      row.appendChild(connect);
      sbody.appendChild(row);
    }

    section.appendChild(sbody);
  };

  render();
  return section;
}

// Recharge config + historique apres avoir tire des donnees depuis le Drive.
async function reloadAfterGdrivePull() {
  try {
    state.config = await window.launcher.getConfig();
    renderProfiles();
    renderPersonas();
    refreshAuthStatus();
  } catch {}
}

// Aide pas-a-pas (fenetre propre) pour creer l'identifiant client Google.
function openGdriveHelp() {
  const url = "https://console.cloud.google.com/apis/credentials";
  const steps = [
    { t: "Ouvre la console Google Cloud", d: "Crée un projet (ou choisis-en un existant)." },
    { t: "Active l'API Drive", d: "Menu « APIs et services » → « Bibliothèque » → cherche et active « Google Drive API »." },
    { t: "Configure l'écran de consentement", d: "« APIs et services » → « Écran de consentement OAuth » → type « Externe ». Renseigne le nom de l'app et ton e-mail, puis ajoute ton compte Google dans « Utilisateurs de test »." },
    { t: "Crée l'identifiant OAuth", d: "« Identifiants » → « Créer des identifiants » → « ID client OAuth » → type d'application : « Application de bureau »." },
    { t: "Copie les deux valeurs", d: "Récupère l'« ID client » (finit par .apps.googleusercontent.com) et le « Secret client » (commence par GOCSPX-), puis colle-les dans l'application." }
  ];

  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="key-round"></i><span>Obtenir un identifiant Google Drive</span>';
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";

  // Lien copiable vers la console.
  const linkRow = document.createElement("div");
  linkRow.className = "gdrive-link-row";
  const linkField = document.createElement("input");
  linkField.type = "text";
  linkField.className = "text-input";
  linkField.readOnly = true;
  linkField.value = url;
  linkField.addEventListener("focus", () => linkField.select());
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "ghost-button";
  copyBtn.textContent = "Copier";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      linkField.select();
      document.execCommand("copy");
    }
    copyBtn.textContent = "Copié ✓";
    setTimeout(() => (copyBtn.textContent = "Copier"), 1500);
  });
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "primary-button";
  openBtn.textContent = "Ouvrir";
  openBtn.addEventListener("click", () => window.launcher.openUrl(url));
  linkRow.append(linkField, copyBtn, openBtn);
  body.appendChild(linkRow);

  // Etapes numerotees.
  const list = document.createElement("ol");
  list.className = "gdrive-steps";
  for (const step of steps) {
    const li = document.createElement("li");
    const strong = document.createElement("div");
    strong.className = "gdrive-step-title";
    strong.textContent = step.t;
    const small = document.createElement("div");
    small.className = "gdrive-step-desc";
    small.textContent = step.d;
    li.append(strong, small);
    list.appendChild(li);
  }
  body.appendChild(list);

  const tip = document.createElement("div");
  tip.className = "sync-note";
  tip.innerHTML = "ℹ️ Le « Secret client » n'est pas confidentiel pour ce type d'application, mais Google l'exige pour finaliser la connexion.";
  body.appendChild(tip);

  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions shortcuts-actions";
  const spacer = document.createElement("div");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghost-button";
  close.textContent = "Fermer";
  close.addEventListener("click", () => overlay.remove());
  actions.append(spacer, close);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
  createIcons();
}

async function openSyncModal() {
  let info = { dataDir: "", localDir: "", isCustom: false };
  try {
    info = await window.launcher.getSync();
  } catch {}
  let gstatus = { configured: false, connected: false, clientId: "", email: "", lastSync: 0 };
  try {
    gstatus = await window.launcher.gdriveStatus();
  } catch {}

  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog shortcuts-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="refresh-cw"></i><span>Synchronisation des données</span>';
  dialog.appendChild(header);

  const sub = document.createElement("div");
  sub.className = "changelog-sub";
  sub.textContent = "Retrouve l'historique, les profils/personas et les sessions sur un autre PC : via un dossier déjà synchronisé (OneDrive, Dropbox…) ou directement avec Google Drive.";
  dialog.appendChild(sub);

  const body = document.createElement("div");
  body.className = "changelog-body shortcuts-body";

  const statusRow = document.createElement("div");
  statusRow.className = "sync-status";
  statusRow.innerHTML = info.isCustom
    ? '<span class="sync-badge on">Synchronisé</span>'
    : '<span class="sync-badge off">Stockage local</span>';
  body.appendChild(statusRow);

  const pathLabel = document.createElement("div");
  pathLabel.className = "shortcuts-label";
  pathLabel.textContent = "Emplacement actuel :";
  const pathValue = document.createElement("div");
  pathValue.className = "sync-path";
  pathValue.textContent = info.dataDir || info.localDir || "(inconnu)";
  body.append(pathLabel, pathValue);

  const note = document.createElement("div");
  note.className = "sync-note";
  note.innerHTML = "⚠️ Un seul PC à la fois (sinon conflits cloud). Les identifiants des CLI ne sont pas synchronisés.<br>L'application redémarrera pour appliquer le changement.";
  body.appendChild(note);

  // --- Section Google Drive natif (sans installer Google Drive Desktop) ---
  const gdriveSection = buildGdriveSection(gstatus);
  body.appendChild(gdriveSection);

  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions shortcuts-actions";

  const left = document.createElement("div");
  if (info.isCustom) {
    const disable = document.createElement("button");
    disable.type = "button";
    disable.className = "ghost-button danger";
    disable.textContent = "Revenir au stockage local";
    disable.addEventListener("click", async () => {
      if (!window.confirm("Repasser en stockage local et redémarrer ? Les données synchronisées seront recopiées en local.")) {
        return;
      }
      await window.launcher.disableSync();
    });
    left.appendChild(disable);
  }

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "primary-button";
  choose.textContent = info.isCustom ? "Changer de dossier" : "Choisir un dossier synchronisé";
  choose.addEventListener("click", async () => {
    const folder = await window.launcher.chooseFolder();
    if (!folder) {
      return;
    }
    if (!window.confirm(`Synchroniser les données dans :\n${folder}\n\nL'application va redémarrer.`)) {
      return;
    }
    const res = await window.launcher.setSyncDir(folder);
    if (res && res.ok === false) {
      flashStatus(`Synchronisation impossible : ${res.error || "erreur"}`);
    }
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghost-button";
  close.textContent = "Fermer";
  close.addEventListener("click", () => overlay.remove());

  right.append(choose, close);
  actions.append(left, right);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
  createIcons();
}

function bindEvents() {
  elements.chooseFolderButton.addEventListener("click", async () => {
    updateFolder(await window.launcher.chooseFolder());
  });

  elements.profileSelect.addEventListener("change", () => {
    renderModes();
    renderProfileSettings();
  });

  elements.modeSelect.addEventListener("change", renderProfileSettings);
  elements.personaSelect.addEventListener("change", () => {
    window.localStorage.setItem("lastPersonaId", elements.personaSelect.value || "");
  });
  elements.managePersonasButton.addEventListener("click", openPersonasModal);
  elements.gitChip.addEventListener("click", openGitChanges);
  elements.promptsButton.addEventListener("click", openPrompts);
  elements.jarvisButton.addEventListener("click", openJarvis);
  elements.conversationsButton.addEventListener("click", openConversations);

  elements.restartAiButton.addEventListener("click", () => {
    if (state.activeSessionId) {
      restartSession(state.activeSessionId);
    }
  });

  elements.relaySelect.addEventListener("change", () => {
    const targetId = elements.relaySelect.value;
    elements.relaySelect.value = "";
    if (targetId && state.activeSessionId) {
      relaySession(state.activeSessionId, targetId);
    }
  });
  elements.saveProfileButton.addEventListener("click", saveProfileEdits);
  elements.launchButton.addEventListener("click", launchSession);
  elements.installProfileButton.addEventListener("click", installSelectedProfile);
  elements.refreshAuthButton.addEventListener("click", refreshAuthStatus);
  elements.favoriteProfileButton.addEventListener("click", toggleFavorite);
  elements.addProfileButton.addEventListener("click", addCustomProfile);
  elements.deleteProfileButton.addEventListener("click", deleteCustomProfile);
  elements.docsProfileButton.addEventListener("click", () => {
    const profile = getSelectedProfile();
    if (profile?.docsUrl) {
      window.launcher.openUrl(profile.docsUrl);
    }
  });

  elements.resetProfilesButton.addEventListener("click", async () => {
    state.config = await window.launcher.resetConfig();
    renderProfiles();
    renderPersonas();
    refreshAuthStatus();
  });

  elements.activeTitleInput.addEventListener("input", () => renameActiveSession(elements.activeTitleInput.value));
  elements.renameActiveTabButton.addEventListener("click", () => {
    if (state.activeSessionId) {
      elements.activeTitleInput.focus();
      elements.activeTitleInput.select();
    }
  });
  elements.activeTitleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const session = state.sessions.get(state.activeSessionId);
      window.clearTimeout(session?.renameTimer);
      persistSessionTitle(session);
      elements.activeTitleInput.blur();
    }
  });
  elements.activeTitleInput.addEventListener("blur", () => {
    const session = state.sessions.get(state.activeSessionId);
    window.clearTimeout(session?.renameTimer);
    persistSessionTitle(session);
  });
  elements.toggleSidebarButton.addEventListener("click", () => {
    setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
  });
  elements.historyButton.addEventListener("click", openHistory);
  elements.shortcutsButton.addEventListener("click", openShortcutsModal);
  elements.syncButton.addEventListener("click", openSyncModal);
  elements.splitButton.addEventListener("click", toggleSplit);
  elements.mirrorButton.addEventListener("click", toggleMirror);
  elements.pipelineButton.addEventListener("click", openPipelineTab);
  elements.historyResumeButton.addEventListener("click", resumeFromHistory);
  setupShortcuts();

  elements.updateInstallButton.addEventListener("click", () => {
    elements.updateBannerText.textContent = "Redémarrage pour installer la mise à jour…";
    elements.updateInstallButton.disabled = true;
    window.launcher.installUpdate();
  });
  elements.updateBannerClose.addEventListener("click", () => {
    elements.updateBanner.classList.add("hidden");
  });
  window.launcher.onUpdateStatus(handleUpdateStatus);

  // Synchro Google Drive : si le demarrage a tire des donnees plus recentes,
  // on recharge config + historique sans intervention de l'utilisateur.
  window.launcher.onGdriveSynced((status, pulled) => {
    if (pulled) {
      reloadAfterGdrivePull();
      flashStatus("Données récupérées depuis Google Drive.");
    }
  });

  let historySearchTimer = null;
  elements.historySearchInput.addEventListener("input", () => {
    window.clearTimeout(historySearchTimer);
    historySearchTimer = window.setTimeout(applyHistoryFilter, 220);
  });

  elements.historyClearButton.addEventListener("click", async () => {
    if (!window.confirm("Effacer tout l'historique global ? Cette action est irréversible.")) {
      return;
    }
    try {
      await window.launcher.clearHistory();
    } catch {}
    historyState.entries = [];
    historyState.rawCache.clear();
    historyState.textCache.clear();
    historyState.selectedId = null;
    elements.historyViewerMeta.textContent = "Sélectionne une session à gauche.";
    if (historyState.viewer) {
      historyState.viewer.terminal.reset();
    }
    elements.historyResumeButton.disabled = true;
    renderHistoryList([], "");
  });

  for (const closer of elements.historyModal.querySelectorAll("[data-close-history]")) {
    closer.addEventListener("click", closeHistory);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.historyModal.classList.contains("hidden")) {
      closeHistory();
    }
  });

  window.addEventListener("resize", () => {
    const ids = state.split ? [state.split.leftId, state.split.rightId] : [state.activeSessionId];
    for (const id of ids) {
      const s = state.sessions.get(id);
      if (s) {
        try {
          s.fitAddon.fit();
        } catch {}
      }
    }
    if (!elements.historyModal.classList.contains("hidden")) {
      fitViewerTerminal();
    }
  });

  elements.terminalHost.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.terminalHost.classList.add("dragging");
  });
  elements.terminalHost.addEventListener("dragleave", () => elements.terminalHost.classList.remove("dragging"));
  elements.terminalHost.addEventListener("drop", handleDrop);

  window.launcher.onTerminalData(({ id, data }) => {
    const session = state.sessions.get(id);
    if (session) {
      session.hasOutput = true;
      session.lastOutputAt = Date.now();
      session.terminal.write(data);
    }
  });

  window.launcher.onTerminalExit(({ id, exitCode }) => {
    const session = state.sessions.get(id);
    if (session) {
      // Pendant un relais on coupe volontairement l'IA en cours : on n'affiche
      // pas le message de fin ni l'etat "termine".
      if (session.relaying) {
        return;
      }
      session.terminal.writeln(`\r\n[processus termine: ${exitCode}]`);
      session.tab.classList.add("ended");
    }
  });
}

// Retire les sequences d'echappement ANSI et caracteres de controle pour
// afficher une transcription lisible et cherchable en texte brut.
function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[[\]][0-9;?=]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][AB0-9]/g, "")
    .replace(/\x1b[=>]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function formatHistoryDate(iso) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// Transcription brute (avec codes ANSI) pour l'affichage colore dans xterm.
async function getHistoryRaw(id) {
  if (historyState.rawCache.has(id)) {
    return historyState.rawCache.get(id);
  }
  let raw = "";
  try {
    raw = await window.launcher.readHistory(id);
  } catch {
    raw = "";
  }
  historyState.rawCache.set(id, raw);
  return raw;
}

// Version texte (sans ANSI) pour la recherche dans le contenu.
function getHistorySearchText(id, raw) {
  if (historyState.textCache.has(id)) {
    return historyState.textCache.get(id);
  }
  const text = stripAnsi(raw);
  historyState.textCache.set(id, text);
  return text;
}

function ensureViewerTerminal() {
  if (historyState.viewer) {
    return historyState.viewer;
  }
  const viewer = createViewerTerminal();
  viewer.terminal.open(elements.historyViewerContent);
  historyState.viewer = viewer;
  return viewer;
}

function fitViewerTerminal() {
  if (historyState.viewer) {
    try {
      historyState.viewer.fitAddon.fit();
    } catch {}
  }
}

function matchesHistoryMeta(entry, query) {
  if (!query) {
    return true;
  }
  return [entry.title, entry.cwd, entry.command, entry.profileLabel, entry.modeLabel]
    .some((field) => String(field || "").toLowerCase().includes(query));
}

function renderHistoryList(entries, query) {
  elements.historyList.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = query ? "Aucune session ne correspond." : "Aucune session enregistrée pour l'instant.";
    elements.historyList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const profile = state.config?.profiles.find((p) => p.id === entry.profileId);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "history-row";
    row.classList.toggle("active", entry.id === historyState.selectedId);
    row.addEventListener("click", (event) => {
      if (event.target.closest(".history-delete")) {
        deleteHistoryEntry(entry.id);
        return;
      }
      selectHistoryEntry(entry.id);
    });

    const dot = document.createElement("span");
    dot.className = "history-dot";
    dot.style.background = profile?.accent || "#10b981";

    const main = document.createElement("div");
    main.className = "history-row-main";

    const title = document.createElement("div");
    title.className = "history-row-title";
    title.textContent = entry.title || "Session";

    const meta = document.createElement("div");
    meta.className = "history-row-meta";
    const labelBits = [entry.profileLabel, entry.modeLabel].filter(Boolean).join(" · ");
    meta.textContent = `${labelBits || "CLI"} — ${formatHistoryDate(entry.startedAt)}`;

    const sub = document.createElement("div");
    sub.className = "history-row-sub";
    sub.textContent = entry.cwd || "";

    main.append(title, meta, sub);
    row.append(dot, main);

    if (state.sessions.has(entry.id)) {
      const badge = document.createElement("span");
      badge.className = "history-badge";
      badge.textContent = "en cours";
      row.appendChild(badge);
    }

    const del = document.createElement("span");
    del.className = "history-delete";
    del.title = "Supprimer cette session";
    del.innerHTML = '<i data-lucide="trash-2"></i>';
    row.appendChild(del);

    fragment.appendChild(row);
  }
  elements.historyList.appendChild(fragment);
  createIcons();
}

async function deleteHistoryEntry(id) {
  const entry = historyState.entries.find((item) => item.id === id);
  if (!entry) {
    return;
  }
  if (!window.confirm(`Supprimer définitivement la session « ${entry.title || "Session"} » de l'historique ?`)) {
    return;
  }

  try {
    await window.launcher.deleteHistory(id);
  } catch {}

  historyState.entries = historyState.entries.filter((item) => item.id !== id);
  historyState.rawCache.delete(id);
  historyState.textCache.delete(id);

  if (historyState.selectedId === id) {
    historyState.selectedId = null;
    elements.historyViewerMeta.textContent = "Sélectionne une session à gauche.";
    elements.historyResumeButton.disabled = true;
    if (historyState.viewer) {
      historyState.viewer.terminal.reset();
    }
  }

  const query = elements.historySearchInput.value.toLowerCase().trim();
  renderHistoryList(
    historyState.entries.filter((e) => matchesHistoryMeta(e, query)),
    query
  );
}

async function applyHistoryFilter() {
  const query = elements.historySearchInput.value.toLowerCase().trim();
  let matched = historyState.entries.filter((entry) => matchesHistoryMeta(entry, query));

  renderHistoryList(matched, query);

  // Recherche dans le contenu des transcriptions (lazy + cache) : on complete
  // la liste avec les sessions dont le texte contient la requete.
  if (query.length >= 2) {
    const remaining = historyState.entries.filter((entry) => !matchesHistoryMeta(entry, query));
    const extra = [];
    for (const entry of remaining) {
      const raw = await getHistoryRaw(entry.id);
      // La requete a pu changer pendant la lecture : on verifie toujours l'actuelle.
      if (elements.historySearchInput.value.toLowerCase().trim() !== query) {
        return;
      }
      const text = getHistorySearchText(entry.id, raw);
      if (text.toLowerCase().includes(query)) {
        extra.push(entry);
      }
    }
    if (extra.length) {
      const byStart = (a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || ""));
      matched = [...matched, ...extra].sort(byStart);
      renderHistoryList(matched, query);
    }
  }
}

async function selectHistoryEntry(id) {
  historyState.selectedId = id;
  const entry = historyState.entries.find((item) => item.id === id);
  if (!entry) {
    return;
  }

  for (const row of elements.historyList.querySelectorAll(".history-row")) {
    row.classList.remove("active");
  }

  const labelBits = [entry.profileLabel, entry.modeLabel].filter(Boolean).join(" · ");
  elements.historyViewerMeta.textContent =
    `${entry.title || "Session"} — ${labelBits} — ${entry.cwd || ""} — ${formatHistoryDate(entry.startedAt)}`;
  elements.historyResumeButton.disabled = !state.config?.profiles.some((p) => p.id === entry.profileId);

  const viewer = ensureViewerTerminal();
  viewer.terminal.reset();
  fitViewerTerminal();

  const raw = await getHistoryRaw(id);
  if (historyState.selectedId !== id) {
    return;
  }
  viewer.terminal.reset();
  viewer.terminal.write(raw || "\x1b[2m(transcription vide)\x1b[0m");
  setTimeout(() => viewer.terminal.scrollToBottom(), 30);

  for (const row of elements.historyList.querySelectorAll(".history-row")) {
    row.classList.remove("active");
  }
  renderHistoryList(
    historyState.entries.filter((e) => matchesHistoryMeta(e, elements.historySearchInput.value.toLowerCase().trim())),
    elements.historySearchInput.value.toLowerCase().trim()
  );
}

async function openHistory() {
  historyState.entries = [];
  historyState.rawCache.clear();
  historyState.textCache.clear();
  historyState.selectedId = null;
  elements.historyViewerMeta.textContent = "Sélectionne une session à gauche.";
  elements.historyResumeButton.disabled = true;
  elements.historySearchInput.value = "";

  try {
    historyState.entries = await window.launcher.getHistory();
  } catch {
    historyState.entries = [];
  }

  renderHistoryList(historyState.entries, "");
  elements.historyModal.classList.remove("hidden");
  createIcons();

  // Le terminal doit etre cree/ajuste une fois la modale visible.
  const viewer = ensureViewerTerminal();
  viewer.terminal.reset();
  setTimeout(() => {
    fitViewerTerminal();
    elements.historySearchInput.focus();
  }, 40);
}

function closeHistory() {
  elements.historyModal.classList.add("hidden");
}

async function resumeFromHistory() {
  const entry = historyState.entries.find((item) => item.id === historyState.selectedId);
  if (!entry) {
    return;
  }
  closeHistory();
  await restoreSession({
    id: entry.id,
    title: entry.title,
    commandLine: entry.command,
    cwd: entry.cwd,
    extraArgs: "",
    profileId: entry.profileId,
    profileLabel: entry.profileLabel,
    modeId: entry.modeId,
    modeLabel: entry.modeLabel
  });
}

function handleUpdateStatus(payload) {
  const banner = elements.updateBanner;
  const installBtn = elements.updateInstallButton;
  const st = payload?.state;
  const manual = Boolean(payload?.manual);

  // Verifications automatiques en arriere-plan : on reste silencieux pour
  // "checking" et "none". Une verification manuelle (menu) affiche un retour.
  if ((st === "checking" || st === "none") && !manual) {
    return;
  }

  installBtn.classList.add("hidden");
  banner.classList.remove("hidden", "error");

  if (st === "checking") {
    elements.updateBannerText.textContent = "Recherche de mises à jour…";
  } else if (st === "none") {
    elements.updateBannerText.textContent =
      `Vous avez déjà la dernière version (${state.app?.appVersion || ""}).`;
    window.setTimeout(() => banner.classList.add("hidden"), 6000);
  } else if (st === "dev") {
    banner.classList.add("error");
    elements.updateBannerText.textContent =
      "Vérification disponible uniquement dans la version installée (pas en mode développement).";
    window.setTimeout(() => banner.classList.add("hidden"), 6000);
  } else if (st === "available") {
    elements.updateBannerText.textContent =
      `Mise à jour ${payload.version || ""} disponible — téléchargement en cours…`;
  } else if (st === "downloading") {
    elements.updateBannerText.textContent = `Téléchargement de la mise à jour… ${payload.percent || 0}%`;
  } else if (st === "downloaded") {
    elements.updateBannerText.textContent = `Mise à jour ${payload.version || ""} prête à être installée.`;
    installBtn.classList.remove("hidden");
  } else if (st === "error") {
    banner.classList.add("error");
    elements.updateBannerText.textContent = `Échec de la mise à jour : ${payload.message || "inconnue"}`;
    window.setTimeout(() => banner.classList.add("hidden"), 8000);
  }

  createIcons();
}

// --- JARVIS (easter egg) ------------------------------------------------------
// Interface alternative facon Iron Man. Le module peut etre installe depuis
// l'installateur Windows ou depuis ce bouton ; l'etat est garde par le
// processus principal (src/main/jarvis.js).
const JARVIS_SOUNDS = {
  intro: "./jarvis/sounds/bonjour-jarvis.wav"
};
// Video de la cinematique, a renseigner quand l'animation sera prete (ex.
// "./jarvis/intro.mp4") ; vide = animation HUD generee en CSS.
const JARVIS_INTRO_VIDEO = "";
const JARVIS_INTRO_FALLBACK_MS = 8000;
const JARVIS_INTRO_MAX_MS = 20000;

const jarvis = { installed: false, active: false, playing: false };

// Reglages de la voix (voix choisie, debit, grave, effets), par PC.
// engine : "tom" (Piper, processeur) ou "quality" (Qwen3-TTS, carte graphique).
// La voix qualite, deja grave, a ses propres reglages d'effets (q*).
const JARVIS_VOICE_DEFAULTS = { engine: "tom", voice: "tom", speed: 1.15, pitch: 0.14, metal: 0.35, echo: 0.3, qPitch: 0, qMetal: 0.2, qEcho: 0.2 };

function loadJarvisVoiceSettings() {
  try {
    return { ...JARVIS_VOICE_DEFAULTS, ...JSON.parse(window.localStorage.getItem("jarvisVoice") || "{}") };
  } catch {
    return { ...JARVIS_VOICE_DEFAULTS };
  }
}

// Effets du moteur choisi (pitch, metal, echo).
function jarvisVoiceFx(settings) {
  return settings.engine === "quality" ? { ...settings, pitch: settings.qPitch, metal: settings.qMetal, echo: settings.qEcho } : settings;
}

function saveJarvisVoiceSettings(settings) {
  window.localStorage.setItem("jarvisVoice", JSON.stringify(settings));
}

// Traitement "IA" de la voix : leger filtre radio, resonance metallique (filtre
// en peigne : retard tres court reinjecte) et echo. Renvoie le noeud de sortie.
function buildJarvisVoiceChain(ctx, source, settings) {
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 110;
  source.connect(highpass);

  const mix = ctx.createGain();
  highpass.connect(mix);

  const comb = ctx.createDelay(0.05);
  comb.delayTime.value = 0.011;
  const combFeedback = ctx.createGain();
  combFeedback.gain.value = 0.6 * settings.metal;
  const combWet = ctx.createGain();
  combWet.gain.value = 0.7 * settings.metal;
  highpass.connect(comb);
  comb.connect(combFeedback);
  combFeedback.connect(comb);
  comb.connect(combWet);
  combWet.connect(mix);

  const output = ctx.createGain();
  mix.connect(output);

  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.13;
  const echoFeedback = ctx.createGain();
  echoFeedback.gain.value = 0.3 * settings.echo;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0.4 * settings.echo;
  mix.connect(echo);
  echo.connect(echoFeedback);
  echoFeedback.connect(echo);
  echo.connect(echoWet);
  echoWet.connect(output);

  return output;
}

// --- Voix de JARVIS dans l'interface : lecture des reponses et dictee --------
// Le reacteur de la barre d'outils (jarvis.core, en mode JARVIS) montre l'etat :
// ecoute pendant la dictee, reflexion pendant le calcul, parole pendant la lecture.
const jarvisVoice = { context: null, token: 0, audio: null, speaking: false };

function jarvisAudioContext() {
  jarvisVoice.context ??= new AudioContext();
  return jarvisVoice.context;
}

// Meme etat pour le reacteur de la barre d'outils et le grand reacteur central.
function setJarvisCoreState(stateName, analyser = null) {
  for (const core of [jarvis.core, jarvisHud.core]) {
    core?.setState(stateName);
    core?.setAnalyser(analyser);
  }
}

function isJarvisAutoRead() {
  return window.localStorage.getItem("jarvisAutoRead") === "1";
}

function toggleJarvisAutoRead() {
  const next = !isJarvisAutoRead();
  window.localStorage.setItem("jarvisAutoRead", next ? "1" : "0");
  flashStatus(next ? "JARVIS lira chaque réponse de l'IA" : "Lecture automatique des réponses désactivée");
}

// Markdown -> texte a dire : le code n'est pas lu, la mise en forme est retiree.
// phonetic : orthographe adaptee a Tom (la voix qualite lit l'anglais telle quelle).
function textForSpeech(markdown, phonetic = true) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, "\n(bloc de code)\n")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "lien")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(\S[^\n]*?)\1/g, "$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => window.JarvisPronounce.pronounce(line, { phonetic }))
    .join("\n")
    .trim();
}

// Decoupe en morceaux de quelques phrases : le premier est dit rapidement et
// les suivants sont generes pendant la lecture.
function splitForSpeech(text) {
  const sentences = text.split(/(?<=[.!?…:])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 260) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function stopJarvisSpeech() {
  jarvisVoice.token += 1;
  jarvisVoice.audio?.pause();
  jarvisVoice.audio = null;
  jarvisVoice.player?.stop();
  jarvisVoice.player = null;
  window.speechSynthesis?.cancel();
  if (jarvisVoice.speaking) {
    jarvisVoice.speaking = false;
    setJarvisCoreState("idle");
    if (jarvisListener.mode !== "command") {
      hideJarvisHud();
    }
  }
}

function playJarvisChunk(bytes, settings) {
  return new Promise((resolve) => {
    const ctx = jarvisAudioContext();
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const audio = new Audio(url);
    audio.preservesPitch = false;
    audio.playbackRate = 1 - settings.pitch;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    buildJarvisVoiceChain(ctx, ctx.createMediaElementSource(audio), settings).connect(analyser);
    analyser.connect(ctx.destination);
    jarvisVoice.audio = audio;
    setJarvisCoreState("speaking", analyser);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("pause", done);
    audio.play().catch(done);
  });
}

function speakWithWindowsVoice(text) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.onend = resolve;
    utterance.onerror = resolve;
    setJarvisCoreState("speaking");
    window.speechSynthesis.speak(utterance);
  });
}

// --- Voix qualite (Qwen3-TTS sur carte graphique) : audio recu en flux --------
const qualityStreams = new Map();
let qualityRequestId = 0;
window.launcher.onQualityVoiceChunk((chunk) => qualityStreams.get(chunk.id)?.(chunk));

// Lecteur en flux : enchaine les morceaux d'audio sans blanc, a travers les
// effets de JARVIS. say() se resout quand la phrase est generee (la suivante
// est alors demandee pendant la lecture), finished() a la fin du son.
function createQualityPlayer(ctx, settings) {
  const fx = jarvisVoiceFx(settings);
  const rate = 1 - fx.pitch;
  const input = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  buildJarvisVoiceChain(ctx, input, fx).connect(analyser);
  analyser.connect(ctx.destination);
  const sources = new Set();
  let at = 0;
  let stopped = false;
  return {
    analyser,
    say(text, onPlay) {
      const id = (qualityRequestId += 1);
      let first = true;
      qualityStreams.set(id, ({ sampleRate, pcm }) => {
        if (stopped) {
          return;
        }
        const samples = new Int16Array(new Uint8Array(pcm).buffer);
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i += 1) {
          data[i] = samples[i] / 32768;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        source.connect(input);
        source.onended = () => sources.delete(source);
        // Petite avance pour absorber les irregularites du flux.
        at = Math.max(at, ctx.currentTime + 0.1);
        if (first) {
          first = false;
          window.setTimeout(() => !stopped && onPlay?.(analyser), (at - ctx.currentTime) * 1000);
        }
        source.start(at);
        sources.add(source);
        at += buffer.duration / rate;
      });
      return window.launcher
        .qualityVoiceSpeak(id, text)
        .catch((error) => ({ error: error.message }))
        .finally(() => qualityStreams.delete(id));
    },
    finished() {
      return new Promise((resolve) => {
        const check = () => (stopped || ctx.currentTime >= at + 0.3 ? resolve() : window.setTimeout(check, 100));
        check();
      });
    },
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      window.launcher.qualityVoiceStop();
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // deja termine
        }
      }
      sources.clear();
    }
  };
}

// Lit les morceaux avec la voix qualite. Renvoie false si elle n'a rien pu dire
// (pack absent, carte indisponible...) : Tom prend alors le relais.
async function speakJarvisQuality(chunks, settings, token) {
  const player = createQualityPlayer(jarvisAudioContext(), settings);
  jarvisVoice.player = player;
  let spoken = false;
  for (const chunk of chunks) {
    const result = await player.say(chunk, (analyser) => {
      if (token === jarvisVoice.token) {
        showJarvisHud("JARVIS", chunk, true);
        setJarvisCoreState("speaking", analyser);
      }
    });
    if (token !== jarvisVoice.token) {
      return true;
    }
    if (result?.error) {
      jarvisLog(`voix qualite : ${result.error}`);
      if (!spoken) {
        player.stop();
        return false;
      }
      break;
    }
    spoken = true;
  }
  await player.finished();
  return true;
}

// Dit un texte avec la voix de JARVIS (interrompt la lecture en cours).
async function speakJarvis(text) {
  stopJarvisSpeech();
  const token = jarvisVoice.token;
  const settings = loadJarvisVoiceSettings();
  const quality = settings.engine === "quality";
  let chunks = splitForSpeech(textForSpeech(text, !quality));
  if (!chunks.length) {
    return;
  }
  jarvisVoice.speaking = true;
  showJarvisHud("JARVIS", chunks[0], true);
  setJarvisCoreState("thinking");
  if (quality) {
    const done = await speakJarvisQuality(chunks, settings, token);
    if (token !== jarvisVoice.token) {
      return;
    }
    chunks = done ? [] : splitForSpeech(textForSpeech(text, true));
  }
  const synth = (chunk) =>
    window.launcher.voiceSpeak({ text: chunk, voiceId: settings.voice, lengthScale: (1 - settings.pitch) / settings.speed });
  let next = chunks.length ? synth(chunks[0]).catch(() => null) : null;
  for (let i = 0; i < chunks.length; i += 1) {
    const result = await next;
    if (token !== jarvisVoice.token) {
      return;
    }
    next = i + 1 < chunks.length ? synth(chunks[i + 1]).catch(() => null) : null;
    showJarvisHud("JARVIS", chunks[i], true);
    if (result?.audio) {
      await playJarvisChunk(result.audio, settings);
    } else {
      await speakWithWindowsVoice(chunks[i]);
    }
    if (token !== jarvisVoice.token) {
      return;
    }
  }
  jarvisVoice.player = null;
  jarvisVoice.speaking = false;
  setJarvisCoreState("idle");
  hideJarvisHud(600);
}

async function jarvisReadReply(session = state.sessions.get(state.activeSessionId), auto = false) {
  if (!jarvis.active) {
    if (!auto) {
      flashStatus("Active JARVIS (bouton réacteur) pour la lecture à voix haute");
    }
    return;
  }
  if (!session || session.type !== "terminal") {
    return;
  }
  let reply = null;
  for (let attempt = 0; attempt < (auto ? 8 : 3); attempt += 1) {
    if (attempt) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
    reply = await window.launcher.getLastReply(session.id);
    if (reply?.text && !(auto && reply.id && reply.id === session.lastSpokenReplyId)) {
      break;
    }
  }
  if (!reply?.text) {
    jarvisLog(`lecture : aucune reponse (${reply?.error || "?"} ; ${auto ? "auto" : "manuel"}, onglet « ${session.title} », profil ${sessionProfileId(session)})`);
    if (!auto) {
      flashStatus("Aucune réponse à lire (lecture disponible pour Claude et Codex)");
    }
    return;
  }
  jarvisLog(`lecture : ${reply.text.length} caracteres (${auto ? "auto" : "manuel"})`);
  if (auto && reply.id && reply.id === session.lastSpokenReplyId) {
    return;
  }
  session.lastSpokenReplyId = reply.id;
  speakJarvis(reply.text);
}

// Fin d'un tour de l'IA dans l'onglet affiche : lecture si l'option est active.
function jarvisAutoReadReply(session) {
  if (!jarvis.active || !isJarvisAutoRead()) {
    return;
  }
  if (jarvisListener.mode === "command") {
    jarvisLog("lecture auto ignoree : ecoute d'une demande en cours");
    return;
  }
  jarvisReadReply(session, true);
}

// --- Ecoute vocale : mot d'activation, commande, envoi automatique ----------
// Le micro est capte en continu en mode JARVIS (si l'option est active) et
// analyse localement, rien n'est envoye en ligne :
//  - le detecteur openWakeWord (« Hey Jarvis ») analyse chaque bloc de 80 ms ;
//  - en secours, un detecteur de voix decoupe les phrases et Whisper cherche
//    « Jarvis » dans leur transcription (prononciations a la francaise).
//  - veille   : on attend « JARVIS » (seul, ou suivi directement de la demande) ;
//  - commande : le grand reacteur s'affiche, la demande est transcrite des que
//               l'utilisateur se tait, puis envoyee a l'IA de l'onglet.
// Whisper ecrit le mot de bien des facons : Jarvis, J'arvis, Djarvis, Jervis...
const WAKE_WORD = /(?<![\p{L}])(d?[jg]|dz)['’\s-]?[ae]r?[\s-]?v[iy]\p{L}{0,3}(?![\p{L}])/iu;
const LEADING_WAKE_WORDS = new RegExp(String.raw`^(?:[\s,.!?:;-]*(?:(?:hey|h[eéè]|eh|et|ok|okay|dis|dit|dix)[\s,]+)?(?:${WAKE_WORD.source}))+[\s,.!?:;-]*`, "iu");
const TRAILING_WAKE_WORD = new RegExp(String.raw`[\s,.!?:;-]+(?:${WAKE_WORD.source})[\s,.!?:;-]*$`, "iu");

// « Jarvis, Jarvis, explique ce fichier » -> « explique ce fichier ».
function stripWakeWords(text) {
  return text.replace(LEADING_WAKE_WORDS, "").replace(TRAILING_WAKE_WORD, "").trim();
}

// Phrases que Whisper invente sur du silence ou du souffle (« J'avis. » vient
// de l'indice « JARVIS ») : jamais envoyees a l'IA.
const WHISPER_HALLUCINATION = /^[\s.!?…-]*(?:j['’\s]?avis|sous-titr\p{L}*\b.*|merci d'avoir regard\p{L}*.*|abonnez-vous.*|au revoir)?[\s.!?…-]*$/iu;

function isWhisperHallucination(text) {
  // Sur un bruit, Whisper recopie parfois le vocabulaire qu'on lui a donne.
  const words = text.toLowerCase().match(/[\p{L}]{3,}/gu) || [];
  const prompt = JARVIS_DICTATION_PROMPT.toLowerCase();
  if (words.length >= 5 && words.filter((word) => prompt.includes(word)).length / words.length > 0.8) {
    return true;
  }
  return WHISPER_HALLUCINATION.test(text);
}
const VAD = {
  minThreshold: 0.012,
  startMs: 80,
  minSpeechMs: 250, // en dessous, bruit bref (clic, souffle) : pas de transcription
  wakeSilenceMs: 700,
  commandSilenceMs: 1100,
  commandTimeoutMs: 7000,
  maxSegmentMs: 30000,
  preRollMs: 450,
  wakeScore: 0.3,
  // openWakeWord seul ne suffit qu'au-dessus de ce score, et seulement si une
  // voix vient d'etre entendue ; en dessous, Whisper doit confirmer « Jarvis »
  // (evite les declenchements sur un silence ou un « d'accord »).
  wakeStrongScore: 0.6,
  wakeVoiceWindowMs: 1500,
  wakeCooldownMs: 1500
};

// Vocabulaire donne a Whisper pour le texte des demandes : ces mots sont
// ensuite ecrits correctement (ex. « features » et non « fiatures »).
const JARVIS_DICTATION_PROMPT =
  "Demande à une IA de programmation (Claude, Codex) : features, commit, push, pull request, build, release, bug, fix, refactor, npm, GitHub, API, frontend, backend.";

// Journal de diagnostic (userData/jarvis-ecoute.log).
function jarvisLog(message) {
  try {
    window.launcher.voiceLog(message);
  } catch {}
}

// Lexique personnel (noms propres), une entree par ligne.
function jarvisLexicon() {
  return (window.localStorage.getItem("jarvisLexicon") || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

// Noms propres de la conversation en cours (derniere reponse de l'IA, titre
// de l'onglet, dossier) : la dictee les reconnait sans rien configurer.
// Un mot en majuscule en debut de phrase n'est pas retenu (« Voici », « Le »).
function extractProperNouns(text) {
  const counts = new Map();
  const pattern = /\p{Lu}[\p{L}]+(?:[-'’][\p{L}]+)*/gu;
  for (const match of String(text).matchAll(pattern)) {
    const before = String(text).slice(0, match.index).trimEnd();
    if (!before || /[.!?:\n#*>-]$/.test(before) || match[0].length < 4) {
      continue;
    }
    counts.set(match[0], (counts.get(match[0]) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

async function refreshJarvisContext(session) {
  if (!session) {
    return;
  }
  const reply = await window.launcher.getLastReply(session.id).catch(() => null);
  const folder = String(session.cwd || "").split(/[\\/]/).filter(Boolean).pop() || "";
  jarvisListener.contextWords = [...new Set([...extractProperNouns(reply?.text || ""), session.title, folder].filter((word) => word && word.length >= 4))].slice(0, 25);
}

// Lexique personnel d'abord, puis vocabulaire de la conversation.
function jarvisVocabulary() {
  return [...new Set([...jarvisLexicon(), ...(jarvisListener.contextWords || [])])];
}

// Vocabulaire technique + noms propres connus, donnes a Whisper.
function jarvisDictationPrompt() {
  const words = jarvisVocabulary();
  return words.length ? `${JARVIS_DICTATION_PROMPT} ${words.join(", ")}.` : JARVIS_DICTATION_PROMPT;
}

// Corrige les noms propres mal reconnus (ils « sonnent » comme un mot connu).
function correctDictation(text) {
  const corrected = window.JarvisLexicon.apply(text, jarvisVocabulary());
  if (corrected.fixes.length) {
    jarvisLog(`correction : ${corrected.fixes.join(" ; ")}`);
  }
  return corrected.text;
}

// Mention ajoutee aux demandes dictees : l'IA comprend les mots mal reconnus
// sans demander « tu voulais dire… ? ».
const JARVIS_DICTATION_NOTE = "(dictée vocale : des mots peuvent être mal reconnus, comprends le sens voulu sans le signaler)";

function isJarvisDictationNote() {
  return window.localStorage.getItem("jarvisDictationNote") !== "0";
}

function isJarvisAutoSend() {
  return window.localStorage.getItem("jarvisAutoSend") !== "0";
}

function isJarvisWakeWordEnabled() {
  return window.localStorage.getItem("jarvisWakeWord") !== "0";
}

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && (jarvisHud.element || jarvisListener.mode === "command")) {
      event.preventDefault();
      event.stopPropagation();
      cancelJarvisInteraction();
    }
  },
  true
);

// Petit signal sonore (debut d'ecoute / envoi).
function jarvisChime(up = true) {
  const ctx = jarvisAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(up ? 660 : 880, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(up ? 990 : 550, ctx.currentTime + 0.14);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.25);
}

// --- Grand reacteur au centre (HUD) ---
const jarvisHud = { element: null, core: null, hideTimer: null };

// passive : pendant la lecture, l'interface reste utilisable (seul le
// reacteur capte le clic).
function showJarvisHud(stateText, text = "", passive = false) {
  window.clearTimeout(jarvisHud.hideTimer);
  if (!jarvisHud.element) {
    const hud = document.createElement("div");
    hud.className = "jarvis-hud";
    hud.innerHTML = `
      <div class="jh-core"></div>
      <div class="jh-state"></div>
      <div class="jh-text"></div>
      <div class="jh-hint">Échap ou clic pour annuler</div>`;
    hud.addEventListener("click", (event) => {
      if (!hud.classList.contains("passive") || event.target.closest(".jh-core")) {
        cancelJarvisInteraction();
      }
    });
    document.body.appendChild(hud);
    const size = Math.round(Math.min(380, window.innerHeight * 0.45));
    jarvisHud.core = new window.JarvisCore(hud.querySelector(".jh-core"), { size });
    jarvisHud.element = hud;
    requestAnimationFrame(() => hud.classList.add("visible"));
  }
  jarvisHud.element.classList.toggle("passive", passive);
  jarvisHud.element.querySelector(".jh-state").textContent = stateText;
  jarvisHud.element.querySelector(".jh-text").textContent = text;
}

function hideJarvisHud(delay = 0) {
  window.clearTimeout(jarvisHud.hideTimer);
  jarvisHud.hideTimer = window.setTimeout(() => {
    const { element, core } = jarvisHud;
    if (!element) {
      return;
    }
    jarvisHud.element = null;
    jarvisHud.core = null;
    element.classList.remove("visible");
    window.setTimeout(() => {
      core.destroy();
      element.remove();
    }, 300);
  }, delay);
}

// --- Capture du micro et detection de la voix ---
const jarvisListener = {
  stream: null,
  source: null,
  processor: null,
  analyser: null,
  mode: "off", // off | wake | command
  busy: false,
  noise: 0.01,
  segment: null,
  preRoll: [],
  loudMs: 0,
  quietMs: 0,
  lastVoiceAt: 0,
  contextWords: [], // noms propres de la conversation (dictee)
  commandStartedAt: 0,
  target: null,
  queue: [], // phrases terminees en attente de transcription
  starting: null,
  ctx: null, // contexte audio 16 kHz dedie au micro
  detector: null, // openWakeWord, charge une fois
  detectorLoading: null,
  detectorChain: Promise.resolve(),
  detectorPending: 0,
  wakeCooldownUntil: 0,
  stats: { since: 0, maxRms: 0, maxScore: 0, blocks: 0 },
  heard: [] // dernieres phrases entendues en veille (diagnostic dans les reglages)
};

function startJarvisListener() {
  if (jarvisListener.stream) {
    return Promise.resolve(true);
  }
  jarvisListener.starting ??= openJarvisMicrophone().finally(() => {
    jarvisListener.starting = null;
  });
  return jarvisListener.starting;
}

async function openJarvisMicrophone() {
  try {
    jarvisListener.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch {
    flashStatus("Micro indisponible : vérifie l'accès au micro dans les paramètres de Windows");
    return false;
  }
  // Contexte a 16 kHz : le navigateur reechantillonne le micro au format
  // attendu par openWakeWord et Whisper.
  jarvisListener.ctx ??= new AudioContext({ sampleRate: 16000 });
  const ctx = jarvisListener.ctx;
  ctx.resume();
  jarvisListener.source = ctx.createMediaStreamSource(jarvisListener.stream);
  jarvisListener.analyser = ctx.createAnalyser();
  jarvisListener.analyser.fftSize = 256;
  jarvisListener.processor = ctx.createScriptProcessor(1024, 1, 1);
  jarvisListener.processor.onaudioprocess = (event) => onJarvisAudio(event.inputBuffer.getChannelData(0), ctx.sampleRate);
  jarvisListener.source.connect(jarvisListener.analyser);
  jarvisListener.source.connect(jarvisListener.processor);
  // Sortie muette : le processeur doit etre relie a la destination pour tourner.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  jarvisListener.processor.connect(mute).connect(ctx.destination);
  jarvisListener.mode = "wake";
  jarvisListener.stats = { since: Date.now(), maxRms: 0, maxScore: 0, blocks: 0 };
  document.body.classList.add("jarvis-wake");
  const track = jarvisListener.stream.getAudioTracks()[0];
  jarvisLog(`micro ouvert : ${track?.label || "?"} ; contexte ${ctx.sampleRate} Hz (${ctx.state})`);
  loadWakeDetector();
  return true;
}

async function loadWakeDetector() {
  if (jarvisListener.detector || jarvisListener.detectorLoading) {
    return jarvisListener.detectorLoading;
  }
  jarvisListener.detectorLoading = (async () => {
    try {
      const assets = await window.launcher.voiceWakeword();
      if (!assets) {
        jarvisLog("openWakeWord absent : detection par Whisper seulement");
        return;
      }
      if (!window.ort) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = `${assets.ortUrl}ort.wasm.min.js`;
          script.onload = resolve;
          script.onerror = () => reject(new Error("onnxruntime-web introuvable"));
          document.head.appendChild(script);
        });
      }
      window.ort.env.wasm.wasmPaths = assets.ortUrl;
      window.ort.env.wasm.numThreads = 1;
      jarvisListener.detector = await window.WakeWordDetector.create(window.ort, assets.models);
      jarvisLog("openWakeWord pret");
    } catch (error) {
      jarvisLog(`openWakeWord indisponible : ${error?.message || error}`);
    } finally {
      jarvisListener.detectorLoading = null;
    }
  })();
  return jarvisListener.detectorLoading;
}

// Bloc de micro -> score « Hey Jarvis » (traitement en file, sans retard cumule).
function runWakeDetector(samples) {
  const listener = jarvisListener;
  if (!listener.detector || listener.mode !== "wake" || Date.now() < listener.wakeCooldownUntil) {
    return;
  }
  if (listener.detectorPending > 6) {
    return;
  }
  listener.detectorPending += 1;
  listener.detectorChain = listener.detectorChain
    .then(() => listener.detector.process(samples))
    .then(({ hey: score }) => {
      listener.stats.maxScore = Math.max(listener.stats.maxScore, score);
      if (score >= VAD.wakeScore && listener.mode === "wake" && Date.now() >= listener.wakeCooldownUntil) {
        const voiceHeard = Date.now() - listener.lastVoiceAt <= VAD.wakeVoiceWindowMs;
        if (score < VAD.wakeStrongScore || !voiceHeard) {
          // Whisper tranchera a la fin de la phrase (WAKE_WORD).
          listener.wakeCooldownUntil = Date.now() + VAD.wakeCooldownMs;
          jarvisLog(`openWakeWord ${score.toFixed(2)} ${voiceHeard ? "trop faible" : "sans voix entendue"} : confirmation par Whisper`);
          return;
        }
        jarvisLog(`mot d'activation detecte (openWakeWord, score ${score.toFixed(2)})`);
        listener.wakeCooldownUntil = Date.now() + VAD.wakeCooldownMs;
        listener.detector.reset();
        // Les phrases precedentes ne sont pas la demande.
        listener.queue = [];
        beginJarvisCommand(jarvisCommandTarget());
      }
    })
    .catch((error) => jarvisLog(`erreur openWakeWord : ${error?.message || error}`))
    .finally(() => {
      listener.detectorPending -= 1;
    });
}

// Statistiques toutes les 10 s dans le journal (niveau du micro, meilleur score).
function logListenerStats(rms, threshold) {
  const stats = jarvisListener.stats;
  stats.maxRms = Math.max(stats.maxRms, rms);
  stats.blocks += 1;
  if (Date.now() - stats.since >= 10000) {
    jarvisLog(
      `niveau max ${stats.maxRms.toFixed(3)} ; seuil ${threshold.toFixed(3)} ; bruit ${jarvisListener.noise.toFixed(4)} ; meilleur score openWakeWord ${stats.maxScore.toFixed(2)} ; mode ${jarvisListener.mode}${jarvisVoice.speaking ? " (parle)" : ""}`
    );
    jarvisListener.stats = { since: Date.now(), maxRms: 0, maxScore: 0, blocks: 0 };
  }
}

function stopJarvisListener() {
  jarvisListener.mode = "off";
  jarvisListener.segment = null;
  jarvisListener.queue = [];
  document.body.classList.remove("jarvis-wake", "jarvis-dictating");
  jarvisListener.processor?.disconnect();
  jarvisListener.source?.disconnect();
  jarvisListener.stream?.getTracks().forEach((track) => track.stop());
  Object.assign(jarvisListener, { stream: null, source: null, processor: null, analyser: null, busy: false });
  jarvisLog("micro ferme");
}

// Ecoute du mot d'activation selon l'option (appele a chaque changement).
function syncJarvisListener() {
  if (jarvis.active && isJarvisWakeWordEnabled()) {
    startJarvisListener();
  } else if (jarvisListener.mode === "wake") {
    stopJarvisListener();
  }
}

// La capture continue pendant la transcription : les phrases terminees
// attendent leur tour (sinon « Jarvis » dit pendant un calcul etait perdu).
function onJarvisAudio(samples, sampleRate) {
  const listener = jarvisListener;
  if (listener.mode === "off" || jarvisVoice.speaking) {
    listener.segment = null;
    return;
  }
  const blockMs = (samples.length / sampleRate) * 1000;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  const threshold = Math.max(VAD.minThreshold, listener.noise * 3);
  if (rms > threshold) {
    listener.lastVoiceAt = Date.now();
  }
  const copy = new Float32Array(samples);
  logListenerStats(rms, threshold);
  runWakeDetector(copy);

  if (!listener.segment) {
    // Bruit de fond suivi lentement, hors parole uniquement.
    if (rms < threshold) {
      listener.noise = listener.noise * 0.95 + rms * 0.05;
    }
    listener.preRoll.push(copy);
    while (listener.preRoll.length * blockMs > VAD.preRollMs) {
      listener.preRoll.shift();
    }
    listener.loudMs = rms > threshold ? listener.loudMs + blockMs : 0;
    if (listener.loudMs >= VAD.startMs) {
      jarvisLog(`voix detectee (niveau ${rms.toFixed(3)}, seuil ${threshold.toFixed(3)}, mode ${listener.mode})`);
      listener.segment = { blocks: [...listener.preRoll], sampleRate, ms: 0, loudMs: listener.loudMs };
      listener.preRoll = [];
      listener.quietMs = 0;
    } else if (
      listener.mode === "command" &&
      !listener.busy &&
      !listener.queue.length &&
      Date.now() - listener.commandStartedAt > VAD.commandTimeoutMs
    ) {
      // Rien dit apres « JARVIS » : retour en veille.
      endJarvisCommand("Je n'ai rien entendu.");
    }
    return;
  }

  listener.segment.blocks.push(copy);
  listener.segment.ms += blockMs;
  if (rms > threshold) {
    listener.segment.loudMs += blockMs;
  }
  listener.quietMs = rms > threshold ? 0 : listener.quietMs + blockMs;
  const silence = listener.mode === "command" ? VAD.commandSilenceMs : VAD.wakeSilenceMs;
  if (listener.quietMs >= silence || listener.segment.ms >= VAD.maxSegmentMs) {
    listener.queue.push(listener.segment);
    listener.segment = null;
    processJarvisQueue();
  }
}

async function segmentToWav16k(segment) {
  const length = segment.blocks.reduce((total, block) => total + block.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const block of segment.blocks) {
    merged.set(block, offset);
    offset += block.length;
  }
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: segment.sampleRate });
  buffer.copyToChannel(merged, 0);
  const offline = new OfflineAudioContext(1, Math.ceil((length / segment.sampleRate) * 16000), 16000);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return encodeWav16k((await offline.startRendering()).getChannelData(0));
}

async function processJarvisQueue() {
  const listener = jarvisListener;
  if (listener.busy) {
    return;
  }
  while (listener.queue.length && listener.mode !== "off") {
    listener.busy = true;
    await handleJarvisSegment(listener.queue.shift());
    listener.busy = false;
  }
}

// Le mode au moment de la transcription decide : apres « JARVIS », la phrase
// suivante (meme dite pendant le calcul) est la demande.
async function handleJarvisSegment(segment) {
  const listener = jarvisListener;
  const mode = listener.mode;
  if (mode === "command") {
    setJarvisCoreState("thinking");
    showJarvisHud("Transcription…");
  }
  let text = "";
  let engine = "";
  const started = Date.now();
  if (segment.loudMs < VAD.minSpeechMs) {
    jarvisLog(`segment ignore : ${Math.round(segment.loudMs)} ms de voix seulement`);
  } else {
    try {
      // L'indice « JARVIS » ne sert qu'a la veille : apres l'activation, il
      // pousse Whisper a ecrire « J'avis. » sur du silence.
      const wake = mode === "wake";
      const result = await window.launcher.voiceTranscribe(await segmentToWav16k(segment), wake ? "JARVIS" : jarvisDictationPrompt(), mode);
      text = result?.text || "";
      engine = result?.engine || "";
      if (result?.error) {
        jarvisLog(`erreur Whisper : ${result.error}`);
      }
    } catch (error) {
      jarvisLog(`erreur Whisper : ${error?.message || error}`);
    }
    jarvisLog(`Whisper (${mode}, ${engine}, ${Math.round(segment.ms)} ms d'audio, ${Date.now() - started} ms) : « ${text} »`);
  }
  if (listener.mode !== mode) {
    return;
  }

  if (mode === "wake") {
    if (text) {
      listener.heard = [text, ...listener.heard].slice(0, 5);
    }
    const match = WAKE_WORD.exec(text);
    if (!match) {
      return;
    }
    // « JARVIS, explique ce fichier » : la demande suit directement.
    const rest = stripWakeWords(text.slice(match.index));
    if (rest.split(/\s+/).length >= 2) {
      const target = jarvisCommandTarget();
      await refreshJarvisContext(target?.session);
      submitJarvisCommand(correctDictation(rest), target);
    } else {
      beginJarvisCommand(jarvisCommandTarget());
    }
    return;
  }
  text = correctDictation(stripWakeWords(text));
  if (isWhisperHallucination(text)) {
    if (text) {
      jarvisLog(`phrase inventee par Whisper ignoree : « ${text} »`);
    }
    text = "";
  }
  if (text) {
    submitJarvisCommand(text, listener.target);
  } else {
    // Juste « Jarvis » (ou rien de clair) : on attend la suite ; sans parole
    // pendant quelques secondes, retour en veille.
    listener.commandStartedAt = Date.now();
    setJarvisCoreState("listening", listener.analyser);
    showJarvisHud("À l'écoute…", "Je t'écoute");
  }
}

// Cible d'une commande vocale : terminal de l'onglet affiche.
function jarvisCommandTarget() {
  const session = state.sessions.get(state.activeSessionId);
  return session?.type === "terminal" ? { session } : null;
}

function beginJarvisCommand(target) {
  stopJarvisSpeech();
  refreshJarvisContext(target?.session);
  jarvisListener.mode = "command";
  jarvisListener.target = target;
  document.body.classList.add("jarvis-dictating");
  jarvisListener.commandStartedAt = Date.now();
  jarvisChime(true);
  const where = target?.element ? "dans le champ" : target?.session ? `pour « ${target.session.title} »` : "";
  showJarvisHud("À l'écoute…", where ? `Parle, j'écris ${where}` : "Parle, je t'écoute");
  setJarvisCoreState("listening", jarvisListener.analyser);
  jarvisHud.core?.setState("listening");
  jarvisHud.core?.setAnalyser(jarvisListener.analyser);
}

function endJarvisCommand(message = "", delay = 1400) {
  jarvisListener.mode = isJarvisWakeWordEnabled() && jarvis.active ? "wake" : "off";
  jarvisListener.target = null;
  document.body.classList.remove("jarvis-dictating");
  if (jarvisListener.mode === "off") {
    stopJarvisListener();
  }
  setJarvisCoreState("idle");
  if (message) {
    showJarvisHud(message);
  }
  hideJarvisHud(message ? delay : 0);
}

function submitJarvisCommand(text, target) {
  jarvisLog(`demande : « ${text} »`);
  if (!target) {
    endJarvisCommand("Ouvre un onglet d'IA pour me parler.", 2200);
    return;
  }
  jarvisChime(false);
  if (target.element) {
    insertDictation(target, text);
    endJarvisCommand();
    showJarvisHud("Écrit", text);
    hideJarvisHud(1600);
    return;
  }
  const session = target.session;
  if (!state.sessions.has(session.id)) {
    endJarvisCommand("L'onglet a été fermé.", 2000);
    return;
  }
  // Sans envoi automatique, le texte est seulement ecrit dans le prompt : on
  // le corrige au clavier puis Entree.
  const autoSend = isJarvisAutoSend();
  pasteToSession(session, isJarvisDictationNote() ? `${text} ${JARVIS_DICTATION_NOTE}` : text, autoSend);
  setActiveSession(session.id);
  endJarvisCommand();
  if (autoSend) {
    showJarvisHud(`Envoyé à ${getProfileLabel(sessionProfileId(session)) || "l'IA"}`, text);
  } else {
    showJarvisHud("Écrit dans le prompt : corrige si besoin, puis Entrée", text);
    session.terminal?.focus();
  }
  hideJarvisHud(autoSend ? 2000 : 2600);
}

// Echap / clic sur le grand reacteur : annule l'ecoute ou la lecture.
function cancelJarvisInteraction() {
  jarvisListener.queue = [];
  if (jarvisListener.mode === "command") {
    endJarvisCommand();
  }
  stopJarvisSpeech();
  hideJarvisHud();
}

// Ou inserer un texte dicte au raccourci : champ de saisie actif, sinon terminal.
function dictationTarget() {
  const element = document.activeElement;
  if (element?.classList?.contains("xterm-helper-textarea")) {
    const session = [...state.sessions.values()].find((item) => item.container?.contains(element));
    return { session: session || state.sessions.get(state.activeSessionId) };
  }
  if (isEditableTarget(element) && !element.disabled && !element.readOnly) {
    return { element };
  }
  return jarvisCommandTarget();
}

function insertDictation(target, text) {
  if (target.element?.isConnected) {
    target.element.focus();
    document.execCommand("insertText", false, text);
  } else if (target.session && state.sessions.has(target.session.id)) {
    pasteToSession(target.session, text, false);
  }
}

function encodeWav16k(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
  return new Uint8Array(buffer);
}

// Ctrl+Maj+Espace : parler sans dire « JARVIS » (dans le champ actif ou a
// l'IA de l'onglet) ; relancer le raccourci annule.
async function toggleJarvisDictation() {
  if (!jarvis.active) {
    flashStatus("Active JARVIS (bouton réacteur) pour la commande vocale");
    return;
  }
  if (jarvisListener.mode === "command") {
    cancelJarvisInteraction();
    return;
  }
  if (await startJarvisListener()) {
    beginJarvisCommand(dictationTarget());
  }
}

let classicBrandTitle = null;

function playJarvisSound(src, volume = 1) {
  const audio = new Audio(src);
  audio.volume = volume;
  audio.play().catch(() => {});
  return audio;
}

function fadeOutAudio(audio, ms = 600) {
  const start = audio.volume;
  const steps = 12;
  let step = 0;
  const timer = window.setInterval(() => {
    step += 1;
    audio.volume = Math.max(0, start * (1 - step / steps));
    if (step >= steps) {
      window.clearInterval(timer);
      audio.pause();
    }
  }, ms / steps);
}

function applyJarvisMode(active) {
  jarvis.active = active;
  document.body.classList.toggle("jarvis", active);
  const brandTitle = document.querySelector(".brand h1");
  if (brandTitle) {
    classicBrandTitle ??= brandTitle.textContent;
    brandTitle.textContent = active ? "J.A.R.V.I.S." : classicBrandTitle;
  }
  for (const session of state.sessions.values()) {
    if (session.terminal?.options) {
      session.terminal.options.theme = currentTerminalTheme();
    }
  }
  // En mode JARVIS, le reacteur de la barre d'outils devient l'icone vivante.
  const svg = elements.jarvisButton.querySelector(".arc-reactor");
  if (active && !jarvis.core) {
    jarvis.core = new window.JarvisCore(elements.jarvisButton, { size: 32 });
    svg.classList.add("hidden");
    // Pack carte graphique (voix qualite, dictee precise) : charge a l'avance
    // (~20 s) pour repondre sans attendre ; ignore s'il n'est pas installe.
    window.launcher.qualityVoicePrepare();
  } else if (!active && jarvis.core) {
    cancelJarvisInteraction();
    stopJarvisListener();
    jarvis.core.destroy();
    jarvis.core = null;
    svg.classList.remove("hidden");
  }
  updateJarvisButton();
  syncJarvisListener();
}

function updateJarvisButton() {
  const button = elements.jarvisButton;
  button.classList.toggle("installed", jarvis.installed);
  button.classList.toggle("on", jarvis.active);
  button.title = jarvis.active ? "JARVIS en ligne" : jarvis.installed ? "Activer JARVIS" : "JARVIS";
}

async function saveJarvis(patch) {
  const next = await window.launcher.setJarvis(patch);
  jarvis.installed = next.installed;
  return next;
}

// Cinematique d'ouverture : animation HUD (ou video) calee sur le son
// « Bonjour Jarvis ». L'interface bascule sous le flash final.
function playJarvisIntro() {
  return new Promise((resolve) => {
    jarvis.playing = true;
    const overlay = document.createElement("div");
    overlay.className = "jarvis-intro";
    overlay.innerHTML = `
      <div class="ji-grid"></div>
      ${JARVIS_INTRO_VIDEO ? `<video class="ji-video" muted playsinline></video>` : ""}
      <div class="ji-reactor">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="ji-r1" cx="100" cy="100" r="92" />
          <circle class="ji-r2" cx="100" cy="100" r="78" />
          <circle class="ji-r3" cx="100" cy="100" r="62" />
          <circle class="ji-r4" cx="100" cy="100" r="44" />
          <circle class="ji-core" cx="100" cy="100" r="22" />
        </svg>
      </div>
      <div class="ji-title">J.A.R.V.I.S.</div>
      <div class="ji-sub">Just A Rather Very Intelligent System</div>
      <ul class="ji-log"></ul>
      <div class="ji-bar"><span></span></div>
      <div class="ji-skip">Échap ou clic pour passer</div>`;
    document.body.appendChild(overlay);

    if (JARVIS_INTRO_VIDEO) {
      const video = overlay.querySelector(".ji-video");
      video.src = JARVIS_INTRO_VIDEO;
      video.play().catch(() => {});
    }

    const audio = playJarvisSound(JARVIS_SOUNDS.intro);
    const log = overlay.querySelector(".ji-log");
    const lines = [
      "Initialisation des systèmes principaux",
      "Connexion aux terminaux IA",
      "Synchronisation des sessions",
      "Calibrage de l'interface holographique",
      "Protocoles de sécurité actifs",
      "Tous les systèmes sont opérationnels"
    ];
    const timers = [];
    let finished = false;

    function finish(skipped) {
      if (finished) {
        return;
      }
      finished = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener("keydown", onKey, true);
      if (skipped) {
        fadeOutAudio(audio);
      }
      overlay.classList.add("ji-out");
      applyJarvisMode(true);
      window.setTimeout(() => {
        overlay.remove();
        jarvis.playing = false;
        resolve();
      }, 900);
    }

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      }
    }

    function start(duration) {
      overlay.style.setProperty("--ji-duration", `${duration}ms`);
      overlay.classList.add("ji-run");
      lines.forEach((text, index) => {
        timers.push(
          window.setTimeout(() => {
            const item = document.createElement("li");
            item.innerHTML = "<span></span><b>OK</b>";
            item.querySelector("span").textContent = text;
            log.appendChild(item);
          }, (duration * 0.82 * (index + 1)) / lines.length)
        );
      });
      timers.push(window.setTimeout(() => finish(false), duration));
    }

    // La duree suit celle du son (plafonnee) ; repli si le son ne se charge pas.
    let started = false;
    const begin = (duration) => {
      if (!started) {
        started = true;
        start(duration);
      }
    };
    audio.addEventListener("loadedmetadata", () => {
      const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 : JARVIS_INTRO_FALLBACK_MS;
      begin(Math.min(Math.max(ms, 3000), JARVIS_INTRO_MAX_MS));
    });
    audio.addEventListener("error", () => begin(JARVIS_INTRO_FALLBACK_MS));
    window.setTimeout(() => begin(JARVIS_INTRO_FALLBACK_MS), 1500);

    overlay.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);
  });
}

async function activateJarvis() {
  if (jarvis.playing) {
    return;
  }
  await playJarvisIntro();
  await saveJarvis({ active: true, pendingIntro: false });
}

async function deactivateJarvis() {
  await saveJarvis({ active: false });
  applyJarvisMode(false);
}

function openJarvisInstall() {
  const modal = createModal({
    icon: "cpu",
    title: "JARVIS",
    sub: "Module disponible",
    dialogClass: "jarvis-dialog"
  });
  modal.body.innerHTML = `
    <p>JARVIS est une refonte de l'interface façon Iron Man, avec des fonctionnalités avancées.</p>
    <p>Un peu moins rapide que l'interface classique, mais plus fun. Tu pourras revenir à l'interface classique ou le désinstaller à tout moment.</p>
    <div class="jarvis-install-progress hidden"><span></span></div>`;
  const closeButton = modal.actions.querySelector("button");
  closeButton.textContent = "Plus tard";
  closeButton.className = "ghost-button";

  const install = document.createElement("button");
  install.type = "button";
  install.className = "primary-button";
  install.textContent = "Installer JARVIS";
  install.addEventListener("click", async () => {
    install.disabled = true;
    closeButton.disabled = true;
    install.textContent = "Installation…";
    modal.body.querySelector(".jarvis-install-progress").classList.remove("hidden");
    await saveJarvis({ installed: true });
    window.setTimeout(() => {
      modal.close();
      updateJarvisButton();
      activateJarvis();
    }, 1600);
  });
  modal.actions.appendChild(install);
  createIcons();
}

function openJarvisControls() {
  const modal = createModal({
    icon: "cpu",
    title: "J.A.R.V.I.S.",
    sub: jarvis.active ? "En ligne" : "Installé, en veille",
    dialogClass: "jarvis-dialog"
  });
  modal.body.innerHTML = `
    <p class="jarvis-shortcuts">
      <span>Dis <kbd>Hey Jarvis</kbd> (ou simplement « Jarvis ») puis ta demande : elle part à l'IA dès que tu te tais</span>
      <span class="jarvis-shortcut-row"><span class="jarvis-shortcut-chord"></span> parler sans le mot d'activation (dans le terminal ou n'importe quel champ) <button type="button" class="link-button jarvis-shortcut-edit">Modifier</button></span>
      <span><kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>J</kbd> lire la dernière réponse de l'IA</span>
      <span><kbd>Échap</kbd> ou clic sur le réacteur : annuler l'écoute ou arrêter la lecture</span>
    </p>
    <label class="switch-row jarvis-wakeword">
      <input type="checkbox" />
      <span>Écouter le mot d'activation « JARVIS » (micro analysé sur ce PC uniquement)</span>
    </label>
    <label class="switch-row jarvis-autosend">
      <input type="checkbox" />
      <span>Envoyer automatiquement la demande dictée (sinon, elle est écrite dans le prompt pour être corrigée avant Entrée)</span>
    </label>
    <label class="switch-row jarvis-autoread">
      <input type="checkbox" />
      <span>Lire automatiquement chaque réponse de l'IA (onglet affiché)</span>
    </label>
    <label class="switch-row jarvis-note">
      <input type="checkbox" />
      <span>Prévenir l'IA que la demande est dictée (elle comprend les mots mal reconnus sans le faire remarquer)</span>
    </label>
    <label class="jarvis-lexicon">
      <span>Lexique (facultatif) : les noms propres de la conversation sont déjà reconnus automatiquement ; ajoute ici ceux qui reviennent souvent, un par ligne.</span>
      <textarea rows="4" spellcheck="false" placeholder="Bormes-les-Mimosas"></textarea>
    </label>`;
  if (jarvisListener.heard.length) {
    const heard = document.createElement("p");
    heard.className = "jarvis-heard";
    heard.textContent = `Dernières phrases entendues : ${jarvisListener.heard.map((text) => `« ${text} »`).join(", ")}`;
    modal.body.appendChild(heard);
  }
  const chord = modal.body.querySelector(".jarvis-shortcut-chord");
  if (keybindings.jarvisDictate) {
    renderChord(keybindings.jarvisDictate, chord);
  } else {
    chord.textContent = "Aucun raccourci :";
  }
  modal.body.querySelector(".jarvis-shortcut-edit").addEventListener("click", () => {
    modal.close();
    openShortcutsModal();
  });
  const wakeWord = modal.body.querySelector(".jarvis-wakeword input");
  wakeWord.checked = isJarvisWakeWordEnabled();
  wakeWord.addEventListener("change", () => {
    window.localStorage.setItem("jarvisWakeWord", wakeWord.checked ? "1" : "0");
    syncJarvisListener();
  });
  const autoSend = modal.body.querySelector(".jarvis-autosend input");
  autoSend.checked = isJarvisAutoSend();
  autoSend.addEventListener("change", () => {
    window.localStorage.setItem("jarvisAutoSend", autoSend.checked ? "1" : "0");
  });
  const note = modal.body.querySelector(".jarvis-note input");
  note.checked = isJarvisDictationNote();
  note.addEventListener("change", () => {
    window.localStorage.setItem("jarvisDictationNote", note.checked ? "1" : "0");
  });
  const lexicon = modal.body.querySelector(".jarvis-lexicon textarea");
  lexicon.value = jarvisLexicon().join("\n");
  lexicon.addEventListener("input", () => {
    window.localStorage.setItem("jarvisLexicon", lexicon.value);
  });
  const autoRead = modal.body.querySelector(".jarvis-autoread input");
  autoRead.checked = isJarvisAutoRead();
  autoRead.addEventListener("change", () => {
    window.localStorage.setItem("jarvisAutoRead", autoRead.checked ? "1" : "0");
  });

  // Mini reacteur anime : acces direct a l'apercu de l'icone a l'ecoute.
  const teaser = document.createElement("button");
  teaser.type = "button";
  teaser.className = "jarvis-core-teaser";
  const teaserIcon = document.createElement("span");
  const teaserText = document.createElement("span");
  teaserText.innerHTML = "<strong>Icône à l'écoute</strong><small>Aperçu des états : veille, écoute (micro), réflexion, parole</small>";
  teaser.append(teaserIcon, teaserText);
  modal.body.appendChild(teaser);
  const miniCore = new window.JarvisCore(teaserIcon, { size: 64 });
  teaser.addEventListener("click", () => {
    modal.close();
    openJarvisCorePreview();
  });
  const stopMini = new MutationObserver(() => {
    if (!modal.overlay.isConnected) {
      stopMini.disconnect();
      miniCore.destroy();
    }
  });
  stopMini.observe(document.body, { childList: true });

  const closeButton = modal.actions.querySelector("button");
  closeButton.className = "ghost-button";

  const addAction = (label, className, run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", () => {
      modal.close();
      run();
    });
    modal.actions.insertBefore(button, closeButton);
  };

  addAction("Désinstaller", "ghost-button danger", async () => {
    if (window.confirm("Désinstaller JARVIS ? L'interface classique sera rétablie.")) {
      await saveJarvis({ installed: false });
      applyJarvisMode(false);
    }
  });
  if (jarvis.active) {
    addAction("Rejouer la cinématique", "ghost-button", () => activateJarvis());
    addAction("Interface classique", "primary-button", () => deactivateJarvis());
  } else {
    addAction("Activer JARVIS", "primary-button", () => activateJarvis());
  }
  createIcons();
}

// Apercu de l'icone "a l'ecoute" (future interface vocale) : les quatre etats
// du reacteur, avec le vrai micro et la voix de l'intro pour les tester.
function openJarvisCorePreview() {
  const modal = createModal({
    icon: "audio-lines",
    title: "J.A.R.V.I.S.",
    sub: "Aperçu de l'icône à l'écoute",
    dialogClass: "jarvis-dialog jarvis-core-preview"
  });
  const stage = document.createElement("div");
  stage.className = "jarvis-core-stage";
  const label = document.createElement("div");
  label.className = "jarvis-core-label";
  modal.body.append(stage, label);
  const core = new window.JarvisCore(stage, { size: 300 });

  let audioContext = null;
  let micStream = null;
  let voice = null;
  let qualityPlayer = null;

  function stopSources() {
    core.setAnalyser(null);
    qualityPlayer?.stop();
    qualityPlayer = null;
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    if (voice) {
      voice.pause();
      voice = null;
    }
    window.speechSynthesis?.cancel();
  }

  function analyserFor(source, toSpeakers) {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    if (toSpeakers) {
      analyser.connect(audioContext.destination);
    }
    return analyser;
  }

  const LABELS = {
    idle: "En veille",
    listening: "À l'écoute…",
    thinking: "Réflexion…",
    speaking: "JARVIS parle"
  };

  async function setState(state) {
    stopSources();
    core.setState(state);
    label.textContent = LABELS[state];
    for (const button of modal.actions.querySelectorAll("[data-state]")) {
      button.classList.toggle("active", button.dataset.state === state);
    }
    audioContext ??= new AudioContext();
    if (state === "listening") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Etat change ou fenetre fermee pendant la demande d'acces au micro.
        if (core.state !== "listening" || !modal.overlay.isConnected) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        micStream = stream;
        core.setAnalyser(analyserFor(audioContext.createMediaStreamSource(micStream), false));
        label.textContent = "À l'écoute… (parle pour voir l'icône réagir)";
      } catch {
        label.textContent = "À l'écoute… (micro indisponible : vérifie l'accès au micro dans les paramètres de Windows)";
      }
    } else if (state === "speaking") {
      voice = new Audio(JARVIS_SOUNDS.intro);
      core.setAnalyser(analyserFor(audioContext.createMediaElementSource(voice), true));
      voice.addEventListener("ended", () => setState("idle"));
      voice.play().catch(() => {});
    }
  }

  const closeButton = modal.actions.querySelector("button");
  closeButton.className = "ghost-button";
  for (const [state, text] of [["idle", "Veille"], ["listening", "Écoute"], ["thinking", "Réflexion"], ["speaking", "Parle"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.dataset.state = state;
    button.textContent = text;
    button.addEventListener("click", () => setState(state));
    modal.actions.insertBefore(button, closeButton);
  }

  // --- Voix locale (Piper) + effet "JARVIS" ; voix de Windows en secours ---
  const voicePanel = document.createElement("div");
  voicePanel.className = "jarvis-voice";
  modal.body.appendChild(voicePanel);
  const voiceNote = document.createElement("div");
  voiceNote.className = "jarvis-voice-note";
  const settings = loadJarvisVoiceSettings();
  let voiceStatus = null;

  // Voix de secours : voix francaise de Windows (pas d'analyse du son possible,
  // l'icone simule la parole).
  function speakWithSystemVoice(text, reason) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    const french = window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("fr"));
    if (french) {
      utterance.voice = french;
    }
    utterance.onend = () => {
      if (core.state === "speaking") {
        setState("idle");
      }
    };
    core.setState("speaking");
    label.textContent = "JARVIS parle (voix de secours Windows)";
    voiceNote.textContent = reason;
    window.speechSynthesis.speak(utterance);
  }

  // Renvoie false si la voix qualite n'a rien pu dire (Tom prend le relais).
  async function sayWithQuality(text) {
    audioContext ??= new AudioContext();
    const player = createQualityPlayer(audioContext, settings);
    qualityPlayer = player;
    const started = Date.now();
    const result = await player.say(window.JarvisPronounce.pronounce(text, { phonetic: false }), (analyser) => {
      core.setAnalyser(analyser);
      core.setState("speaking");
      label.textContent = `JARVIS parle (voix qualité, premier son en ${((Date.now() - started) / 1000).toFixed(1)} s)`;
    });
    if (qualityPlayer !== player) {
      return true;
    }
    if (result?.error) {
      voiceNote.textContent = `Voix qualité indisponible (${result.error}) : voix Tom utilisée.`;
      return false;
    }
    await player.finished();
    if (qualityPlayer === player && core.state === "speaking") {
      setState("idle");
    }
    return true;
  }

  async function sayText(text) {
    stopSources();
    core.setState("thinking");
    label.textContent = settings.engine === "quality" ? "Démarrage de la voix qualité…" : "Génération de la voix…";
    voiceNote.textContent = "";
    if (settings.engine === "quality" && (await sayWithQuality(text))) {
      return;
    }
    // Voix plus grave = lecture ralentie ; la diction est generee plus vite
    // d'autant pour garder le meme debit.
    const rate = 1 - settings.pitch;
    const result = await window.launcher.voiceSpeak({ text, voiceId: settings.voice, lengthScale: rate / settings.speed });
    if (core.state !== "thinking" || !modal.overlay.isConnected) {
      return;
    }
    if (!result?.audio) {
      speakWithSystemVoice(text, result?.error || "Voix locale indisponible.");
      return;
    }
    audioContext ??= new AudioContext();
    const url = URL.createObjectURL(new Blob([result.audio], { type: "audio/wav" }));
    voice = new Audio(url);
    voice.preservesPitch = false;
    voice.playbackRate = rate;
    const output = buildJarvisVoiceChain(audioContext, audioContext.createMediaElementSource(voice), settings);
    core.setAnalyser(analyserFor(output, true));
    core.setState("speaking");
    const current = voiceStatus?.voices.find((v) => v.id === settings.voice);
    label.textContent = `JARVIS parle (voix ${current?.label || settings.voice})`;
    voice.addEventListener("ended", () => {
      URL.revokeObjectURL(url);
      // Laisse l'echo s'eteindre avant de repasser en veille.
      window.setTimeout(() => {
        if (core.state === "speaking") {
          setState("idle");
        }
      }, 400);
    });
    voice.play().catch(() => {});
  }

  function slider(text, key, min, max, step, format) {
    const row = document.createElement("label");
    row.className = "jarvis-voice-slider";
    const name = document.createElement("span");
    name.textContent = text;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(settings[key]);
    const value = document.createElement("em");
    value.textContent = format(settings[key]);
    input.addEventListener("input", () => {
      settings[key] = Number(input.value);
      value.textContent = format(settings[key]);
      saveJarvisVoiceSettings(settings);
    });
    row.append(name, input, value);
    return row;
  }

  async function renderVoicePanel() {
    voiceStatus = await window.launcher.voiceStatus();
    const quality = await window.launcher.qualityVoiceStatus();
    if (settings.engine === "quality" && !quality.installed) {
      settings.engine = "tom";
    }
    voicePanel.innerHTML = "";
    if (!voiceStatus.engine || !voiceStatus.voices.length) {
      voiceNote.textContent = "Voix de JARVIS absente de cette installation : voix de Windows utilisée.";
    }

    const voiceRow = document.createElement("div");
    voiceRow.className = "jarvis-voice-row";
    if (quality.installed) {
      const engine = document.createElement("select");
      engine.innerHTML = '<option value="tom">Voix : Tom (processeur)</option><option value="quality">Voix : qualité (carte graphique)</option>';
      engine.value = settings.engine;
      engine.addEventListener("change", () => {
        settings.engine = engine.value;
        saveJarvisVoiceSettings(settings);
        renderVoicePanel();
      });
      voiceRow.appendChild(engine);
    }
    const current = voiceStatus.voices.find((item) => item.id === settings.voice) || voiceStatus.voices[0];
    if (voiceStatus.voices.length > 1 && settings.engine !== "quality") {
      const select = document.createElement("select");
      for (const item of voiceStatus.voices) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = `Voix : ${item.label}`;
        select.appendChild(option);
      }
      select.value = current.id;
      select.addEventListener("change", () => {
        settings.voice = select.value;
        saveJarvisVoiceSettings(settings);
        renderVoicePanel();
      });
      voiceRow.appendChild(select);
    }

    const license = document.createElement("div");
    license.className = "jarvis-voice-license";
    license.textContent =
      settings.engine === "quality"
        ? "Voix qualité · Qwen3-TTS 0.6B (Apache 2.0) · carte graphique, 100 % locale"
        : current
          ? `${current.label} · ${current.license} · synthèse Piper, 100 % locale`
          : "";

    const testRow = document.createElement("div");
    testRow.className = "jarvis-voice-row";
    const phrase = document.createElement("input");
    phrase.type = "text";
    phrase.value = "Bonjour Monsieur. Tous les systèmes sont opérationnels.";
    const test = document.createElement("button");
    test.type = "button";
    test.className = "primary-button";
    test.textContent = "Tester la voix";
    test.addEventListener("click", () => sayText(phrase.value));
    testRow.append(phrase, test);

    const sliders = document.createElement("div");
    sliders.className = "jarvis-voice-sliders";
    const percent = (v) => `${Math.round(v * 100)} %`;
    if (settings.engine === "quality") {
      sliders.append(
        slider("Grave", "qPitch", 0, 0.25, 0.01, percent),
        slider("Métal", "qMetal", 0, 1, 0.05, percent),
        slider("Écho", "qEcho", 0, 1, 0.05, percent)
      );
    } else {
      sliders.append(
        slider("Débit", "speed", 0.7, 1.4, 0.05, percent),
        slider("Grave", "pitch", 0, 0.25, 0.01, percent),
        slider("Métal", "metal", 0, 1, 0.05, percent),
        slider("Écho", "echo", 0, 1, 0.05, percent)
      );
    }

    voicePanel.append(voiceRow, license, sliders, testRow, qualityVoicePanel(quality), voiceNote);
  }
  // Installation de la voix qualite (pack telecharge une fois, hors de l'appli).
  function qualityVoicePanel(quality) {
    const box = document.createElement("div");
    box.className = "jarvis-quality";
    if (!quality.supported || !quality.gpu) {
      box.textContent = quality.supported
        ? "Voix qualité : demande une carte graphique NVIDIA (aucune détectée)."
        : "Voix qualité : disponible pour l'instant sous Windows uniquement.";
      return box;
    }
    const info = document.createElement("div");
    const bar = document.createElement("div");
    bar.className = "jarvis-quality-bar";
    const fill = document.createElement("span");
    bar.appendChild(fill);
    const button = document.createElement("button");
    button.type = "button";
    const showProgress = ({ percent, step, error }) => {
      bar.hidden = false;
      fill.style.width = `${percent || 0}%`;
      info.textContent = error ? `Échec de l'installation : ${error}` : `Installation de la voix qualité : ${step} (${percent || 0} %)`;
    };
    bar.hidden = true;
    if (quality.installing) {
      showProgress(quality);
      button.hidden = true;
      const off = window.launcher.onQualityVoiceProgress((progress) => {
        showProgress(progress);
        if (progress.done) {
          off();
          if (modal.overlay.isConnected) {
            renderVoicePanel();
          }
        }
      });
    } else if (quality.installed && !quality.asrInstalled) {
      info.textContent = `Voix qualité installée (${quality.gpu.name}). Nouveau : dictée précise sur la carte graphique (bien moins de fautes, ~0,4 s par phrase). Téléchargement de 1,6 Go.`;
      button.className = "primary-button";
      button.textContent = "Ajouter la dictée précise";
      button.addEventListener("click", async () => {
        button.hidden = true;
        showProgress({ percent: 0, step: "préparation" });
        const off = window.launcher.onQualityVoiceProgress(showProgress);
        await window.launcher.qualityVoiceInstall({ onlyAsr: true }).catch((error) => ({ error: error.message }));
        off();
        if (modal.overlay.isConnected) {
          renderVoicePanel();
        }
      });
    } else if (quality.installed) {
      info.textContent = `Voix qualité et dictée précise installées (${quality.gpu.name}).`;
      button.className = "ghost-button danger";
      button.textContent = "Désinstaller";
      button.addEventListener("click", async () => {
        if (!window.confirm("Désinstaller la voix qualité et la dictée précise (environ 11 Go libérés) ?")) {
          return;
        }
        settings.engine = "tom";
        saveJarvisVoiceSettings(settings);
        await window.launcher.qualityVoiceUninstall();
        renderVoicePanel();
      });
    } else {
      info.textContent = quality.error
        ? `Échec de la dernière installation : ${quality.error}`
        : `Voix qualité et dictée précise, calculées par ta carte graphique (${quality.gpu.name}) : voix plus naturelle, beaucoup moins de fautes dans le texte dicté. Téléchargement unique d'environ 8 Go (11 Go sur le disque).`;
      if (!quality.enoughMemory) {
        info.textContent += " Attention : moins de 4 Go de mémoire graphique, la voix risque de ne pas fonctionner.";
      }
      button.className = "primary-button";
      button.textContent = "Installer la voix qualité";
      button.addEventListener("click", async () => {
        button.hidden = true;
        showProgress({ percent: 0, step: "préparation" });
        const off = window.launcher.onQualityVoiceProgress(showProgress);
        const result = await window.launcher.qualityVoiceInstall().catch((error) => ({ error: error.message }));
        off();
        if (result?.ok) {
          settings.engine = "quality";
          saveJarvisVoiceSettings(settings);
        }
        if (modal.overlay.isConnected) {
          renderVoicePanel();
        }
      });
    }
    box.append(info, bar, button);
    return box;
  }

  renderVoicePanel();

  // Liberation du micro, du son et de l'animation a la fermeture.
  const observer = new MutationObserver(() => {
    if (!modal.overlay.isConnected) {
      observer.disconnect();
      stopSources();
      core.destroy();
      audioContext?.close();
    }
  });
  observer.observe(document.body, { childList: true });

  setState("idle");
  createIcons();
}

// Bouton JARVIS / menu Affichage : propose l'installation, sinon lance
// JARVIS (cinematique) ou ouvre ses reglages s'il est deja actif.
function openJarvis() {
  if (jarvis.playing) {
    return;
  }
  // Clic sur le reacteur pendant l'ecoute ou la lecture : on annule.
  if (jarvisListener.mode === "command" || jarvisVoice.speaking) {
    cancelJarvisInteraction();
    return;
  }
  if (!jarvis.installed) {
    openJarvisInstall();
  } else if (!jarvis.active) {
    activateJarvis();
  } else {
    openJarvisControls();
  }
}

async function initJarvis() {
  window.launcher.onJarvisMenu(openJarvis);
  let saved;
  try {
    saved = await window.launcher.getJarvis();
  } catch {
    return;
  }
  jarvis.installed = saved.installed;
  // Chaque demarrage se fait sur l'interface classique : JARVIS ne se relance
  // que sur demande (bouton ou menu). Seule exception : la case cochee dans
  // l'installateur, qui lance la cinematique une fois.
  if (saved.active) {
    await saveJarvis({ active: false });
  }
  applyJarvisMode(false);
  if (saved.pendingIntro) {
    activateJarvis();
  }
}

// Notes de version affichees apres une mise a jour. La cle est le numero de
// version, la valeur la liste des nouveautes a montrer.
const CHANGELOG = {
  "0.1.29": [
    "Dictée bien plus précise : nouveau modèle de reconnaissance pour le texte des demandes, et vocabulaire technique reconnu (features, commit, build…).",
    "Avec une carte graphique NVIDIA : dictée encore plus précise et quasi instantanée, à ajouter d'un clic au pack de la voix qualité.",
    "Le module à réacteur ne se réveille plus tout seul : un « Jarvis » douteux est vérifié avant de passer en écoute.",
    "Les noms propres de la conversation (villes, projets…) sont reconnus à la dictée, et l'IA comprend les mots mal entendus sans le faire remarquer.",
    "Nouvelle option : écrire la demande dictée dans le prompt sans l'envoyer, pour la corriger avant Entrée.",
    "Températures et unités lues correctement (« 22 degrés Celsius », « 30 kilomètres heure »)."
  ],
  "0.1.28": [
    "Le module à réacteur peut prendre une voix bien plus naturelle, calculée par la carte graphique (NVIDIA) : installation en un clic depuis sa fenêtre, premier mot en moins d'une seconde.",
    "Meilleure prononciation : versions, fichiers, raccourcis, unités et termes techniques sont lus correctement."
  ],
  "0.1.27": [
    "Le module à réacteur vous écoute : dites « OK Jarvis » (ou « Dis Jarvis », « Hey Jarvis ») puis votre demande, elle part à l'IA dès que vous vous taisez. Tout est analysé sur ce PC.",
    "Grand réacteur au centre de l'écran pendant l'écoute et la lecture, avec sous-titres ; Échap ou clic pour annuler.",
    "Lecture à voix haute des réponses de l'IA (Claude et Codex), automatique ou à la demande (Ctrl+Maj+J).",
    "Parler sans mot d'activation : Ctrl+Maj+Espace, raccourci modifiable.",
    "Correctif : une IA lancée dans un onglet fonctionne normalement même si le lanceur a été démarré depuis un terminal Claude Code."
  ],
  "0.1.26": [
    "Le module à réacteur a trouvé sa voix : synthèse vocale intégrée, 100 % locale (hors ligne, rien à installer), avec réglages de débit, de grave et d'effets.",
    "Correctif : sélectionner du texte dans une fenêtre en relâchant la souris à l'extérieur ne la ferme plus."
  ],
  "0.1.25": [
    "Le module à réacteur prépare sa voix : aperçu de son icône « à l'écoute », qui réagit au micro et à la parole (veille, écoute, réflexion, parole).",
    "Les boutons de sa fenêtre passent à la ligne au lieu d'être coupés."
  ],
  "0.1.24": [
    "Interface allégée : chaque section du menu latéral se replie d'un clic sur son titre (« Profil actif » est replié par défaut).",
    "Le petit bouton ‹‹ à côté du titre de l'onglet masque Renommer, Redémarrer, Relais et Git ; le quota reste visible.",
    "Le bouton ›› de la barre d'outils la replie (le réacteur reste visible) ; les raccourcis clavier fonctionnent toujours.",
    "Tes choix d'affichage sont mémorisés."
  ],
  "0.1.23": [
    "L'application démarre toujours sur l'interface classique, sans son : le module à réacteur ne se relance que lorsque tu le demandes."
  ],
  "0.1.22": [
    "Coller une image dans la CLI : Ctrl+V (ou clic droit > Coller) avec une capture d'écran ou une image copiée l'envoie directement à l'IA, sans l'enregistrer toi-même dans un dossier.",
    "Fichiers copiés dans l'Explorateur : Ctrl+V colle leurs chemins dans la CLI.",
    "Correctif : le glisser-déposer de fichiers dans le terminal fonctionne de nouveau, et accepte plusieurs fichiers à la fois."
  ],
  "0.1.21": [
    "Un nouveau module se cache dans la barre d'outils… indice : il a un réacteur.",
    "Également proposé en option dans l'installateur Windows, et dans le menu Affichage."
  ],
  "0.1.20": [
    "Correctif : le quota Claude ne disparaît plus quand la jauge de contexte est affichée ; s'il est momentanément indisponible, la raison s'affiche.",
    "Quota Claude interrogé au plus toutes les 2 minutes, toutes fenêtres du launcher confondues (cache partagé), pour ne plus être limité par Anthropic.",
    "Si Anthropic limite quand même les demandes, les dernières valeurs restent affichées avec un ⚠ et l'heure du prochain essai."
  ],
  "0.1.19": [
    "Remplissage du contexte : une jauge « Contexte » dans l'en-tête montre à quel point la mémoire de la conversation est pleine (Claude, Codex), pour savoir quand faire un /compact.",
    "Alerte « attend ton accord » : quand Claude est bloqué sur une autorisation ou une question, la pastille de l'onglet clignote en orange et une notification te prévient.",
    "Conversations Claude (Ctrl+Maj+O) : toutes tes conversations, même lancées hors du launcher, avec recherche ; un clic la reprend dans un nouvel onglet.",
    "Changements Git (Ctrl+Maj+G) : la branche et le nombre de fichiers modifiés dans l'en-tête ; un clic affiche les fichiers et leurs différences, en signalant ceux modifiés pendant la session.",
    "Bibliothèque de prompts (Ctrl+Maj+L) : tes consignes habituelles à insérer ou envoyer dans l'onglet actif, ou dans plusieurs onglets à la fois."
  ],
  "0.1.18": [
    "État des IA sur les onglets : la pastille pulse quand l'IA travaille et s'entoure d'un halo quand elle a fini et attend ta réponse.",
    "Notification Windows quand une IA a fini dans un onglet que tu ne regardes pas ; un clic t'y ramène (désactivable dans la palette de commandes).",
    "Mise à jour d'une IA détectée : le bouton ↻ affiche un badge orange quand une version plus récente de Claude ou Codex est installée que celle qui tourne dans l'onglet.",
    "Quota presque épuisé (90 %) : alerte et bouton « Relais → » pour passer la conversation à une autre IA.",
    "Palette de commandes : redémarrer d'un coup toutes les IA ayant une mise à jour en attente, ou toutes celles du même type."
  ],
  "0.1.17": [
    "Bouton « Redémarrer l'IA » dans l'en-tête (à côté du renommage) et raccourci Ctrl+Maj+U : relance l'IA de l'onglet, par exemple après sa mise à jour, sans perdre la conversation.",
    "Claude et Codex reprennent exactement la conversation de l'onglet, même avec plusieurs onglets dans le même dossier ; les autres CLI reprennent leur dernière conversation ou reçoivent le fil affiché comme contexte.",
    "Si Claude est en train de travailler, une confirmation est demandée avant d'interrompre la tâche."
  ],
  "0.1.16": [
    "Quota en temps réel dans l'en-tête, à droite du titre de l'onglet : l'utilisation de l'IA de l'onglet actif (Claude : fenêtres 5 h et 7 jours, avec le délai avant réinitialisation ; Codex : ses fenêtres de quota).",
    "Jauges vertes, orange à 70 %, rouges à 90 % ; le survol affiche la date exacte de réinitialisation.",
    "L'affichage se simplifie automatiquement quand la fenêtre est étroite."
  ],
  "0.1.15": [
    "Reprise d'historique entre PC : si le dossier d'origine n'existe pas sur ce PC (historique synchronisé depuis une autre machine), la session se relance dans le dossier sélectionné (ou demandé) au lieu d'échouer.",
    "Dans ce cas, le contenu de la conversation est rejoué automatiquement pour le retrouver."
  ],
  "0.1.14": [
    "Vue partagée : affiche deux onglets côte à côte (bouton ⧉ de la barre d'outils ou Ctrl+\\).",
    "Clique un onglet pour le charger dans le pane sélectionné ; clique un terminal pour lui donner le focus.",
    "Saisie synchronisée (bouton 🔗 ou Ctrl+Maj+M) : ce que tu tapes part dans les deux panes — un même prompt envoyé à deux IA en même temps.",
    "Les deux terminaux s'ajustent automatiquement à la taille de la fenêtre.",
    "Pipeline IA : enchaîne plusieurs IA, la sortie de l'une alimente l'entrée de la suivante ({{entrée}}, {{précédent}}). Mode automatique ou pas-à-pas (bouton ⟿ ou Ctrl+Maj+P).",
    "Antigravity (Google) ajouté en remplacement de Gemini CLI (commande agy) ; Gemini conservé en « ancien »."
  ],
  "0.1.13": [
    "Synchronisation Google Drive directe : connecte ton compte sans installer Google Drive Desktop.",
    "Un seul clic « Autoriser » (connexion OAuth) ; l'app range ses données dans un dossier privé de ton Drive et ne voit rien d'autre.",
    "Synchro automatique au démarrage et après chaque changement, + bouton « Synchroniser maintenant ».",
    "Les identifiants des CLI ne sont toujours pas synchronisés."
  ],
  "0.1.12": [
    "Relais entre IA : passe la main d'une CLI à une autre dans le même onglet, sans perdre le fil.",
    "La nouvelle IA reçoit le contexte en silencieux et poursuit comme si elle y était depuis le début.",
    "Sélecteur « Relais → » à côté du titre de l'onglet ; repère discret dans le terminal au moment du passage."
  ],
  "0.1.11": [
    "Synchronisation : range l'historique, les profils/personas et les sessions dans un dossier cloud (OneDrive, Dropbox…) pour les retrouver sur un autre PC.",
    "Bouton de synchronisation dans la barre d'outils : choisir un dossier, ou revenir au stockage local.",
    "Les identifiants des CLI ne sont jamais synchronisés ; à utiliser sur un seul PC à la fois."
  ],
  "0.1.10": [
    "Personas : applique des instructions (system prompt) à l'IA au lancement — façon « Gem » / « GPT ».",
    "Bibliothèque de personas personnalisable (bouton « Gérer les personas ») et sélecteur dans « Nouvel onglet ».",
    "Injection adaptée à chaque CLI : argument pour Claude/Aider, fichier de contexte (AGENTS.md/GEMINI.md/QWEN.md) pour les autres."
  ],
  "0.1.9": [
    "Raccourcis clavier : gestion des onglets (Ctrl+T, Ctrl+W, Ctrl+Tab, Alt+1…9), historique, menu, et plus.",
    "Personnalisation : réassignez chaque raccourci depuis le bouton clavier de la barre d'outils (ou Ctrl+,).",
    "Zoom de la police du terminal (Ctrl+= / Ctrl+- / Ctrl+0).",
    "Recherche dans le terminal (Ctrl+Maj+F), duplication et relance d'un onglet.",
    "Aide intégrée listant tous les raccourcis (F1)."
  ],
  "0.1.8": [
    "Nouveau : cette fenêtre « Quoi de neuf ? » apparaît après chaque mise à jour pour résumer les nouveautés.",
    "Vérification manuelle des mises à jour depuis le menu Fichier."
  ],
  "0.1.7": [
    "Historique global : correction des doublons lors de la reprise ou de la restauration d'une session."
  ],
  "0.1.6": [
    "Mises à jour automatiques de l'application via GitHub."
  ],
  "0.1.5": [
    "Historique global de toutes les sessions, avec recherche et affichage coloré.",
    "Sessions persistantes : reprise des conversations là où vous en étiez."
  ]
};

// Compare deux versions "x.y.z" : renvoie 1 si a>b, -1 si a<b, 0 si egales.
function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

// Affiche les notes de version si on vient de mettre a jour (ou au 1er lancement).
function maybeShowChangelog() {
  const current = state.app?.appVersion;
  if (!current) {
    return;
  }
  const lastSeen = window.localStorage.getItem("lastSeenVersion");
  window.localStorage.setItem("lastSeenVersion", current);

  // Versions a presenter : toutes celles du changelog plus recentes que la
  // derniere vue (ou seulement la version courante au tout premier lancement).
  let toShow;
  if (!lastSeen) {
    toShow = CHANGELOG[current] ? [current] : [];
  } else if (compareVersions(current, lastSeen) > 0) {
    toShow = Object.keys(CHANGELOG)
      .filter((v) => compareVersions(v, lastSeen) > 0 && compareVersions(v, current) <= 0)
      .sort(compareVersions)
      .reverse();
  } else {
    toShow = [];
  }

  if (toShow.length) {
    showChangelog(toShow);
  }
}

function showChangelog(versions) {
  const overlay = document.createElement("div");
  overlay.className = "changelog-modal";

  const dialog = document.createElement("div");
  dialog.className = "changelog-dialog";

  const header = document.createElement("div");
  header.className = "changelog-header";
  header.innerHTML = '<i data-lucide="sparkles"></i><span>Quoi de neuf ?</span>';
  dialog.appendChild(header);

  const sub = document.createElement("div");
  sub.className = "changelog-sub";
  sub.textContent = `Mise à jour vers la version ${state.app.appVersion}`;
  dialog.appendChild(sub);

  const body = document.createElement("div");
  body.className = "changelog-body";
  for (const version of versions) {
    const section = document.createElement("div");
    section.className = "changelog-version";

    const vt = document.createElement("div");
    vt.className = "changelog-version-title";
    vt.textContent = `Version ${version}`;
    section.appendChild(vt);

    const ul = document.createElement("ul");
    for (const note of CHANGELOG[version] || []) {
      const li = document.createElement("li");
      li.textContent = note;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    body.appendChild(section);
  }
  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "changelog-actions";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "primary-button";
  ok.textContent = "Compris";
  ok.addEventListener("click", () => overlay.remove());
  actions.appendChild(ok);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  document.body.appendChild(overlay);
  createIcons();
}

async function init() {
  createIcons();
  state.app = await window.launcher.getAppState();
  state.config = await window.launcher.getConfig();

  if (elements.shellLabel && state.app.shellLabel) {
    elements.shellLabel.textContent = state.app.shellLabel;
  }

  if (elements.appVersionLabel && state.app.appVersion) {
    elements.appVersionLabel.textContent = `v${state.app.appVersion}`;
  }

  const isWindows = state.app.isWindows ?? state.app.platform === "win32";
  if (isWindows) {
    elements.adminStatus.textContent = state.app.isElevated ? "Admin actif" : "Admin inactif";
    elements.adminStatus.classList.toggle("bad", !state.app.isElevated);
  } else {
    // Sous Linux on adapte simplement le libelle (root / utilisateur).
    elements.adminStatus.textContent = state.app.isElevated ? "root" : "utilisateur";
    elements.adminStatus.classList.remove("bad");
  }
  bindEvents();
  setSidebarCollapsed(window.localStorage.getItem("sidebarCollapsed") === "1");
  setupCollapsiblePanels();
  setHeaderToolsHidden(window.localStorage.getItem("headerToolsHidden") === "1");
  elements.headerToolsButton.addEventListener("click", () => {
    setHeaderToolsHidden(!elements.activeTitleInput.parentElement.classList.contains("tools-hidden"));
  });
  setToolbarHidden(window.localStorage.getItem("toolbarHidden") === "1");
  elements.toolbarToggleButton.addEventListener("click", () => {
    setToolbarHidden(!elements.toolbar.classList.contains("tools-hidden"));
  });
  updateFolder(window.localStorage.getItem("lastFolder") || "");
  renderProfiles();
  renderPersonas();
  renderRelayOptions();
  refreshAuthStatus();
  createIcons();

  if (elements.autoRestoreToggle) {
    elements.autoRestoreToggle.checked = isAutoRestoreEnabled();
    elements.autoRestoreToggle.addEventListener("change", () => {
      setAutoRestoreEnabled(elements.autoRestoreToggle.checked);
    });
  }

  const savedSessions = await window.launcher.getSavedSessions();
  const autoRestore = isAutoRestoreEnabled();

  if (savedSessions && savedSessions.length && autoRestore) {
    for (const saved of savedSessions) {
      await restoreSession(saved);
    }
    showRestoreToast(savedSessions.length);
  } else {
    renderRestoreSection(savedSessions);
  }

  maybeShowChangelog();
  initJarvis();

  // Quota en temps reel de l'IA de l'onglet actif (inutile fenetre masquee).
  window.setInterval(() => {
    if (!document.hidden) {
      refreshUsageBar();
    }
  }, USAGE_POLL_MS);

  // Etat des IA des onglets : actif meme fenetre masquee (notifications de fin).
  window.setInterval(refreshLiveStatus, LIVE_POLL_MS);
  // Etat Git du dossier de l'onglet actif (fenetre visible seulement).
  window.setInterval(() => {
    if (!document.hidden) {
      refreshGitChip();
    }
  }, GIT_POLL_MS);
  window.addEventListener("focus", clearVisibleAttention);
  // Clic droit > Coller avec une image dans le presse-papiers.
  window.launcher.onPasteText(({ id, text }) => {
    const session = state.sessions.get(id);
    if (session) {
      pasteWithTrailingSpace(session, text);
    }
  });
  window.launcher.onNotifyActivate(({ sessionId }) => {
    if (state.sessions.has(sessionId)) {
      setActiveSession(sessionId);
    }
  });
}

function showRestoreToast(count) {
  const toast = document.createElement("div");
  toast.className = "restore-toast";

  const label = document.createElement("span");
  label.textContent = `${count} session${count > 1 ? "s" : ""} restaurée${count > 1 ? "s" : ""}`;
  toast.appendChild(label);

  const disable = document.createElement("button");
  disable.type = "button";
  disable.className = "restore-toast-btn";
  disable.textContent = "Ne plus restaurer automatiquement";
  disable.addEventListener("click", () => {
    setAutoRestoreEnabled(false);
    toast.remove();
  });
  toast.appendChild(disable);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "restore-toast-close";
  close.textContent = "×";
  close.title = "Fermer";
  close.addEventListener("click", () => toast.remove());
  toast.appendChild(close);

  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 12000);
}

init();
