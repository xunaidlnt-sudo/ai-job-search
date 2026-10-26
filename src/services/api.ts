// The operations the app needs from a database host. The server exposes them
// over HTTP; the desktop app exposes them over IPC. Same code, same rules.

import type { StratumProject } from "../core/project";
import { computeNextRun, uid, type Dashboard, type P6Connection, type ReportRun, type ReportSchedule, type SmtpSettings } from "../core/reporting";
import type { Schedule } from "../core/types";
import { isEmail, smtpMailer } from "./mailer";
import { p6Import, p6ListProjects, p6Push, p6Test, type P6ProjectInfo } from "./p6";
import type { PushResult } from "./p6/eppm";
import type { ProjectSummary, Repository } from "./repo";
import { runSchedule } from "./runner";
import { getP6Connections, getSmtp, maskP6, maskSmtp, MASK, setP6Connections, setSmtp, type SecretBox } from "./secrets";

export interface ApiDeps {
  repo: Repository;
  box: SecretBox;
  renderPdf: ((dashboardId: string, projectId: string | null) => Promise<Buffer>) | null;
  wasmDir?: string;
  log?: (msg: string) => void;
}

export class StratumApi {
  constructor(private d: ApiDeps) {}

  // ---- projects
  listProjects(): Promise<ProjectSummary[]> {
    return this.d.repo.listProjects();
  }
  getProject(id: string) {
    return this.d.repo.getProject(id);
  }
  saveProject(id: string, project: StratumProject, expectedVersion?: number, user?: string): Promise<number> {
    return this.d.repo.saveProject(id, project, { expectedVersion, user });
  }
  deleteProject(id: string) {
    return this.d.repo.deleteProject(id);
  }

  // ---- dashboards
  listDashboards(): Promise<Dashboard[]> {
    return this.d.repo.listDashboards();
  }
  getDashboard(id: string) {
    return this.d.repo.getDashboard(id);
  }
  saveDashboard(d: Dashboard) {
    return this.d.repo.saveDashboard(d);
  }
  async deleteDashboard(id: string) {
    for (const s of await this.d.repo.listSchedules()) if (s.dashboardId === id) await this.d.repo.deleteSchedule(s.id);
    await this.d.repo.deleteDashboard(id);
  }

  // ---- report schedules
  listSchedules(): Promise<ReportSchedule[]> {
    return this.d.repo.listSchedules();
  }
  async saveSchedule(s: ReportSchedule): Promise<ReportSchedule> {
    const bad = [...s.to, ...s.cc].filter((x) => !isEmail(x));
    if (bad.length) throw new Error(`Invalid email address: ${bad.join(", ")}`);
    if (!/^\d{1,2}:\d{2}$/.test(s.time)) throw new Error("Time must be HH:MM");
    const next = { ...s, nextRunAt: s.enabled ? new Date(computeNextRun(s, Date.now())).toISOString() : null };
    await this.d.repo.saveSchedule(next);
    return next;
  }
  deleteSchedule(id: string) {
    return this.d.repo.deleteSchedule(id);
  }
  async runScheduleNow(id: string): Promise<ReportRun> {
    const s = await this.d.repo.getSchedule(id);
    if (!s) throw new Error("Schedule not found");
    return runSchedule(this.runnerDeps(), s, true);
  }
  listRuns(scheduleId?: string): Promise<ReportRun[]> {
    return this.d.repo.listRuns(scheduleId);
  }
  runnerDeps() {
    return {
      repo: this.d.repo,
      renderPdf: this.d.renderPdf,
      mailer: async () => {
        const smtp = await getSmtp(this.d.repo, this.d.box);
        if (!smtp) throw new Error("Email is not set up (Settings → Email).");
        return smtpMailer(smtp);
      },
      log: this.d.log,
    };
  }
  get canRenderPdf() {
    return !!this.d.renderPdf;
  }

  // ---- email settings
  async getSmtp(): Promise<SmtpSettings | null> {
    return maskSmtp(await getSmtp(this.d.repo, this.d.box));
  }
  setSmtp(s: SmtpSettings) {
    return setSmtp(this.d.repo, this.d.box, s);
  }
  /** Check the connection and, if an address is given, send a short test email. */
  async testSmtp(s: SmtpSettings, to?: string): Promise<string> {
    const stored = await getSmtp(this.d.repo, this.d.box);
    const cfg = { ...s, password: s.password === MASK ? stored?.password ?? "" : s.password };
    const m = await smtpMailer(cfg);
    await m.verify();
    if (to) {
      if (!isEmail(to)) throw new Error(`Invalid email address: ${to}`);
      await m.send({ to: [to], subject: "Stratum 4D – test email", text: "Email from Stratum 4D is working." });
      return `Connected to ${cfg.host}. Test email sent to ${to}.`;
    }
    return `Connected to ${cfg.host}.`;
  }

  // ---- P6 connections
  async getP6(): Promise<P6Connection[]> {
    return maskP6(await getP6Connections(this.d.repo, this.d.box));
  }
  setP6(list: P6Connection[]) {
    return setP6Connections(this.d.repo, this.d.box, list);
  }
  private async resolveP6(c: P6Connection | string): Promise<P6Connection> {
    const all = await getP6Connections(this.d.repo, this.d.box);
    if (typeof c === "string") {
      const found = all.find((x) => x.id === c);
      if (!found) throw new Error("P6 connection not found");
      return found;
    }
    const stored = all.find((x) => x.id === c.id);
    return { ...c, password: c.password === MASK ? stored?.password ?? "" : c.password, token: c.token === MASK ? stored?.token ?? "" : c.token };
  }
  async p6Test(c: P6Connection | string): Promise<string> {
    return p6Test(await this.resolveP6(c), { wasmDir: this.d.wasmDir });
  }
  async p6Projects(connectionId: string): Promise<P6ProjectInfo[]> {
    return p6ListProjects(await this.resolveP6(connectionId), { wasmDir: this.d.wasmDir });
  }
  async p6Import(connectionId: string, objectId: string): Promise<Schedule> {
    return p6Import(await this.resolveP6(connectionId), objectId, { wasmDir: this.d.wasmDir });
  }
  async p6Push(connectionId: string, schedule: Schedule): Promise<PushResult> {
    return p6Push(await this.resolveP6(connectionId), schedule);
  }

  // ---- general settings (org defaults)
  getSetting<T>(key: string) {
    return this.d.repo.getSetting<T>(key);
  }
  setSetting(key: string, value: unknown) {
    if (["smtp", "p6"].includes(key)) throw new Error("Use the dedicated settings for secrets");
    return this.d.repo.setSetting(key, value);
  }
}

export const newId = uid;
