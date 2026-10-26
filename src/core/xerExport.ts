// Write a schedule back out as P6 XER.
//
// When the schedule came from an XER, every original table is kept and only
// the fields Stratum edits are rewritten: activity dates, durations, status,
// float, constraints, names, relationships, and any activities added or
// deleted in Stratum. Everything else (codes, UDFs, resources, notebooks…)
// passes through untouched, so P6 can import it as an update.
//
// Schedules from other sources get a minimal XER (project, WBS, calendar,
// activities, relationships) that P6 imports as a new project.

import { standardCalendar, toP6CalendarData } from "./calendar";
import { CONSTRAINT_MAP, CP1252_HIGH, type XerTables } from "./xer";
import type { Activity, Schedule } from "./types";

const TYPE_OUT: Record<Activity["type"], string> = {
  task: "TT_Task",
  milestone: "TT_Mile",
  "finish-milestone": "TT_FinMile",
  loe: "TT_LOE",
  "wbs-summary": "TT_WBS",
  "resource-dependent": "TT_Rsrc",
};
const STATUS_OUT: Record<Activity["status"], string> = { "not-started": "TK_NotStart", "in-progress": "TK_Active", complete: "TK_Complete" };
const REL_OUT = { FS: "PR_FS", SS: "PR_SS", FF: "PR_FF", SF: "PR_SF" } as const;
const CONSTRAINT_OUT = Object.fromEntries(Object.entries(CONSTRAINT_MAP).map(([k, v]) => [v, k])) as Record<string, string>;

export function formatXerDate(t: number | null | undefined): string {
  if (t === null || t === undefined) return "";
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const hrs = (h: number | null | undefined) => (h === null || h === undefined ? "" : String(Math.round(h * 100) / 100));

function nextId(rows: Record<string, string>[], key: string): () => string {
  let max = 0;
  for (const r of rows) {
    const v = Number(r[key]);
    if (Number.isFinite(v)) max = Math.max(max, v);
  }
  return () => String(++max);
}

function minimalTables(s: Schedule): XerTables {
  const cal = s.calendars?.find((c) => c.id === s.defaultCalendarId) ?? s.calendars?.[0] ?? standardCalendar("1");
  const calendars = (s.calendars?.length ? s.calendars : [cal]).map((c) => ({
    clndr_id: c.id,
    default_flag: c.id === cal.id ? "Y" : "N",
    clndr_name: c.name,
    proj_id: "",
    base_clndr_id: "",
    last_chng_date: "",
    clndr_type: "CA_Base",
    day_hr_cnt: String(c.hoursPerDay),
    week_hr_cnt: String(c.hoursPerDay * 5),
    month_hr_cnt: String(c.hoursPerDay * 21),
    year_hr_cnt: String(c.hoursPerDay * 250),
    rsrc_private: "N",
    clndr_data: toP6CalendarData(c),
  }));
  return {
    CALENDAR: calendars,
    PROJECT: [
      {
        proj_id: s.projectId,
        proj_short_name: s.projectCode,
        clndr_id: cal.id,
        last_recalc_date: formatXerDate(s.dataDate),
        plan_start_date: formatXerDate(Math.min(...s.activities.map((a) => a.start ?? Infinity))),
      },
    ],
    PROJWBS: [
      { wbs_id: `${s.projectId}-root`, proj_id: s.projectId, parent_wbs_id: "", wbs_short_name: s.projectCode, wbs_name: s.projectName, seq_num: "0", proj_node_flag: "Y" },
      ...s.wbs.map((w) => ({
        wbs_id: w.id,
        proj_id: s.projectId,
        parent_wbs_id: w.parentId ?? `${s.projectId}-root`,
        wbs_short_name: w.code,
        wbs_name: w.name,
        seq_num: String(w.seq),
        proj_node_flag: "N",
      })),
    ],
    TASK: [],
    TASKPRED: [],
  };
}

export function scheduleToXerTables(s: Schedule): XerTables {
  const t: XerTables = s.sourceXer ? structuredClone(s.sourceXer) : minimalTables(s);
  t.TASK ??= [];
  t.TASKPRED ??= [];
  const projId = s.projectId;
  const rootWbs = (t.PROJWBS ?? []).find((w) => w.proj_id === projId && w.proj_node_flag === "Y")?.wbs_id ?? "";
  const defaultCal = s.defaultCalendarId ?? t.CALENDAR?.[0]?.clndr_id ?? "";

  const keep = new Set(s.activities.map((a) => a.id));
  const existing = new Map(t.TASK.filter((r) => r.proj_id === projId).map((r) => [r.task_id, r]));
  const template = t.TASK[0] ?? {};
  const newTaskId = nextId(t.TASK, "task_id");

  // Drop deleted activities (and rows that hang off them).
  t.TASK = t.TASK.filter((r) => r.proj_id !== projId || keep.has(r.task_id));
  for (const table of ["TASKRSRC", "TASKACTV", "TASKMEMO", "UDFVALUE"]) {
    if (!t[table]) continue;
    t[table] = t[table].filter((r) => {
      const id = table === "UDFVALUE" ? r.fk_id : r.task_id;
      return !existing.has(id) || keep.has(id);
    });
  }

  const idMap = new Map<string, string>();
  for (const a of s.activities) {
    let row = existing.get(a.id);
    if (!row) {
      row = Object.fromEntries(Object.keys(template).map((k) => [k, ""]));
      const id = /^\d+$/.test(a.id) && !t.TASK.some((r) => r.task_id === a.id) ? a.id : newTaskId();
      idMap.set(a.id, id);
      Object.assign(row, { task_id: id, proj_id: projId, guid: "", duration_type: "DT_FixedDUR2", complete_pct_type: "CP_Phys" });
      t.TASK.push(row);
    } else idMap.set(a.id, a.id);
    const started = a.actualStart !== null;
    Object.assign(row, {
      wbs_id: a.wbsId ?? rootWbs,
      clndr_id: a.calendarId ?? row.clndr_id ?? defaultCal,
      task_code: a.code,
      task_name: a.name,
      task_type: TYPE_OUT[a.type],
      status_code: STATUS_OUT[a.status],
      phys_complete_pct: String(Math.round(a.percentComplete)),
      target_drtn_hr_cnt: hrs(a.originalDurationHours),
      remain_drtn_hr_cnt: hrs(a.status === "complete" ? 0 : a.remainingDurationHours),
      total_float_hr_cnt: hrs(a.totalFloatHours),
      free_float_hr_cnt: hrs(a.freeFloatHours),
      act_start_date: formatXerDate(a.actualStart),
      act_end_date: formatXerDate(a.actualFinish),
      early_start_date: formatXerDate(a.start),
      early_end_date: formatXerDate(a.finish),
      late_start_date: formatXerDate(a.lateStart ?? null),
      late_end_date: formatXerDate(a.lateFinish ?? null),
      restart_date: started && a.status !== "complete" ? formatXerDate(a.start) : row.restart_date ?? "",
      reend_date: a.status !== "complete" ? formatXerDate(a.finish) : row.reend_date ?? "",
      driving_path_flag: a.critical ? "Y" : "N",
      cstr_type: a.constraint ? CONSTRAINT_OUT[a.constraint.type] ?? "" : "",
      cstr_date: formatXerDate(a.constraint?.date ?? null),
    });
    // New activities have no baseline in P6; give them their planned dates.
    if (!existing.has(a.id)) {
      row.target_start_date = formatXerDate(a.baselineStart ?? a.start);
      row.target_end_date = formatXerDate(a.baselineFinish ?? a.finish);
    }
  }

  // Relationships: rebuild this project's set, keeping ids where they exist.
  const oldRels = new Map(t.TASKPRED.filter((r) => r.proj_id === projId).map((r) => [`${r.pred_task_id}|${r.task_id}|${r.pred_type}`, r]));
  const relTemplate = t.TASKPRED[0] ?? {};
  const newRelId = nextId(t.TASKPRED, "task_pred_id");
  t.TASKPRED = t.TASKPRED.filter((r) => r.proj_id !== projId);
  for (const r of s.relationships) {
    const pred = idMap.get(r.predecessorId);
    const succ = idMap.get(r.successorId);
    if (!pred || !succ) continue;
    const key = `${pred}|${succ}|${REL_OUT[r.type]}`;
    const row = oldRels.get(key) ?? { ...Object.fromEntries(Object.keys(relTemplate).map((k) => [k, ""])), task_pred_id: newRelId() };
    Object.assign(row, { task_id: succ, pred_task_id: pred, proj_id: projId, pred_proj_id: projId, pred_type: REL_OUT[r.type], lag_hr_cnt: hrs(r.lagHours) });
    t.TASKPRED.push(row);
  }

  for (const p of t.PROJECT ?? []) if (p.proj_id === projId && s.dataDate !== null) p.last_recalc_date = formatXerDate(s.dataDate);
  return t;
}

/** Serialise tables to XER text (tab-delimited, CRLF). */
export function writeXer(tables: XerTables, header?: string): string {
  const out: string[] = [header ?? `ERMHDR\t21.12\t${formatXerDate(Date.now()).slice(0, 10)}\tProject\tadmin\tStratum\tdbxDatabaseNoName\tProject Management\tUSD`];
  const clean = (v: string | undefined) => (v ?? "").replace(/[\t\r\n]+/g, " ");
  for (const [name, rows] of Object.entries(tables)) {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
    const fields = [...seen];
    if (!fields.length) continue;
    out.push(`%T\t${name}`, `%F\t${fields.join("\t")}`);
    for (const r of rows) out.push(`%R\t${fields.map((f) => clean(r[f])).join("\t")}`);
  }
  out.push("%E");
  return out.join("\r\n") + "\r\n";
}

/** Encode as Windows-1252 (what P6 writes and expects); unmappable characters become "?". */
export function encodeWindows1252(text: string): Uint8Array {
  const special: Record<number, number> = Object.fromEntries(Object.entries(CP1252_HIGH).map(([b, cp]) => [cp, Number(b)]));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : special[c] ?? 0x3f;
  }
  return out;
}

export function exportXer(s: Schedule): Uint8Array {
  return encodeWindows1252(writeXer(scheduleToXerTables(s)));
}

/** Plain CSV of the schedule for Excel. */
export function exportCsv(s: Schedule): string {
  const wbs = new Map(s.wbs.map((w) => [w.id, w.code]));
  const head = ["Activity ID", "Activity Name", "WBS", "Type", "Status", "% Complete", "Start", "Finish", "Baseline Start", "Baseline Finish", "Late Start", "Late Finish", "Total Float (h)", "Free Float (h)", "Critical", "Original Duration (h)", "Remaining Duration (h)"];
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = s.activities.map((a) =>
    [
      a.code, a.name, wbs.get(a.wbsId ?? "") ?? "", a.type, a.status, String(a.percentComplete),
      formatXerDate(a.start), formatXerDate(a.finish), formatXerDate(a.baselineStart), formatXerDate(a.baselineFinish),
      formatXerDate(a.lateStart ?? null), formatXerDate(a.lateFinish ?? null), hrs(a.totalFloatHours), hrs(a.freeFloatHours ?? null),
      a.critical ? "Yes" : "No", hrs(a.originalDurationHours), hrs(a.remainingDurationHours),
    ].map(q).join(","),
  );
  return [head.join(","), ...rows].join("\r\n");
}
