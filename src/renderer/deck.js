// Interface « Command Deck » (nouvelle interface) et choix de l'interface.
// Charge APRES renderer.js : la logique metier reste celle de renderer.js ;
// ce module deplace et rhabille les elements existants (memes id, memes
// ecouteurs) et ajoute la barre des sessions, les palettes et les toasts.
//
// - Nouvelle installation : nouvelle interface.
// - Mise a jour : on garde l'interface classique et on propose d'essayer la
//   nouvelle (retour possible a tout moment dans Reglages > Interface).

const UI_MODE_KEY = "uiMode";
const DECK_OFFER_KEY = "deckOfferPending";

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {}
}

// Decide l'interface au demarrage. "lastSeenVersion" n'existe que si le
// launcher a deja tourne : c'est une mise a jour, pas une premiere installation.
function decideUiMode() {
  const saved = readStorage(UI_MODE_KEY);
  if (saved === "deck" || saved === "classic") {
    return saved;
  }
  const existingUser = Boolean(readStorage("lastSeenVersion"));
  const mode = existingUser ? "classic" : "deck";
  writeStorage(UI_MODE_KEY, mode);
  if (existingUser) {
    writeStorage(DECK_OFFER_KEY, "1");
  }
  return mode;
}

const UI_MODE = decideUiMode();

function isDeckUi() {
  return UI_MODE === "deck";
}

// --- Choix de l'interface (les deux interfaces) ------------------------------
async function switchUiMode(mode) {
  writeStorage(UI_MODE_KEY, mode);
  writeStorage(DECK_OFFER_KEY, null);
  try {
    await window.launcher.relaunchApp();
  } catch {
    window.location.reload();
  }
}

function confirmUiSwitch(mode, close) {
  const restore = isAutoRestoreEnabled();
  const label = mode === "deck" ? "la nouvelle interface" : "l'interface classique";
  const note = restore
    ? "Le Launcher va redémarrer et rouvrir tes onglets (les IA reprennent leur conversation)."
    : "Le Launcher va redémarrer. La restauration automatique est désactivée : tes onglets seront proposés à la restauration au démarrage.";
  if (!state.sessions.size || window.confirm(`Passer à ${label} ?\n\n${note}`)) {
    close?.();
    switchUiMode(mode);
  }
}

function openInterfaceSettings() {
  const modal = createModal({
    icon: "layout-dashboard",
    title: "Interface",
    sub: "Choisis l'interface du Launcher. Tu peux changer à tout moment : toutes les fonctions sont disponibles dans les deux.",
    dialogClass: "ui-mode-dialog"
  });
  const options = [
    {
      id: "deck",
      name: "Nouvelle interface (Command Deck)",
      text: "Liste des sessions à gauche, palette « Nouvelle session » (Ctrl T) et palette de commandes (Ctrl K), thème sombre épuré."
    },
    {
      id: "classic",
      name: "Interface classique",
      text: "Formulaire de lancement dans le menu de gauche et barre d'outils à menus (Créer, Bibliothèque, Affichage, Réglages)."
    }
  ];
  const list = document.createElement("div");
  list.className = "ui-mode-list";
  for (const option of options) {
    const card = document.createElement("div");
    card.className = `ui-mode-card${option.id === UI_MODE ? " current" : ""}`;
    const name = document.createElement("strong");
    name.textContent = option.name;
    const text = document.createElement("p");
    text.textContent = option.text;
    card.append(name, text);
    if (option.id === UI_MODE) {
      const tag = document.createElement("span");
      tag.className = "ui-mode-tag";
      tag.textContent = "Interface actuelle";
      card.appendChild(tag);
    } else {
      const use = document.createElement("button");
      use.type = "button";
      use.className = "primary-button";
      use.textContent = "Utiliser cette interface";
      use.addEventListener("click", () => confirmUiSwitch(option.id, modal.close));
      card.appendChild(use);
    }
    list.appendChild(card);
  }
  modal.body.appendChild(list);
  createIcons();
}

// Proposition (une seule fois) aux utilisateurs qui mettent a jour.
function maybeOfferDeck() {
  if (isDeckUi() || readStorage(DECK_OFFER_KEY) !== "1") {
    return;
  }
  // On attend que les notes de version soient fermees.
  if (document.querySelector(".changelog-modal")) {
    window.setTimeout(maybeOfferDeck, 1000);
    return;
  }
  writeStorage(DECK_OFFER_KEY, null);
  const modal = createModal({
    icon: "sparkles",
    title: "Nouvelle interface disponible",
    sub: "Le Launcher a une nouvelle interface : liste des sessions avec leur statut, lancement en un clic (Ctrl T), toutes les actions au même endroit (Ctrl K).",
    dialogClass: "ui-mode-dialog"
  });
  const note = document.createElement("p");
  note.className = "ui-mode-note";
  note.textContent = "Si elle ne te plaît pas, tu peux revenir à l'ancienne interface à tout moment dans Réglages > Interface.";
  modal.body.appendChild(note);
  const later = modal.actions.querySelector("button");
  later.textContent = "Plus tard";
  later.className = "ghost-button";
  const tryIt = document.createElement("button");
  tryIt.type = "button";
  tryIt.className = "primary-button";
  tryIt.textContent = "Essayer la nouvelle interface";
  tryIt.addEventListener("click", () => confirmUiSwitch("deck", modal.close));
  modal.actions.appendChild(tryIt);
  createIcons();
}

SHORTCUT_ACTIONS.push({
  id: "openInterface",
  label: "Interface (nouvelle / classique)",
  category: "Navigation",
  run: () => openInterfaceSettings()
});
document.getElementById("uiModeButton")?.addEventListener("click", openInterfaceSettings);
window.setTimeout(maybeOfferDeck, 2500);

// =============================================================================
// Command Deck
// =============================================================================
const deck = {
  el: {},
  pop: null,
  palette: null,
  pal: null,
  refreshQueued: false,
  toasts: [],
  recentToast: new Map(),
  waitTail: new Map()
};

const CLI_GLYPHS = {
  claude: ["CC", "#D97757"],
  codex: ["CX", "#E8EAEE"],
  gemini: ["GE", "#5B8DEF"],
  antigravity: ["AG", "#5B8DEF"],
  qwen: ["QW", "#9B7BFF"],
  aider: ["AI", "#3FCF8E"],
  opencode: ["OC", "#F5C04A"],
  cursor: ["CU", "#B0B8C4"],
  amp: ["AM", "#FF6B9A"]
};

// Prompts de confirmation reconnus dans le terminal (CLI sans etat exact).
// Liste centrale, facile a etendre.
const WAIT_PATTERNS = [
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /\[o\/n\]/i,
  /do you want to/i,
  /voulez-vous|veux-tu/i,
  /allow (this|once|always)/i,
  /❯\s*1\.\s*yes/i,
  /press enter to (continue|confirm)/i
];
const YES_NO_PATTERN = /\[y\/n\]|\(y\/n\)|\[o\/n\]/i;

function deckGlyph(profileId) {
  const profile = state.config?.profiles?.find((p) => p.id === profileId);
  const known = CLI_GLYPHS[profileId];
  if (known) {
    return { text: known[0], color: known[1] };
  }
  const label = String(profile?.label || profileId || "?").replace(/[^A-Za-z0-9]/g, "");
  return { text: (label.slice(0, 2) || "?").toUpperCase(), color: profile?.accent || "#8B93A1" };
}

function deckGlyphEl(profileId, size = 24) {
  const glyph = deckGlyph(profileId);
  const span = document.createElement("span");
  span.className = "deck-glyph";
  span.style.setProperty("--glyph-size", `${size}px`);
  span.style.background = glyph.color;
  span.textContent = glyph.text;
  return span;
}

function isRiskyMode(mode) {
  const text = `${mode?.id || ""} ${mode?.label || ""} ${(mode?.args || []).join(" ")}`;
  return /grant|danger|yolo|yes-always|--force|bypass|dangerously/i.test(text);
}

function deckProfile(session) {
  return state.config?.profiles?.find((p) => p.id === sessionProfileId(session)) || null;
}

function deckMode(session) {
  const profile = deckProfile(session);
  return profile?.modes?.find((m) => m.id === session?.spec?.modeId) || null;
}

function authOf(profileId) {
  const status = state.authStatus?.profiles?.find((s) => s.id === profileId);
  if (!status) {
    return { key: "unknown", label: "…", color: "#5A6272" };
  }
  if (!status.commandOk) {
    return { key: "off", label: "Non installé", color: "#8B93A1", status };
  }
  if (status.state === "ok") {
    return { key: "ok", label: "Connecté", color: "#5FD68A", status };
  }
  return { key: "warn", label: "Sans token", color: "#F5C04A", status };
}

// work / wait / idle d'un onglet (reutilise l'etat calcule par renderer.js).
function deckStatus(session) {
  if (session.aiState === "waiting" || deck.waitTail.get(session.id)) {
    return "wait";
  }
  if (session.aiState === "busy") {
    return "work";
  }
  return "idle";
}

function normalizeText(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function chordLabel(chord) {
  return String(chord || "").replace(/Shift/g, "Maj").replace(/\+/g, " ").replace("Escape", "Échap");
}

// Chemin long raccourci pour l'affichage : « …\parent\dossier ».
function shortPath(path, max = 42) {
  const text = String(path || "");
  if (text.length <= max) {
    return text;
  }
  const sep = text.includes("\\") ? "\\" : "/";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return `…${sep}${parts.slice(-2).join(sep)}`;
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function make(tag, className, html) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (html !== undefined) {
    node.innerHTML = html;
  }
  return node;
}

// --- Toasts ------------------------------------------------------------------
function deckToast(text, kind = "info") {
  if (!isDeckUi() || !text) {
    return;
  }
  const now = Date.now();
  if (now - (deck.recentToast.get(text) || 0) < 2000) {
    return;
  }
  deck.recentToast.set(text, now);
  const toast = make("div", `deck-toast ${kind}`);
  toast.setAttribute("role", "status");
  toast.append(make("span", "deck-toast-dot"), Object.assign(document.createElement("span"), { textContent: text }));
  deck.el.toasts.appendChild(toast);
  while (deck.el.toasts.children.length > 4) {
    deck.el.toasts.firstChild.remove();
  }
  const life = Math.min(9000, 3600 + text.length * 25);
  window.setTimeout(() => toast.remove(), life);
}

// --- Popovers ------------------------------------------------------------------
function closeDeckPopover() {
  deck.pop?.remove();
  deck.pop = null;
}

function openDeckPopover(anchor, build, { align = "left", width = 320 } = {}) {
  closeDeckPopover();
  const pop = make("div", "deck-pop");
  pop.style.width = `${width}px`;
  build(pop);
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(rect.bottom + 6)}px`;
  if (align === "right") {
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
  } else {
    pop.style.left = `${Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8))}px`;
  }
  deck.pop = pop;
  createIcons();
  return pop;
}

function popItem(pop, label, onClick, { hint = "", iconName = "", active = false } = {}) {
  const item = make("button", `deck-pop-item${active ? " active" : ""}`);
  item.type = "button";
  if (iconName) {
    item.insertAdjacentHTML("beforeend", icon(iconName));
  }
  const text = make("span", "deck-pop-label");
  text.textContent = label;
  item.appendChild(text);
  if (hint) {
    const h = make("span", "deck-pop-hint");
    h.textContent = hint;
    item.appendChild(h);
  }
  item.addEventListener("click", () => {
    closeDeckPopover();
    onClick();
  });
  pop.appendChild(item);
  return item;
}

function popTitle(pop, text) {
  const title = make("div", "deck-pop-title");
  title.textContent = text;
  pop.appendChild(title);
}

// --- Dossiers recents ------------------------------------------------------------
function recentFolders() {
  let list = [];
  try {
    list = JSON.parse(readStorage("deckRecentFolders") || "[]");
  } catch {}
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function rememberFolder(path) {
  if (!path) {
    return;
  }
  const list = recentFolders().filter((p) => !sameFolder(p, path));
  list.unshift(path);
  writeStorage("deckRecentFolders", JSON.stringify(list.slice(0, 6)));
}

function folderSessionCount(path) {
  return [...state.sessions.values()].filter((s) => sameFolder(s.cwd || s.spec?.cwd, path)).length;
}

function openFolderPopover() {
  openDeckPopover(deck.el.folderChip, (pop) => {
    popTitle(pop, "Dossiers récents");
    const folders = recentFolders();
    if (state.selectedFolder && !folders.some((p) => sameFolder(p, state.selectedFolder))) {
      folders.unshift(state.selectedFolder);
    }
    for (const path of folders.slice(0, 6)) {
      const count = folderSessionCount(path);
      popItem(pop, path, () => {
        updateFolder(path);
        deckToast(`Dossier : ${path}`);
      }, { hint: count ? `${count} session${count > 1 ? "s" : ""}` : "", active: sameFolder(path, state.selectedFolder) }).classList.add("mono");
    }
    pop.appendChild(make("div", "deck-pop-sep"));
    popItem(pop, "Parcourir…", () => elements.chooseFolderButton.click(), { iconName: "folder-search" });
  }, { width: 380 });
}

// --- Relais ------------------------------------------------------------------------
function openRelayPopover(anchor = deck.el.relayButton) {
  const session = state.sessions.get(state.activeSessionId);
  if (!session || session.type !== "terminal") {
    deckToast("Aucune session IA active pour passer le relais.");
    return;
  }
  const currentId = sessionProfileId(session);
  openDeckPopover(anchor, (pop) => {
    popTitle(pop, `Passer « ${session.title} » à…`);
    for (const profile of sortProfiles(state.config.profiles)) {
      if (profile.id === currentId || authOf(profile.id).key === "off") {
        continue;
      }
      const item = popItem(pop, profile.label, () => relaySession(session.id, profile.id), { hint: "même conversation" });
      item.prepend(deckGlyphEl(profile.id, 22));
    }
  }, { align: "right", width: 300 });
}

// --- Reglages (roue dentee) --------------------------------------------------------
function openSettingsPopover() {
  openDeckPopover(deck.el.settingsButton, (pop) => {
    popTitle(pop, "Réglages");
    popItem(pop, "Interface (nouvelle / classique)", openInterfaceSettings, { iconName: "layout-dashboard" });
    popItem(pop, "Thème et couleurs", openThemeSettings, { iconName: "palette" });
    popItem(pop, "Gérer les profils CLI", openProfilesModal, { iconName: "settings-2" });
    popItem(pop, "Gérer les personas", openPersonasModal, { iconName: "sparkles" });
    popItem(pop, "Comptes Claude", openAccountsModal, { iconName: "users" });
    popItem(pop, "Synchronisation", () => elements.syncButton.click(), { iconName: "refresh-cw" });
    popItem(pop, "Raccourcis clavier", openShortcutsModal, { iconName: "keyboard", hint: chordLabel(keybindings.openShortcuts) });
    pop.appendChild(make("div", "deck-pop-sep"));
    popItem(pop, `Restauration auto : ${isAutoRestoreEnabled() ? "activée" : "désactivée"}`, toggleAutoRestore, { iconName: "history" });
    popItem(pop, `Notifications de fin de tâche : ${notificationsEnabled() ? "activées" : "désactivées"}`, toggleNotifications, { iconName: "bell" });
    popItem(pop, "Vérifier les mises à jour", checkUpdatesNow, { iconName: "download-cloud" });
  }, { align: "right", width: 330 });
}

function toggleAutoRestore() {
  setAutoRestoreEnabled(!isAutoRestoreEnabled());
  deckToast(`Restauration auto ${isAutoRestoreEnabled() ? "activée" : "désactivée"}`);
  scheduleDeckRefresh();
}

async function checkUpdatesNow() {
  try {
    const result = await window.launcher.checkUpdate();
    if (result && result.ok === false && result.reason === "dev") {
      deckToast("Vérification des mises à jour indisponible en version de développement.");
    }
  } catch {}
}

// --- Palette de commandes (Ctrl K) ----------------------------------------------
function commandItems() {
  const covered = new Set();
  const items = [];
  const add = (group, label, run, actionId = "", extraHint = "") => {
    if (actionId) {
      covered.add(actionId);
    }
    items.push({ group, label, run, hint: extraHint || (actionId ? chordLabel(keybindings[actionId]) : "") });
  };
  add("Action", "Nouvelle session", openLaunchPalette, "newTab");
  add("Action", "Changer de dossier", openFolderPopover);
  add("Action", "Passer le relais à une autre IA", () => openRelayPopover(deck.el.relayButton));
  add("Action", "Gérer les profils CLI", openProfilesModal);
  add("Action", "Installer une CLI", openProfilesModal);
  add("Action", "Gérer les personas", openPersonasModal);
  for (const id of orderedSessionIds()) {
    const session = state.sessions.get(id);
    if (!session) {
      continue;
    }
    const profile = deckProfile(session);
    const label = profile ? `${session.title} — ${profile.label}` : session.title;
    add("Session", label, () => setActiveSession(id), "", deckStatus(session) === "wait" ? "à valider" : "");
  }
  add("Vue", state.split ? "Quitter la vue partagée" : "Vue partagée", toggleSplit, "toggleSplit");
  add("Vue", "Vue chat / terminal", toggleChatView, "toggleChatView");
  add("Vue", elements.appShell.classList.contains("sidebar-collapsed") ? "Afficher le menu" : "Masquer le menu", toggleDeckSidebar, "toggleSidebar");
  add("Vue", "Saisie synchronisée (vue partagée)", toggleMirror, "toggleMirror");
  add("Outil", "Historique global", openHistory, "openHistory");
  add("Outil", "Bibliothèque de prompts", openPrompts, "openPrompts");
  add("Outil", "Conversations Claude", openConversations, "openConversations");
  add("Outil", "Pipeline IA", openPipelineTab, "openPipeline");
  add("Outil", "Claude Design", () => elements.designButton.click());
  add("Outil", "Artifacts", () => elements.artifactsButton.click());
  add("Outil", "Changements Git de l'onglet", openGitChanges, "openGitChanges");
  add("Réglages", "Interface (nouvelle / classique)", openInterfaceSettings, "openInterface");
  add("Réglages", "Thème et couleurs", openThemeSettings);
  add("Réglages", "Comptes Claude", openAccountsModal, "openAccounts");
  add("Réglages", "Synchronisation", () => elements.syncButton.click());
  add("Réglages", "Raccourcis clavier", openShortcutsModal, "openShortcuts");
  add("Réglages", `Restauration auto (${isAutoRestoreEnabled() ? "activée" : "désactivée"})`, toggleAutoRestore);
  add("Réglages", "Vérifier les mises à jour", checkUpdatesNow);
  add("JARVIS", "Ouvrir JARVIS", () => elements.jarvisButton.click(), "openJarvis");
  // Toutes les autres actions des raccourcis (dupliquer, relancer, police...).
  for (const action of SHORTCUT_ACTIONS) {
    if (!covered.has(action.id) && action.id !== "commandPalette") {
      add(action.category === "JARVIS" ? "JARVIS" : action.category === "Terminal" ? "Terminal" : "Onglets", action.label, action.run, action.id);
    }
  }
  return items;
}

function openCommandPalette() {
  closeDeckPopover();
  closeDeckPalette();
  const overlay = make("div", "deck-overlay");
  const dialog = make("div", "deck-palette deck-cmd");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Commandes");
  const head = make("div", "deck-cmd-head", icon("search"));
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Tape une action ou le nom d'une session…";
  input.setAttribute("aria-label", "Rechercher une action");
  head.append(input, make("kbd", "", "Échap"));
  const list = make("div", "deck-cmd-list");
  const foot = make("div", "deck-cmd-foot", "<span>↑↓ naviguer</span><span>Entrée valider</span><span>Échap fermer</span>");
  dialog.append(head, list, foot);
  overlay.appendChild(dialog);

  const all = commandItems();
  let filtered = all;
  let index = 0;
  const render = () => {
    list.innerHTML = "";
    if (!filtered.length) {
      const empty = make("div", "deck-cmd-empty");
      empty.textContent = `Aucune action pour « ${input.value} »`;
      list.appendChild(empty);
      return;
    }
    filtered.forEach((item, i) => {
      const row = make("button", `deck-cmd-row${i === index ? " selected" : ""}`);
      row.type = "button";
      const group = make("span", "deck-cmd-group");
      group.textContent = item.group;
      const label = make("span", "deck-cmd-label");
      label.textContent = item.label;
      const hint = make("kbd", "deck-cmd-hint");
      hint.textContent = item.hint || "";
      row.append(group, label, hint);
      row.addEventListener("mousemove", () => {
        if (index !== i) {
          index = i;
          render();
        }
      });
      row.addEventListener("click", () => run(item));
      list.appendChild(row);
    });
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };
  const run = (item) => {
    closeDeckPalette();
    try {
      item.run();
    } catch {}
  };
  input.addEventListener("input", () => {
    const q = normalizeText(input.value.trim());
    filtered = q ? all.filter((item) => normalizeText(`${item.group} ${item.label}`).includes(q)) : all;
    index = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = Math.min(filtered.length - 1, index + 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = Math.max(0, index - 1);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[index]) {
        run(filtered[index]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeDeckPalette();
    }
  });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      closeDeckPalette();
    }
  });
  document.body.appendChild(overlay);
  deck.palette = overlay;
  render();
  createIcons();
  input.focus();
}

function closeDeckPalette() {
  if (!deck.palette) {
    return;
  }
  deck.palette.remove();
  deck.palette = null;
  fitVisible();
}

// --- Palette « Nouvelle session » ------------------------------------------------
function lastModeFor(profileId) {
  try {
    return JSON.parse(readStorage("deckLastModes") || "{}")[profileId] || "";
  } catch {
    return "";
  }
}

function rememberLaunchChoice(profileId, modeId) {
  writeStorage("deckLastProfile", profileId);
  let modes = {};
  try {
    modes = JSON.parse(readStorage("deckLastModes") || "{}");
  } catch {}
  modes[profileId] = modeId;
  writeStorage("deckLastModes", JSON.stringify(modes));
}

function defaultTitleFor(profile) {
  const taken = new Set([...state.sessions.values()].map((s) => s.title));
  if (!taken.has(profile.label)) {
    return profile.label;
  }
  let n = 2;
  while (taken.has(`${profile.label} ${n}`)) {
    n += 1;
  }
  return `${profile.label} ${n}`;
}

function openLaunchPalette() {
  if (!state.config) {
    return;
  }
  closeDeckPopover();
  closeDeckPalette();
  const profiles = sortProfiles(state.config.profiles);
  const savedProfile = readStorage("deckLastProfile");
  // Derniere IA choisie, sinon la premiere installee (favoris d'abord).
  const startProfile = profiles.find((p) => p.id === savedProfile)
    || profiles.find((p) => authOf(p.id).key === "ok")
    || profiles.find((p) => authOf(p.id).key !== "off")
    || profiles[0];
  deck.pal = {
    profileId: startProfile?.id || "",
    modeId: "",
    title: "",
    args: "",
    personaId: elements.personaSelect.value || "",
    accountId: selectedAccountId()
  };

  const overlay = make("div", "deck-overlay");
  const dialog = make("div", "deck-palette deck-launch");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Nouvelle session");
  overlay.appendChild(dialog);

  const head = make("div", "deck-launch-head", '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5,6 11,12 5,18"></polyline><line x1="13" y1="18" x2="19" y2="18"></line></svg>');
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "deck-launch-title";
  titleInput.setAttribute("aria-label", "Titre de la session");
  head.append(titleInput, make("kbd", "", "Échap"));

  const cliHead = make("div", "deck-section-label");
  cliHead.innerHTML = "<span>Choisir l'IA</span>";
  const refresh = make("button", "deck-mini-btn", icon("refresh-cw"));
  refresh.type = "button";
  refresh.title = "Actualiser l'état des connexions";
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    await refreshAuthStatus();
    refresh.disabled = false;
    render();
  });
  const editProfile = make("button", "deck-link", "modifier le profil");
  editProfile.type = "button";
  editProfile.addEventListener("click", () => {
    closeDeckPalette();
    openProfilesModal(deck.pal.profileId);
  });
  cliHead.append(refresh, editProfile);

  const grid = make("div", "deck-cli-grid");
  const modeHead = make("div", "deck-section-label", "<span>Mode</span>");
  const chips = make("div", "deck-mode-chips");
  const preview = make("div", "deck-preview mono");
  const warn = make("div", "deck-launch-warn");
  const fields = make("div", "deck-launch-fields");
  const footer = make("div", "deck-launch-foot");
  const footNote = make("span", "deck-launch-note");
  footNote.textContent = "Entrée pour lancer · le titre est facultatif";
  const cancel = make("button", "deck-btn ghost", "Annuler");
  cancel.type = "button";
  cancel.addEventListener("click", closeDeckPalette);
  const launch = make("button", "deck-btn primary");
  launch.type = "button";
  footer.append(footNote, cancel, launch);

  // Champs : dossier, compte Claude, persona, arguments.
  const folderField = make("label", "deck-field", "<span>Dossier</span>");
  const folderSelect = document.createElement("select");
  folderField.appendChild(folderSelect);
  const accountField = make("label", "deck-field", "<span>Compte Claude</span>");
  const accountSelect = document.createElement("select");
  accountField.appendChild(accountSelect);
  const personaField = make("label", "deck-field", "<span>Persona</span>");
  const personaSelect = document.createElement("select");
  personaField.appendChild(personaSelect);
  const argsField = make("label", "deck-field", "<span>Arguments</span>");
  const argsInput = document.createElement("input");
  argsInput.type = "text";
  argsInput.placeholder = "Optionnel";
  argsInput.className = "mono";
  argsField.appendChild(argsInput);
  fields.append(folderField, accountField, personaField, argsField);

  dialog.append(head, cliHead, grid, modeHead, chips, preview, warn, fields, footer);

  const fillFolders = () => {
    folderSelect.innerHTML = "";
    const list = recentFolders();
    if (state.selectedFolder && !list.some((p) => sameFolder(p, state.selectedFolder))) {
      list.unshift(state.selectedFolder);
    }
    if (!state.selectedFolder) {
      const none = new Option("Aucun dossier choisi", "");
      folderSelect.appendChild(none);
    }
    for (const path of list) {
      folderSelect.appendChild(new Option(path, path));
    }
    folderSelect.appendChild(new Option("Parcourir…", "__browse__"));
    folderSelect.value = state.selectedFolder || "";
  };
  folderSelect.addEventListener("change", async () => {
    if (folderSelect.value === "__browse__") {
      const picked = await window.launcher.chooseFolder();
      if (picked) {
        updateFolder(picked);
      }
      fillFolders();
      render();
      return;
    }
    if (folderSelect.value) {
      updateFolder(folderSelect.value);
      render();
    }
  });

  const fillAccounts = () => {
    accountSelect.innerHTML = "";
    for (const account of accountsState.accounts) {
      const option = new Option(account.loggedIn ? account.label : `${account.label} (non connecté)`, account.id);
      option.title = accountOptionText(account);
      accountSelect.appendChild(option);
    }
    accountSelect.appendChild(new Option("Gérer les comptes…", "__manage__"));
    accountSelect.value = deck.pal.accountId;
  };
  accountSelect.addEventListener("change", () => {
    if (accountSelect.value === "__manage__") {
      closeDeckPalette();
      openAccountsModal();
      return;
    }
    deck.pal.accountId = accountSelect.value;
  });

  const fillPersonas = () => {
    personaSelect.innerHTML = "";
    personaSelect.appendChild(new Option("Aucune", ""));
    for (const persona of getPersonas()) {
      personaSelect.appendChild(new Option(persona.name || persona.label || persona.id, persona.id));
    }
    personaSelect.appendChild(new Option("Gérer les personas…", "__manage__"));
    personaSelect.value = deck.pal.personaId;
    if (personaSelect.value !== deck.pal.personaId) {
      personaSelect.value = "";
    }
  };
  personaSelect.addEventListener("change", () => {
    if (personaSelect.value === "__manage__") {
      closeDeckPalette();
      openPersonasModal();
      return;
    }
    deck.pal.personaId = personaSelect.value;
  });

  const current = () => {
    const profile = state.config.profiles.find((p) => p.id === deck.pal.profileId) || profiles[0];
    const mode = profile?.modes.find((m) => m.id === deck.pal.modeId)
      || profile?.modes.find((m) => m.id === lastModeFor(profile.id))
      || profile?.modes.find((m) => m.id === profile.defaultModeId)
      || profile?.modes[0];
    return { profile, mode };
  };

  const render = () => {
    const { profile, mode } = current();
    if (!profile) {
      return;
    }
    deck.pal.profileId = profile.id;
    deck.pal.modeId = mode?.id || "";
    const auth = authOf(profile.id);
    const notInstalled = auth.key === "off";
    const risky = !notInstalled && isRiskyMode(mode);

    titleInput.placeholder = `Titre de la session (par défaut : ${defaultTitleFor(profile)})`;

    grid.innerHTML = "";
    for (const p of profiles) {
      const a = authOf(p.id);
      const card = make("button", `deck-cli-card${p.id === profile.id ? " selected" : ""}${a.key === "off" ? " off" : ""}`);
      card.type = "button";
      card.setAttribute("aria-pressed", String(p.id === profile.id));
      card.title = a.status ? buildAuthTooltip(a.status) : p.label;
      const top = make("span", "deck-cli-top");
      const authLabel = make("span", "deck-cli-auth");
      authLabel.textContent = a.label;
      authLabel.style.color = a.color;
      top.append(deckGlyphEl(p.id, 24), authLabel);
      const name = make("span", "deck-cli-name");
      name.textContent = `${p.favorite ? "★ " : ""}${p.label}`;
      const cmd = make("span", "deck-cli-cmd mono");
      cmd.textContent = p.command;
      card.append(top, name, cmd);
      card.addEventListener("click", () => {
        deck.pal.profileId = p.id;
        deck.pal.modeId = "";
        render();
      });
      card.addEventListener("dblclick", () => doLaunch());
      grid.appendChild(card);
    }

    chips.innerHTML = "";
    for (const m of profile.modes) {
      const danger = isRiskyMode(m);
      const chip = make("button", `deck-chip-mode${m.id === mode?.id ? " selected" : ""}${danger ? " danger" : ""}`);
      chip.type = "button";
      chip.textContent = `${danger ? "! " : ""}${m.label}`;
      chip.title = stringifyArgs(m.args) || "sans argument";
      chip.addEventListener("click", () => {
        deck.pal.modeId = m.id;
        render();
      });
      chips.appendChild(chip);
    }

    const args = argsInput.value.trim();
    const folder = state.selectedFolder ? shortPath(state.selectedFolder) : "(aucun dossier)";
    const commandText = notInstalled
      ? profile.installCommand || "(commande d'installation inconnue)"
      : [profile.command, stringifyArgs(mode?.args), args].filter(Boolean).join(" ");
    preview.innerHTML = "";
    const promptPart = make("span", "deck-preview-ps");
    promptPart.textContent = `${state.app?.isWindows === false ? "$" : "PS"} ${folder}> `;
    const cmdPart = make("span", "deck-preview-cmd");
    cmdPart.textContent = commandText;
    preview.append(promptPart, cmdPart);
    preview.title = commandText;

    warn.innerHTML = "";
    if (notInstalled) {
      const line = make("div", "deck-warn-line warn");
      line.textContent = `${profile.label} n'est pas détecté dans le PATH : on l'installe dans un onglet.`;
      warn.appendChild(line);
    } else if (risky) {
      const line = make("div", "deck-warn-line danger");
      line.textContent = "Ce mode laisse l'IA modifier des fichiers et exécuter des commandes sans te demander.";
      warn.appendChild(line);
    }
    if (!state.selectedFolder) {
      const line = make("div", "deck-warn-line warn");
      line.textContent = "Choisis un dossier de travail pour lancer la session.";
      warn.appendChild(line);
    }

    accountField.classList.toggle("hidden", profile.id !== "claude");
    launch.className = `deck-btn primary${notInstalled ? " warn" : risky ? " danger" : ""}`;
    launch.innerHTML = "";
    launch.append(`${notInstalled ? "Installer" : "Lancer"} ${profile.label} `);
    launch.appendChild(make("kbd", "", "Entrée"));
    launch.disabled = notInstalled ? !profile.installCommand : !state.selectedFolder;
  };

  const doLaunch = async () => {
    const { profile, mode } = current();
    if (!profile || !mode) {
      return;
    }
    if (authOf(profile.id).key === "off") {
      elements.profileSelect.value = profile.id;
      renderModes(mode.id);
      closeDeckPalette();
      await installSelectedProfile();
      deckToast(`Installation de ${profile.label} lancée`);
      return;
    }
    if (!state.selectedFolder) {
      folderSelect.focus();
      deckToast("Choisis d'abord un dossier de travail.", "warn");
      return;
    }
    const title = titleInput.value.trim() || defaultTitleFor(profile);
    // On remplit le formulaire d'origine puis on lance exactement comme lui :
    // meme commande, memes arguments, meme persona et meme compte.
    elements.profileSelect.value = profile.id;
    renderModes(mode.id);
    renderAccountSelect();
    if (profile.id === "claude" && deck.pal.accountId) {
      document.getElementById("accountSelect").value = deck.pal.accountId;
    }
    elements.personaSelect.value = deck.pal.personaId || "";
    elements.tabTitleInput.value = title;
    elements.extraArgsInput.value = argsInput.value;
    rememberLaunchChoice(profile.id, mode.id);
    closeDeckPalette();
    await launchSession();
    elements.extraArgsInput.value = "";
    deckToast(`Session lancée : ${title}`, "ok");
  };
  launch.addEventListener("click", doLaunch);

  const onKey = (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      doLaunch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeDeckPalette();
    }
  };
  titleInput.addEventListener("keydown", onKey);
  argsInput.addEventListener("keydown", onKey);
  argsInput.addEventListener("input", render);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDeckPalette();
    }
  });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      closeDeckPalette();
    }
  });

  fillFolders();
  fillAccounts();
  fillPersonas();
  render();
  document.body.appendChild(overlay);
  deck.palette = overlay;
  createIcons();
  titleInput.focus();
}

// --- Fenetre « Gerer les profils » (ancien panneau Profil actif) ----------------
function openProfilesModal(profileId) {
  closeDeckPopover();
  closeDeckPalette();
  const panel = elements.commandInput.closest(".panel");
  if (!panel) {
    return;
  }
  if (profileId) {
    elements.profileSelect.value = profileId;
    renderModes();
  }
  const home = { parent: panel.parentNode, next: panel.nextSibling, collapsed: panel.classList.contains("collapsed") };
  panel.classList.remove("collapsed");

  const overlay = make("div", "deck-overlay");
  const dialog = make("div", "deck-palette deck-profiles");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Gérer les profils");
  const head = make("div", "deck-launch-head", icon("settings-2"));
  const title = make("strong", "deck-profiles-title");
  title.textContent = "Gérer les profils CLI";
  const closeButton = make("button", "deck-mini-btn", icon("x"));
  closeButton.type = "button";
  closeButton.title = "Fermer (Échap)";
  head.append(title, closeButton);
  const body = make("div", "deck-profiles-body");
  const list = make("div", "deck-profiles-list");
  const side = make("div", "deck-profiles-form");
  const modeLabel = make("div", "deck-section-label", "<span>Mode à modifier</span>");
  const modeChips = make("div", "deck-mode-chips");
  side.append(modeLabel, modeChips, panel);
  body.append(list, side);
  dialog.append(head, body);
  overlay.appendChild(dialog);

  const render = () => {
    list.innerHTML = "";
    for (const profile of sortProfiles(state.config.profiles)) {
      const row = make("button", `deck-profile-row${profile.id === elements.profileSelect.value ? " selected" : ""}`);
      row.type = "button";
      const name = make("span", "deck-profile-name");
      name.textContent = `${profile.favorite ? "★ " : ""}${profile.label}`;
      const auth = authOf(profile.id);
      const state_ = make("span", "deck-profile-auth");
      state_.textContent = auth.label;
      state_.style.color = auth.color;
      row.append(deckGlyphEl(profile.id, 22), name, state_);
      row.addEventListener("click", () => {
        elements.profileSelect.value = profile.id;
        renderModes();
        render();
      });
      list.appendChild(row);
    }
    const profile = getSelectedProfile();
    modeChips.innerHTML = "";
    for (const mode of profile?.modes || []) {
      const chip = make("button", `deck-chip-mode${mode.id === elements.modeSelect.value ? " selected" : ""}${isRiskyMode(mode) ? " danger" : ""}`);
      chip.type = "button";
      chip.textContent = mode.label;
      chip.addEventListener("click", () => {
        renderModes(mode.id);
        render();
      });
      modeChips.appendChild(chip);
    }
    createIcons();
  };

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    observer.disconnect();
    if (home.next && home.next.parentNode === home.parent) {
      home.parent.insertBefore(panel, home.next);
    } else {
      home.parent.appendChild(panel);
    }
    panel.classList.toggle("collapsed", home.collapsed);
    overlay.remove();
    deck.palette = null;
    renderRelayOptions();
    fitVisible();
  };
  const onKey = (event) => {
    if (event.key === "Escape" && deck.palette === overlay) {
      event.preventDefault();
      close();
    }
  };
  // Ajout / suppression / favori d'un profil : la liste suit.
  const observer = new MutationObserver(() => window.requestAnimationFrame(render));
  observer.observe(elements.profileSelect, { childList: true });
  closeButton.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  deck.palette = overlay;
  render();
}

// --- Barre laterale : sessions ----------------------------------------------------
function toggleDeckSidebar() {
  setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
}

function sidebarSignature(ids) {
  const rows = ids.map((id) => {
    const s = state.sessions.get(id);
    return s ? [id, s.title, deckStatus(s), isSessionVisible(s), s.attention, s.spec?.modeId, sessionProfileId(s), s.cwd] : [id];
  });
  const auth = (state.config?.profiles || []).map((p) => `${p.id}:${authOf(p.id).key}`);
  return JSON.stringify([rows, auth, state.activeSessionId]);
}

function renderDeckSidebar() {
  const list = deck.el.sideList;
  const ids = orderedSessionIds();
  const workCount = [...state.sessions.values()].filter((s) => deckStatus(s) === "work").length;
  const waitTotal = [...state.sessions.values()].filter((s) => deckStatus(s) === "wait").length;
  const signature = sidebarSignature(ids);
  if (signature === deck.sideSignature) {
    return { waitCount: waitTotal, workCount };
  }
  deck.sideSignature = signature;
  list.innerHTML = "";
  let waitCount = 0;
  for (const id of ids) {
    const session = state.sessions.get(id);
    if (!session) {
      continue;
    }
    const status = deckStatus(session);
    if (status === "wait") {
      waitCount += 1;
    }
    const visible = isSessionVisible(session);
    const row = make("button", `deck-side-row${id === state.activeSessionId ? " active" : ""}${visible ? " visible" : ""}${session.attention ? " attention" : ""}`);
    row.type = "button";
    const profileId = sessionProfileId(session);
    const glyph = session.type === "design"
      ? Object.assign(make("span", "deck-glyph"), { textContent: "DS" })
      : session.type === "pipeline"
        ? Object.assign(make("span", "deck-glyph"), { textContent: "PL" })
        : deckGlyphEl(profileId, 24);
    if (session.type === "design" || session.type === "pipeline") {
      glyph.style.background = "#5A6272";
      glyph.style.setProperty("--glyph-size", "24px");
    }
    const text = make("span", "deck-side-text");
    const title = make("span", "deck-side-title");
    title.textContent = session.title;
    const sub = make("span", "deck-side-sub mono");
    const profile = deckProfile(session);
    const mode = deckMode(session);
    sub.textContent = session.type === "design"
      ? "Claude Design"
      : session.type === "pipeline"
        ? "Pipeline IA"
        : [profile?.label || session.profileLabel || "Terminal", mode?.label].filter(Boolean).join(" · ");
    text.append(title, sub);
    const dot = make("span", `deck-dot ${status}`);
    dot.title = status === "work" ? "travaille" : status === "wait" ? "attend ta validation" : "inactive";
    row.append(glyph, text, dot);
    row.title = `${session.title}\n${session.cwd || ""}`;
    row.addEventListener("click", () => setActiveSession(id));
    row.addEventListener("dblclick", () => promptRenameSession(id));
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        closeSession(id);
      }
    });
    list.appendChild(row);
  }
  if (!ids.length) {
    const empty = make("div", "deck-side-empty");
    empty.textContent = "Aucune session ouverte.";
    list.appendChild(empty);
  }
  const count = deck.el.sideCount;
  count.classList.toggle("wait", waitCount > 0);
  count.textContent = waitCount ? `${waitCount} à valider` : `${ids.length} ouverte${ids.length > 1 ? "s" : ""}`;

  // Connexions IA : une pastille par CLI.
  const dots = deck.el.authDots;
  dots.innerHTML = "";
  for (const profile of sortProfiles(state.config?.profiles || [])) {
    const auth = authOf(profile.id);
    const dot = make("span", "deck-auth-dot");
    dot.style.background = auth.color;
    dot.title = `${profile.label} : ${auth.label}`;
    dots.appendChild(dot);
  }
  return { waitCount, workCount };
}

// --- En-tete de pane, bandeau de validation, pied de page -----------------------
function renderPaneHead() {
  const session = state.sessions.get(state.activeSessionId);
  const head = deck.el.paneHead;
  head.classList.toggle("hidden", !session);
  head.classList.toggle("split", Boolean(state.split));
  if (!session) {
    return;
  }
  const profile = deckProfile(session);
  const mode = deckMode(session);
  deck.el.paneGlyph.replaceChildren(
    session.type === "terminal" ? deckGlyphEl(sessionProfileId(session), 20) : Object.assign(make("span", "deck-glyph"), { textContent: session.type === "design" ? "DS" : "PL" })
  );
  deck.el.paneName.textContent = session.type === "design" ? "Claude Design" : session.type === "pipeline" ? "Pipeline IA" : profile?.label || session.profileLabel || "Terminal";
  // « & claude » (operateur d'appel PowerShell) : on affiche la commande seule.
  deck.el.paneCmd.textContent = session.type === "terminal" ? String(session.command || "").replace(/^&\s+/, "") : session.cwd || "";
  deck.el.paneCmd.title = deck.el.paneCmd.textContent;
  deck.el.paneCmd.classList.toggle("hidden", !deck.el.paneCmd.textContent);
  deck.el.paneDanger.classList.toggle("hidden", !(session.type === "terminal" && isRiskyMode(mode)));
  const context = session.context;
  const hasCtx = Boolean(context?.window);
  deck.el.paneCtx.classList.toggle("hidden", !hasCtx);
  if (hasCtx) {
    const percent = Math.max(0, Math.min(100, Math.round(context.percent || 0)));
    deck.el.paneCtxText.textContent = `ctx ${percent} %`;
    deck.el.paneCtxFill.style.width = `${percent}%`;
    deck.el.paneCtxFill.classList.toggle("high", percent > 75);
    deck.el.paneCtx.title = `Contexte : ${formatTokens(context.tokens)} / ${formatTokens(context.window)} tokens. Pense à /compact avant qu'il ne soit plein.`;
  }
}

function terminalWaits(session) {
  if (!session || session.type !== "terminal" || session.aiState === "busy") {
    return false;
  }
  const tail = terminalScreenTail(session, 6);
  return WAIT_PATTERNS.some((pattern) => pattern.test(tail));
}

function renderWaitBanner() {
  const session = state.sessions.get(state.activeSessionId);
  const banner = deck.el.waitBanner;
  const waiting = Boolean(session) && deckStatus(session) === "wait" && !session.chat?.open;
  banner.classList.toggle("hidden", !waiting);
  // Les toasts remontent pour ne pas cacher les boutons du bandeau.
  document.body.classList.toggle("deck-banner-on", waiting);
  if (!waiting) {
    banner.dataset.sessionId = "";
    return;
  }
  const tail = terminalScreenTail(session, 6);
  const yesNo = YES_NO_PATTERN.test(tail);
  const label = deckProfile(session)?.label || "L'IA";
  const key = `${session.id}|${yesNo}|${session.waitingFor || ""}`;
  if (banner.dataset.sessionId === key) {
    return;
  }
  banner.dataset.sessionId = key;
  banner.innerHTML = "";
  const text = make("span", "deck-wait-text");
  text.textContent = session.aiState === "waiting" ? `${label} ${describeWaiting(session.waitingFor)}.` : `${label} attend ta validation.`;
  banner.append(make("span", "deck-dot wait"), text);
  const send = (value) => {
    window.launcher.writeTerminal(session.id, value);
    session.terminal.focus();
  };
  if (yesNo) {
    const refuse = make("button", "deck-btn ghost", "Refuser <kbd>N</kbd>");
    refuse.type = "button";
    refuse.addEventListener("click", () => send("n\r"));
    const approve = make("button", "deck-btn warn", "Approuver <kbd>Y</kbd>");
    approve.type = "button";
    approve.addEventListener("click", () => send("y\r"));
    banner.append(refuse, approve);
  } else {
    const see = make("button", "deck-btn warn", "Voir");
    see.type = "button";
    see.addEventListener("click", () => {
      session.terminal.scrollToBottom();
      session.terminal.focus();
    });
    banner.appendChild(see);
  }
}

function renderFooterStatus(counts) {
  const status = deck.el.footStatus;
  const { waitCount, workCount } = counts;
  status.innerHTML = "";
  const dot = make("span", `deck-dot ${workCount ? "work" : waitCount ? "wait" : "idle"}`);
  const text = document.createElement("span");
  text.textContent = workCount ? `${workCount} IA au travail` : waitCount ? `${waitCount} en attente de toi` : "Prêt";
  status.append(dot, text);
  deck.el.restoreButton.textContent = `Restauration auto : ${isAutoRestoreEnabled() ? "activée" : "désactivée"}`;
  // « Pret » est deja dit par le statut global : pas de doublon.
  elements.sessionMeta.classList.toggle("deck-muted", elements.sessionMeta.textContent.trim() === "Pret");
}

function renderHeaderBits() {
  const app = state.app;
  if (app) {
    const isWindows = app.isWindows ?? app.platform === "win32";
    deck.el.adminBadge.textContent = app.isElevated ? (isWindows ? "ADMIN" : "ROOT") : "UTILISATEUR";
    deck.el.adminBadge.classList.toggle("warn", !app.isElevated);
    deck.el.adminBadge.title = elements.adminStatus.textContent;
  }
  const folder = state.selectedFolder;
  deck.el.folderChip.title = folder || "Choisir un dossier";
  deck.el.emptyFolder.textContent = folder || "un dossier (choisis-le en haut)";
}

function deckRefresh() {
  deck.refreshQueued = false;
  if (!state.config) {
    return;
  }
  // Prompts de confirmation des CLI sans etat exact (onglets terminaux).
  for (const session of state.sessions.values()) {
    const exact = session.aiState === "waiting";
    deck.waitTail.set(session.id, !exact && sessionProfileId(session) !== "claude" && terminalWaits(session));
  }
  const counts = renderDeckSidebar();
  renderPaneHead();
  renderWaitBanner();
  renderFooterStatus(counts);
  renderHeaderBits();
}

function scheduleDeckRefresh() {
  if (!isDeckUi() || deck.refreshQueued) {
    return;
  }
  deck.refreshQueued = true;
  window.requestAnimationFrame(deckRefresh);
}

// Accroche une fonction globale de renderer.js (declaration de fonction =
// propriete de window : les appels internes passent par la version enveloppee).
function hookGlobal(name, after) {
  const original = window[name];
  if (typeof original !== "function") {
    return;
  }
  window[name] = function hooked(...args) {
    const result = original.apply(this, args);
    try {
      after(args, result);
    } catch {}
    return result;
  };
}

// --- Themes de couleurs ------------------------------------------------------------
const THEME_KEY = "deckTheme";
const THEME_PRESETS = [
  { id: "citron", name: "Citron", color: "#C6F432" },
  { id: "claude", name: "Claude", color: "#D97757" },
  { id: "ocean", name: "Océan", color: "#5B8DEF" },
  { id: "jarvis", name: "Cyan", color: "#5BE7FF" },
  { id: "lavande", name: "Lavande", color: "#B79CFF" },
  { id: "menthe", name: "Menthe", color: "#5FD68A" },
  { id: "ambre", name: "Ambre", color: "#F5C04A" },
  { id: "rose", name: "Rose", color: "#FF6B9A" },
  { id: "ardoise", name: "Ardoise", color: "#AEB6C4" }
];
const THEME_DEFAULT = { accent: "#C6F432", bubble: "neutral", bubbleColor: "#3A4252" };

function loadTheme() {
  try {
    return { ...THEME_DEFAULT, ...JSON.parse(readStorage(THEME_KEY) || "{}") };
  } catch {
    return { ...THEME_DEFAULT };
  }
}

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const n = parseInt(full, 16);
  if (!/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(n)) {
    return [198, 244, 50];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Texte lisible pose sur une couleur : sombre sur couleur claire, et inversement.
function inkFor(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.3 ? "#0B0D10" : "#F5F7FA";
}

function lighten(hex, amount = 0.18) {
  const rgb = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function applyDeckTheme(theme = loadTheme()) {
  const style = document.body.style;
  const accent = theme.accent || THEME_DEFAULT.accent;
  style.setProperty("--accent", accent);
  style.setProperty("--accent-rgb", hexToRgb(accent).join(", "));
  style.setProperty("--accent-ink", inkFor(accent));
  style.setProperty("--accent-hover", lighten(accent));
  const bubble = theme.bubble === "accent" ? accent : theme.bubble === "custom" ? theme.bubbleColor : "#1F242D";
  style.setProperty("--bubble-bg", bubble);
  style.setProperty("--bubble-ink", theme.bubble === "neutral" ? "#E8EAEE" : inkFor(bubble));
  // Curseur des terminaux a la couleur du theme.
  TERMINAL_THEME.cursor = accent;
  for (const session of state.sessions.values()) {
    if (session.terminal && !document.body.classList.contains("jarvis")) {
      try {
        session.terminal.options.theme = { ...TERMINAL_THEME };
      } catch {}
    }
  }
}

function saveTheme(patch) {
  const theme = { ...loadTheme(), ...patch };
  writeStorage(THEME_KEY, JSON.stringify(theme));
  applyDeckTheme(theme);
  return theme;
}

function openThemeSettings() {
  closeDeckPopover();
  closeDeckPalette();
  const modal = createModal({
    icon: "palette",
    title: "Thème et couleurs",
    sub: "Couleur principale de l'interface et couleur des bulles de tes messages dans la vue chat. Les changements s'appliquent tout de suite.",
    dialogClass: "deck-theme-dialog"
  });
  const body = modal.body;

  const section = (label) => {
    const title = make("div", "deck-theme-label");
    title.textContent = label;
    body.appendChild(title);
  };

  section("Couleur du thème");
  const swatches = make("div", "deck-swatches");
  body.appendChild(swatches);
  const customRow = make("label", "deck-theme-custom");
  const customInput = document.createElement("input");
  customInput.type = "color";
  customRow.append(customInput, Object.assign(document.createElement("span"), { textContent: "Couleur personnalisée" }));
  body.appendChild(customRow);

  section("Bulles de tes messages (vue chat)");
  const bubbles = make("div", "deck-bubble-choices");
  body.appendChild(bubbles);
  const bubbleCustom = document.createElement("input");
  bubbleCustom.type = "color";

  section("Aperçu");
  const preview = make("div", "deck-theme-preview");
  const previewButton = make("span", "deck-btn primary", "Lancer Claude Code");
  const previewChip = make("span", "deck-chip-mode selected", "Standard");
  const previewBubble = make("span", "deck-theme-bubble", "Refonds la page d'accueil");
  preview.append(previewButton, previewChip, previewBubble);
  body.appendChild(preview);

  const render = () => {
    const theme = loadTheme();
    swatches.innerHTML = "";
    for (const preset of THEME_PRESETS) {
      const swatch = make("button", `deck-swatch${preset.color.toLowerCase() === theme.accent.toLowerCase() ? " selected" : ""}`);
      swatch.type = "button";
      swatch.title = preset.name;
      const dot = make("span", "deck-swatch-dot");
      dot.style.background = preset.color;
      const name = make("span", "deck-swatch-name");
      name.textContent = preset.name;
      swatch.append(dot, name);
      swatch.addEventListener("click", () => {
        saveTheme({ accent: preset.color });
        render();
      });
      swatches.appendChild(swatch);
    }
    customInput.value = theme.accent.length === 7 ? theme.accent : "#c6f432";

    bubbles.innerHTML = "";
    const choices = [
      ["neutral", "Neutre (gris)"],
      ["accent", "Couleur du thème"],
      ["custom", "Personnalisée"]
    ];
    for (const [id, label] of choices) {
      const chip = make("button", `deck-chip-mode${theme.bubble === id ? " selected" : ""}`);
      chip.type = "button";
      chip.textContent = label;
      chip.addEventListener("click", () => {
        saveTheme({ bubble: id });
        render();
      });
      bubbles.appendChild(chip);
    }
    bubbleCustom.value = theme.bubbleColor;
    bubbleCustom.classList.toggle("hidden", theme.bubble !== "custom");
    bubbles.appendChild(bubbleCustom);
  };
  customInput.addEventListener("input", () => {
    saveTheme({ accent: customInput.value });
    render();
  });
  bubbleCustom.addEventListener("input", () => {
    saveTheme({ bubble: "custom", bubbleColor: bubbleCustom.value });
  });
  bubbleCustom.addEventListener("change", render);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost-button";
  reset.textContent = "Réinitialiser";
  reset.addEventListener("click", () => {
    writeStorage(THEME_KEY, null);
    applyDeckTheme();
    render();
  });
  modal.actions.prepend(reset);
  render();
  createIcons();
}

// --- Construction de l'interface ---------------------------------------------------
function buildDeck() {
  document.body.classList.add("ui-deck");
  // Fond du terminal aligne sur le theme (avant la creation des terminaux).
  TERMINAL_THEME.background = "#0B0D10";
  applyDeckTheme();

  const shell = elements.appShell;
  const workspace = shell.querySelector(".workspace");

  // En-tete.
  const header = make("header", "deck-header");
  const sidebarToggle = make("button", "deck-icon-btn", icon("panel-left"));
  sidebarToggle.type = "button";
  sidebarToggle.title = "Afficher ou masquer le menu (Ctrl B)";
  sidebarToggle.addEventListener("click", toggleDeckSidebar);
  const brand = make("div", "deck-brand", '<span class="deck-logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5,6 11,12 5,18"></polyline><line x1="13" y1="18" x2="19" y2="18"></line></svg></span><span class="deck-brand-name">CLI Launcher</span>');
  const adminBadge = make("span", "deck-admin mono");
  brand.append(adminBadge, elements.adminStatus);
  const folderChip = make("button", "deck-chip deck-folder", icon("folder"));
  folderChip.type = "button";
  elements.folderPath.classList.add("mono");
  folderChip.append(elements.folderPath);
  folderChip.insertAdjacentHTML("beforeend", icon("chevron-down"));
  folderChip.addEventListener("click", openFolderPopover);
  const search = make("button", "deck-search", `${icon("search")}<span>Lancer une IA, aller à une session, chercher une action…</span><kbd>Ctrl K</kbd>`);
  search.type = "button";
  search.addEventListener("click", openCommandPalette);
  const right = make("div", "deck-header-right");
  const settingsButton = make("button", "deck-icon-btn", icon("settings"));
  settingsButton.type = "button";
  settingsButton.title = "Réglages";
  settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openSettingsPopover();
  });
  right.append(elements.gitChip, elements.designChip, elements.usageBar, settingsButton, elements.jarvisButton);
  header.append(sidebarToggle, brand, folderChip, search, right);
  shell.prepend(header);

  // Barre laterale des sessions.
  const side = make("aside", "deck-sidebar");
  const sideHead = make("div", "deck-side-head", '<span class="deck-eyebrow">Sessions</span>');
  const sideCount = make("span", "deck-side-count mono");
  sideHead.appendChild(sideCount);
  const sideList = make("div", "deck-side-list");
  const sideFoot = make("div", "deck-side-foot");
  const authRow = make("div", "deck-auth-row", "<span>Connexions IA</span>");
  const authDots = make("button", "deck-auth-dots");
  authDots.type = "button";
  authDots.title = "État des connexions (clic : gérer les profils)";
  authDots.addEventListener("click", () => openProfilesModal());
  authRow.appendChild(authDots);
  const newButton = make("button", "deck-new-btn", `${icon("plus")}<span>Nouvelle session</span><kbd>Ctrl T</kbd>`);
  newButton.type = "button";
  newButton.addEventListener("click", openLaunchPalette);
  sideFoot.append(authRow, newButton);
  side.append(sideHead, sideList, sideFoot);
  shell.querySelector(".sidebar").after(side);

  // Barre d'onglets : onglets + nouveau + Chat / Partage / Relais.
  const tabbar = make("div", "deck-tabbar");
  workspace.insertBefore(tabbar, elements.tabs);
  tabbar.appendChild(elements.tabs);
  const plus = make("button", "deck-icon-btn small", icon("plus"));
  plus.type = "button";
  plus.title = "Nouvelle session (Ctrl T)";
  plus.addEventListener("click", openLaunchPalette);
  const tools = make("div", "deck-tab-tools");
  const chatButton = document.getElementById("chatViewButton");
  chatButton.classList.add("deck-toggle");
  chatButton.append(make("span", "deck-toggle-label", "Chat"));
  elements.splitButton.classList.add("deck-toggle");
  elements.splitButton.append(make("span", "deck-toggle-label", "Partagé"));
  const relayButton = make("button", "deck-toggle", `${icon("arrow-right")}<span class="deck-toggle-label">Relais</span>`);
  relayButton.type = "button";
  relayButton.title = "Passer le relais à une autre IA (même conversation)";
  relayButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openRelayPopover(relayButton);
  });
  tools.append(chatButton, elements.splitButton, relayButton);
  tabbar.append(plus, make("div", "deck-spacer"), tools);

  // En-tete de pane.
  const paneHead = make("div", "deck-pane-head");
  const paneGlyph = make("span", "deck-pane-glyph");
  const paneName = make("strong", "deck-pane-name");
  const paneCmd = make("span", "deck-pane-cmd mono");
  const paneDanger = make("span", "deck-pane-danger mono hidden", "ACCÈS TOTAL");
  const paneCtx = make("span", "deck-pane-ctx hidden");
  const paneCtxText = make("span", "mono");
  const paneCtxBar = make("span", "deck-ctx-bar");
  const paneCtxFill = make("span", "deck-ctx-fill");
  paneCtxBar.appendChild(paneCtxFill);
  paneCtx.append(paneCtxText, paneCtxBar);
  elements.restartAiButton.classList.add("deck-icon-btn", "small");
  paneHead.append(paneGlyph, paneName, paneCmd, paneDanger, make("span", "deck-spacer"), paneCtx, elements.restartAiButton);
  workspace.insertBefore(paneHead, elements.terminalHost);

  // Bandeau de validation (bas du pane).
  const waitBanner = make("div", "deck-wait-banner hidden");
  elements.terminalHost.appendChild(waitBanner);

  // Ecran vide.
  elements.emptyState.innerHTML = "";
  const emptyIcon = make("div", "deck-empty-icon", '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5,6 11,12 5,18"></polyline><line x1="13" y1="18" x2="19" y2="18"></line></svg>');
  const emptyTitle = make("span", "deck-empty-title", "Aucune session ouverte");
  const emptyText = make("span", "deck-empty-text", "Choisis une IA et lance-la dans ");
  const emptyFolder = make("span", "mono");
  emptyText.appendChild(emptyFolder);
  const emptyButton = make("button", "deck-btn primary", "Nouvelle session");
  emptyButton.type = "button";
  emptyButton.addEventListener("click", openLaunchPalette);
  elements.emptyState.append(emptyIcon, emptyTitle, emptyText, emptyButton);

  // Pied de page (sous toute la fenetre).
  const footer = workspace.querySelector(".footer");
  shell.appendChild(footer);
  footer.classList.add("mono");
  const footStatus = make("span", "deck-foot-status");
  footer.prepend(footStatus);
  const restoreButton = make("button", "deck-foot-btn");
  restoreButton.type = "button";
  restoreButton.title = "Rouvrir automatiquement les onglets au démarrage";
  restoreButton.addEventListener("click", toggleAutoRestore);
  elements.shellLabel.after(restoreButton);
  elements.appVersionLabel.before(make("span", "deck-spacer"));

  const toasts = make("div", "deck-toasts");
  document.body.appendChild(toasts);

  Object.assign(deck.el, {
    header, folderChip, settingsButton, adminBadge, sideList, sideCount, authDots,
    relayButton, paneHead, paneGlyph, paneName, paneCmd, paneDanger, paneCtx, paneCtxText, paneCtxFill,
    waitBanner, emptyFolder, footStatus, restoreButton, toasts
  });

  // Raccourcis : Ctrl K (palette), Ctrl T ouvre la palette de lancement.
  const newTab = SHORTCUT_ACTIONS.find((action) => action.id === "newTab");
  if (newTab) {
    newTab.run = () => openLaunchPalette();
  }
  SHORTCUT_ACTIONS.push({ id: "commandPalette", label: "Palette de commandes", category: "Navigation", run: () => (deck.palette ? closeDeckPalette() : openCommandPalette()) });
  DEFAULT_KEYBINDINGS.commandPalette = "Ctrl+K";
  keybindings = loadKeybindings();

  // Ferme les popovers au clic exterieur et a Echap.
  document.addEventListener("mousedown", (event) => {
    if (deck.pop && !deck.pop.contains(event.target)) {
      closeDeckPopover();
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && deck.pop) {
      event.preventDefault();
      event.stopPropagation();
      closeDeckPopover();
    }
  }, true);
  window.addEventListener("resize", closeDeckPopover);

  // Suivi de l'etat : onglets (ajout, statut, titre), focus, dossier, tokens.
  new MutationObserver(scheduleDeckRefresh).observe(elements.tabs, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["class"], characterData: true
  });
  hookGlobal("layoutPanes", scheduleDeckRefresh);
  hookGlobal("renderAuthStatusList", scheduleDeckRefresh);
  hookGlobal("updateFolder", ([path]) => {
    rememberFolder(path);
    scheduleDeckRefresh();
  });
  hookGlobal("flashStatus", ([message]) => deckToast(message));
  const toastAttention = (args) => {
    const session = args[0];
    if (session && session.attention && !session.deckToasted) {
      session.deckToasted = true;
      const waiting = session.aiState === "waiting";
      deckToast(`${session.title} ${waiting ? "attend ta validation" : ": réponse prête"}`, waiting ? "warn" : "ok");
    } else if (session && !session.attention) {
      session.deckToasted = false;
    }
    scheduleDeckRefresh();
  };
  hookGlobal("applyAiState", toastAttention);
  // Toasts des CLI sans etat exact qui attendent une confirmation en fond.
  window.setInterval(() => {
    if (document.hidden) {
      return;
    }
    for (const session of state.sessions.values()) {
      const was = deck.waitTail.get(session.id);
      const now = sessionProfileId(session) !== "claude" && session.aiState !== "waiting" && terminalWaits(session);
      if (now && !was && !isSessionVisible(session)) {
        deckToast(`${session.title} attend ta validation`, "warn");
      }
    }
    deckRefresh();
  }, 1500);

  createIcons();
}

if (isDeckUi()) {
  buildDeck();
  rememberFolder(readStorage("lastFolder"));
  scheduleDeckRefresh();
}
