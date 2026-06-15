const state = {
  config: null,
  selectedFolder: "",
  sessions: new Map(),
  activeSessionId: null,
  authStatus: null,
  app: null
};

const elements = {
  appShell: document.getElementById("appShell"),
  adminStatus: document.getElementById("adminStatus"),
  shellLabel: document.getElementById("shellLabel"),
  chooseFolderButton: document.getElementById("chooseFolderButton"),
  folderPath: document.getElementById("folderPath"),
  tabTitleInput: document.getElementById("tabTitleInput"),
  profileSelect: document.getElementById("profileSelect"),
  modeSelect: document.getElementById("modeSelect"),
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
  toggleSidebarButton: document.getElementById("toggleSidebarButton"),
  sessionMeta: document.getElementById("sessionMeta"),
  historyButton: document.getElementById("historyButton"),
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
    FitAddonCtor: window.FitAddon?.FitAddon
  };
}

function createTerminal() {
  const { TerminalCtor, FitAddonCtor } = getTerminalGlobals();
  const terminal = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: "bar",
    convertEol: true,
    copyOnSelect: true,
    fontFamily: "Cascadia Mono, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 10000,
    theme: TERMINAL_THEME
  });
  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);
  return { terminal, fitAddon };
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
  state.activeSessionId = id;

  for (const session of state.sessions.values()) {
    session.tab.classList.toggle("active", session.id === id);
    session.container.classList.toggle("active", session.id === id);
  }

  const active = state.sessions.get(id);
  elements.emptyState.classList.toggle("hidden", Boolean(active));
  elements.activeTitleInput.disabled = !active;
  elements.renameActiveTabButton.disabled = !active;
  elements.activeTitleInput.value = active?.title || "Aucun onglet";
  elements.sessionMeta.textContent = active ? `${active.command} | ${active.cwd}` : "Pret";

  if (active) {
    setTimeout(() => {
      active.fitAddon.fit();
      active.terminal.focus();
    }, 25);
  }
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

  await window.launcher.killTerminal(id);
  session.terminal.dispose();
  session.tab.remove();
  session.container.remove();
  state.sessions.delete(id);

  const next = state.sessions.keys().next().value || null;
  setActiveSession(next);
}

function createTerminalContainer(id) {
  const container = document.createElement("div");
  container.className = "terminal-pane";
  container.dataset.sessionId = id;
  elements.terminalHost.appendChild(container);
  return container;
}

function registerSession(session) {
  session.tab = createTab(session);
  state.sessions.set(session.id, session);
  setActiveSession(session.id);
}

async function openTerminalSession({ title, accent, starter, replayText }) {
  const { terminal, fitAddon } = createTerminal();
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
    accent,
    tab: null,
    container: createTerminalContainer(startResult.id)
  };

  terminal.open(session.container);
  fitAddon.fit();

  // Rejoue l'historique sauvegarde avant que la session ne soit enregistree,
  // donc avant que la sortie live ne commence a s'afficher.
  if (replayText) {
    terminal.write(replayText);
    terminal.write("\r\n\x1b[2m──────── reprise de session ────────\x1b[0m\r\n");
  }
  terminal.onData((data) => window.launcher.writeTerminal(session.id, data));
  terminal.onResize(({ cols: nextCols, rows: nextRows }) => {
    window.launcher.resizeTerminal(session.id, nextCols, nextRows);
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

  await openTerminalSession({
    title: saved.title,
    accent: profile?.accent || "#10b981",
    replayText,
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

  const title = elements.tabTitleInput.value.trim() || profile.label;
  await openTerminalSession({
    title,
    accent: profile.accent,
    starter: ({ cols, rows }) =>
      window.launcher.startTerminal({
        title,
        command: profile.command,
        modeArgs: mode.args || [],
        preLaunchCommands: mode.preLaunchCommands || [],
        extraArgs: elements.extraArgsInput.value,
        cwd: state.selectedFolder,
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: mode.id,
        modeLabel: mode.label,
        cols,
        rows
      })
  });
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

function bindEvents() {
  elements.chooseFolderButton.addEventListener("click", async () => {
    updateFolder(await window.launcher.chooseFolder());
  });

  elements.profileSelect.addEventListener("change", () => {
    renderModes();
    renderProfileSettings();
  });

  elements.modeSelect.addEventListener("change", renderProfileSettings);
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
  elements.historyResumeButton.addEventListener("click", resumeFromHistory);

  elements.updateInstallButton.addEventListener("click", () => {
    elements.updateBannerText.textContent = "Redémarrage pour installer la mise à jour…";
    elements.updateInstallButton.disabled = true;
    window.launcher.installUpdate();
  });
  elements.updateBannerClose.addEventListener("click", () => {
    elements.updateBanner.classList.add("hidden");
  });
  window.launcher.onUpdateStatus(handleUpdateStatus);

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
    const active = state.sessions.get(state.activeSessionId);
    if (active) {
      active.fitAddon.fit();
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
      session.terminal.write(data);
    }
  });

  window.launcher.onTerminalExit(({ id, exitCode }) => {
    const session = state.sessions.get(id);
    if (session) {
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

async function init() {
  createIcons();
  state.app = await window.launcher.getAppState();
  state.config = await window.launcher.getConfig();

  if (elements.shellLabel && state.app.shellLabel) {
    elements.shellLabel.textContent = state.app.shellLabel;
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
