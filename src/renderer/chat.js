// Vue chat des onglets Claude : la conversation affichee comme sur claude.ai
// (bulles, Markdown, actions resumees) au lieu du terminal. Le terminal reste
// monte dessous (meme taille, la CLI ne voit aucune difference) : les messages
// tapes ici lui sont envoyes, et quand Claude attend une reponse (autorisation,
// question), le bas de son ecran est recopie avec des touches pour repondre.
// Charge avant renderer.js : les fonctions de renderer.js (state, pasteToSession...)
// ne sont appelees qu'a l'usage.

const CHAT_POLL_MS = 1200;
const CHAT_PREF_KEY = "chatViewPreferred";

// --- Markdown (sous-ensemble sur : tout est echappe avant mise en forme) -----
function chatEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function chatInline(text) {
  const codes = [];
  let html = chatEscape(text).replace(/`([^`\n]+)`/g, (_m, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  html = html
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-chat-link>$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-chat-link>$2</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return html.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

function chatTable(lines) {
  const cells = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<table><thead><tr>${head.map((c) => `<th>${chatInline(c)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${chatInline(c)}</td>`).join("")}</tr>`).join("")
  }</tbody></table>`;
}

function renderChatMarkdown(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const lang = fence[2] ? `<span class="chat-code-lang">${chatEscape(fence[2])}</span>` : "";
      out.push(`<div class="chat-code">${lang}<button type="button" class="chat-copy" title="Copier">Copier</button><pre><code>${chatEscape(code.join("\n"))}</code></pre></div>`);
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      out.push(`<h${level}>${chatInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
      const block = [];
      while (i < lines.length && lines[i].includes("|")) {
        block.push(lines[i]);
        i += 1;
      }
      out.push(chatTable(block));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderChatMarkdown(block.join("\n"))}</blockquote>`);
      continue;
    }
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (item) {
          items.push({ indent: item[1].length, text: item[3] });
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => {
        const checkbox = /^\[([ xX])\]\s+/.exec(it.text);
        const text = checkbox ? `${checkbox[1].trim() ? "☑" : "☐"} ${it.text.slice(checkbox[0].length)}` : it.text;
        return `<li${it.indent >= 2 ? ' class="chat-sub"' : ""}>${chatInline(text)}</li>`;
      }).join("")}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (!para.length) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${para.map(chatInline).join("<br>")}</p>`);
  }
  return out.join("");
}

// --- Rendu des messages ------------------------------------------------------
const CHAT_TOOL_ICONS = {
  read: "file-text", edit: "file-pen-line", run: "square-terminal", search: "search", web: "globe",
  agent: "bot", todo: "list-checks", ask: "circle-help", plan: "map", other: "wrench"
};

function chatTime(at) {
  return at ? new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
}

function renderChatTool(block) {
  const details = document.createElement("details");
  details.className = `chat-tool${block.isError ? " error" : ""}${block.done ? "" : " running"}`;
  const summary = document.createElement("summary");
  summary.innerHTML = `<i data-lucide="${CHAT_TOOL_ICONS[block.toolKind] || "wrench"}"></i><span class="chat-tool-label"></span><span class="chat-tool-state"></span>`;
  summary.querySelector(".chat-tool-label").textContent = block.label;
  summary.querySelector(".chat-tool-state").textContent = block.isError ? "erreur" : block.done ? "" : "en cours…";
  details.appendChild(summary);
  if (block.detail) {
    const pre = document.createElement("pre");
    pre.className = "chat-tool-detail";
    pre.textContent = block.detail;
    details.appendChild(pre);
  }
  if (block.result) {
    const pre = document.createElement("pre");
    pre.className = "chat-tool-result";
    pre.textContent = block.result;
    details.appendChild(pre);
  }
  // Questions, plans et listes de taches : contenu utile, ouvert d'office.
  if (["ask", "plan", "todo"].includes(block.toolKind)) {
    details.open = true;
  }
  return details;
}

function renderChatTurn(turn) {
  const el = document.createElement("div");
  if (turn.role === "user") {
    el.className = `chat-msg user${turn.command ? " command" : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = turn.text || "";
    if (turn.images) {
      const tag = document.createElement("span");
      tag.className = "chat-attach";
      tag.textContent = turn.images > 1 ? `🖼 ${turn.images} images` : "🖼 image";
      bubble.appendChild(tag);
    }
    el.appendChild(bubble);
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = `${turn.queued ? "envoyé pendant le travail · " : ""}${chatTime(turn.at)}`;
    el.appendChild(meta);
    return el;
  }
  if (turn.role === "event") {
    el.className = `chat-event${turn.error ? " error" : ""}`;
    el.textContent = turn.text;
    return el;
  }
  el.className = "chat-msg assistant";
  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1-6.1-1.9 6.1-1.9z"/></svg>';
  const body = document.createElement("div");
  body.className = "chat-body";
  let tools = null;
  for (const block of turn.blocks || []) {
    if (block.kind === "tool") {
      if (!tools) {
        tools = document.createElement("div");
        tools.className = "chat-tools";
        body.appendChild(tools);
      }
      tools.appendChild(renderChatTool(block));
      continue;
    }
    tools = null;
    if (block.kind === "thinking") {
      const details = document.createElement("details");
      details.className = "chat-thinking";
      details.innerHTML = '<summary><i data-lucide="brain"></i><span>Réflexion</span></summary>';
      const text = document.createElement("div");
      text.className = "chat-thinking-text";
      text.textContent = block.text;
      details.appendChild(text);
      body.appendChild(details);
    } else if (block.kind === "text") {
      const text = document.createElement("div");
      text.className = "chat-text";
      text.innerHTML = renderChatMarkdown(block.text);
      body.appendChild(text);
    }
  }
  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = [turn.model ? turn.model.replace(/^claude-/, "").replace(/-\d{8}$/, "") : "", chatTime(turn.at)].filter(Boolean).join(" · ");
  body.appendChild(meta);
  el.append(avatar, body);
  return el;
}

// Liens, boutons "Copier" des blocs de code.
function bindChatList(list) {
  list.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-chat-link]");
    if (link) {
      event.preventDefault();
      window.launcher.openUrl(link.getAttribute("href"));
      return;
    }
    const copy = event.target.closest(".chat-copy");
    if (copy) {
      const code = copy.parentElement.querySelector("code")?.textContent || "";
      navigator.clipboard.writeText(code);
      copy.textContent = "Copié";
      window.setTimeout(() => { copy.textContent = "Copier"; }, 1200);
    }
  });
}

// Met a jour la liste : on ne redessine que le dernier tour (il peut grandir)
// et les nouveaux.
function updateChatList(view, turns) {
  const list = view.list;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const keep = Math.max(0, Math.min(view.rendered.length, turns.length) - 1);
  for (const el of view.rendered.splice(keep)) {
    el.remove();
  }
  for (let i = keep; i < turns.length; i += 1) {
    const el = renderChatTurn(turns[i]);
    list.insertBefore(el, view.typing);
    view.rendered.push(el);
  }
  view.empty.classList.toggle("hidden", turns.length > 0);
  createIcons();
  if (atBottom || view.stickBottom) {
    view.stickBottom = false;
    list.scrollTop = list.scrollHeight;
  }
}

function createChatList() {
  const list = document.createElement("div");
  list.className = "chat-list";
  const empty = document.createElement("div");
  empty.className = "chat-empty";
  empty.innerHTML = '<div class="chat-empty-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1-6.1-1.9 6.1-1.9z"/></svg></div><div>Comment puis-je t\'aider ?</div>';
  const typing = document.createElement("div");
  typing.className = "chat-typing hidden";
  typing.innerHTML = "<span></span><span></span><span></span>";
  list.append(empty, typing);
  bindChatList(list);
  return { list, empty, typing };
}

// --- Vue chat d'un onglet ----------------------------------------------------
function isChatCapable(session) {
  return Boolean(session && session.type === "terminal" && sessionProfileId(session) === "claude");
}

function chatPreferred() {
  try {
    return window.localStorage.getItem(CHAT_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function ensureChatView(session) {
  if (session.chat) {
    return session.chat;
  }
  const root = document.createElement("div");
  root.className = "chat-view hidden";
  const { list, empty, typing } = createChatList();

  const prompt = document.createElement("div");
  prompt.className = "chat-prompt hidden";
  prompt.innerHTML = `
    <div class="chat-prompt-head"><i data-lucide="hand"></i><span class="chat-prompt-title">Claude attend ta réponse</span>
      <button type="button" class="chat-prompt-terminal">Ouvrir le terminal</button></div>
    <pre class="chat-prompt-screen"></pre>
    <div class="chat-prompt-keys">
      <button type="button" data-key="1">1</button><button type="button" data-key="2">2</button><button type="button" data-key="3">3</button>
      <button type="button" data-key="up">↑</button><button type="button" data-key="down">↓</button>
      <button type="button" data-key="enter" class="primary">Entrée</button><button type="button" data-key="esc">Échap</button>
    </div>`;

  const composer = document.createElement("div");
  composer.className = "chat-composer";
  const status = document.createElement("div");
  status.className = "chat-status";
  const box = document.createElement("div");
  box.className = "chat-input-box";
  const input = document.createElement("textarea");
  input.className = "chat-input";
  input.rows = 1;
  input.placeholder = "Écris à Claude…  (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)";
  const actions = document.createElement("div");
  actions.className = "chat-input-actions";
  actions.innerHTML = `
    <button type="button" class="chat-btn chat-attach-btn" title="Joindre des fichiers (tu peux aussi coller avec Ctrl+V ou glisser-déposer images, GIF et fichiers)"><i data-lucide="paperclip"></i></button>
    <button type="button" class="chat-btn chat-terminal-btn" title="Revenir au terminal (Ctrl+Maj+K)"><i data-lucide="square-terminal"></i></button>
    <button type="button" class="chat-btn chat-stop-btn hidden" title="Interrompre Claude (Échap)"><i data-lucide="square"></i></button>
    <button type="button" class="chat-btn chat-send-btn" title="Envoyer"><i data-lucide="arrow-up"></i></button>`;
  // Calque de coloration sous le champ : le mot « ultracode » y est colore et
  // anime (le texte du champ est transparent, seul le curseur reste visible).
  const inputWrap = document.createElement("div");
  inputWrap.className = "chat-input-wrap";
  const mirror = document.createElement("div");
  mirror.className = "chat-input-mirror";
  mirror.setAttribute("aria-hidden", "true");
  inputWrap.append(mirror, input);
  box.append(inputWrap, actions);
  const tools = buildChatTools(session);
  // Pieces jointes en attente (images, GIF, fichiers) : envoyees avec le message.
  const attachStrip = document.createElement("div");
  attachStrip.className = "chat-attachments hidden";
  composer.append(status, attachStrip, box, tools.root);
  root.append(list, prompt, composer);
  session.container.appendChild(root);

  const view = { root, list, empty, typing, prompt, status, input, mirror, box, tools, rendered: [], version: 0, open: false, timer: null, stickBottom: true, ultracode: false, ultraWords: 0, attachStrip, pending: [] };
  session.chat = view;

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(220, input.scrollHeight)}px`;
    renderUltraMirror(view);
  };
  const send = async () => {
    let text = input.value.trim();
    const files = view.pending.map((item) => item.path);
    if (!text && !files.length) {
      return;
    }
    // Mode Ultracode : le mot-cle part avec le message (Claude Code active
    // alors l'orchestration multi-agents pour cette demande).
    if (text && view.ultracode && !hasUltracode(text)) {
      text = `ultracode ${text}`;
    }
    view.pending = [];
    renderChatAttachments(session);
    input.value = "";
    autosize();
    // Chaque piece jointe est collee seule (Claude Code la reconnait alors et
    // affiche [Image #1]), puis le texte part avec Entree.
    for (const file of files) {
      const quoted = await window.launcher.quotePaths([file]);
      if (quoted) {
        pasteWithTrailingSpace(session, quoted);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    }
    if (files.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    if (text) {
      pasteToSession(session, text, true);
    } else {
      window.launcher.writeTerminal(session.id, "\r");
    }
    input.value = "";
    autosize();
    view.stickBottom = true;
    view.sentAt = Date.now();
    renderChatStatus(session);
    window.setTimeout(() => pollChat(session), 600);
  };
  input.addEventListener("input", autosize);
  input.addEventListener("scroll", () => {
    mirror.scrollTop = input.scrollTop;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && session.aiState === "busy") {
      event.preventDefault();
      window.launcher.writeTerminal(session.id, "\x1b");
    }
  });
  // Coller une image, un GIF ou des fichiers copies : ajoutes en pieces
  // jointes (apercu au-dessus de la saisie), envoyes avec le message.
  input.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    const hasText = Boolean(data?.getData("text/plain"));
    const hasFiles = Boolean(data?.files?.length);
    if (hasText && !hasFiles) {
      return;
    }
    event.preventDefault();
    collectTransfer(data, true).then((paths) => {
      if (paths.length) {
        addChatAttachments(session, paths);
      } else if (hasText) {
        document.execCommand("insertText", false, data.getData("text/plain"));
      } else {
        flashStatus("Rien à joindre dans le presse-papiers.");
      }
    });
  });
  // Glisser-deposer des fichiers ou une image depuis une page web.
  let dragDepth = 0;
  root.addEventListener("dragenter", (event) => {
    if (isFileDrag(event)) {
      event.preventDefault();
      dragDepth += 1;
      root.classList.add("chat-dropping");
    }
  });
  root.addEventListener("dragover", (event) => {
    if (isFileDrag(event)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  root.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      root.classList.remove("chat-dropping");
    }
  });
  root.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    root.classList.remove("chat-dropping");
    collectTransfer(event.dataTransfer, false).then((paths) => {
      if (paths.length) {
        addChatAttachments(session, paths);
      } else {
        flashStatus("Impossible de joindre cet élément.");
      }
    });
  });
  actions.querySelector(".chat-send-btn").addEventListener("click", send);
  actions.querySelector(".chat-attach-btn").addEventListener("click", async () => {
    const paths = await window.launcher.chooseFiles();
    if (paths?.length) {
      addChatAttachments(session, paths);
    }
  });
  actions.querySelector(".chat-terminal-btn").addEventListener("click", () => setChatView(session, false));
  actions.querySelector(".chat-stop-btn").addEventListener("click", () => window.launcher.writeTerminal(session.id, "\x1b"));
  prompt.querySelector(".chat-prompt-terminal").addEventListener("click", () => setChatView(session, false));
  const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", esc: "\x1b" };
  prompt.querySelector(".chat-prompt-keys").addEventListener("click", (event) => {
    const key = event.target.closest("button")?.dataset.key;
    if (key) {
      window.launcher.writeTerminal(session.id, KEYS[key] || key);
      window.setTimeout(() => renderChatPrompt(session), 250);
    }
  });
  createIcons();
  return view;
}

// --- Pieces jointes de la vue chat ------------------------------------------------
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg", "application/pdf": "pdf", "text/plain": "txt" };

function isFileDrag(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes("Files") || types.includes("text/uri-list");
}

// Premiere image d'un extrait HTML (image copiee ou glissee depuis une page).
function imageUrlFromHtml(html) {
  const src = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html || ""))?.[1] || "";
  return /^https?:/i.test(src) ? src.replace(/&amp;/g, "&") : "";
}

// Chemins des elements colles ou deposes : fichiers du disque tels quels,
// images sans fichier (capture, image web) enregistrees en temporaire. Un GIF
// venu d'une page est retelecharge pour garder son animation.
async function collectTransfer(data, fromClipboard) {
  const paths = [];
  if (!data) {
    return paths;
  }
  const html = data.getData?.("text/html") || "";
  const uri = (data.getData?.("text/uri-list") || "").split(/\r?\n/).find((line) => /^https?:/i.test(line)) || "";
  const webImage = imageUrlFromHtml(html) || (/\.(gif|png|jpe?g|webp|bmp|svg)(\?|$)/i.test(uri) ? uri : "");
  const files = Array.from(data.files || []);
  const blobs = [];
  for (const file of files) {
    const onDisk = window.launcher.getPathForFile(file);
    if (onDisk) {
      paths.push(onDisk);
    } else {
      blobs.push(file);
    }
  }
  if (!paths.length && webImage && (/\.gif(\?|$)/i.test(webImage) || !blobs.length)) {
    const saved = await window.launcher.saveAttachmentUrl(webImage);
    if (saved) {
      return [saved];
    }
  }
  for (const file of blobs) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await window.launcher.saveAttachmentBytes(file.name || "image", bytes, MIME_EXT[file.type] || "bin");
    if (saved) {
      paths.push(saved);
    }
  }
  if (!paths.length && fromClipboard) {
    // Fichiers copies dans l'Explorateur (absents de l'evenement sous Windows),
    // sinon image du presse-papiers.
    const copied = await window.launcher.readClipboardFiles();
    if (copied.length) {
      return copied;
    }
    const image = await window.launcher.saveClipboardImage();
    if (image?.path) {
      return [image.path];
    }
  }
  return paths;
}

function addChatAttachments(session, paths) {
  const view = session.chat;
  if (!view) {
    return;
  }
  const known = new Set(view.pending.map((item) => item.path));
  for (const item of paths) {
    if (item && !known.has(item)) {
      known.add(item);
      view.pending.push({ path: item, name: String(item).split(/[\\/]/).pop() });
    }
  }
  renderChatAttachments(session);
  view.input.focus();
}

function renderChatAttachments(session) {
  const view = session.chat;
  const strip = view?.attachStrip;
  if (!strip) {
    return;
  }
  strip.innerHTML = "";
  strip.classList.toggle("hidden", !view.pending.length);
  for (const item of view.pending) {
    const chip = document.createElement("div");
    chip.className = "chat-attach-chip";
    chip.title = `${item.path}\nClic : ouvrir`;
    if (IMAGE_FILE.test(item.name)) {
      chip.classList.add("is-image");
      const img = document.createElement("img");
      img.src = fileUrl(item.path);
      img.alt = "";
      chip.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "chat-attach-icon";
      icon.innerHTML = '<i data-lucide="file-text"></i>';
      const name = document.createElement("span");
      name.className = "chat-attach-name";
      name.textContent = item.name;
      chip.append(icon, name);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chat-attach-remove";
    remove.title = "Retirer";
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      view.pending = view.pending.filter((other) => other !== item);
      renderChatAttachments(session);
    });
    chip.appendChild(remove);
    chip.addEventListener("click", () => window.launcher.openPath(item.path));
    strip.appendChild(chip);
  }
  createIcons();
}

// --- Mot-cle « ultracode » et barre d'outils sous la saisie ---------------------
const ULTRACODE_RE = /\bultracode\b/gi;
const EFFORT_LEVELS = [
  ["low", "Bas"],
  ["medium", "Moyen"],
  ["high", "Élevé"],
  ["xhigh", "Très élevé"],
  ["max", "Max"]
];

function hasUltracode(text) {
  return /\bultracode\b/i.test(String(text || ""));
}

function escapeChatHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function renderUltraMirror(view) {
  const text = view.input.value;
  const count = (text.match(ULTRACODE_RE) || []).length;
  // Un caractere invisible en fin de texte garde la meme hauteur que le champ.
  view.mirror.innerHTML = `${escapeChatHtml(text).replace(ULTRACODE_RE, (word) => `<span class="ultracode-word">${word}</span>`)}​`;
  view.mirror.scrollTop = view.input.scrollTop;
  if (count > view.ultraWords) {
    playUltracodeBurst(view, "Ultracode");
  }
  view.ultraWords = count;
}

// Petite animation : contour qui tourne autour de la saisie, etincelles et
// etiquette qui s'envole.
function playUltracodeBurst(view, label) {
  const box = view.box;
  box.classList.remove("ultra-burst");
  void box.offsetWidth;
  box.classList.add("ultra-burst");
  window.clearTimeout(view.burstTimer);
  view.burstTimer = window.setTimeout(() => box.classList.remove("ultra-burst"), 1400);
  box.querySelectorAll(".ultra-tag").forEach((node) => node.remove());
  const tag = document.createElement("span");
  tag.className = "ultra-tag";
  tag.textContent = `✦ ${label}`;
  box.appendChild(tag);
  for (let i = 0; i < 10; i += 1) {
    const spark = document.createElement("span");
    spark.className = "ultra-spark";
    spark.style.left = `${6 + i * 9.5}%`;
    spark.style.setProperty("--dx", `${(i % 2 ? 1 : -1) * (6 + ((i * 7) % 18))}px`);
    spark.style.animationDelay = `${(i % 5) * 60}ms`;
    box.appendChild(spark);
    window.setTimeout(() => spark.remove(), 1300);
  }
  window.setTimeout(() => tag.remove(), 1400);
}

function setUltracode(session, on) {
  const view = session.chat;
  if (!view) {
    return;
  }
  view.ultracode = on;
  view.box.classList.toggle("ultra-on", on);
  view.tools.ultra.classList.toggle("on", on);
  view.tools.ultra.setAttribute("aria-pressed", String(on));
  view.input.placeholder = on
    ? "Ultracode activé : ta demande sera traitée par plusieurs agents…"
    : "Écris à Claude…  (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)";
  if (on) {
    playUltracodeBurst(view, "Ultracode activé");
  }
  view.input.focus();
}

// Etat affiche par Claude Code en bas de son ecran (« ◐ medium · /effort »,
// « ⏵⏵ auto mode on »).
function readClaudeFooter(session) {
  const tail = terminalScreenTail(session, 14);
  const effort = /\b(low|medium|high|xhigh|max)\s*·\s*\/effort/i.exec(tail)?.[1]?.toLowerCase() || "";
  let mode = "";
  if (/plan mode on/i.test(tail)) {
    mode = "Plan";
  } else if (/auto mode on/i.test(tail)) {
    mode = "Auto";
  } else if (/accept edits on/i.test(tail)) {
    mode = "Éditions auto";
  } else if (/bypass(ing)? permissions/i.test(tail)) {
    mode = "Accès total";
  }
  return { effort, mode };
}

function sendClaudeCommand(session, command) {
  pasteToSession(session, command, true);
  if (session.chat) {
    session.chat.sentAt = Date.now();
    renderChatStatus(session);
  }
  window.setTimeout(() => renderChatTools(session), 900);
}

function buildChatTools(session) {
  const root = document.createElement("div");
  root.className = "chat-bar";

  const effort = document.createElement("div");
  effort.className = "chat-effort";
  effort.title = "Effort de réflexion de Claude (commande /effort)";
  const effortLabel = document.createElement("span");
  effortLabel.className = "chat-bar-label";
  effortLabel.textContent = "Effort";
  effort.appendChild(effortLabel);
  const effortButtons = {};
  for (const [id, label] of EFFORT_LEVELS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-effort-btn";
    button.dataset.level = id;
    button.textContent = label;
    button.title = `/effort ${id}`;
    button.addEventListener("click", () => {
      if (session.chat) {
        session.chat.effort = id;
      }
      sendClaudeCommand(session, `/effort ${id}`);
    });
    effort.appendChild(button);
    effortButtons[id] = button;
  }
  root.appendChild(effort);

  const tool = (icon, label, title, onClick, extra = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-bar-btn ${extra}`.trim();
    button.title = title;
    button.innerHTML = `<i data-lucide="${icon}"></i><span></span>`;
    button.querySelector("span").textContent = label;
    button.addEventListener("click", onClick);
    root.appendChild(button);
    return button;
  };

  const ultra = tool("sparkles", "Ultracode", "Ultracode : Claude orchestre plusieurs agents pour tes demandes (plus complet, mais consomme beaucoup plus de quota)", () => setUltracode(session, !session.chat?.ultracode), "chat-ultra");
  ultra.setAttribute("aria-pressed", "false");
  const mode = tool("shield", "Mode", "Changer de mode de permission (Maj+Tab dans Claude Code : normal, éditions auto, plan, auto)", () => {
    window.launcher.writeTerminal(session.id, "\x1b[Z");
    window.setTimeout(() => renderChatTools(session), 500);
  });
  tool("cpu", "Modèle", "Choisir le modèle (ouvre le choix dans le terminal)", () => {
    pasteToSession(session, "/model", true);
    setChatView(session, false);
  });
  tool("minimize-2", "Compacter", "Résumer la conversation pour libérer du contexte (/compact)", () => sendClaudeCommand(session, "/compact"));
  return { root, ultra, mode, effortButtons };
}

function renderChatTools(session) {
  const view = session.chat;
  if (!view?.tools) {
    return;
  }
  const { effort, mode } = readClaudeFooter(session);
  // Claude Code n'affiche pas toujours l'effort : on garde le dernier connu.
  if (effort) {
    view.effort = effort;
  }
  for (const [id, button] of Object.entries(view.tools.effortButtons)) {
    button.classList.toggle("on", id === view.effort);
  }
  view.tools.mode.querySelector("span").textContent = mode ? `Mode : ${mode}` : "Mode";
}

// Bas de l'ecran du terminal (question ou autorisation affichee par Claude).
function terminalScreenTail(session, maxLines = 18) {
  const buffer = session.terminal?.buffer?.active;
  if (!buffer) {
    return "";
  }
  const lines = [];
  const start = buffer.viewportY;
  for (let i = start; i < start + session.terminal.rows; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) || "");
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.slice(-maxLines).join("\n");
}

function renderChatPrompt(session) {
  const view = session.chat;
  if (!view) {
    return;
  }
  const waiting = session.aiState === "waiting";
  view.prompt.classList.toggle("hidden", !waiting);
  if (waiting) {
    view.prompt.querySelector(".chat-prompt-title").textContent = `Claude ${describeWaiting(session.waitingFor)}`;
    view.prompt.querySelector(".chat-prompt-screen").textContent = terminalScreenTail(session);
  }
}

function renderChatStatus(session) {
  const view = session.chat;
  if (!view) {
    return;
  }
  try {
    renderChatTools(session);
  } catch {}
  const busy = session.aiState === "busy" || (view.sentAt && Date.now() - view.sentAt < 4000 && session.aiState !== "waiting");
  view.typing.classList.toggle("hidden", !busy);
  view.root.querySelector(".chat-stop-btn").classList.toggle("hidden", !busy);
  const account = typeof accountLabelOf === "function" ? accountLabelOf(session.claudeAccountId) : "";
  const parts = [];
  if (session.tab.classList.contains("ended")) {
    parts.push("Session terminée");
  } else if (session.aiState === "waiting") {
    parts.push(`Claude ${describeWaiting(session.waitingFor)}`);
  } else if (busy) {
    parts.push("Claude travaille… (Échap pour interrompre)");
  }
  if (account) {
    parts.push(`Compte : ${account}`);
  }
  if (session.context?.window) {
    parts.push(`Contexte ${Math.round(session.context.percent)} %`);
  }
  view.status.textContent = parts.join(" · ");
}

async function pollChat(session) {
  const view = session.chat;
  if (!view?.open || view.polling || !state.sessions.has(session.id)) {
    return;
  }
  view.polling = true;
  try {
    const data = await window.launcher.readClaudeChat({ tabId: session.id, since: view.version });
    if (data && !data.unchanged && Array.isArray(data.turns)) {
      // Nouvelle conversation dans l'onglet (/clear, reprise) : on repart a zero.
      if (data.conversationId !== view.conversationId) {
        for (const el of view.rendered.splice(0)) {
          el.remove();
        }
        view.conversationId = data.conversationId;
        view.stickBottom = true;
      }
      view.version = data.version;
      updateChatList(view, data.turns);
    }
  } catch {}
  view.polling = false;
  renderChatStatus(session);
  renderChatPrompt(session);
}

function setChatView(session, open, remember = true) {
  if (!isChatCapable(session)) {
    return;
  }
  const view = ensureChatView(session);
  view.open = Boolean(open);
  view.root.classList.toggle("hidden", !view.open);
  session.container.classList.toggle("chat-open", view.open);
  window.clearInterval(view.timer);
  view.timer = null;
  if (view.open) {
    view.stickBottom = true;
    pollChat(session);
    view.timer = window.setInterval(() => {
      if (!document.hidden && isSessionVisible(session)) {
        pollChat(session);
      }
    }, CHAT_POLL_MS);
    window.setTimeout(() => view.input.focus(), 30);
  } else {
    window.setTimeout(() => {
      try {
        session.fitAddon.fit();
      } catch {}
      session.terminal.focus();
    }, 30);
  }
  if (remember) {
    try {
      window.localStorage.setItem(CHAT_PREF_KEY, view.open ? "1" : "0");
    } catch {}
  }
  updateChatButton();
}

function toggleChatView() {
  const session = state.sessions.get(state.activeSessionId);
  if (!isChatCapable(session)) {
    flashStatus("La vue chat est disponible pour les onglets Claude Code.");
    return;
  }
  setChatView(session, !session.chat?.open);
}

function updateChatButton() {
  const button = document.getElementById("chatViewButton");
  if (!button) {
    return;
  }
  const session = state.sessions.get(state.activeSessionId);
  const capable = isChatCapable(session);
  const open = Boolean(capable && session.chat?.open);
  button.disabled = !capable;
  button.classList.toggle("toggle-on", open);
  button.title = open ? "Revenir au terminal (Ctrl+Maj+K)" : "Vue chat : la conversation comme sur claude.ai (Ctrl+Maj+K)";
}

// Nouvel onglet Claude : vue chat d'office si c'est la derniere preference,
// une fois Claude pret (l'ecran de demarrage, ex. confiance dans le dossier,
// reste visible dans le terminal).
function maybeAutoOpenChat(session) {
  if (!isChatCapable(session) || session.chatAutoDone || !chatPreferred()) {
    return;
  }
  if (session.aiState === "idle" || session.aiState === "busy") {
    session.chatAutoDone = true;
    if (!session.chat?.open) {
      setChatView(session, true, false);
    }
  }
}

function disposeChatView(session) {
  if (session?.chat) {
    window.clearInterval(session.chat.timer);
  }
}

// --- Lecture d'une conversation passee (explorateur) ------------------------
async function openConversationReader(conversation) {
  const modal = createModal({
    icon: "message-circle",
    title: conversation.title,
    sub: `${conversation.cwd}${conversation.accountLabel ? ` · compte ${conversation.accountLabel}` : ""} · ${new Date(conversation.updatedAt).toLocaleString("fr-FR")}`,
    dialogClass: "chat-reader-dialog"
  });
  const { list, empty, typing } = createChatList();
  list.classList.add("reader");
  empty.querySelector("div:last-child").textContent = "Chargement…";
  modal.body.appendChild(list);
  const resume = document.createElement("button");
  resume.type = "button";
  resume.className = "ghost-button";
  resume.innerHTML = '<i data-lucide="rotate-cw"></i> Reprendre dans un onglet';
  resume.disabled = !conversation.dirExists;
  resume.addEventListener("click", async () => {
    modal.close();
    const session = await resumeClaudeConversation(conversation);
    if (session) {
      setChatView(session, true);
    }
  });
  modal.actions.prepend(resume);
  createIcons();
  try {
    const data = await window.launcher.readClaudeChat({ conversationId: conversation.id, cwd: conversation.cwd });
    const view = { list, empty, typing, rendered: [], stickBottom: true };
    updateChatList(view, data?.turns || []);
    if (!data?.turns?.length) {
      empty.querySelector("div:last-child").textContent = "Conversation vide ou illisible.";
    }
  } catch {
    empty.querySelector("div:last-child").textContent = "Lecture impossible.";
  }
}
