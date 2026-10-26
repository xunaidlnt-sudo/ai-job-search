// Critical Path Method scheduler.
//
// Forward pass for early dates, backward pass for late dates, then total and
// free float. Follows the usual P6 conventions so results line up with what
// planners expect:
//   - durations and lags are in working hours on calendars;
//   - lags use the predecessor's calendar;
//   - not-started work cannot start before the data date;
//   - in-progress work keeps its actual start and schedules its remaining
//     duration from the data date, with retained logic (unfinished
//     predecessors still hold it back);
//   - completed work keeps its actual dates;
//   - total float is finish float; "critical" means total float <= 0;
//   - open ends are measured against the project's early finish.
//
// Level-of-effort and WBS-summary activities do not drive anything; their
// dates are derived from the activities around them after the passes.

import { addWorkHours, nextWorkStart, prevWorkEnd, standardCalendar, subtractWorkHours, workHoursBetween } from "./calendar";
import type { Activity, Calendar, Relationship, Schedule } from "./types";

export interface CpmOptions {
  /** Defaults to the schedule's data date, else its earliest start. */
  dataDate?: number;
}

export interface CpmResult {
  schedule: Schedule;
  projectStart: number;
  projectFinish: number;
  /** Activity ids on the longest path (total float <= 0), in date order. */
  criticalPath: string[];
  warnings: string[];
}

export class ScheduleLoopError extends Error {
  constructor(public activityCodes: string[]) {
    super(`Logic loop between: ${activityCodes.slice(0, 12).join(", ")}${activityCodes.length > 12 ? " …" : ""}`);
  }
}

interface Node {
  a: Activity;
  cal: Calendar;
  dur: number; // hours still to schedule (remaining)
  ES: number;
  EF: number;
  LS: number;
  LF: number;
  fixed: boolean; // complete
  milestone: "start" | "finish" | null;
}

const isDerived = (a: Activity) => a.type === "loe" || a.type === "wbs-summary";

function durationOf(a: Activity, cal: Calendar): number {
  if (a.type === "milestone" || a.type === "finish-milestone") return 0;
  const d = a.remainingDurationHours ?? a.originalDurationHours;
  if (d !== null && d !== undefined) return Math.max(0, d);
  if (a.start !== null && a.finish !== null) return Math.max(0, workHoursBetween(cal, a.start, a.finish));
  return 0;
}

export function scheduleCpm(input: Schedule, options: CpmOptions = {}): CpmResult {
  const schedule: Schedule = structuredClone(input);
  const warnings: string[] = [];
  const calendars = new Map((schedule.calendars ?? []).map((c) => [c.id, c]));
  const fallback =
    (schedule.defaultCalendarId && calendars.get(schedule.defaultCalendarId)) || schedule.calendars?.[0] || standardCalendar();
  const calOf = (a: Activity) => (a.calendarId && calendars.get(a.calendarId)) || fallback;

  const starts = schedule.activities.map((a) => a.actualStart ?? a.start).filter((x): x is number => x !== null);
  const dataDate = options.dataDate ?? schedule.dataDate ?? (starts.length ? Math.min(...starts) : Date.now());

  const work = schedule.activities.filter((a) => !isDerived(a));
  const nodes = new Map<string, Node>();
  for (const a of work) {
    const cal = calOf(a);
    const fixed = a.status === "complete" && a.actualStart !== null && a.actualFinish !== null;
    nodes.set(a.id, {
      a,
      cal,
      dur: fixed ? 0 : durationOf(a, cal),
      ES: 0,
      EF: 0,
      LS: 0,
      LF: 0,
      fixed,
      milestone: a.type === "milestone" ? "start" : a.type === "finish-milestone" ? "finish" : null,
    });
  }

  const rels = schedule.relationships.filter((r) => nodes.has(r.predecessorId) && nodes.has(r.successorId));
  const preds = new Map<string, Relationship[]>();
  const succs = new Map<string, Relationship[]>();
  for (const r of rels) {
    (preds.get(r.successorId) ?? preds.set(r.successorId, []).get(r.successorId)!).push(r);
    (succs.get(r.predecessorId) ?? succs.set(r.predecessorId, []).get(r.predecessorId)!).push(r);
  }

  // Topological order (Kahn). Anything left over sits on a loop.
  const indeg = new Map<string, number>([...nodes.keys()].map((id) => [id, 0]));
  for (const r of rels) indeg.set(r.successorId, indeg.get(r.successorId)! + 1);
  const queue = [...nodes.keys()].filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const r of succs.get(id) ?? []) {
      const n = indeg.get(r.successorId)! - 1;
      indeg.set(r.successorId, n);
      if (n === 0) queue.push(r.successorId);
    }
  }
  if (order.length < nodes.size) {
    const stuck = [...nodes.keys()].filter((id) => !order.includes(id)).map((id) => nodes.get(id)!.a.code);
    throw new ScheduleLoopError(stuck);
  }

  // ---- Forward pass ----
  for (const id of order) {
    const n = nodes.get(id)!;
    const { a, cal } = n;
    if (n.fixed) {
      n.ES = a.actualStart!;
      n.EF = a.actualFinish!;
      continue;
    }
    // Driving times from predecessors (lags on the predecessor calendar).
    let startBound = -Infinity;
    let finishBound = -Infinity;
    for (const r of preds.get(id) ?? []) {
      const p = nodes.get(r.predecessorId)!;
      switch (r.type) {
        case "FS":
          startBound = Math.max(startBound, addWorkHours(p.cal, p.EF, r.lagHours));
          break;
        case "SS":
          startBound = Math.max(startBound, addWorkHours(p.cal, p.ES, r.lagHours));
          break;
        case "FF":
          finishBound = Math.max(finishBound, addWorkHours(p.cal, p.EF, r.lagHours));
          break;
        case "SF":
          finishBound = Math.max(finishBound, addWorkHours(p.cal, p.ES, r.lagHours));
          break;
      }
    }
    const c = a.constraint;
    const inProgress = a.actualStart !== null && a.status !== "not-started";

    // Remaining work starts no earlier than the data date.
    let es = Math.max(dataDate, startBound);
    if (c?.date != null && (c.type === "start-on-or-after" || c.type === "start-on")) es = Math.max(es, c.date);
    if (finishBound > -Infinity) es = Math.max(es, subtractWorkHours(cal, finishBound, n.dur));
    if (c?.date != null && (c.type === "finish-on-or-after" || c.type === "finish-on")) es = Math.max(es, subtractWorkHours(cal, c.date, n.dur));
    if (c?.date != null && c.type === "mandatory-start") es = c.date;
    if (c?.date != null && c.type === "mandatory-finish") es = subtractWorkHours(cal, c.date, n.dur);

    if (n.milestone === "finish") {
      // A finish milestone sits at the finish of what drives it (e.g. 17:00), not the next morning.
      const t = Math.max(es, finishBound);
      n.ES = n.EF = prevWorkEnd(cal, t) >= dataDate ? prevWorkEnd(cal, t) : t;
    } else {
      const remStart = n.dur > 0 || n.milestone === "start" ? nextWorkStart(cal, es) : es;
      n.ES = inProgress ? a.actualStart! : remStart;
      n.EF = addWorkHours(cal, remStart, n.dur);
      if (n.milestone === "start") n.EF = n.ES;
    }
  }

  const projectFinish = Math.max(...[...nodes.values()].map((n) => n.EF), dataDate);
  const projectStart = Math.min(...[...nodes.values()].map((n) => n.ES), dataDate);

  // ---- Backward pass ----
  for (let i = order.length - 1; i >= 0; i--) {
    const n = nodes.get(order[i])!;
    const { a, cal } = n;
    let lf = projectFinish;
    for (const r of succs.get(a.id) ?? []) {
      const s = nodes.get(r.successorId)!;
      switch (r.type) {
        case "FS":
          lf = Math.min(lf, subtractWorkHours(cal, s.LS, r.lagHours));
          break;
        case "SS":
          lf = Math.min(lf, addWorkHours(cal, subtractWorkHours(cal, s.LS, r.lagHours), n.dur));
          break;
        case "FF":
          lf = Math.min(lf, subtractWorkHours(cal, s.LF, r.lagHours));
          break;
        case "SF":
          lf = Math.min(lf, addWorkHours(cal, subtractWorkHours(cal, s.LF, r.lagHours), n.dur));
          break;
      }
    }
    const c = a.constraint;
    if (c?.date != null) {
      if (c.type === "finish-on-or-before" || c.type === "finish-on" || c.type === "mandatory-finish") lf = Math.min(lf, c.date);
      if (c.type === "start-on-or-before" || c.type === "start-on" || c.type === "mandatory-start") lf = Math.min(lf, addWorkHours(cal, c.date, n.dur));
    }
    if (n.fixed) {
      n.LF = n.EF;
      n.LS = n.ES;
      continue;
    }
    n.LF = n.milestone ? lf : prevWorkEnd(cal, lf);
    n.LS = n.milestone === "start" ? nextWorkStart(cal, n.LF) : subtractWorkHours(cal, n.LF, n.dur);
    if (n.milestone) n.LS = n.LF;
  }

  // As-late-as-possible: push to the late dates.
  for (const n of nodes.values()) {
    if (!n.fixed && n.a.constraint?.type === "as-late-as-possible" && n.a.actualStart === null) {
      n.ES = n.LS;
      n.EF = n.LF;
    }
  }

  // ---- Floats and write-back ----
  for (const n of nodes.values()) {
    const { a, cal } = n;
    if (n.fixed) {
      Object.assign(a, { start: a.actualStart, finish: a.actualFinish, lateStart: null, lateFinish: null, totalFloatHours: null, freeFloatHours: null, critical: false });
      continue;
    }
    const tf = Math.round(workHoursBetween(cal, n.EF, n.LF) * 100) / 100;
    let ff = tf;
    for (const r of succs.get(a.id) ?? []) {
      const s = nodes.get(r.successorId)!;
      let slack: number;
      switch (r.type) {
        case "FS":
          slack = workHoursBetween(cal, addWorkHours(cal, n.EF, r.lagHours), s.ES);
          break;
        case "SS":
          slack = workHoursBetween(cal, addWorkHours(cal, n.ES, r.lagHours), s.ES);
          break;
        case "FF":
          slack = workHoursBetween(cal, addWorkHours(cal, n.EF, r.lagHours), s.EF);
          break;
        case "SF":
          slack = workHoursBetween(cal, addWorkHours(cal, n.ES, r.lagHours), s.EF);
          break;
      }
      ff = Math.min(ff, slack);
    }
    // Next-morning start after a 17:00 finish is not slack.
    ff = Math.max(0, Math.round(ff * 100) / 100);
    Object.assign(a, {
      start: n.ES,
      finish: n.EF,
      lateStart: n.LS,
      lateFinish: n.LF,
      totalFloatHours: tf,
      freeFloatHours: Math.min(ff, Math.max(tf, 0)),
      critical: tf <= 0,
    });
  }

  // ---- Derived activities: LOE spans its neighbours, WBS summaries span their WBS ----
  const byId = new Map(schedule.activities.map((a) => [a.id, a]));
  for (const a of schedule.activities.filter(isDerived)) {
    let s = Infinity;
    let f = -Infinity;
    if (a.type === "loe") {
      for (const r of schedule.relationships) {
        if (r.successorId === a.id) {
          const p = byId.get(r.predecessorId);
          if (p?.start != null && p.finish != null) s = Math.min(s, r.type === "FS" ? p.finish : p.start);
        }
        if (r.predecessorId === a.id) {
          const q = byId.get(r.successorId);
          if (q?.start != null && q.finish != null) f = Math.max(f, r.type === "FS" ? q.start : q.finish);
        }
      }
    } else {
      const under = descendantsOf(schedule, a.wbsId);
      for (const b of schedule.activities) {
        if (b === a || isDerived(b) || !under.has(b.wbsId ?? "")) continue;
        if (b.start != null) s = Math.min(s, b.start);
        if (b.finish != null) f = Math.max(f, b.finish);
      }
    }
    if (Number.isFinite(s) && Number.isFinite(f) && f >= s) {
      a.start = a.actualStart ?? s;
      a.finish = a.actualFinish ?? f;
    } else {
      warnings.push(`${a.code}: ${a.type === "loe" ? "level-of-effort has no predecessor and successor to span" : "summary has no activities below it"}`);
    }
    a.totalFloatHours = null;
    a.critical = false;
  }

  // Open ends are allowed but usually a mistake.
  for (const n of nodes.values()) {
    if (n.fixed) continue;
    const hasPred = (preds.get(n.a.id) ?? []).length > 0 || n.a.constraint?.date != null;
    const hasSucc = (succs.get(n.a.id) ?? []).length > 0;
    if (!hasPred && n.a.type !== "milestone") warnings.push(`${n.a.code}: no predecessor`);
    if (!hasSucc && n.a.type !== "finish-milestone") warnings.push(`${n.a.code}: no successor`);
  }

  const criticalPath = [...nodes.values()]
    .filter((n) => !n.fixed && n.a.critical)
    .sort((x, y) => x.ES - y.ES || x.EF - y.EF)
    .map((n) => n.a.id);

  schedule.dataDate = dataDate;
  return { schedule, projectStart, projectFinish, criticalPath, warnings };
}

function descendantsOf(schedule: Schedule, wbsId: string | null): Set<string> {
  const out = new Set<string>();
  if (!wbsId) return out;
  const stack = [wbsId];
  while (stack.length) {
    const id = stack.pop()!;
    out.add(id);
    for (const w of schedule.wbs) if (w.parentId === id) stack.push(w.id);
  }
  return out;
}
