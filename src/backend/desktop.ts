import type { Backend } from "./types";

/** Desktop app: every call goes to the main process (local SQLite database). */
export function desktopBackend(): Backend {
  const bridge = window.stratumDesktop!;
  const call = <T>(method: string, ...args: unknown[]) =>
    bridge.invoke<T>(method, ...args).catch((err: Error) => {
      // Electron prefixes errors with "Error invoking remote method …: Error: ".
      throw new Error(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    });
  return {
    kind: "desktop",
    label: "This computer (local database)",
    caps: { email: true, p6: true, pdf: true, alwaysOn: false, multiUser: false },
    user: null,
    listProjects: () => call("listProjects"),
    getProject: (id) => call("getProject", id),
    saveProject: (id, p, v) => call("saveProject", id, p, v),
    deleteProject: (id) => call("deleteProject", id),
    listDashboards: () => call("listDashboards"),
    getDashboard: (id) => call("getDashboard", id),
    saveDashboard: (d) => call("saveDashboard", d),
    deleteDashboard: (id) => call("deleteDashboard", id),
    listSchedules: () => call("listSchedules"),
    saveSchedule: (s) => call("saveSchedule", s),
    deleteSchedule: (id) => call("deleteSchedule", id),
    runScheduleNow: (id) => call("runScheduleNow", id),
    listRuns: (id) => call("listRuns", id),
    getSmtp: () => call("getSmtp"),
    setSmtp: (s) => call("setSmtp", s),
    testSmtp: (s, to) => call("testSmtp", s, to),
    getP6: () => call("getP6"),
    setP6: (l) => call("setP6", l),
    p6Test: (c) => call("p6Test", c),
    p6Projects: (id) => call("p6Projects", id),
    p6Import: (id, obj) => call("p6Import", id, obj),
    p6Push: (id, s) => call("p6Push", id, s),
  };
}
