// Narrow bridge between the app page and the main process:
//   - invoke(): calls one of an allow-listed set of service methods
//     (local database, P6 connectors, email) — see ALLOWED in host.ts;
//   - onOpenFile(): files the OS asked Stratum to open (double-clicked .xer/.ifc).
// No Node or Electron APIs are exposed to the page.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stratumDesktop", {
  isDesktop: true,
  /** Call a service method in the main process (local database, P6, email). */
  invoke: (method, ...args) => ipcRenderer.invoke("stratum:api", method, args),
  info: () => ipcRenderer.invoke("stratum:info"),
  onOpenFile: (callback) => {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on("open-file", listener);
    ipcRenderer.send("renderer-ready");
    return () => ipcRenderer.removeListener("open-file", listener);
  },
});
