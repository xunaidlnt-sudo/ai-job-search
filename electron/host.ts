// Desktop host: runs the shared services inside Electron's main process.
//   - Local database: SQLite file in the user's app-data folder.
//   - Secrets: encrypted with the OS keychain (Electron safeStorage).
//   - PDF reports: the app's report view rendered in a hidden window.
//   - Scheduled emails: sent while the app is running.
// Bundled with esbuild into electron/host.cjs (see npm run build:electron).

import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { StratumApi } from "../src/services/api";
import { Repository } from "../src/services/repo";
import { startScheduler } from "../src/services/runner";
import { aesBox, type SecretBox } from "../src/services/secrets";
import { openSqlite } from "../src/services/sql";

/**
 * fetch through Chromium's network stack: it trusts the Windows / macOS
 * certificate store (company CAs included), follows the system proxy, and
 * keeps P6 session cookies in an in-memory session of its own.
 */
function platformFetch(): typeof fetch {
  const ses = session.fromPartition("stratum-p6");
  return ((url: string, init?: RequestInit) => ses.fetch(url, { ...init, credentials: "include" })) as unknown as typeof fetch;
}

/** Methods the renderer may call. Anything else is refused. */
const ALLOWED = new Set([
  "listProjects",
  "getProject",
  "saveProject",
  "deleteProject",
  "listDashboards",
  "getDashboard",
  "saveDashboard",
  "deleteDashboard",
  "listSchedules",
  "saveSchedule",
  "deleteSchedule",
  "runScheduleNow",
  "listRuns",
  "getSmtp",
  "setSmtp",
  "testSmtp",
  "getP6",
  "setP6",
  "p6Test",
  "p6Projects",
  "p6Import",
  "p6Push",
  "getSetting",
  "setSetting",
]);

function keychainBox(): SecretBox {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      seal: (plain) => (plain ? `os:${safeStorage.encryptString(plain).toString("base64")}` : ""),
      open: (sealed) => (!sealed ? "" : sealed.startsWith("os:") ? safeStorage.decryptString(Buffer.from(sealed.slice(3), "base64")) : sealed),
    };
  }
  // No keychain (some Linux desktops): fall back to a key derived from this machine and user.
  return aesBox(crypto.createHash("sha256").update(`${os.hostname()}|${os.userInfo().username}|stratum-local`).digest("hex"));
}

export interface HostOptions {
  /** URL of the app page, e.g. app://stratum/index.html */
  appUrl: string;
  preload: string;
  log?: (m: string) => void;
}

export async function startHost(o: HostOptions): Promise<{ dbFile: string; stop: () => void }> {
  const dbFile = path.join(app.getPath("userData"), "stratum.db");
  const repo = new Repository(await openSqlite(dbFile, { wasmDir: __dirname }));
  await repo.migrate();

  const renderPdf = async (dashboardId: string, projectId: string | null): Promise<Buffer> => {
    const win = new BrowserWindow({
      show: false,
      width: 1400,
      height: 990,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: o.preload },
    });
    try {
      const qs = new URLSearchParams({ report: dashboardId, local: "1" });
      if (projectId) qs.set("project", projectId);
      await win.loadURL(`${o.appUrl}#${qs.toString()}`);
      const started = Date.now();
      for (;;) {
        const state = await win.webContents.executeJavaScript("document.body.dataset.reportReady || ''");
        if (state === "1") break;
        if (state === "error") throw new Error(await win.webContents.executeJavaScript("document.body.dataset.reportError || 'Report failed'"));
        if (Date.now() - started > 60_000) throw new Error("Report took too long to render");
        await new Promise((r) => setTimeout(r, 200));
      }
      const landscape = (await win.webContents.executeJavaScript("document.body.dataset.orientation || ''")) !== "portrait";
      return await win.webContents.printToPDF({ landscape, pageSize: "A4", printBackground: true, margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.3, right: 0.3 } });
    } finally {
      win.destroy();
    }
  };

  const api = new StratumApi({ repo, box: keychainBox(), renderPdf, wasmDir: __dirname, log: o.log, p6Fetch: platformFetch(), p6CookieJar: true, where: "desktop" });

  ipcMain.handle("stratum:api", async (_e, method: string, args: unknown[]) => {
    if (!ALLOWED.has(method)) throw new Error(`Not allowed: ${method}`);
    const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    return fn.apply(api, Array.isArray(args) ? args : []);
  });
  ipcMain.handle("stratum:info", () => ({ dbFile, version: app.getVersion(), pdf: true }));

  const stop = startScheduler(api.runnerDeps());
  return { dbFile, stop };
}
