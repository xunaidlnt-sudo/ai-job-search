// Primavera P6 EPPM REST API connector.
//
// Request shapes follow Oracle's P6 EPPM REST API:
//   POST {prefix}/login?DatabaseName=<db>   headers: username, password  -> session cookie
//   GET  {prefix}/{entity}?Fields=A,B&Filter=ProjectObjectId :eq: 123
//   GET  {prefix}/{entity}/fields           -> comma-separated field names
//   PUT  {prefix}/{entity}                  body: [{ ObjectId, ...changes }]
// Oracle-hosted (cloud) P6 can use an OAuth bearer token instead of login.
//
// Field names differ slightly between P6 releases, so the connector asks each
// entity which fields it has and only requests those.

import type { P6Connection } from "../../core/reporting";
import type { Schedule } from "../../core/types";
import { xerToSchedule, type XerTables } from "../../core/xer";

type Json = Record<string, unknown>;

export class P6HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class EppmClient {
  private cookie = "";
  private fieldCache = new Map<string, Set<string> | null>();

  /**
   * cookieJar: the fetch keeps cookies itself (Electron session fetch), so a
   * login that shows no Set-Cookie header is still a good login.
   */
  constructor(
    private cfg: P6Connection,
    private fetchImpl: typeof fetch = fetch,
    private opts: { cookieJar?: boolean } = {},
  ) {
    if (!cfg.url) throw new Error("P6 EPPM REST URL is required, e.g. https://p6.company.com/p6ws/restapi");
  }

  private get prefix() {
    return this.cfg.url!.replace(/\/+$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.cfg.auth === "bearer" && this.cfg.token) h.Authorization = `Bearer ${this.cfg.token}`;
    else if (this.cookie) h.Cookie = this.cookie;
    return h;
  }

  async login(): Promise<void> {
    if (this.cfg.auth === "bearer") return;
    const url = `${this.prefix}/login${this.cfg.database ? `?DatabaseName=${encodeURIComponent(this.cfg.database)}` : ""}`;
    const res = await this.fetchImpl(url, { method: "POST", headers: { username: this.cfg.user ?? "", password: this.cfg.password ?? "" } });
    if (!res.ok) throw new P6HttpError(res.status, `P6 login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const raw = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    this.cookie = raw
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!this.cookie && !this.opts.cookieJar) throw new Error("P6 login returned no session cookie");
  }

  async logout(): Promise<void> {
    if (this.cfg.auth === "bearer" || !this.cookie) return;
    try {
      await this.fetchImpl(`${this.prefix}/logout`, { method: "POST", headers: this.headers() });
    } catch {
      // best effort
    }
  }

  /** Fields an entity supports; null when the server will not say (then we ask for everything we want). */
  async fields(entity: string): Promise<Set<string> | null> {
    if (this.fieldCache.has(entity)) return this.fieldCache.get(entity)!;
    let set: Set<string> | null = null;
    try {
      const res = await this.fetchImpl(`${this.prefix}/${entity}/fields`, { headers: this.headers() });
      if (res.ok) {
        const text = (await res.text()).trim();
        const list = text.startsWith("[") ? (JSON.parse(text) as string[]) : text.split(",");
        set = new Set(list.map((x) => x.trim()).filter(Boolean));
      }
    } catch {
      set = null;
    }
    this.fieldCache.set(entity, set);
    return set;
  }

  async read(entity: string, wanted: string[], filter?: string): Promise<Json[]> {
    const have = await this.fields(entity);
    const fields = have ? wanted.filter((f) => have.has(f)) : wanted;
    if (!fields.includes("ObjectId") && (!have || have.has("ObjectId"))) fields.unshift("ObjectId");
    const qs = new URLSearchParams({ Fields: fields.join(",") });
    if (filter) qs.set("Filter", filter);
    const res = await this.fetchImpl(`${this.prefix}/${entity}?${qs.toString()}`, { headers: this.headers() });
    if (res.status === 204) return [];
    if (!res.ok) throw new P6HttpError(res.status, `P6 read ${entity} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const body = await res.text();
    return body.trim() ? (JSON.parse(body) as Json[]) : [];
  }

  async update(entity: string, rows: Json[], chunk = 100): Promise<number> {
    let n = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const res = await this.fetchImpl(`${this.prefix}/${entity}`, {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(part),
      });
      if (!res.ok) throw new P6HttpError(res.status, `P6 update ${entity} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      n += part.length;
    }
    return n;
  }
}

// ---------------------------------------------------------------- mapping

/** "2026-03-02T08:00:00" (any zone suffix ignored: P6 dates are wall time) -> "2026-03-02 08:00". */
export function eppmDate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
  return m ? `${m[1]} ${m[2]}` : "";
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const TYPE: Record<string, string> = {
  "Task Dependent": "TT_Task",
  "Resource Dependent": "TT_Rsrc",
  "Level of Effort": "TT_LOE",
  "Start Milestone": "TT_Mile",
  "Finish Milestone": "TT_FinMile",
  "WBS Summary": "TT_WBS",
};
const STATUS: Record<string, string> = { "Not Started": "TK_NotStart", "In Progress": "TK_Active", Completed: "TK_Complete" };
const REL: Record<string, string> = { "Finish to Start": "PR_FS", "Start to Start": "PR_SS", "Finish to Finish": "PR_FF", "Start to Finish": "PR_SF" };
const CSTR: Record<string, string> = {
  "Start On or After": "CS_MSOA",
  "Start On or Before": "CS_MSOB",
  "Finish On or After": "CS_MEOA",
  "Finish On or Before": "CS_MEOB",
  "Start On": "CS_MSO",
  "Finish On": "CS_MEO",
  "Mandatory Start": "CS_MANDSTART",
  "Mandatory Finish": "CS_MANDFIN",
  "As Late As Possible": "CS_ALAP",
};
const RSRC: Record<string, string> = { Labor: "RT_Labor", Nonlabor: "RT_Equip", Material: "RT_Mat" };

/**
 * P6 returns percent complete either as 0–100 or as a 0–1 fraction depending
 * on release and field. Treat the set as fractions when nothing exceeds 1 and
 * something is strictly between 0 and 1.
 */
export function percentScale(values: number[]): 1 | 100 {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length && finite.every((v) => v <= 1) && finite.some((v) => v > 0 && v < 1) ? 100 : 1;
}

export const ACTIVITY_FIELDS = [
  "ObjectId", "Id", "Name", "ProjectObjectId", "WBSObjectId", "CalendarObjectId", "Type", "Status",
  "PhysicalPercentComplete", "PercentComplete", "PlannedDuration", "RemainingDuration", "TotalFloat", "FreeFloat",
  "StartDate", "FinishDate", "EarlyStartDate", "EarlyFinishDate", "LateStartDate", "LateFinishDate",
  "PlannedStartDate", "PlannedFinishDate", "BaselineStartDate", "BaselineFinishDate",
  "ActualStartDate", "ActualFinishDate", "RemainingEarlyStartDate", "RemainingEarlyFinishDate",
  "IsCritical", "PrimaryConstraintType", "PrimaryConstraintDate",
];

export async function eppmListProjects(client: EppmClient): Promise<{ objectId: string; code: string; name: string; dataDate: string }[]> {
  const rows = await client.read("project", ["ObjectId", "Id", "Name", "DataDate", "Status"]);
  return rows.map((r) => ({ objectId: s(r.ObjectId), code: s(r.Id), name: s(r.Name), dataDate: eppmDate(r.DataDate) }));
}

export async function eppmPullTables(client: EppmClient, projectObjectId: string): Promise<XerTables> {
  const byProject = `ProjectObjectId :eq: ${projectObjectId}`;
  const [proj] = await client.read("project", ["ObjectId", "Id", "Name", "DataDate", "ActivityDefaultCalendarObjectId"], `ObjectId :eq: ${projectObjectId}`);
  if (!proj) throw new Error(`P6 project ${projectObjectId} not found`);
  const [wbs, acts, rels, cals, ras, codes] = await Promise.all([
    client.read("wbs", ["ObjectId", "Code", "Name", "ParentObjectId", "SequenceNumber", "ProjectObjectId"], byProject),
    client.read("activity", ACTIVITY_FIELDS, byProject),
    client.read("relationship", ["ObjectId", "PredecessorActivityObjectId", "SuccessorActivityObjectId", "Type", "Lag", "PredecessorProjectObjectId", "SuccessorProjectObjectId"], `SuccessorProjectObjectId :eq: ${projectObjectId}`).catch(() =>
      client.read("relationship", ["ObjectId", "PredecessorActivityObjectId", "SuccessorActivityObjectId", "Type", "Lag"], byProject),
    ),
    client.read("calendar", ["ObjectId", "Name", "HoursPerDay", "IsDefault"]).catch(() => [] as Json[]),
    client.read("resourceAssignment", ["ObjectId", "ActivityObjectId", "ResourceObjectId", "PlannedUnits", "ActualUnits", "RemainingUnits", "PlannedCost", "ActualCost", "RemainingCost"], byProject).catch(() => [] as Json[]),
    client.read("activityCodeAssignment", ["ActivityObjectId", "ActivityCodeTypeName", "ActivityCodeValue"], byProject).catch(() => [] as Json[]),
  ]);
  const rsrcIds = [...new Set(ras.map((r) => s(r.ResourceObjectId)).filter(Boolean))];
  const resources = rsrcIds.length
    ? await client.read("resource", ["ObjectId", "Id", "Name", "ResourceType", "PricePerUnit", "UnitOfMeasureAbbreviation"]).then((all) => all.filter((r) => rsrcIds.includes(s(r.ObjectId))))
    : [];

  const pid = s(proj.ObjectId);
  const rootId = `root-${pid}`;
  const wbsIds = new Set(wbs.map((w) => s(w.ObjectId)));
  const pctScale = percentScale(acts.map((a) => Number(a.PhysicalPercentComplete ?? a.PercentComplete ?? 0)));

  const typeIds = new Map<string, string>();
  const codeIds = new Map<string, string>();
  for (const c of codes) {
    const t = s(c.ActivityCodeTypeName);
    if (t && !typeIds.has(t)) typeIds.set(t, `t${typeIds.size + 1}`);
    const key = `${t}|${s(c.ActivityCodeValue)}`;
    if (!codeIds.has(key)) codeIds.set(key, `c${codeIds.size + 1}`);
  }

  return {
    PROJECT: [{ proj_id: pid, proj_short_name: s(proj.Id), last_recalc_date: eppmDate(proj.DataDate), clndr_id: s(proj.ActivityDefaultCalendarObjectId) }],
    PROJWBS: [
      { wbs_id: rootId, proj_id: pid, parent_wbs_id: "", wbs_short_name: s(proj.Id), wbs_name: s(proj.Name), seq_num: "0", proj_node_flag: "Y" },
      ...wbs.map((w) => ({
        wbs_id: s(w.ObjectId),
        proj_id: pid,
        parent_wbs_id: wbsIds.has(s(w.ParentObjectId)) ? s(w.ParentObjectId) : rootId,
        wbs_short_name: s(w.Code),
        wbs_name: s(w.Name),
        seq_num: s(w.SequenceNumber),
        proj_node_flag: "N",
      })),
    ],
    CALENDAR: cals.map((c) => ({ clndr_id: s(c.ObjectId), clndr_name: s(c.Name), day_hr_cnt: s(c.HoursPerDay || 8), default_flag: c.IsDefault ? "Y" : "N", clndr_data: "" })),
    TASK: acts.map((a) => {
      const pct = Number(a.PhysicalPercentComplete ?? a.PercentComplete ?? 0) * pctScale;
      return {
        task_id: s(a.ObjectId),
        proj_id: pid,
        wbs_id: wbsIds.has(s(a.WBSObjectId)) ? s(a.WBSObjectId) : rootId,
        clndr_id: s(a.CalendarObjectId),
        task_code: s(a.Id),
        task_name: s(a.Name),
        task_type: TYPE[s(a.Type)] ?? "TT_Task",
        status_code: STATUS[s(a.Status)] ?? "TK_NotStart",
        phys_complete_pct: String(Math.round(pct * 100) / 100),
        target_drtn_hr_cnt: s(a.PlannedDuration),
        remain_drtn_hr_cnt: s(a.RemainingDuration),
        total_float_hr_cnt: s(a.TotalFloat),
        free_float_hr_cnt: s(a.FreeFloat),
        act_start_date: eppmDate(a.ActualStartDate),
        act_end_date: eppmDate(a.ActualFinishDate),
        early_start_date: eppmDate(a.EarlyStartDate ?? a.RemainingEarlyStartDate ?? a.StartDate),
        early_end_date: eppmDate(a.EarlyFinishDate ?? a.RemainingEarlyFinishDate ?? a.FinishDate),
        late_start_date: eppmDate(a.LateStartDate),
        late_end_date: eppmDate(a.LateFinishDate),
        target_start_date: eppmDate(a.BaselineStartDate ?? a.PlannedStartDate),
        target_end_date: eppmDate(a.BaselineFinishDate ?? a.PlannedFinishDate),
        driving_path_flag: a.IsCritical === true || a.IsCritical === "true" ? "Y" : "N",
        cstr_type: CSTR[s(a.PrimaryConstraintType)] ?? "",
        cstr_date: eppmDate(a.PrimaryConstraintDate),
      };
    }),
    TASKPRED: rels.map((r) => ({
      task_pred_id: s(r.ObjectId),
      task_id: s(r.SuccessorActivityObjectId),
      pred_task_id: s(r.PredecessorActivityObjectId),
      proj_id: pid,
      pred_proj_id: s(r.PredecessorProjectObjectId || pid),
      pred_type: REL[s(r.Type)] ?? "PR_FS",
      lag_hr_cnt: s(r.Lag || 0),
    })),
    RSRC: resources.map((r) => ({ rsrc_id: s(r.ObjectId), rsrc_short_name: s(r.Id), rsrc_name: s(r.Name), rsrc_type: RSRC[s(r.ResourceType)] ?? "RT_Labor", unit_id: s(r.UnitOfMeasureAbbreviation) })),
    RSRCRATE: resources.map((r) => ({ rsrc_id: s(r.ObjectId), cost_per_qty: s(r.PricePerUnit) })),
    UMEASURE: [...new Set(resources.map((r) => s(r.UnitOfMeasureAbbreviation)).filter(Boolean))].map((u) => ({ unit_id: u, unit_abbrev: u })),
    TASKRSRC: ras.map((r) => ({
      taskrsrc_id: s(r.ObjectId),
      task_id: s(r.ActivityObjectId),
      rsrc_id: s(r.ResourceObjectId),
      proj_id: pid,
      target_qty: s(r.PlannedUnits),
      act_reg_qty: s(r.ActualUnits),
      remain_qty: s(r.RemainingUnits),
      target_cost: s(r.PlannedCost),
      act_reg_cost: s(r.ActualCost),
      remain_cost: s(r.RemainingCost),
    })),
    ACTVTYPE: [...typeIds].map(([name, id]) => ({ actv_code_type_id: id, actv_code_type: name })),
    ACTVCODE: [...codeIds].map(([key, id]) => ({ actv_code_id: id, actv_code_type_id: typeIds.get(key.split("|")[0])!, short_name: key.split("|").slice(1).join("|") })),
    TASKACTV: codes.map((c) => ({
      task_id: s(c.ActivityObjectId),
      actv_code_type_id: typeIds.get(s(c.ActivityCodeTypeName))!,
      actv_code_id: codeIds.get(`${s(c.ActivityCodeTypeName)}|${s(c.ActivityCodeValue)}`)!,
      proj_id: pid,
    })),
  };
}

export async function eppmImport(cfg: P6Connection, projectObjectId: string, fetchImpl?: typeof fetch, opts: { cookieJar?: boolean } = {}): Promise<Schedule> {
  const client = new EppmClient(cfg, fetchImpl, opts);
  await client.login();
  try {
    const tables = await eppmPullTables(client, projectObjectId);
    const schedule = xerToSchedule(tables);
    return {
      ...schedule,
      sourceFormat: "p6-eppm",
      // The pulled tables are kept so an XER export still works; mark them as not from a file.
      p6Source: { connectionId: cfg.id, projectObjectId, kind: cfg.kind, pulledAt: new Date().toISOString() },
    };
  } finally {
    await client.logout();
  }
}

const isoDate = (t: number | null) => (t === null ? null : new Date(t).toISOString().slice(0, 19));

export interface PushResult {
  updated: number;
  skipped: string[];
}

/**
 * Push progress back to P6: actual dates, physical % complete and remaining
 * duration, for activities that exist in P6. New activities and logic changes
 * are not created through the API (use XER for those); they are listed as
 * skipped so nothing is silently lost.
 */
export async function eppmPushProgress(cfg: P6Connection, schedule: Schedule, fetchImpl?: typeof fetch, opts: { cookieJar?: boolean } = {}): Promise<PushResult> {
  const client = new EppmClient(cfg, fetchImpl, opts);
  await client.login();
  try {
    const pid = schedule.p6Source?.projectObjectId;
    if (!pid) throw new Error("This schedule was not pulled from P6 EPPM");
    const existing = await client.read("activity", ["ObjectId", "PhysicalPercentComplete"], `ProjectObjectId :eq: ${pid}`);
    const ids = new Set(existing.map((r) => s(r.ObjectId)));
    const scale = percentScale(existing.map((r) => Number(r.PhysicalPercentComplete ?? 0)));
    const skipped: string[] = [];
    const rows: Json[] = [];
    for (const a of schedule.activities) {
      if (!ids.has(a.id)) {
        skipped.push(a.code);
        continue;
      }
      if (a.status === "not-started" && a.actualStart === null) continue;
      rows.push({
        ObjectId: Number.isFinite(Number(a.id)) ? Number(a.id) : a.id,
        ActualStartDate: isoDate(a.actualStart),
        ActualFinishDate: a.status === "complete" ? isoDate(a.actualFinish) : null,
        PhysicalPercentComplete: scale === 100 ? a.percentComplete / 100 : a.percentComplete,
        RemainingDuration: a.status === "complete" ? 0 : a.remainingDurationHours ?? undefined,
      });
    }
    const updated = rows.length ? await client.update("activity", rows) : 0;
    return { updated, skipped };
  } finally {
    await client.logout();
  }
}
