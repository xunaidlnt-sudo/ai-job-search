// Runs report schedules: renders the dashboard to PDF, builds the Excel
// workbook, emails both, records the run and moves the schedule on.
// Used by the server (every minute) and the desktop app (while it is open).

import { computeNextRun, fillTemplate, uid, type ReportRun, type ReportSchedule } from "../core/reporting";
import type { Schedule } from "../core/types";
import { buildWorkbook } from "./excel";
import type { MailAttachment, Mailer } from "./mailer";
import type { Repository } from "./repo";

export interface RunnerDeps {
  repo: Repository;
  /** Render a dashboard for a project to PDF. Null when PDF rendering is unavailable. */
  renderPdf: ((dashboardId: string, projectId: string | null) => Promise<Buffer>) | null;
  mailer: () => Promise<Mailer>;
  now?: () => Date;
  log?: (msg: string) => void;
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 60);

export async function runSchedule(deps: RunnerDeps, sched: ReportSchedule, manual = false): Promise<ReportRun> {
  const now = deps.now?.() ?? new Date();
  const run: ReportRun = { id: uid("run"), scheduleId: sched.id, at: now.toISOString(), status: "sent", message: "", manual };
  try {
    if (!sched.to.length) throw new Error("No recipients");
    const dash = await deps.repo.getDashboard(sched.dashboardId);
    if (!dash) throw new Error("Dashboard not found");
    const projectId = sched.projectId ?? dash.projectId;
    let schedule: Schedule | null = null;
    if (projectId) {
      const p = await deps.repo.getProject(projectId);
      schedule = p?.project.schedule ?? null;
      if (!schedule) throw new Error("Project not found or has no schedule");
    }
    const projectLabel = schedule ? `${schedule.projectCode}` : dash.name;
    const vars = { project: projectLabel, date: now.getTime(), dataDate: schedule?.dataDate ?? null, utcOffsetMinutes: sched.utcOffsetMinutes };
    const attachments: MailAttachment[] = [];
    const notes: string[] = [];
    const stamp = new Date(now.getTime() + sched.utcOffsetMinutes * 60_000).toISOString().slice(0, 10);

    if (sched.formats.includes("pdf")) {
      if (deps.renderPdf) {
        const pdf = await deps.renderPdf(dash.id, projectId);
        attachments.push({ filename: `${safeName(projectLabel)}_${safeName(dash.name)}_${stamp}.pdf`, content: pdf, contentType: "application/pdf" });
      } else notes.push("PDF rendering is not available on this host; Excel attached instead.");
    }
    if (sched.formats.includes("xlsx") || (sched.formats.includes("pdf") && !deps.renderPdf)) {
      if (schedule) {
        let portfolio: { id: string; schedule: Schedule }[] | undefined;
        if (dash.widgets.some((w) => w.kind === "portfolio")) {
          portfolio = [];
          for (const p of await deps.repo.listProjects()) {
            const full = await deps.repo.getProject(p.id);
            if (full?.project.schedule) portfolio.push({ id: p.id, schedule: full.project.schedule });
          }
        }
        const xlsx = await buildWorkbook(schedule, { dashboard: dash, portfolio });
        attachments.push({
          filename: `${safeName(projectLabel)}_${stamp}.xlsx`,
          content: Buffer.from(xlsx),
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      }
    }
    const text = fillTemplate(sched.body, vars) + (notes.length ? `\n\n${notes.join("\n")}` : "") + "\n\n— Sent by Stratum 4D";
    const mailer = await deps.mailer();
    const info = await mailer.send({ to: sched.to, cc: sched.cc, subject: fillTemplate(sched.subject, vars), text, attachments });
    run.message = `Sent to ${info.accepted.length} recipient(s) with ${attachments.length} attachment(s)`;
    deps.log?.(`[report] ${sched.name}: ${run.message}`);
  } catch (err) {
    run.status = "failed";
    run.message = (err as Error).message;
    deps.log?.(`[report] ${sched.name} failed: ${run.message}`);
  }
  await deps.repo.addRun(run);
  const next: ReportSchedule = {
    ...sched,
    lastRunAt: run.at,
    // A manual "send now" does not skip the next scheduled send.
    nextRunAt: manual && sched.nextRunAt && Date.parse(sched.nextRunAt) > now.getTime() ? sched.nextRunAt : new Date(computeNextRun(sched, now.getTime())).toISOString(),
  };
  await deps.repo.saveSchedule(next);
  return run;
}

/** Run everything that is due. Returns the runs performed. */
export async function runDue(deps: RunnerDeps): Promise<ReportRun[]> {
  const now = deps.now?.() ?? new Date();
  const due = await deps.repo.dueSchedules(now);
  const out: ReportRun[] = [];
  for (const s of due) out.push(await runSchedule(deps, s));
  return out;
}

/** Make sure every enabled schedule has a next-run time (after edits or a restart). */
export async function primeSchedules(repo: Repository, now = new Date()) {
  for (const s of await repo.listSchedules()) {
    if (s.enabled && !s.nextRunAt) await repo.saveSchedule({ ...s, nextRunAt: new Date(computeNextRun(s, now.getTime())).toISOString() });
    if (!s.enabled && s.nextRunAt) await repo.saveSchedule({ ...s, nextRunAt: null });
  }
}

/** Start a once-a-minute loop. Returns a stop function. */
export function startScheduler(deps: RunnerDeps, intervalMs = 60_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDue(deps);
    } catch (err) {
      deps.log?.(`[report] scheduler error: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void primeSchedules(deps.repo).then(tick);
  return () => clearInterval(timer);
}
