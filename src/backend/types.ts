// What the app needs from wherever its data lives. Three implementations:
//   browser — IndexedDB in this browser (single user, no email/P6)
//   desktop — SQLite file via the desktop app's main process (P6, email while open)
//   server  — Stratum Server over HTTPS (shared, multi-user, emails 24/7)

import type { StratumProject } from "../core/project";
import type { Dashboard, P6Connection, ReportRun, ReportSchedule, SmtpSettings } from "../core/reporting";
import type { Schedule } from "../core/types";

export interface ProjectSummary {
  id: string;
  code: string;
  name: string;
  dataDate: number | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface P6ProjectInfo {
  objectId: string;
  code: string;
  name: string;
  dataDate: string;
}

export interface SessionUser {
  sub?: string;
  id?: string;
  email: string;
  name: string;
  role: "admin" | "planner" | "viewer";
}

export interface Capabilities {
  /** Can send email (reports, tests). */
  email: boolean;
  /** Can talk to P6 (needs a host outside the browser sandbox). */
  p6: boolean;
  /** Can render reports to PDF on its own. */
  pdf: boolean;
  /** Emails go out even when no one has the app open. */
  alwaysOn: boolean;
  multiUser: boolean;
}

export class ConflictError extends Error {
  constructor(message: string, public version: number) {
    super(message);
  }
}

export interface Backend {
  kind: "browser" | "desktop" | "server";
  label: string;
  caps: Capabilities;
  user: SessionUser | null;

  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<{ project: StratumProject; version: number } | null>;
  /** Throws ConflictError when someone else saved since `expectedVersion`. */
  saveProject(id: string, project: StratumProject, expectedVersion?: number): Promise<number>;
  deleteProject(id: string): Promise<void>;

  listDashboards(): Promise<Dashboard[]>;
  getDashboard(id: string): Promise<Dashboard | null>;
  saveDashboard(d: Dashboard): Promise<void>;
  deleteDashboard(id: string): Promise<void>;

  listSchedules(): Promise<ReportSchedule[]>;
  saveSchedule(s: ReportSchedule): Promise<ReportSchedule>;
  deleteSchedule(id: string): Promise<void>;
  runScheduleNow(id: string): Promise<ReportRun>;
  listRuns(scheduleId?: string): Promise<ReportRun[]>;

  getSmtp(): Promise<SmtpSettings | null>;
  setSmtp(s: SmtpSettings): Promise<void>;
  testSmtp(s: SmtpSettings, to?: string): Promise<string>;

  getP6(): Promise<P6Connection[]>;
  setP6(list: P6Connection[]): Promise<void>;
  p6Test(c: P6Connection): Promise<string>;
  p6Projects(connectionId: string): Promise<P6ProjectInfo[]>;
  p6Import(connectionId: string, objectId: string): Promise<Schedule>;
  p6Push(connectionId: string, schedule: Schedule): Promise<{ updated: number; skipped: string[] }>;
}

export const NOT_IN_BROWSER = "This needs the Stratum desktop app or a Stratum Server (browsers can't reach P6 or a mail server directly).";
