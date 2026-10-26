// Quantity takeoff from model properties, and installed quantities over time.
//
// Any numeric element property can be the measure: IFC quantity sets such as
// Qto_SlabBaseQuantities.NetVolume, a Pset value, or a count. Each element
// counts once, against the activity that installs it (the link whose profile
// action is "install"; otherwise its first link).

import { phaseAt } from "./simulation";
import type { AppearanceProfile, DateSource, Link, ModelElement, Schedule } from "./types";

export function toNumber(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?(?:e-?\d+)?)/i.exec(v);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Property keys whose values are numeric on at least 60% of the elements that have them. */
export function numericPropertyKeys(elements: ModelElement[]): string[] {
  const seen = new Map<string, { total: number; numeric: number }>();
  for (const e of elements) {
    for (const [k, v] of Object.entries(e.properties)) {
      const s = seen.get(k) ?? { total: 0, numeric: 0 };
      s.total++;
      if (toNumber(v) !== null) s.numeric++;
      seen.set(k, s);
    }
  }
  const keys = [...seen].filter(([, s]) => s.numeric >= 2 && s.numeric / s.total >= 0.6).map(([k]) => k);
  // Quantity-set measures first, volume before area before length: what planners usually track.
  const rank = (k: string) => (/volume/i.test(k) ? 5 : /area/i.test(k) ? 4 : /length|weight|count/i.test(k) ? 3 : /qto|quantit/i.test(k) ? 2 : 0);
  return keys.sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
}

export const COUNT_KEY = "(count)";

function measureOf(e: ModelElement, key: string): number {
  if (key === COUNT_KEY) return 1;
  return toNumber(e.properties[key]) ?? 0;
}

/** Which activity installs each element: its first "install" link, else its first link. */
export function installingActivity(links: Link[], profiles: AppearanceProfile[]): Map<string, string> {
  const action = new Map(profiles.map((p) => [p.id, p.action]));
  const out = new Map<string, string>();
  for (const l of links) if (action.get(l.profileId) === "install" && !out.has(l.elementId)) out.set(l.elementId, l.activityId);
  for (const l of links) if (!out.has(l.elementId)) out.set(l.elementId, l.activityId);
  return out;
}

export interface TakeoffRow {
  key: string; // activity id or group label
  label: string;
  quantity: number;
  installed: number;
  elements: number;
}

export interface Takeoff {
  total: number;
  installed: number;
  unscheduled: number;
  byActivity: TakeoffRow[];
  byType: TakeoffRow[];
}

/** Quantities in total, by activity and by IFC type, with the amount installed at time t. */
export function takeoff(
  schedule: Schedule,
  elements: ModelElement[],
  links: Link[],
  profiles: AppearanceProfile[],
  key: string,
  t: number,
  source: DateSource = "current",
): Takeoff {
  const acts = new Map(schedule.activities.map((a) => [a.id, a]));
  const inst = installingActivity(links, profiles);
  const byAct = new Map<string, TakeoffRow>();
  const byType = new Map<string, TakeoffRow>();
  let total = 0;
  let installed = 0;
  let unscheduled = 0;
  for (const e of elements) {
    const q = measureOf(e, key);
    if (!q) continue;
    total += q;
    const actId = inst.get(e.id);
    const act = actId ? acts.get(actId) : undefined;
    let done = 0;
    if (act) {
      const { phase, progress } = phaseAt(act, t, source);
      done = phase === "after" ? q : phase === "active" ? q * progress : 0;
      const row = byAct.get(act.id) ?? { key: act.id, label: `${act.code} ${act.name}`, quantity: 0, installed: 0, elements: 0 };
      row.quantity += q;
      row.installed += done;
      row.elements++;
      byAct.set(act.id, row);
    } else unscheduled += q;
    installed += done;
    const tr = byType.get(e.ifcType) ?? { key: e.ifcType, label: e.ifcType, quantity: 0, installed: 0, elements: 0 };
    tr.quantity += q;
    tr.installed += done;
    tr.elements++;
    byType.set(e.ifcType, tr);
  }
  const sort = (m: Map<string, TakeoffRow>) => [...m.values()].sort((a, b) => b.quantity - a.quantity);
  return { total, installed, unscheduled, byActivity: sort(byAct), byType: sort(byType) };
}

/** Cumulative installed quantity over time, planned (current dates) vs baseline. */
export function quantityCurve(
  schedule: Schedule,
  elements: ModelElement[],
  links: Link[],
  profiles: AppearanceProfile[],
  key: string,
  points: number[],
): { t: number; current: number; baseline: number }[] {
  return points.map((t) => ({
    t,
    current: takeoff(schedule, elements, links, profiles, key, t, "current").installed,
    baseline: takeoff(schedule, elements, links, profiles, key, t, "baseline").installed,
  }));
}
