// Minimal, read-only bridge: lets the app receive files the OS asked Stratum
// to open (double-clicked .xer, "Open with…"). Nothing else is exposed.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stratumDesktop", {
  isDesktop: true,
  onOpenFile: (callback) => {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on("open-file", listener);
    ipcRenderer.send("renderer-ready");
    return () => ipcRenderer.removeListener("open-file", listener);
  },
});
