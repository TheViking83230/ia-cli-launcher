// Multi-compte Claude : liste des comptes, choix du compte des nouveaux
// onglets (menu de gauche), fenetre de gestion (ajouter, connecter, renommer,
// retirer) et repere du compte sur les onglets. Charge avant renderer.js.

const accountsState = { activeId: "default", accounts: [] };

async function refreshAccounts() {
  try {
    const data = await window.launcher.listAccounts();
    if (data?.accounts) {
      accountsState.activeId = data.activeId;
      accountsState.accounts = data.accounts;
    }
  } catch {}
  renderAccountSelect();
  if (typeof renderRelayOptions === "function") {
    renderRelayOptions();
  }
  for (const session of state.sessions.values()) {
    updateTabAccount(session);
  }
  return accountsState;
}

function hasSeveralAccounts() {
  return accountsState.accounts.length > 1;
}

function accountById(id) {
  return accountsState.accounts.find((a) => a.id === (id || "default")) || null;
}

// Libelle du compte (vide s'il n'y a qu'un compte : rien a distinguer).
function accountLabelOf(id) {
  if (!hasSeveralAccounts() || !id) {
    return "";
  }
  return accountById(id)?.label || "";
}

function accountOptionText(account) {
  const extra = account.email || (account.loggedIn ? "" : "non connecté");
  return extra ? `${account.label} · ${extra}` : account.label;
}

function renderAccountSelect() {
  const field = document.getElementById("accountField");
  const select = document.getElementById("accountSelect");
  if (!field || !select) {
    return;
  }
  const profile = typeof getSelectedProfile === "function" ? getSelectedProfile() : null;
  field.classList.toggle("hidden", profile?.id !== "claude");
  select.innerHTML = "";
  for (const account of accountsState.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    // Libelle court (le menu de gauche est etroit) ; adresse en infobulle.
    option.textContent = account.loggedIn ? account.label : `${account.label} (non connecté)`;
    option.title = accountOptionText(account);
    select.appendChild(option);
  }
  select.value = accountsState.activeId;
  select.title = accountOptionText(accountById(accountsState.activeId) || { label: "" });
}

function selectedAccountId() {
  return document.getElementById("accountSelect")?.value || accountsState.activeId || "default";
}

function updateTabAccount(session) {
  if (!session?.tab) {
    return;
  }
  let badge = session.tab.querySelector(".tab-account");
  const label = sessionProfileId(session) === "claude" ? accountLabelOf(session.claudeAccountId) : "";
  if (!label) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "tab-account";
    session.tab.querySelector(".tab-title").after(badge);
  }
  badge.textContent = label;
  badge.title = `Compte Claude : ${accountOptionText(accountById(session.claudeAccountId) || { label })}`;
}

// Ouvre un onglet Claude sur ce compte pour s'y connecter. Compte neuf :
// Claude Code propose lui-meme la connexion ; deja connecte : on tape /login
// (changer de compte d'abonnement).
async function loginAccount(account) {
  const profile = state.config.profiles.find((p) => p.id === "claude");
  if (!profile) {
    flashStatus("Profil Claude introuvable.");
    return;
  }
  const title = `Connexion · ${account.label}`;
  const session = await openTerminalSession({
    title,
    accent: profile.accent,
    spec: null,
    starter: ({ cols, rows }) =>
      window.launcher.startTerminal({
        title,
        command: profile.command,
        modeArgs: [],
        extraArgs: "",
        cwd: state.selectedFolder || "",
        profileId: profile.id,
        profileLabel: profile.label,
        modeId: "standard",
        modeLabel: "Connexion",
        claudeAccountId: account.id,
        cols,
        rows
      })
  });
  if (!session) {
    return;
  }
  if (account.loggedIn) {
    sendFirstMessage(session, "/login");
  }
  flashStatus(account.loggedIn
    ? `Onglet de connexion ouvert pour « ${account.label} » : choisis « Claude account with subscription » puis valide dans le navigateur.`
    : `Onglet de connexion ouvert pour « ${account.label} » : suis les étapes (thème, puis connexion à ton abonnement dans le navigateur).`);
}

async function openAccountsModal() {
  const modal = createModal({
    icon: "users",
    title: "Comptes Claude",
    sub: "Connecte plusieurs abonnements Claude (Pro, Max…). Chaque compte a ses propres identifiants, conversations et quotas ; choisis le compte de chaque nouvel onglet dans le menu de gauche.",
    dialogClass: "accounts-dialog"
  });
  const list = document.createElement("div");
  list.className = "accounts-list";
  modal.body.appendChild(list);

  const addRow = document.createElement("div");
  addRow.className = "accounts-add";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Nom du nouveau compte (ex. Pro perso, Max boulot)";
  nameInput.maxLength = 40;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "primary-button";
  addButton.innerHTML = '<i data-lucide="user-plus"></i> Ajouter';
  addRow.append(nameInput, addButton);
  modal.body.appendChild(addRow);

  const render = () => {
    list.innerHTML = "";
    for (const account of accountsState.accounts) {
      const row = document.createElement("div");
      row.className = `account-row${account.id === accountsState.activeId ? " active" : ""}`;

      const main = document.createElement("div");
      main.className = "account-main";
      const name = document.createElement("div");
      name.className = "account-name";
      name.textContent = account.label;
      if (account.id === accountsState.activeId) {
        const tag = document.createElement("span");
        tag.className = "account-tag";
        tag.textContent = "par défaut";
        name.appendChild(tag);
      }
      const info = document.createElement("div");
      info.className = `account-info${account.loggedIn ? "" : " off"}`;
      info.textContent = account.loggedIn
        ? [account.email || "connecté", account.plan ? `abonnement ${account.plan}` : "", account.organization].filter(Boolean).join(" · ")
        : "Non connecté";
      const dir = document.createElement("div");
      dir.className = "account-dir";
      dir.textContent = account.configDir;
      dir.title = "Dossier de configuration de ce compte";
      main.append(name, info, dir);

      const actions = document.createElement("div");
      actions.className = "account-actions";
      const button = (label, icon, handler, extra = "") => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `ghost-button ${extra}`.trim();
        b.innerHTML = `<i data-lucide="${icon}"></i>`;
        b.append(label);
        b.addEventListener("click", handler);
        actions.appendChild(b);
        return b;
      };
      button(account.loggedIn ? "Reconnecter" : "Connecter", "log-in", () => {
        modal.close();
        loginAccount(account);
      });
      if (account.id !== accountsState.activeId) {
        button("Par défaut", "star", async () => {
          await window.launcher.setActiveAccount(account.id);
          await refreshAccounts();
          render();
        });
      }
      button("Renommer", "pencil", async () => {
        const label = await askText({ title: "Renommer le compte", value: account.label, placeholder: "Nom du compte", icon: "user", maxLength: 40 });
        if (label && label.trim()) {
          await window.launcher.renameAccount(account.id, label.trim());
          await refreshAccounts();
          render();
        }
      });
      if (!account.isDefault) {
        button("Retirer", "trash-2", async () => {
          if (!window.confirm(`Retirer le compte « ${account.label} » du launcher ?`)) {
            return;
          }
          const wipe = window.confirm(`Effacer aussi ses fichiers (identifiants et conversations de ce compte) ?\n\n${account.configDir}\n\nOK = effacer, Annuler = garder le dossier.`);
          await window.launcher.removeAccount(account.id, wipe);
          await refreshAccounts();
          render();
        }, "danger");
      }
      row.append(main, actions);
      list.appendChild(row);
    }
    createIcons();
  };

  addButton.addEventListener("click", async () => {
    const label = nameInput.value.trim() || `Compte ${accountsState.accounts.length + 1}`;
    addButton.disabled = true;
    try {
      await window.launcher.addAccount(label);
      await refreshAccounts();
      nameInput.value = "";
      render();
      const created = accountsState.accounts[accountsState.accounts.length - 1];
      if (created && window.confirm(`Compte « ${created.label} » créé. Te connecter maintenant ?`)) {
        modal.close();
        loginAccount(created);
      }
    } finally {
      addButton.disabled = false;
    }
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      addButton.click();
    }
  });

  await refreshAccounts();
  render();
}
