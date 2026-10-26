// Cost, earned value and resource usage.
//
// Values are spread linearly in elapsed time between an activity's dates. That
// is the usual "linear curve" default and good enough for S-curves and
// histograms; it ignores weekends inside an activity, so a week-by-week chart
// can differ slightly from P6's calendar-weighted spread.
//
// Two measures are supported so the panel is useful with or without a costed
// schedule: "cost" (assignment costs) and "hours" (labour quantities).

import type { Activity, Assignment, Resource, Schedule } from "./types";

export type Measure = "cost" | "hours";

const DAY = 86_400_000;

function frac(t: number, a: number | null, b: number | null): number {
  if (a === null || b === null) return 0;
  if (t <= a) return 0;
  if (t >= b || b <= a) return 1;
  return (t - a) / (b - a);
}

interface ActValues {
  a: Activity;
  budget: number;
  actual: number;
  remaining: number;
}

export function activityValues(s: Schedule, measure: Measure): ActValues[] {
  const res = new Map((s.resources ?? []).map((r) => [r.id, r]));
  const byAct = new Map<string, Assignment[]>();
  for (const x of s.assignments ?? []) (byAct.get(x.activityId) ?? byAct.set(x.activityId, []).get(x.activityId)!).push(x);
  return s.activities
    .filter((a) => a.type !== "wbs-summary")
    .map((a) => {
      const list = byAct.get(a.id) ?? [];
      if (measure === "cost") {
        return {
          a,
          budget: list.reduce((t, x) => t + x.budgetCost, 0),
          actual: list.reduce((t, x) => t + x.actualCost, 0),
          remaining: list.reduce((t, x) => t + x.remainingCost, 0),
        };
      }
      const labour = list.filter((x) => res.get(x.resourceId)?.type === "labor");
      return {
        a,
        budget: labour.reduce((t, x) => t + x.budgetQty, 0),
        actual: labour.reduce((t, x) => t + x.actualQty, 0),
        remaining: labour.reduce((t, x) => t + x.remainingQty, 0),
      };
    })
    .filter((v) => v.budget > 0 || v.actual > 0 || v.remaining > 0);
}

export interface EvmMetrics {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  sv: number;
  cv: number;
  spi: number | null;
  cpi: number | null;
  /** Bottom-up estimate at completion: actual + remaining. */
  eac: number;
  /** Performance-based estimate: BAC / CPI. */
  eacCpi: number | null;
  etc: number;
  vac: number;
  tcpi: number | null;
  plannedPct: number;
  earnedPct: number;
}

function metricsFor(values: ActValues[], dataDate: number): EvmMetrics {
  let bac = 0;
  let pv = 0;
  let ev = 0;
  let ac = 0;
  let rem = 0;
  for (const v of values) {
    const { a } = v;
    bac += v.budget;
    pv += v.budget * frac(dataDate, a.baselineStart ?? a.start, a.baselineFinish ?? a.finish);
    ev += v.budget * (a.percentComplete / 100);
    ac += v.actual;
    rem += a.status === "complete" ? 0 : v.remaining;
  }
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = ac + rem;
  return {
    bac,
    pv,
    ev,
    ac,
    sv: ev - pv,
    cv: ev - ac,
    spi,
    cpi,
    eac,
    eacCpi: cpi ? bac / cpi : null,
    etc: rem,
    vac: bac - eac,
    tcpi: bac - ac !== 0 ? (bac - ev) / (bac - ac) : null,
    plannedPct: bac ? pv / bac : 0,
    earnedPct: bac ? ev / bac : 0,
  };
}

export function evm(s: Schedule, measure: Measure = "cost", dataDate = s.dataDate ?? Date.now()): EvmMetrics {
  return metricsFor(activityValues(s, measure), dataDate);
}

/** EVM per WBS node (including everything below it), in WBS order. */
export function evmByWbs(s: Schedule, measure: Measure = "cost", dataDate = s.dataDate ?? Date.now()) {
  const values = activityValues(s, measure);
  const children = new Map<string | null, string[]>();
  for (const w of s.wbs) (children.get(w.parentId) ?? children.set(w.parentId, []).get(w.parentId)!).push(w.id);
  const under = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!out.has(c)) (out.add(c), stack.push(c));
    return out;
  };
  return s.wbs
    .map((w) => {
      const ids = under(w.id);
      return { wbs: w, metrics: metricsFor(values.filter((v) => ids.has(v.a.wbsId ?? "")), dataDate) };
    })
    .filter((r) => r.metrics.bac > 0 || r.metrics.ac > 0);
}

export interface CurvePoint {
  t: number;
  /** Cumulative planned value on baseline dates. */
  pv: number;
  /** Cumulative earned value (only up to the data date). */
  ev: number | null;
  /** Cumulative actual cost (only up to the data date). */
  ac: number | null;
  /** Cumulative forecast: actuals to date, then remaining work on current dates. */
  forecast: number;
}

/** Weekly cumulative S-curves from project start to finish. */
export function sCurves(s: Schedule, measure: Measure = "cost", stepDays = 7): CurvePoint[] {
  const values = activityValues(s, measure);
  if (!values.length) return [];
  const dd = s.dataDate ?? Date.now();
  let lo = Infinity;
  let hi = -Infinity;
  for (const { a } of values) {
    for (const t of [a.baselineStart, a.start, a.actualStart]) if (t !== null && t !== undefined) lo = Math.min(lo, t);
    for (const t of [a.baselineFinish, a.finish, a.actualFinish]) if (t !== null && t !== undefined) hi = Math.max(hi, t);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  lo = Math.floor(lo / DAY) * DAY;
  const out: CurvePoint[] = [];
  const step = stepDays * DAY;
  for (let t = lo; ; t += step) {
    const tt = Math.min(t, hi);
    let pv = 0;
    let ev = 0;
    let ac = 0;
    let fc = 0;
    const evAt = Math.min(tt, dd);
    for (const v of values) {
      const { a } = v;
      pv += v.budget * frac(tt, a.baselineStart ?? a.start, a.baselineFinish ?? a.finish);
      // Earned and actual values accrue linearly over the actual period up to the data date.
      const aEnd = a.actualFinish ?? dd;
      if (a.actualStart !== null) {
        ev += v.budget * (a.percentComplete / 100) * frac(evAt, a.actualStart, aEnd);
        ac += v.actual * frac(evAt, a.actualStart, aEnd);
      }
      // Forecast = actual to date + remaining on the current dates after the data date.
      const remStart = Math.max(a.start ?? dd, dd);
      fc += v.actual * frac(Math.min(tt, dd), a.actualStart, aEnd) + (a.status === "complete" ? 0 : v.remaining * frac(tt, remStart, a.finish ?? remStart));
    }
    out.push({ t: tt, pv, ev: tt <= dd ? ev : null, ac: tt <= dd ? ac : null, forecast: fc });
    if (tt >= hi) break;
  }
  return out;
}

export interface HistogramBar {
  t: number; // period start
  byResource: Record<string, number>;
  total: number;
}

/**
 * Resource usage per period (default weekly). Actual quantities fall in the
 * actual period up to the data date; remaining quantities over the current
 * remaining dates. With `baseline` the budget is spread over baseline dates.
 */
export function resourceHistogram(s: Schedule, opts: { stepDays?: number; baseline?: boolean; resourceIds?: string[] } = {}): { bars: HistogramBar[]; resources: Resource[] } {
  const step = (opts.stepDays ?? 7) * DAY;
  const dd = s.dataDate ?? Date.now();
  const acts = new Map(s.activities.map((a) => [a.id, a]));
  const filter = opts.resourceIds ? new Set(opts.resourceIds) : null;
  const used = (s.assignments ?? []).filter((x) => acts.has(x.activityId) && (!filter || filter.has(x.resourceId)));
  const resources = (s.resources ?? []).filter((r) => used.some((x) => x.resourceId === r.id));
  if (!used.length) return { bars: [], resources };

  type Piece = { res: string; qty: number; a: number; b: number };
  const pieces: Piece[] = [];
  for (const x of used) {
    const a = acts.get(x.activityId)!;
    if (opts.baseline) {
      const s0 = a.baselineStart ?? a.start;
      const f0 = a.baselineFinish ?? a.finish;
      if (s0 !== null && f0 !== null) pieces.push({ res: x.resourceId, qty: x.budgetQty, a: s0, b: f0 });
      continue;
    }
    if (a.actualStart !== null && x.actualQty > 0) pieces.push({ res: x.resourceId, qty: x.actualQty, a: a.actualStart, b: Math.max(a.actualStart + 1, a.actualFinish ?? dd) });
    if (a.status !== "complete" && x.remainingQty > 0 && a.finish !== null) {
      const rs = Math.max(a.start ?? dd, a.actualStart !== null ? dd : a.start ?? dd);
      pieces.push({ res: x.resourceId, qty: x.remainingQty, a: rs, b: Math.max(rs + 1, a.finish) });
    }
  }
  if (!pieces.length) return { bars: [], resources };
  const lo = Math.floor(Math.min(...pieces.map((p) => p.a)) / DAY) * DAY;
  const hi = Math.max(...pieces.map((p) => p.b));
  const bars: HistogramBar[] = [];
  for (let t = lo; t < hi; t += step) {
    const bar: HistogramBar = { t, byResource: {}, total: 0 };
    for (const p of pieces) {
      const overlap = Math.min(p.b, t + step) - Math.max(p.a, t);
      if (overlap <= 0) continue;
      const q = (p.qty * overlap) / (p.b - p.a);
      bar.byResource[p.res] = (bar.byResource[p.res] ?? 0) + q;
      bar.total += q;
    }
    bars.push(bar);
  }
  return { bars, resources };
}
