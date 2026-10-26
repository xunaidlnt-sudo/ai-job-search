// Browser-only storage (IndexedDB). Projects, dashboards and schedules are
// kept in this browser. Email and P6 need the desktop app or a server.

import type { StratumProject } from "../core/project";
import { computeNextRun, type Dashboard, type ReportSchedule } from "../core/reporting";
import { ConflictError, NOT_IN_BROWSER, type Backend, type ProjectSummary } from "./types";

const DB = "stratum-local";
const STORES = ["projects", "dashboards", "schedules", "settings"] as const;
type Store = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => {
      db.close();
      resolve(req ? (req.result as T) : (undefined as T));
    };
    t.onerror = () => reject(t.error);
  });
}

const get = <T>(store: Store, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
const all = <T>(store: Store) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
const put = (store: Store, key: string, value: unknown) => tx<void>(store, "readwrite", (s) => void s.put(value, key));
const del = (store: Store, key: string) => tx<void>(store, "readwrite", (s) => void s.delete(key));

interface StoredProject {
  summary: ProjectSummary;
  project: StratumProject;
}

const unsupported = async (): Promise<never> => {
  throw new Error(NOT_IN_BROWSER);
};

export function browserBackend(): Backend {
  return {
    kind: "browser",
    label: "This browser",
    caps: { email: false, p6: false, pdf: false, alwaysOn: false, multiUser: false },
    user: null,
    async listProjects() {
      return (await all<StoredProject>("projects")).map((p) => p.summary).sort((a, b) => a.code.localeCompare(b.code));
    },
    async getProject(id) {
      const p = await get<StoredProject>("projects", id);
      return p ? { project: p.project, version: p.summary.version } : null;
    },
    async saveProject(id, project, expectedVersion) {
      const old = await get<StoredProject>("projects", id);
      if (old && expectedVersion !== undefined && old.summary.version !== expectedVersion) {
        throw new ConflictError("This project was saved in another tab. Reload it before saving.", old.summary.version);
      }
      const version = (old?.summary.version ?? 0) + 1;
      const s = project.schedule;
      await put("projects", id, {
        project,
        summary: { id, code: s?.projectCode ?? "PROJECT", name: s?.projectName ?? "Untitled", dataDate: s?.dataDate ?? null, version, updatedAt: new Date().toISOString(), updatedBy: null },
      } satisfies StoredProject);
      return version;
    },
    deleteProject: (id) => del("projects", id),
    async listDashboards() {
      return (await all<Dashboard>("dashboards")).sort((a, b) => a.name.localeCompare(b.name));
    },
    async getDashboard(id) {
      return (await get<Dashboard>("dashboards", id)) ?? null;
    },
    saveDashboard: (d) => put("dashboards", d.id, { ...d, updatedAt: new Date().toISOString() }),
    async deleteDashboard(id) {
      for (const s of await all<ReportSchedule>("schedules")) if (s.dashboardId === id) await del("schedules", s.id);
      await del("dashboards", id);
    },
    listSchedules: () => all<ReportSchedule>("schedules"),
    async saveSchedule(s) {
      const next = { ...s, nextRunAt: s.enabled ? new Date(computeNextRun(s, Date.now())).toISOString() : null };
      await put("schedules", s.id, next);
      return next;
    },
    deleteSchedule: (id) => del("schedules", id),
    runScheduleNow: unsupported,
    listRuns: async () => [],
    getSmtp: async () => null,
    setSmtp: unsupported,
    testSmtp: unsupported,
    getP6: async () => [],
    setP6: unsupported,
    p6Test: unsupported,
    p6Projects: unsupported,
    p6Import: unsupported,
    p6Push: unsupported,
  };
}
