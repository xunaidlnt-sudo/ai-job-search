// Turn the flat WBS + activity lists into display rows for the Gantt.

import { activityDates } from "./simulation";
import type { Activity, DateSource, Schedule } from "./types";

export type GanttRow =
  | { kind: "wbs"; id: string; depth: number; label: string; start: number | null; finish: number | null }
  | { kind: "activity"; id: string; depth: number; activity: Activity };

export function buildGanttRows(schedule: Schedule, source: DateSource, collapsed: Set<string> = new Set()): GanttRow[] {
  const children = new Map<string | null, typeof schedule.wbs>();
  for (const w of schedule.wbs) {
    const list = children.get(w.parentId) ?? [];
    list.push(w);
    children.set(w.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));

  const acts = new Map<string | null, Activity[]>();
  for (const a of schedule.activities) {
    const list = acts.get(a.wbsId) ?? [];
    list.push(a);
    acts.set(a.wbsId, list);
  }
  for (const list of acts.values()) {
    list.sort((a, b) => (activityDates(a, source).start ?? 0) - (activityDates(b, source).start ?? 0) || a.code.localeCompare(b.code));
  }

  const rows: GanttRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const a of acts.get(parent) ?? []) rows.push({ kind: "activity", id: a.id, depth, activity: a });
    for (const w of children.get(parent) ?? []) {
      const idx = rows.length;
      rows.push({ kind: "wbs", id: w.id, depth, label: `${w.code} ${w.name}`.trim(), start: null, finish: null });
      const before = rows.length;
      visit(w.id, depth + 1);
      // Roll up summary dates from everything below this WBS node.
      let s = Infinity;
      let f = -Infinity;
      for (let i = before; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === "activity") {
          const d = activityDates(r.activity, source);
          if (d.start !== null) s = Math.min(s, d.start);
          if (d.finish !== null) f = Math.max(f, d.finish);
        } else {
          if (r.start !== null) s = Math.min(s, r.start);
          if (r.finish !== null) f = Math.max(f, r.finish);
        }
      }
      const head = rows[idx] as Extract<GanttRow, { kind: "wbs" }>;
      head.start = Number.isFinite(s) ? s : null;
      head.finish = Number.isFinite(f) ? f : null;
      if (collapsed.has(w.id)) rows.length = before;
    }
  };
  visit(null, 0);
  return rows;
}
