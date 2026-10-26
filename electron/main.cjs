// Stratum desktop shell. Serves the built web app (dist/) over a private
// app:// scheme so fetch, WebAssembly (web-ifc) and IndexedDB autosave behave
// exactly as they do in the browser.

const { app, BrowserWindow, Menu, protocol, net, shell, dialog, session, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const DIST = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Files the OS asked us to open, queued until the app page is ready for them.
const OPENABLE = /\.(xer|ifc)$/i;
const pending = [];
let rendererReady = false;

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => OPENABLE.test(a) && fs.existsSync(a));
}

function deliver(filePath) {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || !rendererReady) {
    pending.push(filePath);
    return;
  }
  try {
    const bytes = fs.readFileSync(filePath);
    win.webContents.send("open-file", { name: path.basename(filePath), bytes: new Uint8Array(bytes) });
  } catch (err) {
    dialog.showErrorBox("Could not open file", `${filePath}\n\n${err.message}`);
  }
}

ipcMain.on("renderer-ready", () => {
  rendererReady = true;
  while (pending.length) deliver(pending.shift());
});

// macOS sends files through this event, sometimes before the app is ready.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  deliver(filePath);
});

// One window per user; a second launch (e.g. double-clicking another .xer) goes to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    filesFromArgv(argv).forEach(deliver);
  });
}

function serveDist() {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.normalize(path.join(DIST, rel));
    // Refuse anything that escapes dist/.
    if (!file.startsWith(DIST + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Stratum 4D",
    backgroundColor: "#f5f6f8",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(`${SCHEME}://stratum/index.html`);
  // A reload re-registers the listener; hold files until it does.
  win.webContents.on("did-start-loading", () => (rendererReady = false));

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  return win;
}

// Saved projects, snapshots and videos: ask where to save, like a desktop app should.
function handleDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "Save", defaultPath: path.join(app.getPath("documents"), item.getFilename()) });
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About Stratum 4D",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "About Stratum 4D",
              message: `Stratum 4D ${app.getVersion()}`,
              detail: "4D construction planning: P6 schedules linked to IFC models.\n\nDeveloped by Junaid Quamar, Senior Planning Engineer.\nhttps://www.linkedin.com/in/junaidquamar/\n\nPress ? inside the app for the getting-started guide.",
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  serveDist();
  handleDownloads();
  buildMenu();
  // Local database, report scheduler and P6/email services (see host.ts).
  try {
    const { startHost } = require("./host.cjs");
    await startHost({ appUrl: `${SCHEME}://stratum/index.html`, preload: path.join(__dirname, "preload.cjs"), log: (m) => console.log(m) });
  } catch (err) {
    dialog.showErrorBox("Stratum could not open its database", String(err && err.stack ? err.stack : err));
  }
  createWindow();
  filesFromArgv(process.argv).forEach(deliver);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
