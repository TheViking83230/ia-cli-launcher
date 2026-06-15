const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  getAppState: () => ipcRenderer.invoke("app:get-state"),
  chooseFolder: () => ipcRenderer.invoke("dialog:choose-folder"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  resetConfig: () => ipcRenderer.invoke("config:reset"),
  getAuthStatus: () => ipcRenderer.invoke("auth:get-status"),
  checkCommand: (command) => ipcRenderer.invoke("system:check-command", command),
  openUrl: (url) => ipcRenderer.invoke("system:open-url", url),
  startTerminal: (request) => ipcRenderer.invoke("terminal:start", request),
  runCommand: (request) => ipcRenderer.invoke("terminal:run-command", request),
  writeTerminal: (id, data) => ipcRenderer.invoke("terminal:input", { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  renameTerminal: (id, title) => ipcRenderer.invoke("terminal:rename", { id, title }),
  killTerminal: (id) => ipcRenderer.invoke("terminal:kill", id),
  pasteFilePath: (id, filePath) => ipcRenderer.invoke("terminal:paste-file-path", { id, filePath }),
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
