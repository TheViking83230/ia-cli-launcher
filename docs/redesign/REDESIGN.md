# Refonte UI « Command Deck » — brief pour Claude Code

> Fichier destiné à Claude Code. Lis-le en entier avant de toucher au code.
> Prototype de référence : `docs/redesign/command-deck.prototype.html` (voir §2).
> Maquette interactive : https://claude.ai/artifact/W8eKeiSkk1EkHJKWmbEdSf

## 1. Objectif

Remplacer l'interface actuelle (sidebar-formulaire + barre d'outils à menus) par la direction **Command Deck** :

- une **sidebar = liste des sessions** (plus de formulaire dedans) ;
- une **palette « Nouvelle session »** (modale) qui remplace le formulaire de lancement ;
- une **palette de commandes Ctrl K** qui remplace les menus Créer / Bibliothèque / Affichage / Réglages ;
- un **header compact** : dossier, recherche/commande, chip git, jauge d'usage, bouton JARVIS ;
- une **barre d'onglets** avec statut vivant, et des panes terminal (simple ou partagé) avec un en-tête de pane ;
- un **thème sombre unique** (pas de thème clair).

Hors périmètre : **le HUD JARVIS** (`src/renderer/jarvis/*`) ne change pas, on garde son thème. On ne touche pas non plus au process main (`src/main/*`), sauf besoin strict d'un nouvel IPC.

## 2. Comment lire le prototype

`command-deck.prototype.html` est un fichier au format « Design Component » de Claude Design. **Il ne tourne pas tel quel dans Electron** : c'est une référence visuelle et comportementale, pas du code à copier.

- Le markup est entre `<x-dc>…</x-dc>`. Les `style="…"` inline donnent les valeurs exactes (tailles, couleurs, espacements).
- `{{ x }}` est une valeur calculée dans `renderVals()`. `<sc-for list>` est une boucle, `<sc-if value>` une condition.
- Toute la logique de comportement est dans la classe `Component` (en bas du fichier) : `launch()`, `select()`, `closeTab()`, `toggleSplit()`, `relay()`, `cmdList()`, `step()` (simulation du flux terminal), `toast()`.
- Les lignes de terminal du prototype sont **simulées**. Dans l'appli, c'est **xterm** qui affiche le terminal réel ; ne recrée pas de faux terminal.
- La barre de saisie `>` sous le terminal du prototype **ne doit pas devenir un champ séparé** en mode terminal : les CLI sont des TUI, la saisie reste dans xterm. Elle n'existe qu'en **vue chat** (où `chat.js` gère déjà la saisie).

## 3. Contraintes techniques

- Electron + JS vanilla, aucun framework. Icônes : `lucide` (déjà chargé, `data-lucide="…"` + `lucide.createIcons()`).
- `renderer.js` (~8 200 lignes) référence ~69 éléments par `getElementById`. **Règle : conserver les `id` existants** chaque fois que l'élément survit (même s'il change de place). Si un élément disparaît, retire proprement son usage dans `renderer.js` (pas de `null.addEventListener`). Fais un `grep` de chaque id avant de le supprimer.
- Les fonctions existantes restent la source de vérité : `launchFromProfile()`, `launchSession()`, `createTab()`, `renderProfiles()`, `renderAuthStatusList()`, la persistance des sessions, l'historique, le relais, le split et le mirror, le chat, git et l'usage. On **déplace et rhabille**, on ne réécrit pas la logique métier.
- `hud.css` est chargé après `styles.css` : ne crée pas de sélecteurs globaux qui fuiraient dans `.jh2`.
- Travaille sur une branche `feat/command-deck`. Incrémente `version` dans `package.json` à la fin.

## 4. Design tokens

Remplacer le bloc `:root` de `styles.css` par :

```css
:root {
  color-scheme: dark;
  --bg: #0B0D10;          /* fond app + terminal */
  --surface: #0E1014;     /* header, sidebar, tab bar, footer */
  --raised: #12151A;      /* modales, champs */
  --raised-2: #14171D;    /* boutons header, popovers */
  --hover: #181C23;       /* ligne active sidebar */
  --line: #1E232C;        /* séparateurs */
  --line-strong: #2A303B; /* bordures modales/champs */
  --text: #E8EAEE;
  --text-2: #C9CED7;
  --muted: #8B93A1;
  --soft: #5A6272;
  --accent: #C6F432;      /* vert citron ; texte dessus = --bg */
  --warn: #F5C04A;        /* « attend ta validation », sans token */
  --danger: #FF9F5A;      /* modes accès total */
  --ok: #5FD68A;
  --add: #7EE2A0; --del: #FF8A8A;
  --radius: 8px; --radius-lg: 14px;
  --font: Inter, "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}
```

Couleurs d'identité des CLI (badge 2 lettres, texte `#0B0D10`) :
Claude `#D97757` · Codex `#E8EAEE` · Gemini/Antigravity `#5B8DEF` · Qwen `#9B7BFF` · Aider `#3FCF8E` · OpenCode `#F5C04A` · Cursor `#B0B8C4` · Amp `#FF6B9A` · profil perso : couleur `accent` du profil si elle existe, sinon `#8B93A1`.
Ajoute un champ optionnel `glyph` et `color` dans `defaultProfiles.js` ou fais un mapping côté renderer.

Polices : Inter pour l'UI, JetBrains Mono pour les chemins, commandes et terminal (vérifie la `fontFamily` d'xterm). Pas de CDN au runtime : utilise les polices système en repli, ou embarque-les en woff2 local si tu veux les garantir.

## 5. Layout

```
┌ header 48px ─────────────────────────────────────────────────────────────┐
│ [≡] [▶ CLI Launcher ADMIN] [📁 J:\Dev\…  ▾]  [🔍 Lancer…  Ctrl K]  [git] [5h ▓▓░ 62%] [◎] │
├ sidebar 256px ─┬ tab bar 40px ─────────────────────────────────────────────┤
│ SESSIONS  1 à valider │ ● Refonte UI × │ ● Fix auto-update × │ +   [Chat][Partagé][Relais] │
│ [CC] Refonte UI   ●   ├ pane header 38px : [CC] Claude Code  `claude --permission-mode auto`  ACCÈS TOTAL? · ctx 48% ▓░ ↻ │
│ [CX] Fix auto-up  ●   │                                                     │
│ …                     │            xterm (ou vue chat)                      │
│ ───────────────       │                                                     │
│ Connexions IA ●●●●●●  │ [bandeau validation si statut = wait]               │
│ [+ Nouvelle session]  │                                                     │
├ footer 26px ──────────┴─────────────────────────────────────────────────────┤
│ ● 2 IA au travail · PowerShell 7 · Restauration auto : activée      v0.1.37 │
└──────────────────────────────────────────────────────────────────────────────┘
```

- `.shell` : `grid-template-rows: 48px 1fr 26px` ; corps = `grid-template-columns: 256px 1fr` (`0 1fr` quand repliée, via la classe existante `sidebar-collapsed`).
- Vue partagée : la zone panes passe en `repeat(2, minmax(0,1fr))` avec 1px de gap couleur `--line`. Le pane focus a l'en-tête en `#11141A` avec un liseré haut de 2px `--accent`.

## 6. Composants : correspondance ancien → nouveau

| Actuel (id) | Devient |
|---|---|
| `.brand`, `adminStatus` | Header gauche : logo 28px fond `--accent` + « CLI Launcher » + badge `ADMIN` (ou « UTILISATEUR » en `--warn` si pas admin). Garde `adminStatus` comme ce badge. |
| `chooseFolderButton`, `folderPath` | **Chip dossier** dans le header (`folderPath` = son texte mono). Clic → popover « Dossiers récents » (3–5 derniers dossiers, stockés en local) + « Parcourir… » qui appelle l'ancien sélecteur. |
| `tabTitleInput`, `profileSelect`, `modeSelect`, `personaSelect`, `accountSelect`, `extraArgsInput`, `launchButton`, `accountField`, `manageAccountsButton`, `managePersonasButton` | **Palette « Nouvelle session »** (modale 760px, §7.1). Garde les ids : le `profileSelect` devient une grille de cartes **plus** un `<select>` caché synchronisé, pour ne pas casser `renderProfiles()`. Idem pour `modeSelect` (puces). |
| `autoRestoreToggle` | Bouton texte dans le footer, « Restauration auto : activée/désactivée » (garde l'input checkbox, masqué visuellement, comme état). |
| Panneau Tokens : `authStatusList`, `refreshAuthButton` | Pied de sidebar : « Connexions IA » + une pastille par CLI (vert = token, jaune = CLI sans token, gris = non installé), avec tooltip. Dans la palette, chaque carte CLI affiche « Connecté / Sans token / Non installé ». `refreshAuthButton` devient une icône ↻ dans la palette de lancement. |
| Panneau « Profil actif » : `favoriteProfileButton`, `installProfileButton`, `docsProfileButton`, `commandInput`, `modeArgsInput`, `installCommandInput`, `docsUrlInput`, `save/add/reset/deleteProfileButton`, `commandStatus` | Nouvelle modale **« Gérer les profils »** (liste des profils à gauche, formulaire à droite, même style que la palette). Ouverte depuis le lien « modifier le profil » de la palette de lancement et depuis Ctrl K. Garde tous les ids. |
| `activeTitleInput`, `renameActiveTabButton` | Le renommage se fait par **double-clic sur l'onglet** (input inline, Entrée valide, Échap annule, blur valide). `activeTitleInput` peut rester masqué si `renderer.js` en dépend, sinon supprime-le. |
| `restartAiButton` | Icône ↻ dans l'en-tête de pane. |
| `chatViewButton` | Toggle « Chat » dans la tab bar (état actif : bordure + texte `--accent`, fond accent à 10 %). |
| `splitButton`, `mirrorButton` | Toggle « Partagé » dans la tab bar. Le mirror passe dans Ctrl K (« Saisie synchronisée »), actif seulement en split. |
| `relaySelect` | Bouton « Relais » de la tab bar → popover listant les autres CLI installées (badge + nom + « même conversation »). Garde le `<select>` caché si la logique en dépend. |
| `gitChip`, `designChip` | `gitChip` : chip header `branche +N −M` → popover fichiers modifiés (M/A/D) + « Voir le diff » + « Commit avec l'IA » (pré-remplit un prompt de commit dans la session active). `designChip` : à côté, même style, visible seulement si pertinent. |
| `usageBar` | Chip header « 5 h ▓▓░ 62 % » → popover usage (fenêtre 5 h + semaine, heures de reset). La barre devient `--danger` au-dessus de 85 %. |
| `toolbar`, `toolbarToggleButton`, `headerToolsButton`, menus `.tool-menu` (pipeline, design, artifacts, prompts, conversations, history, shortcuts, accounts, sync, toggleSidebar) | **Supprimés visuellement** : tout passe dans la **palette Ctrl K**. Garde les boutons en DOM (masqués), ou appelle directement leurs handlers depuis la palette. Bouton ≡ à gauche du header = `toggleSidebarButton`. |
| `jarvisButton` | Bouton rond 32px dans le header (icône réacteur existante, couleur `#5BE7FF`). Aucun changement de comportement. |
| `tabs`, `createTab()` | Nouvelle tab bar (§7.3). |
| `emptyState` | Écran vide centré : icône, « Aucune session ouverte », « Choisis une IA et lance-la dans <dossier> », bouton accent « Nouvelle session ». |
| `sessionMeta`, `shellLabel`, `appVersionLabel` | Footer : statut global (« 2 IA au travail » / « 1 en attente de toi » / « Prêt », avec pastille) · shell · restauration · version à droite. |
| `updateBanner` | Garde-le, restylé en toast persistant en bas à droite. |
| `historyModal` | Garde la structure, restyle avec les tokens (fond `--raised`, bordure `--line-strong`, rayon 14px). |

## 7. Comportements

### 7.1 Palette « Nouvelle session »
- Ouverture : Ctrl T, le bouton `+` de la tab bar, « Nouvelle session » en sidebar et dans Ctrl K. Fond assombri `rgba(5,7,9,.6)`, clic dehors ou Échap pour fermer.
- Contenu, dans l'ordre :
  1. Le **titre** (autofocus, facultatif ; par défaut « <Nom CLI> <n> »).
  2. La **grille de CLI** (4 colonnes) : badge, état de connexion, nom, commande. Les favoris d'abord. La carte sélectionnée a une bordure `--accent` et un halo.
  3. Les **puces de mode** du profil. Les modes « accès total » (grant/danger/yolo/yes-always/force) sont préfixés `!` et colorés en `--danger`.
  4. L'**aperçu de la commande** en mono : `PS <dossier>> <cmd> <args du mode> <args>`.
  5. Un avertissement orange si le mode est à risque ; un avertissement jaune si la CLI n'est pas installée.
  6. Les champs **Dossier / Compte Claude** (seulement pour Claude, sinon **Persona**) **/ Arguments**.
- Bouton principal : « Lancer <CLI> ». Il passe en `--danger` pour un mode à risque, et devient « Installer <CLI> » en `--warn` si la CLI est absente (il lance alors l'installation existante dans un onglet).
- Entrée dans le titre ou les arguments = lancer. Fermeture automatique après le lancement. Toast « Session lancée : <titre> ».
- Le dernier CLI et le dernier mode choisis sont mémorisés.

### 7.2 Palette de commandes (Ctrl K)
- Modale 620px, champ de recherche autofocus, filtrage **insensible aux accents et à la casse**, ↑/↓ pour la sélection, Entrée pour exécuter, Échap pour fermer.
- Chaque ligne : groupe (colonne 70px), libellé, raccourci (`kbd`).
- Entrées :
  - **Action** : Nouvelle session ; Changer de dossier ; Passer le relais ; Gérer les profils ; Installer une CLI.
  - **Session** : une entrée par session ouverte, « <titre> — <CLI> », avec la mention « à valider » si besoin.
  - **Vue** : Vue partagée (Ctrl \\) ; Vue chat (Ctrl Maj K) ; Masquer/afficher le menu (Ctrl B) ; Saisie synchronisée.
  - **Outil** : Historique global ; Bibliothèque de prompts (Ctrl Maj L) ; Conversations Claude (Ctrl Maj O) ; Pipeline IA ; Claude Design ; Artifacts.
  - **Réglages** : Comptes Claude ; Synchronisation ; Raccourcis clavier (F1) ; Vérifier les mises à jour.
  - **JARVIS** : Ouvrir JARVIS.
- Les raccourcis sont **globaux** (`document.addEventListener("keydown", …, true)` existe déjà ligne ~5035 : étends-le). Attention : quand xterm a le focus, n'intercepte que les combinaisons ci-dessus et laisse tout le reste au terminal.

### 7.3 Sessions : sidebar et onglets
- **Ligne de sidebar** :
  - badge CLI 24px, titre, puis « <CLI> · <mode> » en mono 11px, et une pastille de statut à droite ;
  - ligne active : fond `--hover` et liseré gauche de 2px `--accent` ; une session visible dans le split a aussi le fond `--hover` ;
  - clic = focus de la session (en split, remplace le pane qui a le focus).
- **En-tête de sidebar** : « SESSIONS » à gauche ; à droite « N ouvertes », ou un badge jaune plein « N à valider » si au moins une attend.
- **Onglets** :
  - pastille de statut, titre (160px max, ellipsis), bouton ×. Double-clic pour renommer ;
  - l'onglet actif est fusionné avec le contenu (fond `--bg`, bordure `--line` sans bordure basse).
- **Statut** : trois états, à exposer sur chaque session de `renderer.js` :
  - `work` (pastille `--accent` qui pulse) : la sortie PTY a reçu des données dans les ~1,5 s précédentes ;
  - `wait` (pastille `--warn` qui pulse) : la dernière sortie correspond à un prompt de confirmation (`[y/N]`, `(y/n)`, « Do you want to », menu de permission de Claude Code `❯ 1. Yes`, etc. ; liste de regex centralisée et facile à étendre) ;
  - `idle` (pastille `--soft`) : le reste.
  
  Si une logique d'activité ou de `tab-dot` existe déjà, réutilise-la.
- Quand une session **non visible** passe en `wait` ou termine son travail : **toast** en bas à droite (« Fix auto-update attend ta validation »), qui disparaît après 3,6 s, 4 au maximum à l'écran.

### 7.4 Pane
- **En-tête 38px** :
  - badge 20px, nom de la CLI, puis la commande lancée en chip mono (ellipsis) ;
  - un badge `ACCÈS TOTAL` (`--danger`) si le mode est à risque ;
  - à droite, « ctx NN % » avec sa mini-jauge (si l'info de contexte est disponible via l'usage, sinon masquée) et le bouton ↻ (redémarrer).
- **Bandeau de validation**, au-dessus du bas du pane, quand le statut est `wait` :
  - fond `--warn` à 8 %, bordure `--warn` à 45 % ;
  - texte « <CLI> attend ta validation » ;
  - boutons « Refuser » et « Approuver », **seulement si le prompt détecté est de type y/N** (ils envoient `n\r` / `y\r` au PTY). Sinon un seul bouton « Voir » qui focus xterm. Le bandeau disparaît dès que le statut change.
- **Vue chat** : réutilise `chat.js`, restylé en bulles. Utilisateur à droite (fond `--accent`, texte `--bg`) ; IA à gauche (fond `--raised-2`, bordure `--line`) ; rayon 12px, avec le coin côté locuteur à 4px.

### 7.5 Micro-interactions
- `@keyframes pulse` (opacité 1 → .3, 1,1 s) pour les pastilles `work`/`wait`.
- `@keyframes pop` (opacité + translateY 6px + scale .985, 140 ms) pour les modales, popovers et toasts.
- Hover générique : `box-shadow: inset 0 0 0 999px rgba(255,255,255,.045)`.
- Focus visible : `outline: 2px solid rgba(198,244,50,.55)`.
- Les popovers se ferment au clic extérieur et à Échap.

## 8. Plan d'implémentation (une étape = un commit, `npm start` vérifié à chaque fois)

1. **Tokens et base** : nouveau `:root`, typo, scrollbars, keyframes. Rien ne doit casser visuellement de façon bloquante.
2. **Header et footer** : nouveau markup, chips dossier/git/usage avec leurs popovers, bouton JARVIS, ≡ sidebar. Toolbar masquée.
3. **Sidebar sessions** et statut `work/wait/idle`, plus les toasts.
4. **Tab bar** : nouveau `createTab()`, renommage inline, toggles Chat/Partagé, popover Relais.
5. **Panes** : en-tête de pane, bandeau de validation, style du split.
6. **Palette « Nouvelle session »** branchée sur `launchFromProfile()`, avec un `<select>` caché synchronisé.
7. **Palette Ctrl K** et raccourcis globaux.
8. **Modale « Gérer les profils »** (ancien panneau Profil actif).
9. **Restyle** de l'historique, de la vue chat, de la bannière de mise à jour et des autres modales existantes (comptes, personas, prompts, pipeline…) avec les tokens.
10. **Nettoyage** du CSS mort, `version` +1, mise à jour de la section « Fonctions » du README.

## 9. Critères d'acceptation

- [ ] Lancer chaque profil par défaut, dans chaque mode, depuis la palette produit **exactement** la même commande qu'avant.
- [ ] Les sessions persistantes se restaurent au démarrage ; l'historique, le relais, le split, le mirror, la vue chat, git, l'usage, les comptes, les personas, les prompts, le pipeline et JARVIS fonctionnent comme avant.
- [ ] Aucune erreur dans la console du renderer au démarrage ni pendant l'usage courant.
- [ ] Le glisser-déposer d'un fichier colle toujours son chemin dans le terminal actif.
- [ ] Ctrl K, Ctrl T, Ctrl B, Ctrl \\, Ctrl Maj K et Échap fonctionnent, y compris quand xterm a le focus. Les autres touches arrivent bien au terminal.
- [ ] Une session non visible qui attend une validation déclenche un toast, et le badge « à valider » apparaît dans la sidebar.
- [ ] Le HUD JARVIS est visuellement inchangé.
- [ ] La fenêtre reste utilisable à 980px de large (largeur minimale actuelle) : la sidebar se replie, les chips du header passent en icône seule.
