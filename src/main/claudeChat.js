// Vue chat : transforme le fichier de conversation de Claude Code
// (<compte>/projects/<dossier>/<id>.jsonl) en une suite de messages, comme sur
// claude.ai : messages de l'utilisateur, reponses de Claude, et actions (outils)
// resumees en une ligne. La lecture est incrementale : seules les lignes
// ajoutees depuis la derniere lecture sont analysees.
const fs = require("node:fs");
const path = require("node:path");

const MAX_RESULT = 4000;
const MAX_INPUT = 4000;
const cache = new Map();

function shorten(text, max = 80) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function baseName(file) {
  return path.basename(String(file || "?"));
}

// Resume d'une action en une ligne (icone cote interface selon "kind").
function describeTool(name, input = {}) {
  const short = String(name || "").replace(/^mcp__(.+?)__/, "$1 · ");
  switch (name) {
    case "Read": return { kind: "read", label: `Lit ${baseName(input.file_path)}` };
    case "Edit":
    case "MultiEdit": return { kind: "edit", label: `Modifie ${baseName(input.file_path)}` };
    case "Write": return { kind: "edit", label: `Écrit ${baseName(input.file_path)}` };
    case "NotebookEdit": return { kind: "edit", label: `Modifie ${baseName(input.notebook_path)}` };
    case "Bash":
    case "PowerShell": return { kind: "run", label: shorten(input.description || input.command) || "Commande" };
    case "Grep": return { kind: "search", label: `Cherche « ${shorten(input.pattern, 50)} »` };
    case "Glob": return { kind: "search", label: `Cherche ${shorten(input.pattern, 50)}` };
    case "WebSearch": return { kind: "web", label: `Recherche web : ${shorten(input.query)}` };
    case "WebFetch": return { kind: "web", label: `Consulte ${shorten(input.url)}` };
    case "Task":
    case "Agent": return { kind: "agent", label: `Délègue : ${shorten(input.description)}` };
    case "TodoWrite": return { kind: "todo", label: "Met à jour sa liste de tâches" };
    case "AskUserQuestion": return { kind: "ask", label: "Te pose une question" };
    case "ExitPlanMode": return { kind: "plan", label: "Propose un plan" };
    case "Skill": return { kind: "other", label: `Compétence ${shorten(input.skill, 40)}` };
    default: return { kind: "other", label: short || "Outil" };
  }
}

// Detail affichable d'une action (commande, extrait de modification...).
function toolDetail(name, input = {}) {
  if (name === "Bash" || name === "PowerShell") {
    return String(input.command || "");
  }
  if (name === "Edit" && (input.old_string || input.new_string)) {
    return `${input.file_path || ""}\n--- avant\n${input.old_string || ""}\n+++ après\n${input.new_string || ""}`;
  }
  if (name === "Write") {
    return `${input.file_path || ""}\n${input.content || ""}`;
  }
  if (name === "TodoWrite" && Array.isArray(input.todos)) {
    const marks = { completed: "☑", in_progress: "▸", pending: "☐" };
    return input.todos.map((todo) => `${marks[todo.status] || "☐"} ${todo.content || todo.activeForm || ""}`).join("\n");
  }
  if (name === "AskUserQuestion" && Array.isArray(input.questions)) {
    return input.questions.map((q) => `${q.question}\n${(q.options || []).map((o, i) => `  ${i + 1}. ${o.label}`).join("\n")}`).join("\n\n");
  }
  if (name === "ExitPlanMode" && input.plan) {
    return String(input.plan);
  }
  let text = "";
  try {
    text = JSON.stringify(input, null, 2);
  } catch {}
  return text === "{}" ? "" : text;
}

function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}\n… (${value.length - max} caractères de plus)` : value;
}

function resultText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (part?.type === "text" ? part.text : part?.type === "image" ? "[image]" : "")).filter(Boolean).join("\n");
  }
  return "";
}

// Commande tapee (ex. "/clear") : Claude la range entre balises.
function commandText(text) {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1];
  if (!name) {
    return "";
  }
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] || "";
  return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
}

function createState() {
  return { offset: 0, rest: "", turns: [], tools: new Map() };
}

function pushUser(state, text, at, extra = {}) {
  state.turns.push({ role: "user", text, at, ...extra });
}

// Tour de Claude en cours (cree si le dernier tour est un message utilisateur).
function assistantTurn(state, at, model) {
  let last = state.turns[state.turns.length - 1];
  if (!last || last.role !== "assistant") {
    last = { role: "assistant", blocks: [], at, model: model || "" };
    state.turns.push(last);
  }
  if (model && !last.model) {
    last.model = model;
  }
  return last;
}

function handleEntry(state, entry) {
  if (!entry || entry.isSidechain) {
    return;
  }
  const at = Date.parse(entry.timestamp || "") || 0;

  if (entry.type === "summary" || entry.isCompactSummary) {
    state.turns.push({ role: "event", text: "Conversation compactée (résumé automatique)", at });
    return;
  }

  // Message envoye pendant que Claude travaillait.
  if (entry.type === "attachment" && entry.attachment?.type === "queued_command" && entry.attachment.commandMode === "prompt") {
    const text = String(entry.attachment.prompt || "").trim();
    if (text) {
      pushUser(state, text, at, { queued: true });
    }
    return;
  }

  if (entry.type === "user" && !entry.isMeta) {
    const content = entry.message?.content;
    if (typeof content === "string") {
      const text = content.trim();
      if (!text) {
        return;
      }
      const command = commandText(text);
      if (command) {
        pushUser(state, command, at, { command: true });
      } else if (text.startsWith("<local-command-stdout>")) {
        const out = text.replace(/<\/?local-command-stdout>/g, "").trim();
        if (out) {
          state.turns.push({ role: "event", text: out, at });
        }
      } else if (!text.startsWith("<") && !text.startsWith("Caveat:")) {
        pushUser(state, text, at);
      }
      return;
    }
    if (!Array.isArray(content)) {
      return;
    }
    const texts = [];
    let images = 0;
    for (const part of content) {
      if (part?.type === "tool_result") {
        const tool = state.tools.get(part.tool_use_id);
        if (tool) {
          tool.result = clip(resultText(part.content), MAX_RESULT);
          tool.isError = Boolean(part.is_error);
          tool.done = true;
        }
      } else if (part?.type === "text" && part.text?.trim()) {
        const text = part.text.trim();
        if (text.startsWith("[Request interrupted")) {
          state.turns.push({ role: "event", text: "Interrompu", at });
        } else if (!text.startsWith("<")) {
          texts.push(text);
        }
      } else if (part?.type === "image") {
        images += 1;
      }
    }
    if (texts.length || images) {
      pushUser(state, texts.join("\n\n"), at, images ? { images } : {});
    }
    return;
  }

  if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
    const model = String(entry.message.model || "");
    if (model === "<synthetic>") {
      const text = entry.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (text) {
        state.turns.push({ role: "event", text, at, error: true });
      }
      return;
    }
    const turn = assistantTurn(state, at, model);
    for (const block of entry.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        const previous = turn.blocks[turn.blocks.length - 1];
        // Texte decoupe en plusieurs entrees : on recolle les morceaux.
        if (previous?.kind === "text" && previous.messageId && previous.messageId === entry.message.id) {
          previous.text += block.text;
        } else {
          turn.blocks.push({ kind: "text", text: block.text, messageId: entry.message.id || "" });
        }
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        turn.blocks.push({ kind: "thinking", text: clip(block.thinking, MAX_INPUT) });
      } else if (block.type === "tool_use") {
        const info = describeTool(block.name, block.input || {});
        const tool = {
          kind: "tool",
          id: block.id,
          name: block.name,
          toolKind: info.kind,
          label: info.label,
          detail: clip(toolDetail(block.name, block.input || {}), MAX_INPUT),
          result: "",
          isError: false,
          done: false
        };
        state.tools.set(block.id, tool);
        turn.blocks.push(tool);
      }
    }
  }
}

function readFrom(file, offset) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size <= offset) {
      return { text: "", size };
    }
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    return { text: buffer.toString("utf8"), size };
  } catch {
    return { text: "", size: offset };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

// Renvoie { version, turns } ; version change a chaque ajout au fichier, ce qui
// permet a l'interface de ne redessiner que si besoin (since = version connue).
function readChat(file, since) {
  if (!file) {
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  let state = cache.get(file);
  // Fichier raccourci (reecrit) : on repart de zero.
  if (!state || stat.size < state.offset) {
    state = createState();
    cache.set(file, state);
  }
  if (stat.size > state.offset) {
    const { text, size } = readFrom(file, state.offset);
    // On ne garde que les lignes completes (la derniere peut etre en cours d'ecriture).
    const data = state.rest + text;
    const lastNewline = data.lastIndexOf("\n");
    const complete = lastNewline >= 0 ? data.slice(0, lastNewline) : "";
    state.rest = lastNewline >= 0 ? data.slice(lastNewline + 1) : data;
    state.offset = size;
    for (const line of complete.split("\n")) {
      if (!line.startsWith("{")) {
        continue;
      }
      try {
        handleEntry(state, JSON.parse(line));
      } catch {}
    }
  }
  // Version = taille lue : elle change a chaque ajout dans le fichier.
  if (since && Number(since) === state.offset) {
    return { version: state.offset, unchanged: true };
  }
  return { version: state.offset, turns: state.turns };
}

module.exports = { readChat };
