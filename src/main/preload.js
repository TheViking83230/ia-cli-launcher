const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  chooseFolder: () => ipcRenderer.invoke("dialog:choose-folder"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  resetConfig: () => ipcRenderer.invoke("config:reset"),
  getSync: () => ipcRenderer.invoke("sync:get"),
  setSyncDir: (folder) => ipcRenderer.invoke("sync:set", folder),
  disableSync: () => ipcRenderer.invoke("sync:disable"),
  gdriveStatus: () => ipcRenderer.invoke("gdrive:status"),
  gdriveSetCredentials: (clientId, clientSecret) => ipcRenderer.invoke("gdrive:set-credentials", { clientId, clientSecret }),
  gdriveConnect: () => ipcRenderer.invoke("gdrive:connect"),
  gdriveDisconnect: () => ipcRenderer.invoke("gdrive:disconnect"),
  gdriveSyncNow: () => ipcRenderer.invoke("gdrive:sync-now"),
  runPipelineStep: (request) => ipcRenderer.invoke("pipeline:run-step", request),
  cancelPipeline: () => ipcRenderer.invoke("pipeline:cancel"),
  onPipelineStepOutput: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pipeline:step-output", listener);
    return () => ipcRenderer.off("pipeline:step-output", listener);
  },
  onGdriveSynced: (handler) => {
    const listener = (_event, status, pulled) => handler(status, pulled);
    ipcRenderer.on("gdrive:synced", listener);
    return () => ipcRenderer.off("gdrive:synced", listener);
  },
  getAuthStatus: () => ipcRenderer.invoke("auth:get-status"),
  getUsage: (profileId) => ipcRenderer.invoke("usage:get", { profileId }),
  checkCommand: (command) => ipcRenderer.invoke("system:check-command", command),
  dirExists: (dirPath) => ipcRenderer.invoke("system:dir-exists", dirPath),
  openUrl: (url) => ipcRenderer.invoke("system:open-url", url),
  startTerminal: (request) => ipcRenderer.invoke("terminal:start", request),
  runCommand: (request) => ipcRenderer.invoke("terminal:run-command", request),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:input", { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  renameTerminal: (id, title) => ipcRenderer.invoke("terminal:rename", { id, title }),
  killTerminal: (id) => ipcRenderer.invoke("terminal:kill", id),
  getConversationInfo: (id) => ipcRenderer.invoke("terminal:conversation-info", id),
  getLiveStatus: (ids) => ipcRenderer.invoke("terminal:live-status", ids),
  notify: (request) => ipcRenderer.invoke("app:notify", request),
  listClaudeConversations: () => ipcRenderer.invoke("claude:conversations"),
  gitStatus: (cwd) => ipcRenderer.invoke("git:status", cwd),
  gitDiff: (cwd, file, untracked) => ipcRenderer.invoke("git:diff", { cwd, file, untracked }),
  getJarvis: () => ipcRenderer.invoke("jarvis:get"),
  setJarvis: (patch) => ipcRenderer.invoke("jarvis:set", patch),
  voiceStatus: () => ipcRenderer.invoke("voice:status"),
  voiceSpeak: (request) => ipcRenderer.invoke("voice:speak", request),
  voiceTranscribe: (wavBytes, prompt) => ipcRenderer.invoke("voice:transcribe", { wavBytes, prompt }),
  voiceWakeword: () => ipcRenderer.invoke("voice:wakeword"),
  voiceLog: (line) => ipcRenderer.send("voice:log", line),
  qualityVoiceStatus: () => ipcRenderer.invoke("voice:quality-status"),
  qualityVoiceInstall: () => ipcRenderer.invoke("voice:quality-install"),
  qualityVoiceUninstall: () => ipcRenderer.invoke("voice:quality-uninstall"),
  qualityVoiceSpeak: (id, text) => ipcRenderer.invoke("voice:quality-speak", { id, text }),
  qualityVoiceStop: () => ipcRenderer.send("voice:quality-stop"),
  qualityVoicePrepare: () => ipcRenderer.send("voice:quality-prepare"),
  onQualityVoiceProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("voice:quality-progress", listener);
    return () => ipcRenderer.off("voice:quality-progress", listener);
  },
  onQualityVoiceChunk: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("voice:quality-chunk", listener);
    return () => ipcRenderer.off("voice:quality-chunk", listener);
  },
  getLastReply: (id) => ipcRenderer.invoke("terminal:last-reply", id),
  onJarvisMenu: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("jarvis:menu", listener);
    return () => ipcRenderer.off("jarvis:menu", listener);
  },
  onNotifyActivate: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("notify:activate", listener);
    return () => ipcRenderer.off("notify:activate", listener);
  },
  pasteFilePath: (id, filePath) => ipcRenderer.invoke("terminal:paste-file-path", { id, filePath }),
  // Electron 32+ : File.path n'existe plus, le chemin passe par webUtils.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  quotePaths: (paths) => ipcRenderer.invoke("system:quote-paths", paths),
  saveClipboardImage: () => ipcRenderer.invoke("clipboard:save-image"),
  onPasteText: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("terminal:paste-text", listener);
    return () => ipcRenderer.off("terminal:paste-text", listener);
  },
  showTerminalContextMenu: (id, selectedText) => ipcRenderer.invoke("terminal:context-menu", { id, selectedText }),
  getSavedSessions: () => ipcRenderer.invoke("sessions:get-saved"),
  readScrollback: (id) => ipcRenderer.invoke("sessions:read-scrollback", id),
  getHistory: () => ipcRenderer.invoke("history:list"),
  readHistory: (id) => ipcRenderer.invoke("history:read", id),
  deleteHistory: (id) => ipcRenderer.invoke("history:delete", id),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  onTerminalData: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.off("terminal:data", listener);
  },
  onTerminalExit: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.off("terminal:exit", listener);
  },
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.off("update:status", listener);
  }
});
