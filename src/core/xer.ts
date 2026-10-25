// Primavera P6 XER reader.
//
// XER is a tab-delimited text export. Each table starts with "%T <name>", then
// one "%F" line of field names and any number of "%R" rows. "%E" ends the file.
// The format is documented by Oracle and widely used for P6 data exchange.

import type { Activity, ActivityStatus, ActivityType, Relationship, RelationshipType, Schedule, WbsNode } from "./types";

export type XerTables = Record<string, Record<string, string>[]>;

export function parseXerTables(text: string): XerTables {
  const tables: XerTables = {};
  let current: string | null = null;
  let fields: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) continue;
    const parts = rawLine.split("\t");
    const tag = parts[0];
    if (tag === "%T") {
      current = (parts[1] ?? "").trim();
      fields = [];
      tables[current] ??= [];
    } else if (tag === "%F") {
      fields = parts.slice(1).map((f) => f.trim());
    } else if (tag === "%R" && current) {
      const row: Record<string, string> = {};
      for (let i = 0; i < fields.length; i++) row[fields[i]] = parts[i + 1] ?? "";
      tables[current].push(row);
    } else if (tag === "%E") {
      break;
    }
  }
  return tables;
}

/** Decode XER bytes. P6 usually writes Windows-1252; fall back to UTF-8 when a BOM says so. */
export function decodeXer(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** P6 dates look like "2024-03-18 08:00". They have no zone; we read them as UTC wall time. */
export function parseXerDate(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const TYPE_MAP: Record<string, ActivityType> = {
  TT_Task: "task",
  TT_Mile: "milestone",
  TT_FinMile: "finish-milestone",
  TT_LOE: "loe",
  TT_WBS: "wbs-summary",
  TT_Rsrc: "resource-dependent",
};

const STATUS_MAP: Record<string, ActivityStatus> = {
  TK_NotStart: "not-started",
  TK_Active: "in-progress",
  TK_Complete: "complete",
};

const REL_MAP: Record<string, RelationshipType> = { PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF" };

export interface XerImportOptions {
  /** Pick a project when the XER holds several. Defaults to the first one. */
  projectId?: string;
}

export function listXerProjects(tables: XerTables): { id: string; code: string; name: string }[] {
  return (tables.PROJECT ?? []).map((p) => ({
    id: p.proj_id,
    code: p.proj_short_name ?? p.proj_id,
    name: projectName(tables, p.proj_id) ?? p.proj_short_name ?? p.proj_id,
  }));
}

function projectName(tables: XerTables, projId: string): string | null {
  const root = (tables.PROJWBS ?? []).find((w) => w.proj_id === projId && w.proj_node_flag === "Y");
  return root?.wbs_name ?? null;
}

export function xerToSchedule(tables: XerTables, options: XerImportOptions = {}): Schedule {
  const projects = tables.PROJECT ?? [];
  if (projects.length === 0) throw new Error("No PROJECT table found. Is this a P6 XER export?");
  const project = options.projectId ? projects.find((p) => p.proj_id === options.projectId) : projects[0];
  if (!project) throw new Error(`Project ${options.projectId} not found in XER`);
  const projId = project.proj_id;

  // Activity codes: type id -> type name, code id -> value
  const codeTypeName = new Map<string, string>();
  for (const t of tables.ACTVTYPE ?? []) codeTypeName.set(t.actv_code_type_id, t.actv_code_type);
  const codeValue = new Map<string, { type: string; value: string }>();
  for (const c of tables.ACTVCODE ?? []) {
    codeValue.set(c.actv_code_id, { type: c.actv_code_type_id, value: c.short_name || c.actv_code_name });
  }
  const taskCodes = new Map<string, Record<string, string>>();
  for (const a of tables.TASKACTV ?? []) {
    if (a.proj_id && a.proj_id !== projId) continue;
    const cv = codeValue.get(a.actv_code_id);
    if (!cv) continue;
    const typeName = codeTypeName.get(a.actv_code_type_id ?? cv.type) ?? cv.type;
    const rec = taskCodes.get(a.task_id) ?? {};
    rec[typeName] = cv.value;
    taskCodes.set(a.task_id, rec);
  }

  const wbsRows = (tables.PROJWBS ?? []).filter((w) => w.proj_id === projId);
  const rootWbs = wbsRows.find((w) => w.proj_node_flag === "Y");
  const wbs: WbsNode[] = wbsRows
    .filter((w) => w.proj_node_flag !== "Y")
    .map((w) => ({
      id: w.wbs_id,
      parentId: w.parent_wbs_id && w.parent_wbs_id !== rootWbs?.wbs_id ? w.parent_wbs_id : null,
      code: w.wbs_short_name ?? "",
      name: w.wbs_name ?? "",
      seq: num(w.seq_num) ?? 0,
    }));

  const activities: Activity[] = (tables.TASK ?? [])
    .filter((t) => t.proj_id === projId)
    .map((t) => {
      const status = STATUS_MAP[t.status_code] ?? "not-started";
      const actualStart = parseXerDate(t.act_start_date);
      const actualFinish = parseXerDate(t.act_end_date);
      // For in-progress work P6 holds remaining dates in restart_date / reend_date.
      const start = actualStart ?? parseXerDate(t.early_start_date) ?? parseXerDate(t.restart_date) ?? parseXerDate(t.target_start_date);
      const finish =
        actualFinish ?? parseXerDate(t.early_end_date) ?? parseXerDate(t.reend_date) ?? parseXerDate(t.target_end_date);
      const totalFloatHours = num(t.total_float_hr_cnt);
      return {
        id: t.task_id,
        code: t.task_code ?? t.task_id,
        name: t.task_name ?? "",
        wbsId: t.wbs_id && t.wbs_id !== rootWbs?.wbs_id ? t.wbs_id : null,
        type: TYPE_MAP[t.task_type] ?? "task",
        status,
        percentComplete: status === "complete" ? 100 : Math.max(0, Math.min(100, num(t.phys_complete_pct) ?? 0)),
        start,
        finish,
        baselineStart: parseXerDate(t.target_start_date),
        baselineFinish: parseXerDate(t.target_end_date),
        actualStart,
        actualFinish,
        totalFloatHours,
        originalDurationHours: num(t.target_drtn_hr_cnt),
        remainingDurationHours: num(t.remain_drtn_hr_cnt),
        critical: t.driving_path_flag === "Y" || (totalFloatHours !== null && totalFloatHours <= 0 && status !== "complete"),
        calendarId: t.clndr_id || null,
        codes: taskCodes.get(t.task_id) ?? {},
      };
    });

  const ids = new Set(activities.map((a) => a.id));
  const relationships: Relationship[] = (tables.TASKPRED ?? [])
    .filter((r) => ids.has(r.task_id) && ids.has(r.pred_task_id))
    .map((r) => ({
      id: r.task_pred_id,
      predecessorId: r.pred_task_id,
      successorId: r.task_id,
      type: REL_MAP[r.pred_type] ?? "FS",
      lagHours: num(r.lag_hr_cnt) ?? 0,
    }));

  return {
    projectId: projId,
    projectCode: project.proj_short_name ?? projId,
    projectName: projectName(tables, projId) ?? project.proj_short_name ?? projId,
    dataDate: parseXerDate(project.last_recalc_date) ?? parseXerDate(project.next_data_date),
    activities,
    wbs,
    relationships,
  };
}

export function parseXer(text: string, options?: XerImportOptions): Schedule {
  return xerToSchedule(parseXerTables(text), options);
}
