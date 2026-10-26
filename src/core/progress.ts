// Weighted physical progress, the way EPC progress reports are built:
// activities carry a weight (budget cost, labour hours, duration, or equal),
// rows group activities by a dimension (top-level WBS or an activity code
// such as Discipline), each row has a weightage, and the TOTAL is the
// weightage-weighted sum of the rows.
//
//   Cum. BL Plan %   = share of weight planned complete by the data date on baseline dates
//   Cum. Actual %    = share of weight actually complete (physical % complete)
//   Variance wrt BL  = Actual − Plan

import type { Activity, Schedule } from "./types";

export type WeightBasis = "cost" | "hours" | "duration" | "equal";
/** "wbs1" = top-level WBS; "wbs2" = second level; "code:<Type>" = activity code. */
export type Dimension = string;

export interface Slice {
  dimension: Dimension;
  values: string[];
}

const DAY = 86_400_000;

const isWork = (a: Activity) => a.type !== "wbs-summary" && a.type !== "loe" && a.type !== "milestone" && a.type !== "finish-milestone";

function linear(t: number, a: number | null, b: number | null): number {
  if (a === null || b === null) return 0;
  if (t <= a) return 0;
  if (t >= b || b <= a) return 1;
  return (t - a) / (b - a);
}

export function weights(s: Schedule, basis: WeightBasis): Map<string, number> {
  const out = new Map<string, number>();
  const res = new Map((s.resources ?? []).map((r) => [r.id, r]));
  if (basis === "cost" || basis === "hours") {
    for (const x of s.assignments ?? []) {
      const v = basis === "cost" ? x.budgetCost : res.get(x.resourceId)?.type === "labor" ? x.budgetQty : 0;
      out.set(x.activityId, (out.get(x.activityId) ?? 0) + v);
    }
    // No cost/hours loaded at all: fall back to duration so the report still works.
    if ([...out.values()].every((v) => !v)) return weights(s, "duration");
    return out;
  }
  for (const a of s.activities) if (isWork(a)) out.set(a.id, basis === "equal" ? 1 : Math.max(0, a.originalDurationHours ?? 0));
  return out;
}

/** Group label of an activity for a dimension. */
export function groupOf(a: Activity, dim: Dimension, s: Schedule, wbsIndex?: Map<string, { parentId: string | null; name: string; code: string }>): string {
  if (dim.startsWith("code:")) return a.codes[dim.slice(5)] ?? "(none)";
  if (dim.startsWith("user:")) return a.userFields?.[dim.slice(5)] ?? "(none)";
  const idx = wbsIndex ?? new Map(s.wbs.map((w) => [w.id, w]));
  const level = dim === "wbs2" ? 2 : 1;
  const chain: string[] = [];
  for (let id = a.wbsId; id; id = idx.get(id)?.parentId ?? null) chain.unshift(id);
  const node = idx.get(chain[Math.min(level, chain.length) - 1] ?? "");
  return node ? node.name : "(no WBS)";
}

export function dimensions(s: Schedule | null): { value: Dimension; label: string }[] {
  const out = [
    { value: "wbs1", label: "WBS level 1" },
    { value: "wbs2", label: "WBS level 2" },
  ];
  if (!s) return out;
  const codes = new Set<string>();
  const udfs = new Set<string>();
  for (const a of s.activities) {
    Object.keys(a.codes).forEach((k) => codes.add(k));
    Object.keys(a.userFields ?? {}).forEach((k) => udfs.add(k));
  }
  return [...out, ...[...codes].sort().map((c) => ({ value: `code:${c}`, label: `Activity code: ${c}` })), ...[...udfs].sort().map((c) => ({ value: `user:${c}`, label: `User field: ${c}` }))];
}

export function groupValues(s: Schedule, dim: Dimension): string[] {
  const idx = new Map(s.wbs.map((w) => [w.id, w]));
  const seen = new Set<string>();
  for (const a of s.activities) if (isWork(a)) seen.add(groupOf(a, dim, s, idx));
  // Keep WBS order for WBS dimensions; alphabetical for codes.
  if (dim.startsWith("wbs")) {
    const order = new Map(s.wbs.map((w, i) => [w.name, i]));
    return [...seen].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  }
  return [...seen].sort();
}

/** Keep only activities that match every slicer selection. */
export function applySlices(s: Schedule, slices: Slice[] | undefined): Schedule {
  const active = (slices ?? []).filter((x) => x.values.length);
  if (!active.length) return s;
  const idx = new Map(s.wbs.map((w) => [w.id, w]));
  const keep = s.activities.filter((a) => active.every((sl) => sl.values.includes(groupOf(a, sl.dimension, s, idx))));
  const ids = new Set(keep.map((a) => a.id));
  return {
    ...s,
    activities: keep,
    relationships: s.relationships.filter((r) => ids.has(r.predecessorId) && ids.has(r.successorId)),
    assignments: (s.assignments ?? []).filter((x) => ids.has(x.activityId)),
  };
}

export interface ProgressRow {
  key: string;
  label: string;
  /** Row weightage, 0..1 (manual if given, else share of total weight). */
  weightage: number;
  plan: number;
  actual: number;
  forecast: number;
  variance: number;
}

export interface ProgressTable {
  at: number;
  rows: ProgressRow[];
  total: ProgressRow;
  basis: WeightBasis;
}

function planFrac(a: Activity, t: number) {
  return linear(t, a.baselineStart ?? a.start, a.baselineFinish ?? a.finish);
}
function forecastFrac(a: Activity, t: number) {
  if (a.status === "complete") return 1;
  return linear(t, a.start, a.finish);
}

export function progressTable(
  s: Schedule,
  opts: { dimension: Dimension; basis: WeightBasis; weightage?: Record<string, number>; at?: number },
): ProgressTable {
  const at = opts.at ?? s.dataDate ?? Date.now();
  const w = weights(s, opts.basis);
  const idx = new Map(s.wbs.map((x) => [x.id, x]));
  const groups = new Map<string, { w: number; plan: number; actual: number; forecast: number }>();
  let totalW = 0;
  for (const a of s.activities) {
    const wa = w.get(a.id) ?? 0;
    if (!wa || !isWork(a)) continue;
    const g = groupOf(a, opts.dimension, s, idx);
    const r = groups.get(g) ?? { w: 0, plan: 0, actual: 0, forecast: 0 };
    r.w += wa;
    r.plan += wa * planFrac(a, at);
    r.actual += wa * (a.percentComplete / 100);
    r.forecast += wa * forecastFrac(a, at);
    groups.set(g, r);
    totalW += wa;
  }
  const order = groupValues(s, opts.dimension);
  const manual = opts.weightage && Object.keys(opts.weightage).length ? opts.weightage : null;
  const manualSum = manual ? Object.values(manual).reduce((t, v) => t + (Number(v) || 0), 0) : 0;
  const rows: ProgressRow[] = order
    .filter((k) => groups.has(k))
    .map((k) => {
      const g = groups.get(k)!;
      const weightage = manual ? (Number(manual[k]) || 0) / (manualSum || 1) : totalW ? g.w / totalW : 0;
      const plan = g.w ? g.plan / g.w : 0;
      const actual = g.w ? g.actual / g.w : 0;
      return { key: k, label: k, weightage, plan, actual, forecast: g.w ? g.forecast / g.w : 0, variance: actual - plan };
    });
  const sum = (f: (r: ProgressRow) => number) => rows.reduce((t, r) => t + r.weightage * f(r), 0);
  const total: ProgressRow = {
    key: "__total",
    label: "TOTAL",
    weightage: rows.reduce((t, r) => t + r.weightage, 0),
    plan: sum((r) => r.plan),
    actual: sum((r) => r.actual),
    forecast: sum((r) => r.forecast),
    variance: sum((r) => r.actual) - sum((r) => r.plan),
  };
  return { at, rows, total, basis: opts.basis };
}

export interface ProgressPoint {
  t: number;
  /** Cumulative baseline plan, 0..1 */
  plan: number;
  /** Cumulative actual, 0..1, up to the data date only */
  actual: number | null;
  /** Cumulative forecast on current dates, 0..1 */
  forecast: number;
  /** Progress gained in the period ending at t (plan / actual), 0..1 */
  periodPlan: number;
  periodActual: number | null;
}

/**
 * Cumulative progress S-curve by month (or week). Actual progress accrues
 * linearly over each activity's actual period up to the data date.
 */
export function progressCurve(s: Schedule, opts: { basis: WeightBasis; step?: "month" | "week" }): ProgressPoint[] {
  const w = weights(s, opts.basis);
  const acts = s.activities.filter((a) => isWork(a) && (w.get(a.id) ?? 0) > 0);
  const total = acts.reduce((t, a) => t + (w.get(a.id) ?? 0), 0);
  if (!total) return [];
  const dd = s.dataDate ?? Date.now();
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of acts) {
    for (const t of [a.baselineStart, a.start, a.actualStart]) if (t != null) lo = Math.min(lo, t);
    for (const t of [a.baselineFinish, a.finish]) if (t != null) hi = Math.max(hi, t);
  }
  if (!Number.isFinite(lo)) return [];
  const pts: number[] = [];
  if (opts.step === "week") {
    for (let t = Math.floor(lo / DAY) * DAY + 7 * DAY; t < hi + 7 * DAY; t += 7 * DAY) pts.push(t);
  } else {
    const d = new Date(lo);
    // Month ends.
    for (let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); ; m.setUTCMonth(m.getUTCMonth() + 1)) {
      pts.push(m.getTime() - 1);
      if (m.getTime() > hi) break;
    }
  }
  const at = (t: number) => {
    let plan = 0;
    let actual = 0;
    let fc = 0;
    const ta = Math.min(t, dd);
    for (const a of acts) {
      const wa = w.get(a.id)!;
      plan += wa * planFrac(a, t);
      if (a.actualStart !== null) actual += wa * (a.percentComplete / 100) * linear(ta, a.actualStart, a.actualFinish ?? dd);
      // Forecast: actual to date, then remaining work spread over the remaining dates.
      const done = a.percentComplete / 100;
      const doneByT = a.actualStart !== null ? done * linear(ta, a.actualStart, a.actualFinish ?? dd) : 0;
      const remStart = Math.max(a.start ?? dd, dd);
      fc += wa * (doneByT + (1 - done) * (a.status === "complete" ? 0 : linear(t, remStart, a.finish ?? remStart)));
    }
    return { plan: plan / total, actual: actual / total, forecast: fc / total };
  };
  let prev = { plan: 0, actual: 0 };
  return pts.map((t) => {
    const v = at(t);
    const past = t <= dd + DAY;
    const p: ProgressPoint = {
      t,
      plan: v.plan,
      actual: past ? v.actual : null,
      forecast: v.forecast,
      periodPlan: v.plan - prev.plan,
      periodActual: past ? v.actual - prev.actual : null,
    };
    prev = { plan: v.plan, actual: v.actual };
    return p;
  });
}
