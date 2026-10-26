import { useEffect, useMemo, useState } from "react";
import { useConfig } from "../backend/config";
import type { ProjectSummary } from "../backend/types";
import { parseRecipients } from "../services/mailer";
import { applySlices, dimensions, groupValues } from "../core/progress";
import {
  computeNextRun,
  defaultDashboard,
  progressReportDashboard,
  type InfoRow,
  newSchedule,
  uid,
  type Dashboard,
  type KpiMetric,
  type ReportRun,
  type ReportSchedule,
  type TableFilter,
  type Widget,
  type WidgetKind,
} from "../core/reporting";
import type { Schedule } from "../core/types";
import { download } from "./files";
import { useStore } from "./store";
import { FILTER_LABELS, KPI_LABELS, WIDGET_KINDS, WidgetView, type PortfolioEntry } from "./Widgets";

/** Load the schedules a dashboard needs: the open project, stored projects, and (for portfolio widgets) all of them. */
export function useDashboardData(d: Dashboard | null, override: string | null = null) {
  const { backend } = useConfig();
  const open = useStore((s) => s.schedule);
  const currentId = useStore((s) => s.currentProjectId);
  const [cache, setCache] = useState<Record<string, Schedule | null>>({});
  const [portfolio, setPortfolio] = useState<PortfolioEntry[] | null>(null);
  const baseId = override ?? d?.projectId ?? null;
  const ids = useMemo(() => {
    const s = new Set<string>();
    if (baseId) s.add(baseId);
    for (const w of d?.widgets ?? []) if (w.projectId) s.add(w.projectId);
    return [...s];
  }, [d, baseId]);
  const needsPortfolio = !!d?.widgets.some((w) => w.kind === "portfolio");

  useEffect(() => {
    let live = true;
    (async () => {
      const next: Record<string, Schedule | null> = {};
      for (const id of ids) {
        if (id === currentId && open) next[id] = open;
        else next[id] = (await backend.getProject(id).catch(() => null))?.project.schedule ?? null;
      }
      if (live) setCache(next);
    })();
    return () => {
      live = false;
    };
  }, [ids, backend, currentId, open]);

  useEffect(() => {
    if (!needsPortfolio) return setPortfolio(null);
    let live = true;
    (async () => {
      const out: PortfolioEntry[] = [];
      for (const p of await backend.listProjects().catch(() => [] as ProjectSummary[])) {
        const s = p.id === currentId && open ? open : (await backend.getProject(p.id).catch(() => null))?.project.schedule;
        if (s) out.push({ id: p.id, schedule: s });
      }
      if (live) setPortfolio(out);
    })();
    return () => {
      live = false;
    };
  }, [needsPortfolio, backend, currentId, open]);

  /** Schedule for a widget before slicers. */
  const rawFor = (w: Widget): Schedule | null => {
    const id = w.projectId ?? baseId;
    if (!id) return open; // "open project"
    return cache[id] ?? null;
  };
  /** Schedule for a widget with the dashboard's slicer selections applied. */
  const scheduleFor = (w: Widget): Schedule | null => {
    const raw = rawFor(w);
    return raw && w.kind !== "slicer" ? applySlices(raw, d?.slices) : raw;
  };
  return { scheduleFor, rawFor, portfolio, loaded: ids.every((id) => id in cache) && (!needsPortfolio || portfolio !== null) };
}

export function DashboardsView({ onClose }: { onClose: () => void }) {
  const { backend } = useConfig();
  const open = useStore((s) => s.schedule);
  const currentId = useStore((s) => s.currentProjectId);
  const [list, setList] = useState<Dashboard[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [panel, setPanel] = useState<"none" | "email">("none");
  const [msg, setMsg] = useState("");

  const reload = async () => {
    const l = await backend.listDashboards();
    setList(l);
    if (!sel && l[0]) setSel(l[0].id);
  };
  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
    backend.listProjects().then(setProjects).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const dash = list?.find((d) => d.id === sel) ?? null;
  const data = useDashboardData(dash);
  const setDash = (d: Dashboard) => setList((l) => (l ?? []).map((x) => (x.id === d.id ? d : x)));
  const persist = async (d: Dashboard) => {
    setDash(d);
    try {
      await backend.saveDashboard(d);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const create = async (kind: "status" | "progress") => {
    const d = kind === "progress" ? progressReportDashboard(currentId) : defaultDashboard(currentId);
    if (!currentId && kind === "status") d.name = "Project status (open project)";
    await backend.saveDashboard(d);
    await reload();
    setSel(d.id);
  };

  const exportExcel = async () => {
    const s = dash ? data.scheduleFor({ id: "", kind: "kpi", title: "", w: 3, h: 1 }) : null;
    if (!s) return setMsg("Open or pick a project first.");
    const { buildWorkbook } = await import("../services/excel");
    const bytes = await buildWorkbook(s, { dashboard: dash!, portfolio: data.portfolio ?? undefined });
    download(`${s.projectCode}_${dash!.name}.xlsx`.replace(/[^\w.-]+/g, "_"), bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  return (
    <div className="dash-root">
      <aside className="dash-list">
        <div className="row">
          <b>Dashboards</b>
          <span className="spacer" />
          <button onClick={onClose}>✕ Back</button>
        </div>
        {list?.map((d) => (
          <button key={d.id} className={`dash-item ${d.id === sel ? "active" : ""}`} onClick={() => (setSel(d.id), setEdit(false))}>
            {d.name}
            <span className="muted">{d.projectId ? projects.find((p) => p.id === d.projectId)?.code ?? "project" : "open project"}</span>
          </button>
        ))}
        <button onClick={() => create("progress")}>+ Progress report (EPC style)</button>
        <button onClick={() => create("status")}>+ Project status dashboard</button>
        {list && !list.length && <p className="muted">Start with a ready-made project status dashboard, then customise it.</p>}
      </aside>

      <main className="dash-main">
        {!dash ? (
          <div className="empty">{list === null ? "Loading…" : "Create a dashboard to begin."}</div>
        ) : (
          <>
            <div className="dash-bar">
              {edit ? (
                <input className="dash-title-input" value={dash.name} onChange={(e) => setDash({ ...dash, name: e.target.value })} onBlur={() => persist(dash)} />
              ) : (
                <h2>{dash.name}</h2>
              )}
              <select value={dash.projectId ?? ""} onChange={(e) => persist({ ...dash, projectId: e.target.value || null })} title="Project shown by this dashboard">
                <option value="">Open project{open ? ` (${open.projectCode})` : ""}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} – {p.name}
                  </option>
                ))}
              </select>
              <span className="spacer" />
              <button className={edit ? "primary" : ""} onClick={() => (edit ? (persist(dash), setEdit(false)) : setEdit(true))}>
                {edit ? "Done" : "Edit"}
              </button>
              <button onClick={() => window.print()}>Print / PDF</button>
              <button onClick={exportExcel}>Excel</button>
              <button className={panel === "email" ? "active" : ""} onClick={() => setPanel(panel === "email" ? "none" : "email")}>
                ✉ Email reports
              </button>
              {edit && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete dashboard "${dash.name}" and its email schedules?`)) return;
                    await backend.deleteDashboard(dash.id);
                    setSel(null);
                    await reload();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {msg && <p className="bad">{msg}</p>}
            <div className="dash-body">
              <DashCanvas dash={dash} edit={edit} data={data} onChange={persist} projects={projects} />
              {panel === "email" && <EmailPanel dash={dash} projects={projects} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function DashCanvas({
  dash,
  edit,
  data,
  onChange,
  projects,
}: {
  dash: Dashboard;
  edit: boolean;
  data: ReturnType<typeof useDashboardData>;
  onChange: (d: Dashboard) => void;
  projects: ProjectSummary[];
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const upd = (w: Widget) => onChange({ ...dash, widgets: dash.widgets.map((x) => (x.id === w.id ? w : x)) });
  const move = (from: string, to: string) => {
    const ws = [...dash.widgets];
    const a = ws.findIndex((w) => w.id === from);
    const b = ws.findIndex((w) => w.id === to);
    if (a < 0 || b < 0 || a === b) return;
    const [x] = ws.splice(a, 1);
    ws.splice(b, 0, x);
    onChange({ ...dash, widgets: ws });
  };
  return (
    <div className={`dash-canvas print-root ${dash.theme === "report" ? "theme-report" : ""}`}>
      <div className="print-only report-head">
        <img src="./stratum-logo.png" alt="Stratum 4D" />
        <div>
          <b>{dash.name}</b>
          <div className="muted">Printed {new Date().toLocaleString()}</div>
        </div>
      </div>
      <div className="dash-grid">
        {dash.widgets.map((w) => (
          <section
            key={w.id}
            className={`widget w${w.w} h${w.h} ${dragId === w.id ? "dragging" : ""}`}
            draggable={edit}
            onDragStart={() => setDragId(w.id)}
            onDragOver={(e) => edit && e.preventDefault()}
            onDrop={() => dragId && move(dragId, w.id)}
            onDragEnd={() => setDragId(null)}
          >
            <header>
              {edit && <span className="grip" title="Drag to move">⠿</span>}
              <span className="widget-title">{w.title}</span>
              {edit && (
                <span className="widget-tools">
                  <select value={w.w} onChange={(e) => upd({ ...w, w: Number(e.target.value) as Widget["w"] })} title="Width">
                    {[3, 4, 6, 8, 12].map((n) => (
                      <option key={n} value={n}>
                        {n === 12 ? "Full" : n === 6 ? "Half" : n === 3 ? "Quarter" : n === 4 ? "Third" : "Two thirds"}
                      </option>
                    ))}
                  </select>
                  <select value={w.h} onChange={(e) => upd({ ...w, h: Number(e.target.value) as Widget["h"] })} title="Height">
                    <option value={1}>Short</option>
                    <option value={2}>Medium</option>
                    <option value={3}>Tall</option>
                  </select>
                  <button className="link" onClick={() => setSettingsFor(settingsFor === w.id ? null : w.id)}>
                    ⚙
                  </button>
                  <button className="link" onClick={() => onChange({ ...dash, widgets: dash.widgets.filter((x) => x.id !== w.id) })}>
                    ✕
                  </button>
                </span>
              )}
            </header>
            {edit && settingsFor === w.id && <WidgetSettings w={w} onChange={upd} projects={projects} raw={data.rawFor(w)} />}
            <div className="widget-body">
              <WidgetView
                w={w}
                schedule={data.scheduleFor(w)}
                portfolio={data.portfolio}
                slice={{ slices: dash.slices ?? [], onSlices: (slices) => onChange({ ...dash, slices }), raw: data.rawFor(w) }}
              />
            </div>
          </section>
        ))}
        {edit && (
          <section className="widget w12 h1 add-widget">
            <span className="muted">Add:</span>
            {WIDGET_KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => onChange({ ...dash, widgets: [...dash.widgets, { id: uid("w"), kind: k.kind, title: k.label, w: 6, h: 1, ...k.defaults } as Widget] })}
              >
                + {k.label}
              </button>
            ))}
          </section>
        )}
      </div>
      <div className="print-only report-foot">Stratum 4D · developed by Junaid Quamar</div>
    </div>
  );
}

function WidgetSettings({ w, onChange, projects, raw }: { w: Widget; onChange: (w: Widget) => void; projects: ProjectSummary[]; raw: Schedule | null }) {
  const dims = dimensions(raw);
  const groups = raw && (w.kind === "progress" || w.kind === "slicer") ? groupValues(raw, w.dimension ?? "wbs1") : [];
  return (
    <div className="widget-settings">
      <label>
        Title
        <input value={w.title} onChange={(e) => onChange({ ...w, title: e.target.value })} />
      </label>
      <label>
        Type
        <select value={w.kind} onChange={(e) => onChange({ ...w, kind: e.target.value as WidgetKind })}>
          {WIDGET_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {w.kind !== "text" && w.kind !== "portfolio" && (
        <label>
          Project
          <select value={w.projectId ?? ""} onChange={(e) => onChange({ ...w, projectId: e.target.value || null })}>
            <option value="">Dashboard's project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
      )}
      {w.kind === "kpi" && (
        <label>
          Measure
          <select value={w.metric} onChange={(e) => onChange({ ...w, metric: e.target.value as KpiMetric })}>
            {(Object.keys(KPI_LABELS) as KpiMetric[]).map((k) => (
              <option key={k} value={k}>
                {KPI_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {(w.kind === "kpi" || w.kind === "scurve") && (
        <label>
          Values in
          <select value={w.measure ?? "cost"} onChange={(e) => onChange({ ...w, measure: e.target.value as "cost" | "hours" })}>
            <option value="cost">Cost</option>
            <option value="hours">Labour hours</option>
          </select>
        </label>
      )}
      {w.kind === "table" && (
        <>
          <label>
            Show
            <select value={w.filter} onChange={(e) => onChange({ ...w, filter: e.target.value as TableFilter })}>
              {(Object.keys(FILTER_LABELS) as TableFilter[]).map((k) => (
                <option key={k} value={k}>
                  {FILTER_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rows
            <input type="number" min={1} max={200} value={w.limit ?? 15} onChange={(e) => onChange({ ...w, limit: Number(e.target.value) || 15 })} />
          </label>
        </>
      )}
      {(w.filter === "starting-soon" || w.filter === "finishing-soon" || w.metric === "startingSoon") && (
        <label>
          Window (days)
          <input type="number" min={1} value={w.days ?? 14} onChange={(e) => onChange({ ...w, days: Number(e.target.value) || 14 })} />
        </label>
      )}
      {w.kind === "quantity" && (
        <label>
          Quantity property
          <input value={w.quantityKey ?? "BaseQuantities.NetVolume"} onChange={(e) => onChange({ ...w, quantityKey: e.target.value })} />
        </label>
      )}
      {(w.kind === "progress" || w.kind === "slicer") && (
        <label>
          Group by
          <select value={w.dimension ?? "wbs1"} onChange={(e) => onChange({ ...w, dimension: e.target.value, weightage: undefined })}>
            {dims.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(w.kind === "progress" || w.kind === "pscurve") && (
        <label>
          Weight activities by
          <select value={w.basis ?? "cost"} onChange={(e) => onChange({ ...w, basis: e.target.value as Widget["basis"] })}>
            <option value="cost">Budget cost</option>
            <option value="hours">Labour hours</option>
            <option value="duration">Duration</option>
            <option value="equal">Equal weights</option>
          </select>
        </label>
      )}
      {w.kind === "pscurve" && (
        <label>
          Period
          <select value={w.step ?? "month"} onChange={(e) => onChange({ ...w, step: e.target.value as "month" | "week" })}>
            <option value="month">Monthly</option>
            <option value="week">Weekly</option>
          </select>
        </label>
      )}
      {w.kind === "progress" && (
        <>
          <label>
            Total row label
            <input value={w.totalLabel ?? "TOTAL"} onChange={(e) => onChange({ ...w, totalLabel: e.target.value })} />
          </label>
          <div className="span-all weightage">
            <b>Weightage %</b> <span className="muted">(leave all blank to weight by the basis above)</span>
            {groups.map((g) => (
              <label key={g} className="row">
                <span style={{ flex: 1 }}>{g}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ width: 80 }}
                  value={w.weightage?.[g] ?? ""}
                  onChange={(e) => {
                    const next = { ...(w.weightage ?? {}) };
                    if (e.target.value === "") delete next[g];
                    else next[g] = Number(e.target.value);
                    onChange({ ...w, weightage: Object.keys(next).length ? next : undefined });
                  }}
                />
              </label>
            ))}
            {w.weightage && <span className="muted">Total entered: {Object.values(w.weightage).reduce((t, v) => t + v, 0)}%</span>}
          </div>
        </>
      )}
      {w.kind === "info" && <InfoRowsEditor rows={w.rows ?? []} onChange={(rows) => onChange({ ...w, rows })} />}
      {w.kind === "text" && (
        <label className="span-all">
          Text
          <textarea rows={3} value={w.text ?? ""} onChange={(e) => onChange({ ...w, text: e.target.value })} />
        </label>
      )}
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OFFSETS = [-300, -240, 0, 60, 120, 180, 240, 300, 330, 345, 360, 420, 480, 540, 600];
const offLabel = (m: number) => `UTC${m >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

function EmailPanel({ dash, projects }: { dash: Dashboard; projects: ProjectSummary[] }) {
  const { backend } = useConfig();
  const [list, setList] = useState<ReportSchedule[]>([]);
  const [edit, setEdit] = useState<(ReportSchedule & { toText: string; ccText: string }) | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const all = await backend.listSchedules();
    setList(all.filter((s) => s.dashboardId === dash.id));
    setRuns(await backend.listRuns().catch(() => []));
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash.id, backend]);

  const startEdit = (s: ReportSchedule) => setEdit({ ...s, toText: s.to.join("; "), ccText: s.cc.join("; ") });
  const describe = (s: ReportSchedule) =>
    s.frequency === "daily" ? `Daily ${s.time}` : s.frequency === "weekly" ? `${s.weekdays.map((d) => DAYS[d]).join(", ")} ${s.time}` : `Monthly, day ${s.monthDay === -1 ? "last" : s.monthDay}, ${s.time}`;

  return (
    <aside className="email-panel">
      <h3>Email reports</h3>
      {!backend.caps.email ? (
        <p className="muted">Scheduled emails need the Stratum desktop app or a Stratum Server. You can still Print / PDF and export Excel by hand.</p>
      ) : (
        <>
          <p className="muted">
            {backend.caps.alwaysOn ? "Sent by the server on schedule." : "Sent by this app while it is open; missed sends go out the next time you start Stratum."} Set up the mail server in Settings → Email.
          </p>
          {list.map((s) => (
            <div key={s.id} className="sched-card">
              <div className="row">
                <b>{s.name}</b>
                <span className="spacer" />
                <span className={s.enabled ? "good" : "muted"}>{s.enabled ? "On" : "Paused"}</span>
              </div>
              <div className="muted">
                {describe(s)} {offLabel(s.utcOffsetMinutes)} · {s.to.length + s.cc.length} recipient(s) · {s.formats.join(" + ").toUpperCase()}
              </div>
              <div className="muted">Next: {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "–"}</div>
              {runs.filter((r) => r.scheduleId === s.id).slice(0, 1).map((r) => (
                <div key={r.id} className={r.status === "sent" ? "good" : "bad"}>
                  Last: {new Date(r.at).toLocaleString()} – {r.message}
                </div>
              ))}
              <div className="row">
                <button className="link" onClick={() => startEdit(s)}>
                  edit
                </button>
                <button
                  className="link"
                  onClick={async () => {
                    setMsg("Sending…");
                    try {
                      const r = await backend.runScheduleNow(s.id);
                      setMsg(r.status === "sent" ? r.message : `Failed: ${r.message}`);
                      await load();
                    } catch (e) {
                      setMsg((e as Error).message);
                    }
                  }}
                >
                  send now
                </button>
                <button
                  className="link"
                  onClick={async () => {
                    await backend.deleteSchedule(s.id);
                    await load();
                  }}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
          {!edit && (
            <button
              onClick={() => {
                const s = newSchedule(dash.id);
                s.utcOffsetMinutes = -new Date().getTimezoneOffset();
                startEdit(s);
              }}
            >
              + New email schedule
            </button>
          )}
          {edit && (
            <div className="stack form">
              <label>
                Name
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              {!dash.projectId && (
                <label>
                  Project (reports need a saved project)
                  <select value={edit.projectId ?? ""} onChange={(e) => setEdit({ ...edit, projectId: e.target.value || null })}>
                    <option value="">Choose…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} – {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                To (separate with ; or ,)
                <textarea rows={2} value={edit.toText} onChange={(e) => setEdit({ ...edit, toText: e.target.value })} placeholder="pm@company.com; director@company.com" />
              </label>
              <label>
                Cc
                <input value={edit.ccText} onChange={(e) => setEdit({ ...edit, ccText: e.target.value })} />
              </label>
              <label>
                Subject
                <input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
              </label>
              <label>
                Message
                <textarea rows={4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              </label>
              <p className="muted">Placeholders: {"{project}"}, {"{date}"}, {"{datadate}"}</p>
              <div className="row">
                <select value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value as ReportSchedule["frequency"] })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <input type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} />
                <select value={edit.utcOffsetMinutes} onChange={(e) => setEdit({ ...edit, utcOffsetMinutes: Number(e.target.value) })}>
                  {[...new Set([...OFFSETS, edit.utcOffsetMinutes])].sort((a, b) => a - b).map((m) => (
                    <option key={m} value={m}>
                      {offLabel(m)}
                      {m === 240 ? " (Gulf)" : m === 330 ? " (India)" : m === 0 ? " (UK)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {edit.frequency === "weekly" && (
                <div className="row wrap">
                  {DAYS.map((d, i) => (
                    <label key={d} className="check">
                      <input
                        type="checkbox"
                        checked={edit.weekdays.includes(i)}
                        onChange={(e) => setEdit({ ...edit, weekdays: e.target.checked ? [...edit.weekdays, i].sort() : edit.weekdays.filter((x) => x !== i) })}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              )}
              {edit.frequency === "monthly" && (
                <label>
                  Day of month
                  <select value={edit.monthDay} onChange={(e) => setEdit({ ...edit, monthDay: Number(e.target.value) })}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value={-1}>Last day</option>
                  </select>
                </label>
              )}
              <div className="row">
                {(["pdf", "xlsx"] as const).map((f) => (
                  <label key={f} className="check">
                    <input
                      type="checkbox"
                      checked={edit.formats.includes(f)}
                      onChange={(e) => setEdit({ ...edit, formats: e.target.checked ? [...edit.formats, f] : edit.formats.filter((x) => x !== f) })}
                    />
                    {f === "pdf" ? "PDF of the dashboard" : "Excel workbook"}
                  </label>
                ))}
                <label className="check">
                  <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>
              {(() => {
                try {
                  return <p className="muted">First send: {new Date(computeNextRun(edit, Date.now())).toLocaleString()}</p>;
                } catch {
                  return null;
                }
              })()}
              <div className="row">
                <button
                  className="primary"
                  onClick={async () => {
                    const to = parseRecipients(edit.toText);
                    const cc = parseRecipients(edit.ccText);
                    if (to.invalid.length || cc.invalid.length) return setMsg(`Not an email address: ${[...to.invalid, ...cc.invalid].join(", ")}`);
                    if (!to.valid.length) return setMsg("Add at least one recipient.");
                    if (!dash.projectId && !edit.projectId) return setMsg("Choose the project to report on.");
                    if (!edit.formats.length) return setMsg("Choose PDF and/or Excel.");
                    const { toText: _t, ccText: _c, ...rest } = edit;
                    void _t;
                    void _c;
                    try {
                      await backend.saveSchedule({ ...rest, to: to.valid, cc: cc.valid });
                      setEdit(null);
                      setMsg("Saved.");
                      await load();
                    } catch (e) {
                      setMsg((e as Error).message);
                    }
                  }}
                >
                  Save schedule
                </button>
                <button onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </div>
          )}
          {msg && <p className={/fail|invalid|not an email|error|needs|cannot/i.test(msg) ? "bad" : "good"}>{msg}</p>}
        </>
      )}
    </aside>
  );
}

function InfoRowsEditor({ rows, onChange }: { rows: InfoRow[]; onChange: (r: InfoRow[]) => void }) {
  const set = (i: number, r: InfoRow) => onChange(rows.map((x, k) => (k === i ? r : x)));
  return (
    <div className="span-all info-editor">
      <b>Rows</b>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input value={r.label} onChange={(e) => set(i, { ...r, label: e.target.value })} style={{ flex: 2 }} />
          <select value={r.metric ?? ""} onChange={(e) => set(i, { ...r, metric: (e.target.value || null) as KpiMetric | null })} style={{ flex: 1 }}>
            <option value="">Typed value</option>
            {(Object.keys(KPI_LABELS) as KpiMetric[]).map((k) => (
              <option key={k} value={k}>
                {KPI_LABELS[k]}
              </option>
            ))}
          </select>
          {!r.metric && <input value={r.value ?? ""} onChange={(e) => set(i, { ...r, value: e.target.value })} placeholder="value" style={{ flex: 1 }} />}
          <button className="link" onClick={() => onChange(rows.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...rows, { label: "New row", metric: null, value: "" }])}>+ Row</button>
    </div>
  );
}
