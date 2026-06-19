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
  terminalHost: document.getElementById("terminalHost"),
  emptyState: document.getElementById("emptyState"),
  activeTitleInput: document.getElementById("activeTitleInput"),
  renameActiveTabButton: document.getElementById("renameActiveTabButton"),
  relaySelect: document.getElementById("relaySelect"),
  toggleSidebarButton: document.getElementById("toggleSidebarButton"),
  sessionMeta: document.getElementById("sessionMeta"),
  historyButton: document.getElementById("historyButton"),
  shortcutsButton: document.getElementById("shortcutsButton"),
  syncButton: document.getElementById("syncButton"),
  splitButton: document.getElementById("splitButton"),
  mirrorButton: document.getElementById("mirrorButton"),
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
    theme: TERMINAL_THEME
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

  updateSessionHeader();
  updateSplitControls();
  fitVisible();
}

function updateSessionHeader() {
  const active = state.sessions.get(state.activeSessionId);
  elements.emptyState.classList.toggle("hidden", state.sessions.size > 0);
  elements.activeTitleInput.disabled = !active;
  elements.renameActiveTabButton.disabled = !active;
  if (elements.relaySelect) {
    elements.relaySelect.disabled = !active;
    elements.relaySelect.value = "";
  }
  elements.activeTitleInput.value = active?.title || "Aucun onglet";
  elements.sessionMeta.textContent = active ? `${active.command} | ${active.cwd}` : "Pret";
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
    state.sessions.get(state.activeSessionId)?.terminal.focus();
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

  await window.launcher.killTerminal(id);
  session.terminal.dispose();
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
    title,
    command: startResult.command,
    cwd: startResult.cwd,
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

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
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

  // Si la CLI sait reprendre la conversation, elle reaffiche elle-meme le
  // contenu : inutile de rejouer l'historique (eviterait une duplication).
  // Sinon on rejoue le texte sauvegarde pour retrouver le fil visuellement.
  let replayText = "";
  if (!canResume && saved.id) {
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
        cwd: saved.cwd
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
          resumeArgs: resume?.args || [],
          resumeReplace: Boolean(resume?.replace),
          resumeId: saved.id,
          cwd: saved.cwd,
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
        cwd: saved.cwd,
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
  //    Les handlers d'entree/sortie lisent session.id en direct : il suffit de
  //    re-cler la session dans la Map.
  state.sessions.delete(id);
  session.id = startResult.id;
  session.command = startResult.command;
  session.cwd = startResult.cwd;
  session.accent = profile.accent;
  session.spec = {
    kind: "profile",
    title: session.title,
    accent: profile.accent,
    profileId: profile.id,
    modeId: mode.id,
    extraArgs: "",
    cwd: session.cwd,
    personaId: session.spec?.personaId || ""
  };
  state.sessions.set(session.id, session);
  session.relaying = false;
  session.tab.classList.remove("ended");
  session.tab.style.setProperty("--tab-accent", profile.accent);
  if (state.activeSessionId === id) {
    state.activeSessionId = session.id;
  }
  setActiveSession(session.id);

  // CLI sans canal d'instructions fiable (ex. Codex) : le contexte de relais
  // est envoye comme premier message une fois la nouvelle CLI prete.
  if (profile.personaInjection?.kind === "first-message") {
    session.hasOutput = false;
    sendFirstMessage(session, handoff);
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

  const file = files[0];
  if (file.path) {
    await window.launcher.pasteFilePath(active.id, file.path);
    elements.sessionMeta.textContent = `Fichier: ${file.path}`;
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
  { id: "renameTab", label: "Renommer l'onglet actif", category: "Onglets", run: () => focusRenameActive() },
  { id: "toggleSplit", label: "Vue partagée (deux onglets côte à côte)", category: "Vue partagée", run: () => toggleSplit() },
  { id: "toggleMirror", label: "Saisie synchronisée (miroir)", category: "Vue partagée", run: () => toggleMirror() },
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
  renameTab: "F2",
  toggleSplit: "Ctrl+\\",
  toggleMirror: "Ctrl+Shift+M",
  toggleSidebar: "Ctrl+B",
  openHistory: "Ctrl+Shift+H",
  openShortcuts: "Ctrl+,",
  showHelp: "F1",
  zoomIn: "Ctrl+=",
  zoomOut: "Ctrl+-",
  zoomReset: "Ctrl+0",
  findInTerminal: "Ctrl+Shift+F"
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

// Notes de version affichees apres une mise a jour. La cle est le numero de
// version, la valeur la liste des nouveautes a montrer.
const CHANGELOG = {
  "0.1.14": [
    "Vue partagée : affiche deux onglets côte à côte (bouton ⧉ de la barre d'outils ou Ctrl+\\).",
    "Clique un onglet pour le charger dans le pane sélectionné ; clique un terminal pour lui donner le focus.",
    "Saisie synchronisée (bouton 🔗 ou Ctrl+Maj+M) : ce que tu tapes part dans les deux panes — un même prompt envoyé à deux IA en même temps.",
    "Les deux terminaux s'ajustent automatiquement à la taille de la fenêtre."
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
