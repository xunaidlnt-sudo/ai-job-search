// Schedule updates: bring a new XER (e.g. next week's progress update) into an
// existing project without losing links, and report what changed.
//
// P6's internal task_id can change between exports (copied projects, different
// databases), so links are carried across by the user-facing Activity ID.

import type { Activity, Link, Schedule } from "./types";

export interface ActivityChange {
  code: string;
  name: string;
  /** Movement in calendar days; positive = later. */
  startShiftDays: number | null;
  finishShiftDays: number | null;
  statusFrom: Activity["status"];
  statusTo: Activity["status"];
  pctFrom: number;
  pctTo: number;
}

export interface ScheduleDiff {
  added: { code: string; name: string }[];
  removed: { code: string; name: string }[];
  changed: ActivityChange[];
  /** Project finish movement in calendar days (positive = slipped). */
  finishShiftDays: number | null;
  dataDateFrom: number | null;
  dataDateTo: number | null;
}

const DAY = 86_400_000;

function shift(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.round(((b - a) / DAY) * 10) / 10;
}

function projectFinish(s: Schedule): number | null {
  let f = -Infinity;
  for (const a of s.activities) if (a.finish !== null) f = Math.max(f, a.finish);
  return Number.isFinite(f) ? f : null;
}

export function diffSchedules(prev: Schedule, next: Schedule): ScheduleDiff {
  const before = new Map(prev.activities.map((a) => [a.code, a]));
  const after = new Map(next.activities.map((a) => [a.code, a]));
  const added = next.activities.filter((a) => !before.has(a.code)).map((a) => ({ code: a.code, name: a.name }));
  const removed = prev.activities.filter((a) => !after.has(a.code)).map((a) => ({ code: a.code, name: a.name }));
  const changed: ActivityChange[] = [];
  for (const a of next.activities) {
    const b = before.get(a.code);
    if (!b) continue;
    const s = shift(b.start, a.start);
    const f = shift(b.finish, a.finish);
    if ((s ?? 0) !== 0 || (f ?? 0) !== 0 || a.status !== b.status || a.percentComplete !== b.percentComplete) {
      changed.push({
        code: a.code,
        name: a.name,
        startShiftDays: s,
        finishShiftDays: f,
        statusFrom: b.status,
        statusTo: a.status,
        pctFrom: b.percentComplete,
        pctTo: a.percentComplete,
      });
    }
  }
  changed.sort((x, y) => Math.abs(y.finishShiftDays ?? 0) - Math.abs(x.finishShiftDays ?? 0));
  return {
    added,
    removed,
    changed,
    finishShiftDays: shift(projectFinish(prev), projectFinish(next)),
    dataDateFrom: prev.dataDate,
    dataDateTo: next.dataDate,
  };
}

/** Move links from the old schedule's activity ids to the new one's, matching on Activity ID (code). */
export function remapLinks(prev: Schedule, next: Schedule, links: Link[]): { links: Link[]; dropped: Link[] } {
  const codeOf = new Map(prev.activities.map((a) => [a.id, a.code]));
  const idOf = new Map(next.activities.map((a) => [a.code, a.id]));
  const kept: Link[] = [];
  const dropped: Link[] = [];
  for (const l of links) {
    const code = codeOf.get(l.activityId);
    const newId = code !== undefined ? idOf.get(code) : undefined;
    if (newId === undefined) dropped.push(l);
    else kept.push({ ...l, activityId: newId });
  }
  return { links: kept, dropped };
}
