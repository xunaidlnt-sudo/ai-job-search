import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { InterfaceMode } from "../core/reporting";
import { activityDates, scheduleRange } from "../core/simulation";
import type { Activity, Relationship } from "../core/types";
import { buildGanttRows, type GanttRow } from "../core/wbs";
import { useConfig } from "../backend/config";
import { DAY, fmtDate, useStore } from "./store";
import { useTerms, type Terms } from "./terms";

const ROW = 24;

interface ColCtx {
  a: Activity;
  start: number | null;
  finish: number | null;
  hpd: number;
  rowNo: Map<string, number>;
  preds: Relationship[];
  linkCount: number;
}

interface Col {
  key: string;
  label: string;
  width: number;
  title?: string;
  render: (c: ColCtx) => ReactNode;
  className?: (c: ColCtx) => string;
}

const days = (h: number | null | undefined, hpd: number) => (h === null || h === undefined ? "" : String(Math.round((h / hpd) * 10) / 10));

export type GanttCommand = "zoom-in" | "zoom-out" | "fit" | "find";
export const ganttCommand = (c: GanttCommand) => window.dispatchEvent(new CustomEvent<GanttCommand>("stratum:gantt", { detail: c }));

function columnsFor(mode: InterfaceMode, t: Terms): Col[] {
  const tf: Col = {
    key: "tf",
    label: mode === "msp" ? "Slack" : "TF",
    width: 40,
    title: `${t.totalFloat} (days)`,
    render: (c) => days(c.a.totalFloatHours, c.hpd),
    className: (c) => (c.a.totalFloatHours !== null && c.a.totalFloatHours < 0 ? "bad" : ""),
  };
  const start: Col = { key: "start", label: "Start", width: 78, render: (c) => fmtDate(c.start) };
  const finish: Col = { key: "finish", label: "Finish", width: 78, render: (c) => fmtDate(c.finish) };
  const pct: Col = { key: "pct", label: "%", width: 38, title: t.percentComplete, render: (c) => Math.round(c.a.percentComplete) };
  if (mode === "p6") {
    return [
      { key: "code", label: t.activityId, width: 82, render: (c) => c.a.code },
      { key: "name", label: t.activityName, width: 170, render: (c) => c.a.name },
      { key: "od", label: "Orig Dur", width: 50, title: `${t.originalDuration} (days)`, render: (c) => days(c.a.originalDurationHours, c.hpd) },
      start,
      finish,
      tf,
      pct,
    ];
  }
  if (mode === "msp") {
    const rel = (r: Relationship, c: ColCtx) => {
      const n = c.rowNo.get(r.predecessorId);
      if (n === undefined) return "";
      const lag = r.lagHours ? `${r.lagHours > 0 ? "+" : ""}${days(r.lagHours, c.hpd)} days` : "";
      return r.type === "FS" && !lag ? String(n) : `${n}${r.type}${lag}`;
    };
    return [
      { key: "id", label: t.activityId, width: 34, render: (c) => c.rowNo.get(c.a.id) ?? "" },
      { key: "name", label: t.activityName, width: 180, render: (c) => c.a.name },
      { key: "dur", label: "Duration", width: 68, render: (c) => (c.a.originalDurationHours === null ? "" : `${days(c.a.originalDurationHours, c.hpd)} days`) },
      start,
      finish,
      { key: "pred", label: t.predecessors, width: 76, render: (c) => c.preds.map((r) => rel(r, c)).filter(Boolean).join(",") },
    ];
  }
  return [
    { key: "code", label: t.activityId, width: 76, render: (c) => c.a.code },
    { key: "name", label: "Name", width: 160, render: (c) => c.a.name },
    start,
    finish,
    pct,
    tf,
    { key: "links", label: "🔗", width: 28, title: "Linked elements", render: (c) => c.linkCount || "" },
  ];
}

export function Gantt() {
  const schedule = useStore((s) => s.schedule);
  const sim = useStore((s) => s.sim);
  const time = useStore((s) => s.time);
  const links = useStore((s) => s.links);
  const collapsed = useStore((s) => s.collapsedWbs);
  const toggleWbs = useStore((s) => s.toggleWbs);
  const selectedActivity = useStore((s) => s.selectedActivity);
  const selectActivity = useStore((s) => s.selectActivity);
  const selectElements = useStore((s) => s.selectElements);
  const setTime = useStore((s) => s.setTime);
  const mode = useConfig((s) => s.config.mode);
  const t = useTerms();
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  // Commands from the P6 command bar and other shortcuts.
  useEffect(() => {
    const on = (e: Event) => {
      const action = (e as CustomEvent<GanttCommand>).detail;
      if (action === "zoom-in") setZoom((z) => Math.min(40, z * 1.5));
      else if (action === "zoom-out") setZoom((z) => Math.max(0.25, z / 1.5));
      else if (action === "fit") setZoom(1);
      else if (action === "find") filterRef.current?.focus();
    };
    window.addEventListener("stratum:gantt", on);
    return () => window.removeEventListener("stratum:gantt", on);
  }, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Widths are set for 12 px text; scale them with the chosen text size and font.
  const fontSize = useConfig((st) => st.config.fontSize);
  const font = useConfig((st) => st.config.font);
  const widthScale = ((fontSize - 1) / 12) * (font === "mono" ? 1.18 : font === "nunito" || font === "plex" ? 1.04 : 1);
  const cols = useMemo(() => columnsFor(mode, t).map((c) => ({ ...c, width: Math.round(c.width * widthScale) })), [mode, t, widthScale]);
  const COLS = cols.reduce((s, c) => s + c.width, 0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight);
      setWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  const allRows = useMemo<GanttRow[]>(() => (schedule ? buildGanttRows(schedule, sim.dateSource, collapsed) : []), [schedule, sim.dateSource, collapsed]);
  const rows = useMemo<GanttRow[]>(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return allRows;
    return allRows.filter((r) => r.kind === "activity" && `${r.activity.code} ${r.activity.name}`.toLowerCase().includes(f));
  }, [allRows, filter]);
  // MS Project numbers every row (summaries included); predecessors refer to those numbers.
  const rowNo = useMemo(() => {
    const m = new Map<string, number>();
    allRows.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [allRows]);
  const predsOf = useMemo(() => {
    const m = new Map<string, Relationship[]>();
    for (const r of schedule?.relationships ?? []) (m.get(r.successorId) ?? m.set(r.successorId, []).get(r.successorId)!).push(r);
    return m;
  }, [schedule]);

  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.activityId, (m.get(l.activityId) ?? 0) + 1);
    return m;
  }, [links]);

  const range = useMemo(() => (schedule ? scheduleRange(schedule, sim.dateSource) : null), [schedule, sim.dateSource]);
  const hpd = schedule?.calendars?.find((c) => c.id === schedule.defaultCalendarId)?.hoursPerDay ?? 8;

  if (!schedule || !range) return <div className="empty">No schedule loaded.</div>;

  const origin = range.start - 7 * DAY;
  const totalDays = Math.ceil((range.finish - origin) / DAY) + 14;
  // Fit the whole schedule into the visible bar area at zoom 1.
  const PX_PER_DAY = Math.max(0.5, ((width - COLS - 16) / totalDays) * zoom);
  const x = (tt: number) => ((tt - origin) / DAY) * PX_PER_DAY;
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 5);

  const months: { t: number; label: string }[] = [];
  const d0 = new Date(origin);
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)); m.getTime() < origin + totalDays * DAY; m.setUTCMonth(m.getUTCMonth() + 1)) {
    months.push({ t: m.getTime(), label: m.toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
  }

  // Click picks the activity and keeps the 3D selection, so elements can be selected first and then linked.
  // Alt-click also selects the elements already linked to it.
  const onActivity = (id: string, withElements: boolean) => {
    selectActivity(id);
    if (withElements) selectElements(new Set(links.filter((l) => l.activityId === id).map((l) => l.elementId)));
  };
  const nameSpan = cols.slice(0, cols.findIndex((c) => c.key === "name") + 1).reduce((s, c) => s + c.width, 0);
  const afterName = cols.slice(cols.findIndex((c) => c.key === "name") + 1);

  return (
    <div className={`gantt gantt-${mode}`}>
      <div className="gantt-toolbar">
        <input ref={filterRef} placeholder={`Filter ${t.activities.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">
          {schedule.activities.length} {t.activities.toLowerCase()}
        </span>
        <button title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))}>
          −
        </button>
        <button title="Fit" onClick={() => setZoom(1)}>
          Fit
        </button>
        <button title="Zoom in" onClick={() => setZoom((z) => Math.min(40, z * 1.5))}>
          +
        </button>
      </div>
      <div className="gantt-body" ref={bodyRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="gantt-grid" style={{ height: rows.length * ROW + ROW, width: COLS + totalDays * PX_PER_DAY }}>
          <div className="gantt-head" style={{ width: COLS + totalDays * PX_PER_DAY }}>
            <div className="gantt-cols" style={{ width: COLS }}>
              {cols.map((c) => (
                <span key={c.key} style={{ width: c.width }} title={c.title}>
                  {c.label}
                </span>
              ))}
            </div>
            <div className="gantt-scale" style={{ left: COLS }}>
              {months
                .filter((_, i) => PX_PER_DAY * 30 >= 48 || i % Math.ceil(48 / (PX_PER_DAY * 30)) === 0)
                .map((m) => (
                  <span key={m.t} style={{ left: x(m.t) }}>
                    {m.label}
                  </span>
                ))}
            </div>
          </div>
          <div className="gantt-now" style={{ left: COLS + x(time), height: rows.length * ROW + ROW }} />
          {schedule.dataDate !== null && (
            <div className="gantt-datadate" title={`${t.dataDate} ${fmtDate(schedule.dataDate)}`} style={{ left: COLS + x(schedule.dataDate), height: rows.length * ROW + ROW }} />
          )}
          {rows.slice(first, last).map((r, i) => {
            const top = ROW + (first + i) * ROW;
            if (r.kind === "wbs") {
              return (
                <div key={`w${r.id}`} className="gantt-row wbs" style={{ top }} onClick={() => toggleWbs(r.id)}>
                  <div className="gantt-cols" style={{ width: COLS }}>
                    <span style={{ width: nameSpan, paddingLeft: 6 + r.depth * 12 }}>
                      {mode === "msp" ? `${rowNo.get(r.id) ?? ""} ` : ""}
                      {collapsed.has(r.id) ? "▸" : "▾"} {r.label}
                    </span>
                    {afterName.map((c) => (
                      <span key={c.key} style={{ width: c.width }}>
                        {c.key === "start" ? fmtDate(r.start) : c.key === "finish" ? fmtDate(r.finish) : ""}
                      </span>
                    ))}
                  </div>
                  {r.start !== null && r.finish !== null && <div className="bar summary" style={{ left: COLS + x(r.start), width: Math.max(2, x(r.finish) - x(r.start)) }} />}
                </div>
              );
            }
            const a = r.activity;
            const d = activityDates(a, sim.dateSource);
            const isMs = a.type === "milestone" || a.type === "finish-milestone";
            const ctx: ColCtx = { a, start: d.start, finish: d.finish, hpd, rowNo, preds: predsOf.get(a.id) ?? [], linkCount: linkCount.get(a.id) ?? 0 };
            const cls = ["gantt-row", selectedActivity === a.id ? "selected" : ""].join(" ");
            return (
              <div key={a.id} className={cls} style={{ top }} onClick={(e) => onActivity(a.id, e.altKey)} onDoubleClick={() => d.start !== null && setTime(d.start)}>
                <div className="gantt-cols" style={{ width: COLS }}>
                  {cols.map((c, k) => (
                    <span
                      key={c.key}
                      style={{ width: c.width, paddingLeft: k === 0 && mode !== "msp" ? 6 + r.depth * 12 : c.key === "name" && mode === "msp" ? 4 + r.depth * 12 : undefined }}
                      className={c.className?.(ctx)}
                      title={c.key === "name" ? a.name : undefined}
                    >
                      {c.render(ctx)}
                    </span>
                  ))}
                </div>
                {a.baselineStart !== null && a.baselineFinish !== null && (
                  <div className="bar baseline" style={{ left: COLS + x(a.baselineStart), width: Math.max(2, x(a.baselineFinish) - x(a.baselineStart)) }} />
                )}
                {d.start !== null &&
                  d.finish !== null &&
                  (isMs ? (
                    <div className={`milestone ${a.critical ? "critical" : ""}`} style={{ left: COLS + x(d.start) - 6 }} />
                  ) : (
                    <div className={`bar ${a.critical ? "critical" : ""} ${a.status}`} style={{ left: COLS + x(d.start), width: Math.max(2, x(d.finish) - x(d.start)) }}>
                      <div className="bar-progress" style={{ width: `${a.percentComplete}%` }} />
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
