import {
  Briefcase,
  CalendarRange,
  ChartArea,
  ChartBarBig,
  ChartColumnStacked,
  ChartLine,
  ChartSpline,
  Check,
  Copy,
  FileSpreadsheet,
  Flag,
  Gauge,
  GripVertical,
  Hash,
  Heading,
  Image as ImageIcon,
  LayoutGrid,
  ListChecks,
  ListFilter,
  Mail,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plus,
  Printer,
  Redo2,
  Table2,
  TableProperties,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../backend/config";
import type { ProjectSummary } from "../backend/types";
import { parseRecipients } from "../services/mailer";
import { dimensions, groupValues } from "../core/progress";
import {
  BUILTIN_TEMPLATES,
  cloneDashboard,
  computeNextRun,
  widgetCols,
  widgetRows,
  type InfoRow,
  type TableColumn,
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
import { ModeSwitch, ThemeButton } from "./ModeSwitch";
import { TrainingButton } from "./training/Training";
import {
  columnLabel,
  DEFAULT_COLUMNS,
  FILTER_LABELS,
  KPI_LABELS,
  PageHead,
  pageStyle,
  TABLE_COLUMNS,
  WIDGET_KINDS,
  WidgetFrame,
  widgetSchedule,
  WidgetView,
  type PortfolioEntry,
  type WidgetGroup,
} from "./Widgets";

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
  const scheduleFor = (w: Widget): Schedule | null => widgetSchedule(rawFor(w), w, d?.slices);
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
  const [selWidget, setSelWidget] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const history = useRef<{ past: Dashboard[]; future: Dashboard[]; at: number }>({ past: [], future: [], at: 0 });
  const saveTimer = useRef<number | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);

  const reload = async (pick?: string) => {
    const l = await backend.listDashboards();
    setList(l);
    if (pick) setSel(pick);
    else if (!sel || !l.some((d) => d.id === sel)) setSel(l.find((d) => !d.isTemplate)?.id ?? l[0]?.id ?? null);
  };
  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
    backend.listProjects().then(setProjects).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const dash = list?.find((d) => d.id === sel) ?? null;
  const data = useDashboardData(dash);
  const setDash = (d: Dashboard) => setList((l) => (l ?? []).map((x) => (x.id === d.id ? d : x)));

  /** Save after a short pause so typing in a setting doesn't post on every key. */
  const save = (d: Dashboard) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => backend.saveDashboard(d).catch((e) => setMsg((e as Error).message)), 350);
  };
  const persist = (d: Dashboard) => {
    const prev = list?.find((x) => x.id === d.id);
    const h = history.current;
    // Group quick edits (typing) into one undo step.
    if (prev && Date.now() - h.at > 700) {
      h.past.push(prev);
      if (h.past.length > 60) h.past.shift();
      h.future = [];
    }
    h.at = Date.now();
    const next = { ...d, updatedAt: new Date().toISOString() };
    setDash(next);
    save(next);
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev || !dash) return;
    h.future.push(dash);
    h.at = 0;
    setDash(prev);
    save(prev);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next || !dash) return;
    h.past.push(dash);
    h.at = 0;
    setDash(next);
    save(next);
  };
  useEffect(() => {
    history.current = { past: [], future: [], at: 0 };
    setSelWidget(null);
  }, [sel]);

  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selWidget && dash && !typing) {
        e.preventDefault();
        persist({ ...dash, widgets: dash.widgets.filter((w) => w.id !== selWidget) });
        setSelWidget(null);
      } else if (e.key === "Escape") setSelWidget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const createFrom = async (d: Dashboard) => {
    await backend.saveDashboard(d);
    await reload(d.id);
    setEdit(true);
  };
  const create = (id: string) => {
    const t = BUILTIN_TEMPLATES.find((x) => x.id === id);
    if (t) return createFrom(t.make(currentId));
    const user = list?.find((d) => d.id === id);
    if (user) return createFrom({ ...cloneDashboard(user, user.name.replace(/ \(template\)$/, "")), projectId: currentId ?? user.projectId });
  };
  const blank = () =>
    createFrom({
      id: uid("dash"),
      name: "New dashboard",
      projectId: currentId,
      widgets: [],
      slices: [],
      page: { header: "{project}", subtitle: "Data date {datadate}" },
      updatedAt: new Date().toISOString(),
    });

  const exportExcel = async () => {
    const s = dash ? data.scheduleFor({ id: "", kind: "kpi", title: "", w: 3, h: 1 }) : null;
    if (!s) return setMsg("Open or pick a project first.");
    const { buildWorkbook } = await import("../services/excel");
    const bytes = await buildWorkbook(s, { dashboard: dash!, portfolio: data.portfolio ?? undefined });
    download(`${s.projectCode}_${dash!.name}.xlsx`.replace(/[^\w.-]+/g, "_"), bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  const exportJson = () => {
    if (!dash) return;
    const { id: _id, ...rest } = dash;
    void _id;
    download(`${dash.name.replace(/[^\w.-]+/g, "_")}.stratum-dashboard.json`, new TextEncoder().encode(JSON.stringify({ stratumDashboard: 1, ...rest }, null, 2)), "application/json");
  };
  const importJson = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.widgets)) throw new Error("Not a Stratum dashboard file.");
      const d = cloneDashboard({ ...j, id: "x", projectId: currentId ?? null } as Dashboard, j.name ?? "Imported dashboard");
      await createFrom(d);
      setMsg(`Imported "${d.name}".`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const dashboards = list?.filter((d) => !d.isTemplate) ?? [];
  const templates = list?.filter((d) => d.isTemplate) ?? [];
  const selW = dash?.widgets.find((w) => w.id === selWidget) ?? null;

  return (
    <div className="dash-root">
      <header className="reports-topbar">
        <img className="logo logo-light" src="./stratum-logo.png" alt="Stratum 4D" />
        <img className="logo logo-dark" src="./stratum-logo-dark.png" alt="" />
        <b className="reports-brand">Reports</b>
        <span className="muted reports-sub">{open ? `${open.projectCode} – ${open.projectName}` : "No project open"}</span>
        <span className="spacer" />
        <ModeSwitch />
        <TrainingButton className="tb" />
        <ThemeButton />
        <button className="tb icon-only" title="Back to the schedule" onClick={onClose} aria-label="Back to the schedule">
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="dash-shell">
        <aside className="dash-list">
          <div className="dash-list-head">Dashboards</div>
          {dashboards.map((d) => (
            <button key={d.id} className={`dash-item ${d.id === sel ? "active" : ""}`} onClick={() => (setSel(d.id), setEdit(false))}>
              {d.name}
              <span className="muted">
                {d.projectId ? (projects.find((p) => p.id === d.projectId)?.code ?? "project") : "open project"} · {d.widgets.length} widgets
              </span>
            </button>
          ))}
          {list && !dashboards.length && <p className="muted">No dashboards yet. Start from a template below, then change anything.</p>}
          {templates.length > 0 && <div className="dash-list-head">My templates</div>}
          {templates.map((d) => (
            <div key={d.id} className={`dash-item tpl ${d.id === sel ? "active" : ""}`}>
              <button className="link" onClick={() => (setSel(d.id), setEdit(false))}>
                {d.name}
              </button>
              <button className="mini" title="New dashboard from this template" onClick={() => create(d.id)}>
                <Plus size={13} aria-hidden /> Use
              </button>
            </div>
          ))}
          <div className="dash-list-head">New</div>
          {BUILTIN_TEMPLATES.map((t) => (
            <button key={t.id} className="dash-new" onClick={() => create(t.id)} title={t.hint}>
              <Plus size={14} aria-hidden />
              <span>
                {t.name}
                <small className="muted">{t.hint}</small>
              </span>
            </button>
          ))}
          <button className="dash-new" onClick={blank}>
            <Plus size={14} aria-hidden />
            <span>
              Blank dashboard<small className="muted">Build it from the widget gallery</small>
            </span>
          </button>
          <button className="dash-new" onClick={() => importRef.current?.click()}>
            <Upload size={14} aria-hidden />
            <span>
              Import…<small className="muted">A dashboard file shared by a colleague</small>
            </span>
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </aside>

        <main className="dash-main">
          {!dash ? (
            <div className="empty">{list === null ? "Loading…" : "Pick a template on the left to begin."}</div>
          ) : (
            <>
              <div className="dash-bar">
                {edit ? (
                  <input className="dash-title-input" value={dash.name} onChange={(e) => persist({ ...dash, name: e.target.value })} aria-label="Dashboard name" />
                ) : (
                  <h2>
                    {dash.name}
                    {dash.isTemplate && <span className="tag">template</span>}
                  </h2>
                )}
                <select value={dash.projectId ?? ""} onChange={(e) => persist({ ...dash, projectId: e.target.value || null })} title="Project shown by this dashboard">
                  <option value="">Open project{open ? ` (${open.projectCode})` : ""}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} – {p.name}
                    </option>
                  ))}
                </select>
                {(dash.slices?.length ?? 0) > 0 && (
                  <button className="mini" onClick={() => persist({ ...dash, slices: [] })} title="Clear every slicer selection">
                    Clear filters ({dash.slices!.reduce((t, x) => t + x.values.length, 0)})
                  </button>
                )}
                <span className="spacer" />
                {edit && (
                  <>
                    <button className="icon-only" title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.past.length}>
                      <Undo2 size={15} aria-hidden />
                    </button>
                    <button className="icon-only" title="Redo (Ctrl+Y)" onClick={redo} disabled={!history.current.future.length}>
                      <Redo2 size={15} aria-hidden />
                    </button>
                    <button className={!selWidget ? "active" : ""} onClick={() => setSelWidget(null)} title="Widget gallery and page set-up">
                      <Plus size={15} aria-hidden /> Add / Page
                    </button>
                  </>
                )}
                <button className={edit ? "primary" : ""} onClick={() => (edit ? (setEdit(false), setSelWidget(null)) : setEdit(true))}>
                  {edit ? (
                    <>
                      <Check size={15} aria-hidden /> Done
                    </>
                  ) : (
                    <>
                      <Pencil size={15} aria-hidden /> Customise
                    </>
                  )}
                </button>
                <Menu
                  label="More"
                  items={[
                    { label: "Duplicate dashboard", onClick: () => createFrom(cloneDashboard(dash, `${dash.name} (copy)`)) },
                    {
                      label: "Save as template",
                      onClick: async () => {
                        const t = cloneDashboard(dash, `${dash.name} (template)`, true);
                        await backend.saveDashboard(t);
                        await reload(dash.id);
                        setMsg(`Saved "${t.name}" under My templates.`);
                      },
                    },
                    { label: "Export dashboard file (.json)", onClick: exportJson },
                    {
                      label: "Delete dashboard",
                      danger: true,
                      onClick: async () => {
                        if (!window.confirm(`Delete dashboard "${dash.name}" and its email schedules?`)) return;
                        await backend.deleteDashboard(dash.id);
                        setSel(null);
                        await reload();
                      },
                    },
                  ]}
                />
                {!edit && (
                  <>
                    <button onClick={() => window.print()} title="Print or save as PDF">
                      <Printer size={15} aria-hidden /> PDF
                    </button>
                    <button onClick={exportExcel} title="Excel workbook">
                      <FileSpreadsheet size={15} aria-hidden /> Excel
                    </button>
                    <button className={panel === "email" ? "active" : ""} onClick={() => setPanel(panel === "email" ? "none" : "email")}>
                      <Mail size={15} aria-hidden /> Email
                    </button>
                  </>
                )}
              </div>
              {msg && (
                <p className={/fail|invalid|not a|error|cannot/i.test(msg) ? "bad dash-msg" : "good dash-msg"} onClick={() => setMsg("")}>
                  {msg}
                </p>
              )}
              <div className="dash-body">
                <DashCanvas dash={dash} edit={edit} data={data} onChange={persist} selected={selWidget} onSelect={setSelWidget} />
                {edit && (
                  <Inspector
                    key={selW?.id ?? "none"}
                    dash={dash}
                    widget={selW}
                    onChange={persist}
                    projects={projects}
                    raw={selW ? data.rawFor(selW) : data.rawFor({ id: "", kind: "kpi", title: "", w: 3, h: 1 })}
                    onSelect={setSelWidget}
                  />
                )}
                {!edit && panel === "email" && <EmailPanel dash={dash} projects={projects} />}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Menu({ label, items }: { label: string; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} title={label}>
        <MoreHorizontal size={15} aria-hidden /> {label}
      </button>
      {open && (
        <div className="menu-drop" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? "danger" : ""}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ROW_PX = 52;

function DashCanvas({
  dash,
  edit,
  data,
  onChange,
  selected,
  onSelect,
}: {
  dash: Dashboard;
  edit: boolean;
  data: ReturnType<typeof useDashboardData>;
  onChange: (d: Dashboard) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [resize, setResize] = useState<{ id: string; w: number; h: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** The click that ends a resize drag must not clear the selection. */
  const justResized = useRef(false);
  const upd = (w: Widget) => onChange({ ...dash, widgets: dash.widgets.map((x) => (x.id === w.id ? w : x)) });
  const background = (e: React.MouseEvent) => {
    if (justResized.current) return;
    if (edit && e.target === e.currentTarget) onSelect(null);
  };
  const move = (from: string, to: string) => {
    const ws = [...dash.widgets];
    const a = ws.findIndex((w) => w.id === from);
    const b = ws.findIndex((w) => w.id === to);
    if (a < 0 || b < 0 || a === b) return;
    const [x] = ws.splice(a, 1);
    ws.splice(b, 0, x);
    onChange({ ...dash, widgets: ws });
  };
  const duplicate = (w: Widget) => {
    const i = dash.widgets.findIndex((x) => x.id === w.id);
    const copy = { ...structuredClone(w), id: uid("w"), title: w.title };
    const ws = [...dash.widgets];
    ws.splice(i + 1, 0, copy);
    onChange({ ...dash, widgets: ws });
    onSelect(copy.id);
  };

  const startResize = (e: React.PointerEvent, w: Widget) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
    const colUnit = (grid.clientWidth - 11 * gap) / 12 + gap;
    const rowUnit = ROW_PX + gap;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const w0 = widgetCols(w.w);
    const r0 = widgetRows(w.h);
    let cur = { id: w.id, w: w0, h: w.h };
    const onMove = (ev: PointerEvent) => {
      const cols = Math.min(12, Math.max(1, w0 + Math.round((ev.clientX - x0) / colUnit)));
      const rows = Math.min(16, Math.max(1, r0 + Math.round((ev.clientY - y0) / rowUnit)));
      cur = { id: w.id, w: cols, h: rows / 2 };
      setResize(cur);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      justResized.current = true;
      window.setTimeout(() => (justResized.current = false), 0);
      onSelect(w.id);
      setResize(null);
      if (cur.w !== w0 || cur.h !== w.h) upd({ ...w, w: cur.w, h: cur.h });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const ps = pageStyle(dash);
  const main = data.rawFor({ id: "", kind: "kpi", title: "", w: 3, h: 1 });
  return (
    <div className={`dash-canvas print-root ${ps.className} ${edit ? "editing" : ""}`} style={ps.style} onClick={background}>
      {dash.page?.orientation === "portrait" && <style>{"@page { size: A4 portrait; }"}</style>}
      <PageHead dash={dash} schedule={main} />
      <div className="print-only">
        <PageHead dash={dash} schedule={main} print />
      </div>
      <div className="dash-grid" ref={gridRef} onClick={background}>
        {dash.widgets.map((w0) => {
          const w = resize?.id === w0.id ? { ...w0, w: resize.w, h: resize.h } : w0;
          const sched = data.scheduleFor(w);
          return (
            <WidgetFrame
              key={w.id}
              w={w}
              dash={dash}
              schedule={sched}
              className={`${dragId === w.id ? "dragging" : ""} ${overId === w.id && dragId !== w.id ? "drop-target" : ""} ${selected === w.id ? "selected" : ""}`}
              draggable={edit && !resize}
              onDragStart={(e) => {
                if ((e.target as HTMLElement).closest(".resize-handle, .widget-body")) return e.preventDefault();
                setDragId(w.id);
              }}
              onDragOver={(e) => {
                if (!edit || !dragId) return;
                e.preventDefault();
                setOverId(w.id);
              }}
              onDrop={() => dragId && move(dragId, w.id)}
              onDragEnd={() => (setDragId(null), setOverId(null))}
              onClick={edit ? () => onSelect(w.id) : undefined}
              header={edit ? <GripVertical className="grip" size={14} aria-label="Drag to move" /> : undefined}
              tools={
                edit ? (
                  <span className="widget-tools">
                    <span className="size-chip" title="Width × height">
                      {widgetCols(w.w)}×{w.h}
                    </span>
                    <button className="icon-only" title="Duplicate" onClick={(e) => (e.stopPropagation(), duplicate(w))}>
                      <Copy size={13} aria-hidden />
                    </button>
                    <button
                      className="icon-only"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange({ ...dash, widgets: dash.widgets.filter((x) => x.id !== w.id) });
                        if (selected === w.id) onSelect(null);
                      }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </span>
                ) : undefined
              }
            >
              <WidgetView w={w} schedule={sched} portfolio={data.portfolio} slice={{ slices: dash.slices ?? [], onSlices: (slices) => onChange({ ...dash, slices }), raw: data.rawFor(w) }} />
              {edit && <span className="resize-handle" title="Drag to resize" onPointerDown={(e) => startResize(e, w0)} />}
            </WidgetFrame>
          );
        })}
        {edit && !dash.widgets.length && (
          <div className="dash-empty-hint">
            <LayoutGrid size={28} aria-hidden />
            <b>Empty dashboard</b>
            <span className="muted">Pick widgets from the gallery on the right. Drag a card&apos;s header to move it and its corner to resize it.</span>
          </div>
        )}
      </div>
      <div className="print-only report-foot">
        {dash.page?.footer ? `${dash.page.footer} · ` : ""}Stratum 4D · developed by Junaid Quamar
      </div>
    </div>
  );
}

const SWATCHES = ["#0b4f8a", "#0b2a8a", "#2a78d6", "#1baf7a", "#008300", "#eb6834", "#d03b3b", "#6250d6", "#1b2330", "#5b6470"];
const BACKGROUNDS = ["", "#ffffff", "#f6f8fb", "#eef4fb", "#fff8e8", "#eefaf4", "#1b2330", "#0b2a8a"];

function ColorPick({ value, onChange, options = SWATCHES, none = "Default" }: { value?: string; onChange: (v: string | undefined) => void; options?: string[]; none?: string }) {
  return (
    <div className="swatches">
      <button className={`sw none ${!value ? "on" : ""}`} title={none} onClick={() => onChange(undefined)}>
        {none}
      </button>
      {options.filter(Boolean).map((c) => (
        <button key={c} className={`sw ${value === c ? "on" : ""}`} style={{ background: c }} title={c} aria-label={c} onClick={() => onChange(c)} />
      ))}
      <input type="color" value={value ?? "#2a78d6"} onChange={(e) => onChange(e.target.value)} title="Any colour" />
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={value === o.v ? "active" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Inspector({
  dash,
  widget,
  onChange,
  projects,
  raw,
  onSelect,
}: {
  dash: Dashboard;
  widget: Widget | null;
  onChange: (d: Dashboard) => void;
  projects: ProjectSummary[];
  raw: Schedule | null;
  onSelect: (id: string | null) => void;
}) {
  const [tab, setTab] = useState<"data" | "style" | "filter">("data");
  const [side, setSide] = useState<"add" | "page">("add");
  const upd = (w: Widget) => onChange({ ...dash, widgets: dash.widgets.map((x) => (x.id === w.id ? w : x)) });
  const add = (k: (typeof WIDGET_KINDS)[number]) => {
    const w = { id: uid("w"), kind: k.kind, title: k.label, w: 6, h: 1, ...structuredClone(k.defaults) } as Widget;
    onChange({ ...dash, widgets: [...dash.widgets, w] });
    onSelect(w.id);
    requestAnimationFrame(() => document.querySelector(".widget.selected")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  if (!widget)
    return (
      <aside className="inspector">
        <div className="tabs">
          <button className={side === "add" ? "active" : ""} onClick={() => setSide("add")}>
            Add widget
          </button>
          <button className={side === "page" ? "active" : ""} onClick={() => setSide("page")}>
            Page &amp; theme
          </button>
        </div>
        {side === "add" ? (
          <div className="gallery">
            {(["Numbers", "Charts", "Tables", "Layout"] as WidgetGroup[]).map((g) => (
              <section key={g}>
                <h4>{g}</h4>
                {WIDGET_KINDS.filter((k) => k.group === g).map((k) => (
                  <button key={k.kind} className="gallery-item" onClick={() => add(k)}>
                    <WidgetIcon kind={k.kind} />
                    <span>
                      <b>{k.label}</b>
                      <small className="muted">{k.hint}</small>
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <PageSettings dash={dash} onChange={onChange} />
        )}
      </aside>
    );

  const w = widget;
  const st = w.style ?? {};
  const setStyle = (p: Partial<NonNullable<Widget["style"]>>) => upd({ ...w, style: { ...st, ...p } });
  return (
    <aside className="inspector">
      <div className="insp-head">
        <WidgetIcon kind={w.kind} />
        <b>{WIDGET_KINDS.find((k) => k.kind === w.kind)?.label}</b>
        <span className="spacer" />
        <button className="icon-only" title="Close (Esc)" onClick={() => onSelect(null)}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="tabs">
        {(["data", "style", "filter"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "data" ? "Data" : t === "style" ? "Look" : `Filter${w.where?.length || w.ignoreSlicers ? " •" : ""}`}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {tab === "data" && <WidgetSettings w={w} onChange={upd} projects={projects} raw={raw} />}
        {tab === "style" && (
          <div className="form-grid">
            <label className="span-all">
              Size
              <span className="row">
                <select value={widgetCols(w.w)} onChange={(e) => upd({ ...w, w: Number(e.target.value) })} title="Width in twelfths">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}/12{n === 12 ? " (full)" : n === 6 ? " (half)" : n === 4 ? " (third)" : n === 3 ? " (quarter)" : ""}
                    </option>
                  ))}
                </select>
                <select value={w.h} onChange={(e) => upd({ ...w, h: Number(e.target.value) })} title="Height">
                  {Array.from({ length: 16 }, (_, i) => (i + 1) / 2).map((n) => (
                    <option key={n} value={n}>
                      {n} × row
                    </option>
                  ))}
                </select>
              </span>
              <small className="muted">Or drag the card&apos;s bottom-right corner.</small>
            </label>
            <label className="check span-all">
              <input type="checkbox" checked={!!st.hideTitle} onChange={(e) => setStyle({ hideTitle: e.target.checked || undefined })} /> Hide the title
            </label>
            <label className="span-all">
              Title bar
              <Seg
                value={st.header ?? "plain"}
                onChange={(v) => setStyle({ header: v === "plain" ? undefined : v })}
                options={[
                  { v: "plain", label: "Plain" },
                  { v: "underline", label: "Underline" },
                  { v: "filled", label: "Filled" },
                ]}
              />
            </label>
            <label className="span-all">
              Accent colour
              <ColorPick value={st.accent} onChange={(v) => setStyle({ accent: v })} none="Page" />
            </label>
            <label className="span-all">
              Card background
              <ColorPick value={st.background} onChange={(v) => setStyle({ background: v, color: v && isDark(v) ? "#ffffff" : undefined })} options={BACKGROUNDS} />
            </label>
            <label className="span-all">
              Card style
              <Seg
                value={st.border ?? "page"}
                onChange={(v) => setStyle({ border: v === "page" ? undefined : (v as "card" | "line" | "none") })}
                options={[
                  { v: "page", label: "Page default" },
                  { v: "card", label: "Card" },
                  { v: "line", label: "Outline" },
                  { v: "none", label: "None" },
                ]}
              />
            </label>
            <label>
              Text size
              <select value={st.fontScale ?? 1} onChange={(e) => setStyle({ fontScale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
                {[0.85, 1, 1.15, 1.3, 1.5].map((n) => (
                  <option key={n} value={n}>
                    {Math.round(n * 100)}%
                  </option>
                ))}
              </select>
            </label>
            <label>
              Align
              <select value={st.align ?? ""} onChange={(e) => setStyle({ align: (e.target.value || undefined) as "left" | "center" | "right" | undefined })}>
                <option value="">Default</option>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </label>
            {CHARTS.includes(w.kind) && (
              <>
                <label>
                  Chart
                  <select value={w.chart ?? "line"} onChange={(e) => upd({ ...w, chart: e.target.value as "line" | "area" })}>
                    <option value="line">Lines</option>
                    <option value="area">Shaded area</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={w.showLegend !== false} onChange={(e) => upd({ ...w, showLegend: e.target.checked ? undefined : false })} /> Legend
                </label>
                <div className="span-all">
                  <span className="muted">Series shown</span>
                  <div className="row wrap">
                    {(SERIES_IDS[w.kind] ?? []).map(([id, label]) => {
                      const hidden = w.hiddenSeries ?? (w.kind === "groupbars" ? ["forecast"] : []);
                      return (
                        <label key={id} className="check">
                          <input
                            type="checkbox"
                            checked={!hidden.includes(id)}
                            onChange={(e) => upd({ ...w, hiddenSeries: e.target.checked ? hidden.filter((x) => x !== id) : [...hidden, id] })}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {tab === "filter" && <FilterSettings w={w} onChange={upd} raw={raw} />}
      </div>
      <div className="insp-foot">
        <button
          onClick={() => {
            const i = dash.widgets.findIndex((x) => x.id === w.id);
            const ws = [...dash.widgets];
            const [x] = ws.splice(i, 1);
            ws.splice(Math.max(0, i - 1), 0, x);
            onChange({ ...dash, widgets: ws });
          }}
          title="Move earlier"
        >
          ← Earlier
        </button>
        <button
          onClick={() => {
            const i = dash.widgets.findIndex((x) => x.id === w.id);
            const ws = [...dash.widgets];
            const [x] = ws.splice(i, 1);
            ws.splice(Math.min(ws.length, i + 1), 0, x);
            onChange({ ...dash, widgets: ws });
          }}
          title="Move later"
        >
          Later →
        </button>
        <span className="spacer" />
        <button
          className="danger"
          onClick={() => {
            onChange({ ...dash, widgets: dash.widgets.filter((x) => x.id !== w.id) });
            onSelect(null);
          }}
        >
          <Trash2 size={14} aria-hidden /> Remove
        </button>
      </div>
    </aside>
  );
}

const CHARTS: WidgetKind[] = ["scurve", "pscurve", "phasecurves", "groupbars"];
const SERIES_IDS: Partial<Record<WidgetKind, [string, string][]>> = {
  scurve: [
    ["pv", "Planned"],
    ["ev", "Earned"],
    ["ac", "Actual"],
    ["fc", "Forecast"],
  ],
  pscurve: [
    ["plan", "Plan"],
    ["actual", "Actual"],
    ["fc", "Forecast"],
  ],
  phasecurves: [
    ["plan", "Plan"],
    ["actual", "Actual"],
    ["fc", "Forecast"],
  ],
  groupbars: [
    ["plan", "Plan"],
    ["actual", "Actual"],
    ["forecast", "Forecast"],
  ],
};

function isDark(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
}

const KIND_ICON: Record<WidgetKind, LucideIcon> = {
  kpi: Hash,
  gauge: Gauge,
  info: ListChecks,
  donut: PieChart,
  scurve: ChartSpline,
  pscurve: ChartLine,
  phasecurves: LayoutGrid,
  groupbars: ChartBarBig,
  histogram: ChartColumnStacked,
  quantity: ChartArea,
  table: Table2,
  milestones: Flag,
  lookahead: CalendarRange,
  progress: TableProperties,
  portfolio: Briefcase,
  banner: Heading,
  text: Type,
  image: ImageIcon,
  slicer: ListFilter,
};
function WidgetIcon({ kind }: { kind: WidgetKind }) {
  const I = KIND_ICON[kind] ?? Hash;
  return (
    <span className="w-icon">
      <I size={16} strokeWidth={1.8} aria-hidden />
    </span>
  );
}

function PageSettings({ dash, onChange }: { dash: Dashboard; onChange: (d: Dashboard) => void }) {
  const pg = dash.page ?? {};
  const set = (p: Partial<NonNullable<Dashboard["page"]>>) => onChange({ ...dash, page: { ...pg, ...p } });
  const logoRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  return (
    <div className="form-grid insp-body">
      <label className="span-all">
        Theme
        <Seg
          value={dash.theme ?? "classic"}
          onChange={(v) => onChange({ ...dash, theme: v })}
          options={[
            { v: "classic", label: "Stratum" },
            { v: "report", label: "EPC report" },
            { v: "executive", label: "Executive" },
          ]}
        />
      </label>
      <label className="span-all">
        Main colour
        <ColorPick value={pg.accent} onChange={(v) => set({ accent: v })} />
      </label>
      <label className="span-all">
        Page background
        <ColorPick value={pg.background} onChange={(v) => set({ background: v })} options={BACKGROUNDS} />
      </label>
      <label className="span-all">
        Cards
        <Seg
          value={pg.border ?? "card"}
          onChange={(v) => set({ border: v })}
          options={[
            { v: "card", label: "Card" },
            { v: "line", label: "Outline" },
            { v: "none", label: "Flat" },
          ]}
        />
      </label>
      <label className="span-all">
        Spacing {pg.gap ?? 12}px
        <input type="range" min={0} max={28} step={2} value={pg.gap ?? 12} onChange={(e) => set({ gap: Number(e.target.value) })} />
      </label>
      <label className="span-all">
        Header
        <input value={pg.header ?? ""} onChange={(e) => set({ header: e.target.value })} placeholder="{project}" />
      </label>
      <label className="span-all">
        Subtitle
        <input value={pg.subtitle ?? ""} onChange={(e) => set({ subtitle: e.target.value })} placeholder="Monthly progress report · data date {datadate}" />
      </label>
      <label className="check span-all">
        <input type="checkbox" checked={!!pg.showDataDate} onChange={(e) => set({ showDataDate: e.target.checked })} /> Show the data date at top right
      </label>
      <div className="span-all">
        <span className="muted">Company logo</span>
        <div className="row">
          {pg.logo && <img src={pg.logo} alt="Logo" className="logo-preview" />}
          <button onClick={() => logoRef.current?.click()}>{pg.logo ? "Change…" : "Choose image…"}</button>
          {pg.logo && <button onClick={() => set({ logo: undefined })}>Remove</button>}
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = await fileToDataUrl(f, 600);
            if (url.length > 400_000) return setErr("That image is too large. Use one under 300 kB.");
            setErr("");
            set({ logo: url });
          }}
        />
        {err && <p className="bad">{err}</p>}
      </div>
      <label className="span-all">
        Footer
        <input value={pg.footer ?? ""} onChange={(e) => set({ footer: e.target.value })} placeholder="Company · Confidential" />
      </label>
      <label className="span-all">
        PDF page
        <Seg
          value={pg.orientation ?? "landscape"}
          onChange={(v) => set({ orientation: v })}
          options={[
            { v: "landscape", label: "A4 landscape" },
            { v: "portrait", label: "A4 portrait" },
          ]}
        />
      </label>
      <p className="muted span-all">
        Placeholders: {"{project}"}, {"{datadate}"}. These settings also apply to the PDF that email schedules send.
      </p>
    </div>
  );
}

/** Read an image file as a data URL, scaling raster images down to maxPx. */
async function fileToDataUrl(f: File, maxPx: number): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
  if (f.type === "image/svg+xml") return raw;
  const img = new Image();
  await new Promise((res, rej) => ((img.onload = res), (img.onerror = rej), (img.src = raw)));
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  if (k === 1 && raw.length < 300_000) return raw;
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(f.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.85);
}

function FilterSettings({ w, onChange, raw }: { w: Widget; onChange: (w: Widget) => void; raw: Schedule | null }) {
  const dims = dimensions(raw);
  const [dim, setDim] = useState(w.where?.[0]?.dimension ?? dims[0]?.value ?? "wbs1");
  const values = raw ? groupValues(raw, dim) : [];
  const sel = w.where?.find((x) => x.dimension === dim)?.values ?? [];
  const toggle = (v: string) => {
    const next = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v];
    const others = (w.where ?? []).filter((x) => x.dimension !== dim);
    const where = next.length ? [...others, { dimension: dim, values: next }] : others;
    onChange({ ...w, where: where.length ? where : undefined });
  };
  return (
    <div className="form-grid">
      <p className="muted span-all">Show only part of the project in this widget, whatever the slicer buttons say. Other widgets are not affected.</p>
      <label className="span-all">
        Filter by
        <select value={dim} onChange={(e) => setDim(e.target.value)}>
          {dims.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
              {w.where?.some((x) => x.dimension === d.value) ? " •" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="span-all chip-list">
        {values.map((v) => (
          <button key={v} className={`chip ${sel.includes(v) ? "on" : ""}`} onClick={() => toggle(v)}>
            {v}
          </button>
        ))}
        {!values.length && <span className="muted">Open the project to list its values.</span>}
      </div>
      {w.where?.length ? (
        <div className="span-all">
          <span className="muted">Active: </span>
          {w.where.map((x) => `${dims.find((d) => d.value === x.dimension)?.label ?? x.dimension} = ${x.values.join(", ")}`).join("; ")}{" "}
          <button className="link" onClick={() => onChange({ ...w, where: undefined })}>
            clear
          </button>
        </div>
      ) : null}
      <label className="check span-all">
        <input type="checkbox" checked={!!w.ignoreSlicers} onChange={(e) => onChange({ ...w, ignoreSlicers: e.target.checked || undefined })} /> Ignore the dashboard&apos;s slicer buttons
      </label>
    </div>
  );
}

function WidgetSettings({ w, onChange, projects, raw }: { w: Widget; onChange: (w: Widget) => void; projects: ProjectSummary[]; raw: Schedule | null }) {
  const dims = dimensions(raw);
  const groups = raw && (w.kind === "progress" || w.kind === "slicer" || w.kind === "groupbars") ? groupValues(raw, w.dimension ?? "wbs1") : [];
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const imgRef = useRef<HTMLInputElement>(null);
  return (
    <div className="form-grid">
      <label className="span-all">
        Title
        <input value={w.title} onChange={(e) => onChange({ ...w, title: e.target.value })} />
      </label>
      <label>
        Type
        <select value={w.kind} onChange={(e) => onChange({ ...w, kind: e.target.value as WidgetKind, ...structuredClone(WIDGET_KINDS.find((k) => k.kind === e.target.value)?.defaults ?? {}), w: w.w, h: w.h, title: w.title })}>
          {WIDGET_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {!["text", "portfolio", "image", "banner"].includes(w.kind) && (
        <label>
          Project
          <select value={w.projectId ?? ""} onChange={(e) => onChange({ ...w, projectId: e.target.value || null })}>
            <option value="">Dashboard&apos;s project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
      )}
      {(w.kind === "kpi" || w.kind === "gauge") && (
        <label>
          Measure
          <select value={w.metric} onChange={(e) => onChange({ ...w, metric: e.target.value as KpiMetric })}>
            {(Object.keys(KPI_LABELS) as KpiMetric[])
              .filter((k) => w.kind === "kpi" || !["finish", "dataDate", "finishVariance"].includes(k))
              .map((k) => (
                <option key={k} value={k}>
                  {KPI_LABELS[k]}
                </option>
              ))}
          </select>
        </label>
      )}
      {(w.kind === "kpi" || w.kind === "scurve" || w.kind === "gauge") && (
        <label>
          Values in
          <select value={w.measure ?? "cost"} onChange={(e) => onChange({ ...w, measure: e.target.value as "cost" | "hours" })}>
            <option value="cost">Cost</option>
            <option value="hours">Labour hours</option>
          </select>
        </label>
      )}
      {(w.kind === "kpi" || w.kind === "gauge") && !["finish", "dataDate", "finishVariance"].includes(w.metric ?? "") && (
        <>
          <label>
            Decimals
            <select value={w.decimals ?? ""} onChange={(e) => onChange({ ...w, decimals: num(e.target.value) })}>
              <option value="">Auto</option>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prefix / suffix
            <span className="row">
              <input value={w.prefix ?? ""} onChange={(e) => onChange({ ...w, prefix: e.target.value || undefined })} placeholder="AED " style={{ width: "50%" }} />
              <input value={w.suffix ?? ""} onChange={(e) => onChange({ ...w, suffix: e.target.value || undefined })} placeholder=" h" style={{ width: "50%" }} />
            </span>
          </label>
          <label>
            Green at
            <input type="number" step="any" value={w.good ?? ""} onChange={(e) => onChange({ ...w, good: num(e.target.value) })} placeholder={w.metric === "percentComplete" ? "e.g. 45 (%)" : "e.g. 1.0"} />
          </label>
          <label>
            Red at
            <input type="number" step="any" value={w.bad ?? ""} onChange={(e) => onChange({ ...w, bad: num(e.target.value) })} placeholder={w.metric === "percentComplete" ? "e.g. 40 (%)" : "e.g. 0.9"} />
          </label>
          <p className="muted span-all">Green when the value reaches “Green at”, red past “Red at”, amber between. Put the smaller number in “Green at” when lower is better.</p>
        </>
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
          <ColumnsEditor w={w} onChange={onChange} raw={raw} />
        </>
      )}
      {(w.kind === "table" || w.kind === "milestones" || w.kind === "lookahead") && (
        <label>
          Max rows
          <input type="number" min={1} max={500} value={w.limit ?? ""} placeholder="All" onChange={(e) => onChange({ ...w, limit: num(e.target.value) })} />
        </label>
      )}
      {(w.filter === "starting-soon" || w.filter === "finishing-soon" || w.metric === "startingSoon") && (
        <label>
          Window (days)
          <input type="number" min={1} value={w.days ?? 14} onChange={(e) => onChange({ ...w, days: Number(e.target.value) || 14 })} />
        </label>
      )}
      {w.kind === "milestones" && (
        <>
          <label>
            “At risk” under (days float)
            <input type="number" min={0} value={w.days ?? 5} onChange={(e) => onChange({ ...w, days: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={!!w.showDone} onChange={(e) => onChange({ ...w, showDone: e.target.checked || undefined })} /> Include achieved
          </label>
        </>
      )}
      {w.kind === "lookahead" && (
        <label>
          Weeks ahead
          <select value={w.weeks ?? 3} onChange={(e) => onChange({ ...w, weeks: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {w.kind === "donut" && (
        <label>
          Split by
          <select value={w.split ?? "status"} onChange={(e) => onChange({ ...w, split: e.target.value as Widget["split"] })}>
            <option value="status">Progress status</option>
            <option value="float">Total float bands</option>
            <option value="critical">Critical vs not critical</option>
          </select>
        </label>
      )}
      {w.kind === "quantity" && (
        <label>
          Quantity property
          <input value={w.quantityKey ?? "BaseQuantities.NetVolume"} onChange={(e) => onChange({ ...w, quantityKey: e.target.value })} />
        </label>
      )}
      {(w.kind === "progress" || w.kind === "slicer" || w.kind === "groupbars" || w.kind === "phasecurves") && (
        <label>
          {w.kind === "phasecurves" ? "One curve per" : "Group by"}
          <select value={w.dimension ?? "wbs1"} onChange={(e) => onChange({ ...w, dimension: e.target.value, weightage: undefined })}>
            {dims.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(w.kind === "progress" || w.kind === "pscurve" || w.kind === "groupbars" || w.kind === "phasecurves" || (w.kind === "gauge" && w.metric === "percentComplete")) && (
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
      {(w.kind === "pscurve" || w.kind === "phasecurves") && (
        <label>
          Period
          <select value={w.step ?? "month"} onChange={(e) => onChange({ ...w, step: e.target.value as "month" | "week" })}>
            <option value="month">Monthly</option>
            <option value="week">Weekly</option>
          </select>
        </label>
      )}
      {(w.kind === "progress" || w.kind === "groupbars") && (
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
          <textarea rows={5} value={w.text ?? ""} onChange={(e) => onChange({ ...w, text: e.target.value })} />
          <small className="muted">Placeholders: {"{project}"}, {"{datadate}"}</small>
        </label>
      )}
      {w.kind === "image" && (
        <div className="span-all">
          <div className="row">
            {w.image && <img src={w.image} alt="" className="logo-preview" />}
            <button onClick={() => imgRef.current?.click()}>{w.image ? "Change image…" : "Choose image…"}</button>
            <select value={w.fit ?? "contain"} onChange={(e) => onChange({ ...w, fit: e.target.value as "contain" | "cover" })}>
              <option value="contain">Fit inside</option>
              <option value="cover">Fill the card</option>
            </select>
          </div>
          <input
            ref={imgRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) onChange({ ...w, image: await fileToDataUrl(f, 1200) });
            }}
          />
        </div>
      )}
    </div>
  );
}

function ColumnsEditor({ w, onChange, raw }: { w: Widget; onChange: (w: Widget) => void; raw: Schedule | null }) {
  const cols = w.columns?.length ? w.columns : DEFAULT_COLUMNS;
  const extra: { id: TableColumn; label: string }[] = dimensions(raw).map((d) => ({ id: `dim:${d.value}` as TableColumn, label: d.label }));
  const all = [...TABLE_COLUMNS, ...extra.filter((e) => !TABLE_COLUMNS.some((t) => t.id === e.id))];
  const set = (c: TableColumn[]) => onChange({ ...w, columns: c });
  const mv = (i: number, d: number) => {
    const c = [...cols];
    const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    set(c);
  };
  return (
    <div className="span-all cols-editor">
      <b>Columns</b> <span className="muted">(click a heading in the table to sort)</span>
      <ol>
        {cols.map((c, i) => (
          <li key={c}>
            <span>{columnLabel(c)}</span>
            <button className="icon-only" onClick={() => mv(i, -1)} title="Move left" disabled={!i}>
              ↑
            </button>
            <button className="icon-only" onClick={() => mv(i, 1)} title="Move right" disabled={i === cols.length - 1}>
              ↓
            </button>
            <button className="icon-only" onClick={() => set(cols.filter((x) => x !== c))} title="Remove column" disabled={cols.length < 2}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <select value="" onChange={(e) => e.target.value && set([...cols, e.target.value as TableColumn])}>
        <option value="">+ Add column…</option>
        {all
          .filter((c) => !cols.includes(c.id))
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
      </select>
      <label>
        Default sort
        <span className="row">
          <select value={w.sort?.by ?? ""} onChange={(e) => onChange({ ...w, sort: e.target.value ? { by: e.target.value as TableColumn, desc: w.sort?.desc } : undefined })}>
            <option value="">Schedule order</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                {columnLabel(c)}
              </option>
            ))}
          </select>
          <select value={w.sort?.desc ? "desc" : "asc"} disabled={!w.sort} onChange={(e) => w.sort && onChange({ ...w, sort: { ...w.sort, desc: e.target.value === "desc" } })}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </span>
      </label>
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
