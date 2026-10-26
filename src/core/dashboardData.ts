// Numbers behind dashboard widgets and report workbooks. Pure functions of a
// schedule, so the app, the PDF renderer and the Excel writer agree.

import { evm, resourceHistogram, sCurves, type Measure } from "./evm";
import type { KpiMetric, TableFilter } from "./reporting";
import type { Activity, Schedule } from "./types";
import { monthShort } from "./dates";

const DAY = 86_400_000;

export interface KpiValue {
  label: string;
  value: string;
  /** Raw number when there is one (for Excel). */
  raw: number | null;
  tone?: "good" | "bad";
  hint?: string;
}

const fmtDay = (t: number | null) => {
  if (t === null || !Number.isFinite(t)) return "–";
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${monthShort(d)}-${String(d.getUTCFullYear()).slice(2)}`;
};
const compact = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(a >= 10 ? 0 : 1);
};

const work = (s: Schedule) => s.activities.filter((a) => a.type !== "wbs-summary" && a.type !== "loe");

export function projectFinish(s: Schedule): number | null {
  let f = -Infinity;
  for (const a of s.activities) if (a.finish !== null) f = Math.max(f, a.finish);
  return Number.isFinite(f) ? f : null;
}

export function baselineFinish(s: Schedule): number | null {
  let f = -Infinity;
  for (const a of s.activities) if (a.baselineFinish !== null) f = Math.max(f, a.baselineFinish);
  return Number.isFinite(f) ? f : null;
}

export function isLate(a: Activity): boolean {
  return a.status !== "complete" && a.baselineFinish !== null && a.finish !== null && a.finish > a.baselineFinish + 3_600_000;
}

/** Duration-weighted % complete (used when the schedule has no costs or hours). */
export function durationPercent(s: Schedule): number {
  let total = 0;
  let done = 0;
  for (const a of work(s)) {
    const d = a.originalDurationHours ?? 0;
    total += d;
    done += d * (a.percentComplete / 100);
  }
  return total ? done / total : 0;
}

function hasMeasure(s: Schedule, m: Measure): boolean {
  return (s.assignments ?? []).some((x) => (m === "cost" ? x.budgetCost > 0 : x.budgetQty > 0));
}

export function kpi(s: Schedule, metric: KpiMetric, opts: { measure?: Measure; days?: number } = {}): KpiValue {
  const measure: Measure = opts.measure && hasMeasure(s, opts.measure) ? opts.measure : hasMeasure(s, "cost") ? "cost" : "hours";
  const m = () => evm(s, measure);
  const dd = s.dataDate ?? Date.now();
  switch (metric) {
    case "finish": {
      const f = projectFinish(s);
      return { label: "Forecast finish", value: fmtDay(f), raw: f };
    }
    case "finishVariance": {
      const f = projectFinish(s);
      const b = baselineFinish(s);
      if (f === null || b === null) return { label: "Finish variance", value: "–", raw: null, hint: "No baseline" };
      const v = Math.round((f - b) / DAY);
      return { label: "Finish variance", value: v === 0 ? "On time" : `${v > 0 ? "+" : ""}${v} days`, raw: v, tone: v > 0 ? "bad" : "good", hint: `Baseline ${fmtDay(b)}` };
    }
    case "dataDate":
      return { label: "Data date", value: fmtDay(s.dataDate), raw: s.dataDate };
    case "percentComplete": {
      const x = hasMeasure(s, measure) ? m().earnedPct : durationPercent(s);
      return { label: "% complete", value: `${(x * 100).toFixed(1)}%`, raw: x };
    }
    case "spi":
    case "cpi": {
      const v = metric === "spi" ? m().spi : m().cpi;
      return { label: metric.toUpperCase(), value: v === null ? "–" : v.toFixed(2), raw: v, tone: v === null ? undefined : v >= 1 ? "good" : v < 0.95 ? "bad" : undefined };
    }
    case "bac":
    case "eac":
    case "vac":
    case "ev":
    case "ac": {
      const x = m();
      const v = x[metric];
      return {
        label: metric.toUpperCase(),
        value: compact(v) + (measure === "hours" ? " h" : ""),
        raw: v,
        tone: metric === "vac" ? (v < 0 ? "bad" : "good") : undefined,
      };
    }
    case "activities":
      return { label: "Activities", value: String(work(s).length), raw: work(s).length };
    case "critical": {
      const n = work(s).filter((a) => a.critical && a.status !== "complete").length;
      return { label: "Critical (open)", value: String(n), raw: n };
    }
    case "late": {
      const n = work(s).filter(isLate).length;
      return { label: "Late vs baseline", value: String(n), raw: n, tone: n ? "bad" : "good" };
    }
    case "startingSoon": {
      const days = opts.days ?? 14;
      const n = work(s).filter((a) => a.status === "not-started" && a.start !== null && a.start >= dd && a.start < dd + days * DAY).length;
      return { label: `Starting in ${days} days`, value: String(n), raw: n };
    }
  }
}

export interface ActivityRow {
  id: string;
  code: string;
  name: string;
  status: string;
  percent: number;
  start: number | null;
  finish: number | null;
  baselineStart: number | null;
  baselineFinish: number | null;
  actualStart: number | null;
  actualFinish: number | null;
  varianceDays: number | null;
  totalFloatDays: number | null;
  origDurDays: number | null;
  remDurDays: number | null;
  critical: boolean;
  activity: Activity;
}

export function activityRows(s: Schedule, filter: TableFilter, opts: { days?: number; limit?: number } = {}): ActivityRow[] {
  const dd = s.dataDate ?? Date.now();
  const days = (opts.days ?? 14) * DAY;
  const hpd = s.calendars?.find((c) => c.id === s.defaultCalendarId)?.hoursPerDay ?? 8;
  const pick = (a: Activity) => {
    switch (filter) {
      case "critical":
        return a.critical && a.status !== "complete";
      case "late":
        return isLate(a) || (a.critical && a.status !== "complete");
      case "in-progress":
        return a.status === "in-progress";
      case "starting-soon":
        return a.status === "not-started" && a.start !== null && a.start >= dd && a.start < dd + days;
      case "finishing-soon":
        return a.status !== "complete" && a.finish !== null && a.finish >= dd && a.finish < dd + days;
      case "negative-float":
        return a.totalFloatHours !== null && a.totalFloatHours < 0;
      default:
        return true;
    }
  };
  const rows = work(s)
    .filter(pick)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      status: a.status,
      percent: a.percentComplete,
      start: a.start,
      finish: a.finish,
      baselineStart: a.baselineStart,
      baselineFinish: a.baselineFinish,
      actualStart: a.actualStart,
      actualFinish: a.actualFinish,
      varianceDays: a.finish !== null && a.baselineFinish !== null ? Math.round((a.finish - a.baselineFinish) / DAY) : null,
      totalFloatDays: a.totalFloatHours !== null ? Math.round((a.totalFloatHours / hpd) * 10) / 10 : null,
      origDurDays: a.originalDurationHours !== null ? Math.round((a.originalDurationHours / hpd) * 10) / 10 : null,
      remDurDays: a.remainingDurationHours !== null ? Math.round((a.remainingDurationHours / hpd) * 10) / 10 : null,
      critical: a.critical,
      activity: a,
    }));
  rows.sort((x, y) => (filter === "late" ? (y.varianceDays ?? 0) - (x.varianceDays ?? 0) : 0) || (x.start ?? 0) - (y.start ?? 0));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

export interface PortfolioRow {
  projectId: string;
  code: string;
  name: string;
  dataDate: number | null;
  finish: number | null;
  varianceDays: number | null;
  percent: number;
  spi: number | null;
  cpi: number | null;
  late: number;
}

export function portfolioRow(projectId: string, s: Schedule): PortfolioRow {
  const f = projectFinish(s);
  const b = baselineFinish(s);
  const measure: Measure = hasMeasure(s, "cost") ? "cost" : "hours";
  const m = hasMeasure(s, measure) ? evm(s, measure) : null;
  return {
    projectId,
    code: s.projectCode,
    name: s.projectName,
    dataDate: s.dataDate,
    finish: f,
    varianceDays: f !== null && b !== null ? Math.round((f - b) / DAY) : null,
    percent: m ? m.earnedPct : durationPercent(s),
    spi: m?.spi ?? null,
    cpi: m?.cpi ?? null,
    late: work(s).filter(isLate).length,
  };
}

const isMilestone = (a: Activity) => a.type === "milestone" || a.type === "finish-milestone";
const msDate = (a: Activity) => (a.type === "milestone" ? a.start : a.finish);
const msBaseline = (a: Activity) => (a.type === "milestone" ? a.baselineStart : a.baselineFinish);

export type MilestoneState = "achieved" | "achieved-late" | "on-track" | "at-risk" | "late";

export interface MilestoneRow {
  id: string;
  code: string;
  name: string;
  baseline: number | null;
  forecast: number | null;
  /** Forecast (or actual) minus baseline, calendar days; positive = late. */
  varianceDays: number | null;
  totalFloatDays: number | null;
  state: MilestoneState;
}

/**
 * Milestone tracker. A milestone is "at risk" when it is still on its
 * baseline but has under `riskFloatDays` of float left, "late" when its
 * forecast is past the baseline.
 */
export function milestoneRows(s: Schedule, opts: { showDone?: boolean; limit?: number; riskFloatDays?: number } = {}): MilestoneRow[] {
  const hpd = s.calendars?.find((c) => c.id === s.defaultCalendarId)?.hoursPerDay ?? 8;
  const risk = opts.riskFloatDays ?? 5;
  const rows: MilestoneRow[] = [];
  for (const a of s.activities) {
    if (!isMilestone(a)) continue;
    const done = a.status === "complete";
    if (done && !opts.showDone) continue;
    const f = msDate(a);
    const b = msBaseline(a);
    const v = f !== null && b !== null ? Math.round((f - b) / DAY) : null;
    const tf = a.totalFloatHours !== null ? Math.round((a.totalFloatHours / hpd) * 10) / 10 : null;
    const state: MilestoneState = done ? ((v ?? 0) > 0 ? "achieved-late" : "achieved") : (v ?? 0) > 0 ? "late" : tf !== null && tf < risk ? "at-risk" : "on-track";
    rows.push({ id: a.id, code: a.code, name: a.name, baseline: b, forecast: f, varianceDays: v, totalFloatDays: tf, state });
  }
  rows.sort((x, y) => (x.forecast ?? Infinity) - (y.forecast ?? Infinity));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

export interface LookaheadWeek {
  /** Monday 00:00 UTC of the week. */
  from: number;
  rows: ActivityRow[];
}

/**
 * Look-ahead from the data date: activities that are in progress or due to
 * start within `weeks` weeks, grouped by the week they start (work already
 * under way goes in the first week).
 */
export function lookahead(s: Schedule, weeks = 3, limit = 0): LookaheadWeek[] {
  const dd = s.dataDate ?? Date.now();
  const d = new Date(Math.floor(dd / DAY) * DAY);
  const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
  const end = monday + weeks * 7 * DAY;
  const out: LookaheadWeek[] = Array.from({ length: weeks }, (_, i) => ({ from: monday + i * 7 * DAY, rows: [] }));
  const all = activityRows(s, "all").filter((r) => r.status !== "complete" && r.start !== null && r.start < end && (r.finish ?? Infinity) >= monday);
  let n = 0;
  for (const r of all.sort((x, y) => (x.start ?? 0) - (y.start ?? 0))) {
    if (limit && n >= limit) break;
    const i = Math.max(0, Math.min(weeks - 1, Math.floor(((r.start ?? dd) - monday) / (7 * DAY))));
    out[i].rows.push(r);
    n++;
  }
  return out;
}

export interface MixSlice {
  id: string;
  label: string;
  value: number;
  tone: "good" | "warning" | "serious" | "critical" | "neutral" | "info";
}

/** Counts for a donut: progress status, float bands, or critical share of open work. */
export function statusMix(s: Schedule, split: "status" | "float" | "critical"): MixSlice[] {
  const acts = work(s).filter((a) => !isMilestone(a));
  const hpd = s.calendars?.find((c) => c.id === s.defaultCalendarId)?.hoursPerDay ?? 8;
  if (split === "status") {
    const c = (st: string) => acts.filter((a) => a.status === st).length;
    return [
      { id: "complete", label: "Complete", value: c("complete"), tone: "good" },
      { id: "in-progress", label: "In progress", value: c("in-progress"), tone: "info" },
      { id: "not-started", label: "Not started", value: c("not-started"), tone: "neutral" },
    ];
  }
  const open = acts.filter((a) => a.status !== "complete");
  if (split === "critical") {
    const crit = open.filter((a) => a.critical).length;
    return [
      { id: "critical", label: "Critical", value: crit, tone: "critical" },
      { id: "other", label: "Not critical", value: open.length - crit, tone: "neutral" },
    ];
  }
  const band = (a: Activity) => {
    if (a.totalFloatHours === null) return "unknown";
    const d = a.totalFloatHours / hpd;
    return d < 0 ? "negative" : d < 1 ? "zero" : d <= 10 ? "low" : "healthy";
  };
  const c = (b: string) => open.filter((a) => band(a) === b).length;
  return [
    { id: "negative", label: "Negative float", value: c("negative"), tone: "critical" },
    { id: "zero", label: "Zero float", value: c("zero"), tone: "serious" },
    { id: "low", label: "1–10 days", value: c("low"), tone: "warning" },
    { id: "healthy", label: "Over 10 days", value: c("healthy"), tone: "good" },
  ].filter((x) => x.value > 0 || x.id !== "unknown") as MixSlice[];
}

export { sCurves, resourceHistogram, fmtDay, compact };
