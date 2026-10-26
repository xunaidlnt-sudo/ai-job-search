// Activity table + Gantt chart, drawn the way each layout's original draws it:
//  - P6: Classic Schedule Layout columns, WBS bands, actual (blue) / remaining
//    (green, red when critical) bars, "A" after actual dates.
//  - MS Project: row numbers, indicator and task-mode columns, blue task bars
//    with a progress line, black summary brackets, milestone dates and
//    resource names beside the bars.
//  - 4D: compact table with linked-element counts and a playback line.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConfig } from "../backend/config";
import { MONTHS, WEEKDAYS, monthShort } from "../core/dates";
import type { InterfaceMode } from "../core/reporting";
import { activityDates, scheduleRange } from "../core/simulation";
import type { Activity, Relationship } from "../core/types";
import { buildGanttRows, type GanttRow } from "../core/wbs";
import { DAY, fmtDate, useStore, type GanttFilterKind } from "./store";
import { useTerms, type Terms } from "./terms";

interface ColCtx {
  a: Activity;
  start: number | null;
  finish: number | null;
  hpd: number;
  rowNo: Map<string, number>;
  preds: Relationship[];
  linkCount: number;
  resources: string;
}

interface Col {
  key: string;
  label: ReactNode;
  width: number;
  title?: string;
  align?: "right" | "center";
  render: (c: ColCtx) => ReactNode;
  className?: (c: ColCtx) => string;
}

const days = (h: number | null | undefined, hpd: number) => (h === null || h === undefined ? "" : String(Math.round((h / hpd) * 10) / 10));
const mspDate = (t: number | null) => {
  if (t === null) return "";
  const d = new Date(t);
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
};
/** MS Project writes "1 day" but "0 days" and "15 days". */
const dayWord = (n: string) => `${n} ${n === "1" ? "day" : "days"}`;
/** P6 marks actual dates with "A". */
const p6Start = (c: ColCtx) => (c.start === null ? "" : `${fmtDate(c.start)}${c.a.actualStart !== null && c.a.status !== "not-started" ? " A" : ""}`);
const p6Finish = (c: ColCtx) => (c.finish === null ? "" : `${fmtDate(c.finish)}${c.a.status === "complete" ? " A" : ""}`);

export type GanttCommand = "zoom-in" | "zoom-out" | "fit" | "find" | "scroll-to-selected";
export const ganttCommand = (c: GanttCommand) => window.dispatchEvent(new CustomEvent<GanttCommand>("stratum:gantt", { detail: c }));

/** Small "auto scheduled" task-mode glyph, as MS Project shows it. */
const TaskModeIcon = () => (
  <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden className="taskmode">
    <rect x="1" y="3" width="10" height="4" fill="currentColor" />
    <path d="M11 1 L15 5 L11 9 Z" fill="currentColor" />
  </svg>
);

function columnsFor(mode: InterfaceMode, t: Terms): Col[] {
  if (mode === "p6") {
    return [
      { key: "code", label: "Activity ID", width: 88, render: (c) => c.a.code },
      { key: "name", label: "Activity Name", width: 220, render: (c) => c.a.name },
      { key: "od", label: <>Original<br />Duration</>, width: 58, align: "right", render: (c) => days(c.a.originalDurationHours, c.hpd) },
      { key: "rd", label: <>Remaining<br />Duration</>, width: 64, align: "right", render: (c) => days(c.a.remainingDurationHours, c.hpd) },
      { key: "pct", label: <>Schedule %<br />Complete</>, width: 66, align: "right", render: (c) => `${Math.round(c.a.percentComplete)}%` },
      { key: "start", label: "Start", width: 88, render: p6Start },
      { key: "finish", label: "Finish", width: 88, render: p6Finish },
      {
        key: "tf",
        label: <>Total<br />Float</>,
        width: 46,
        align: "right",
        render: (c) => days(c.a.totalFloatHours, c.hpd),
        className: (c) => (c.a.totalFloatHours !== null && c.a.totalFloatHours < 0 ? "bad" : ""),
      },
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
      { key: "rowno", label: "", width: 34, align: "right", render: (c) => c.rowNo.get(c.a.id) ?? "" },
      { key: "ind", label: <span title="Indicators">ⓘ</span>, width: 24, align: "center", render: (c) => (c.a.status === "complete" ? <span className="ind-done" title="This task was completed">✔</span> : "") },
      { key: "mode", label: <span title="Task Mode"><TaskModeIcon /></span>, width: 30, align: "center", render: () => <TaskModeIcon /> },
      { key: "name", label: "Task Name", width: 230, render: (c) => c.a.name },
      { key: "dur", label: "Duration", width: 70, render: (c) => (c.a.originalDurationHours === null ? "" : dayWord(days(c.a.originalDurationHours, c.hpd))) },
      { key: "start", label: "Start", width: 92, render: (c) => mspDate(c.start) },
      { key: "finish", label: "Finish", width: 92, render: (c) => mspDate(c.finish) },
      { key: "pred", label: t.predecessors, width: 90, render: (c) => c.preds.map((r) => rel(r, c)).filter(Boolean).join(",") },
      { key: "res", label: "Resource Names", width: 150, render: (c) => c.resources },
      { key: "add", label: <span className="add-col">Add New Column ▾</span>, width: 112, render: () => "" },
    ];
  }
  const start: Col = { key: "start", label: "Start", width: 78, render: (c) => fmtDate(c.start) };
  const finish: Col = { key: "finish", label: "Finish", width: 78, render: (c) => fmtDate(c.finish) };
  return [
    { key: "code", label: t.activityId, width: 86, render: (c) => c.a.code },
    { key: "name", label: "Name", width: 160, render: (c) => c.a.name },
    start,
    finish,
    { key: "pct", label: "%", width: 38, title: t.percentComplete, render: (c) => Math.round(c.a.percentComplete) },
    {
      key: "tf",
      label: "TF",
      width: 40,
      title: `${t.totalFloat} (days)`,
      render: (c) => days(c.a.totalFloatHours, c.hpd),
      className: (c) => (c.a.totalFloatHours !== null && c.a.totalFloatHours < 0 ? "bad" : ""),
    },
    { key: "links", label: "🔗", width: 28, title: "Linked elements", render: (c) => c.linkCount || "" },
  ];
}

function passesFilter(a: Activity, kind: GanttFilterKind): boolean {
  switch (kind) {
    case "critical":
      return a.critical;
    case "not-started":
    case "in-progress":
    case "complete":
      return a.status === kind;
    case "late":
      return a.baselineFinish !== null && a.finish !== null && a.finish > a.baselineFinish + DAY / 2;
    case "milestones":
      return a.type === "milestone" || a.type === "finish-milestone";
    default:
      return true;
  }
}

interface Tier {
  t: number;
  end: number;
  label: string;
}

/** Two-row timescale like P6 and MS Project: the unit adapts to the zoom. */
function timescale(origin: number, end: number, pxPerDay: number, mode: InterfaceMode): { top: Tier[]; bottom: Tier[] } {
  const top: Tier[] = [];
  const bottom: Tier[] = [];
  const y0 = new Date(origin).getUTCFullYear();
  if (pxPerDay * 7 >= 34) {
    // months over weeks
    for (let m = new Date(Date.UTC(y0, new Date(origin).getUTCMonth(), 1)); m.getTime() < end; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const n = new Date(m);
      n.setUTCMonth(n.getUTCMonth() + 1);
      top.push({ t: m.getTime(), end: n.getTime(), label: mode === "msp" ? `${monthShort(m)} '${String(m.getUTCFullYear()).slice(2)}` : `${monthShort(m)} ${m.getUTCFullYear()}` });
    }
    const first = new Date(origin);
    const toMon = (first.getUTCDay() + 6) % 7;
    for (let w = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() - toMon); w < end; w += 7 * DAY) {
      const d = new Date(w);
      bottom.push({ t: w, end: w + 7 * DAY, label: mode === "msp" ? `${String(d.getUTCDate()).padStart(2, "0")} ${monthShort(d)}` : String(d.getUTCDate()).padStart(2, "0") });
    }
  } else if (pxPerDay * 30 >= 22) {
    // years over months
    const narrow = pxPerDay * 30 < 30;
    for (let y = y0; Date.UTC(y, 0, 1) < end; y++) top.push({ t: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1), label: String(y) });
    for (let m = new Date(Date.UTC(y0, new Date(origin).getUTCMonth(), 1)); m.getTime() < end; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const n = new Date(m);
      n.setUTCMonth(n.getUTCMonth() + 1);
      bottom.push({ t: m.getTime(), end: n.getTime(), label: narrow ? MONTHS[m.getUTCMonth()][0] : monthShort(m) });
    }
  } else {
    for (let y = y0; Date.UTC(y, 0, 1) < end; y++) {
      top.push({ t: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1), label: String(y) });
      for (let q = 0; q < 4; q++) bottom.push({ t: Date.UTC(y, q * 3, 1), end: Date.UTC(y, q * 3 + 3, 1), label: `Q${q + 1}` });
    }
  }
  return { top, bottom };
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
  const ganttFilter = useStore((s) => s.ganttFilter);
  const setGanttFilter = useStore((s) => s.setGanttFilter);
  const tracking = useStore((s) => s.ganttTracking);
  const mode = useConfig((s) => s.config.mode);
  const classic = mode !== "4d";
  const ROW = classic ? 20 : 24;
  const HEAD = classic ? 36 : 24;
  const t = useTerms();
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const filterRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const fontSize = useConfig((st) => st.config.fontSize);
  const font = useConfig((st) => st.config.font);
  // Widths are set for 12 px text; scale them with the chosen text size and font.
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
    const f = ganttFilter.text.trim().toLowerCase();
    if (!f && ganttFilter.kind === "all") return allRows;
    const keep = allRows.filter((r) => r.kind === "activity" && passesFilter(r.activity, ganttFilter.kind) && (!f || `${r.activity.code} ${r.activity.name}`.toLowerCase().includes(f)));
    if (!classic) return keep;
    // P6 and MS Project keep the WBS / summary rows above filtered activities.
    const needed = new Set<string>();
    const parentOf = new Map(schedule!.wbs.map((w) => [w.id, w.parentId]));
    for (const r of keep) for (let w = (r as Extract<GanttRow, { kind: "activity" }>).activity.wbsId; w; w = parentOf.get(w) ?? null) needed.add(w);
    const ids = new Set(keep.map((r) => r.id));
    return allRows.filter((r) => (r.kind === "wbs" ? needed.has(r.id) : ids.has(r.id)));
  }, [allRows, ganttFilter, classic, schedule]);

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
  const resourcesOf = useMemo(() => {
    const names = new Map((schedule?.resources ?? []).map((r) => [r.id, r.name]));
    const m = new Map<string, string[]>();
    for (const a of schedule?.assignments ?? []) {
      const n = names.get(a.resourceId);
      if (n) (m.get(a.activityId) ?? m.set(a.activityId, []).get(a.activityId)!).push(n);
    }
    return m;
  }, [schedule]);
  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.activityId, (m.get(l.activityId) ?? 0) + 1);
    return m;
  }, [links]);

  const range = useMemo(() => (schedule ? scheduleRange(schedule, sim.dateSource) : null), [schedule, sim.dateSource]);
  const hpd = schedule?.calendars?.find((c) => c.id === schedule.defaultCalendarId)?.hoursPerDay ?? 8;

  const origin = range ? range.start - 14 * DAY : 0;
  const totalDays = range ? Math.ceil((range.finish - origin) / DAY) + 28 : 0;
  // Fit the whole schedule into the visible bar area at zoom 1.
  const PX_PER_DAY = Math.max(0.3, ((width - COLS - 16) / Math.max(1, totalDays)) * zoom);
  const x = (tt: number) => ((tt - origin) / DAY) * PX_PER_DAY;

  // Commands from the P6 command bar, the MS Project ribbon and shortcuts.
  const scrollTo = useRef<() => void>(() => {});
  scrollTo.current = () => {
    const i = rows.findIndex((r) => r.id === selectedActivity);
    const el = bodyRef.current;
    if (i < 0 || !el || !schedule) return;
    const a = schedule.activities.find((y) => y.id === selectedActivity);
    el.scrollTop = Math.max(0, i * ROW - el.clientHeight / 3);
    const d = a ? activityDates(a, sim.dateSource) : null;
    if (d?.start != null) el.scrollLeft = Math.max(0, x(d.start) - 60);
  };
  useEffect(() => {
    const on = (e: Event) => {
      const action = (e as CustomEvent<GanttCommand>).detail;
      if (action === "zoom-in") setZoom((z) => Math.min(60, z * 1.5));
      else if (action === "zoom-out") setZoom((z) => Math.max(0.25, z / 1.5));
      else if (action === "fit") setZoom(1);
      else if (action === "find") filterRef.current?.focus();
      else if (action === "scroll-to-selected") scrollTo.current();
    };
    window.addEventListener("stratum:gantt", on);
    return () => window.removeEventListener("stratum:gantt", on);
  }, []);

  if (!schedule || !range) return <div className="empty">No schedule loaded.</div>;

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 5);
  const gridW = COLS + totalDays * PX_PER_DAY;
  const gridH = rows.length * ROW + HEAD;
  const scale = classic ? timescale(origin, origin + totalDays * DAY, PX_PER_DAY, mode) : null;
  const months: { t: number; label: string }[] = [];
  if (!classic) {
    const d0 = new Date(origin);
    for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)); m.getTime() < origin + totalDays * DAY; m.setUTCMonth(m.getUTCMonth() + 1)) {
      months.push({ t: m.getTime(), label: `${monthShort(m)} ${String(m.getUTCFullYear()).slice(2)}` });
    }
  }

  // Click picks the activity and keeps the 3D selection, so elements can be selected first and then linked.
  // Alt-click also selects the elements already linked to it.
  const onActivity = (id: string, withElements: boolean) => {
    selectActivity(id);
    if (withElements) selectElements(new Set(links.filter((l) => l.activityId === id).map((l) => l.elementId)));
  };
  const nameIdx = cols.findIndex((c) => c.key === "name");
  const nameSpan = cols.slice(0, nameIdx + 1).reduce((s, c) => s + c.width, 0);
  const afterName = cols.slice(nameIdx + 1);
  const dd = schedule.dataDate;

  /** P6 draws actual work blue up to the data date, remaining work green (red when critical). */
  const p6Bars = (a: Activity, s: number, f: number) => {
    const isMs = a.type === "milestone" || a.type === "finish-milestone";
    const crit = a.critical ? " crit" : "";
    if (isMs) return <div className={`p6-ms ${a.status === "complete" ? "done" : crit}`} style={{ left: COLS + x(s) - 6 }} />;
    const split = a.status === "complete" ? f : a.status === "in-progress" && dd !== null ? Math.min(Math.max(dd, s), f) : s;
    return (
      <>
        {split > s && <div className="p6-bar actual" style={{ left: COLS + x(s), width: Math.max(2, x(split) - x(s)) }} />}
        {f > split && <div className={`p6-bar remaining${crit}`} style={{ left: COLS + x(split), width: Math.max(2, x(f) - x(split)) }} />}
      </>
    );
  };

  /** MS Project: blue task bar with a dark progress line; milestone diamond with its date; resource names to the right. */
  const mspBars = (a: Activity, s: number, f: number, res: string) => {
    const isMs = a.type === "milestone" || a.type === "finish-milestone";
    const crit = tracking && a.critical ? " crit" : "";
    if (isMs) {
      const d = new Date(s);
      return (
        <>
          <div className={`msp-ms${crit}`} style={{ left: COLS + x(s) - 6 }} />
          <span className="msp-label" style={{ left: COLS + x(s) + 9 }}>
            {String(d.getUTCDate()).padStart(2, "0")}/{String(d.getUTCMonth() + 1).padStart(2, "0")}
          </span>
        </>
      );
    }
    return (
      <>
        <div className={`msp-bar${crit}`} style={{ left: COLS + x(s), width: Math.max(2, x(f) - x(s)) }}>
          <div className="msp-progress" style={{ width: `${a.percentComplete}%` }} />
        </div>
        {res && (
          <span className="msp-label" style={{ left: COLS + x(f) + 6 }}>
            {res}
          </span>
        )}
      </>
    );
  };

  const baseline = (a: Activity) =>
    a.baselineStart !== null &&
    a.baselineFinish !== null && <div className={`bar baseline ${classic ? "classic" : ""}`} style={{ left: COLS + x(a.baselineStart), width: Math.max(2, x(a.baselineFinish) - x(a.baselineStart)) }} />;

  return (
    <div className={`gantt gantt-${mode}`}>
      {!classic && (
        <div className="gantt-toolbar">
          <input ref={filterRef} placeholder={`Filter ${t.activities.toLowerCase()}…`} value={ganttFilter.text} onChange={(e) => setGanttFilter({ text: e.target.value })} />
          <span className="muted">
            {schedule.activities.length} {t.activities.toLowerCase()}
          </span>
          <button title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))}>
            −
          </button>
          <button title="Fit" onClick={() => setZoom(1)}>
            Fit
          </button>
          <button title="Zoom in" onClick={() => setZoom((z) => Math.min(60, z * 1.5))}>
            +
          </button>
        </div>
      )}
      <div className="gantt-body" ref={bodyRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="gantt-grid" style={{ height: gridH, width: gridW }}>
          <div className="gantt-head" style={{ width: gridW, height: HEAD }}>
            <div className="gantt-cols" style={{ width: COLS, height: HEAD }}>
              {cols.map((c) => (
                <span key={c.key} style={{ width: c.width, textAlign: c.align }} title={c.title}>
                  {c.label}
                </span>
              ))}
            </div>
            {scale ? (
              <div className="gantt-scale two" style={{ left: COLS, height: HEAD }}>
                {scale.top.map((s) => (
                  <span key={`t${s.t}`} className="tier top" style={{ left: x(s.t), width: x(s.end) - x(s.t) }}>
                    {s.label}
                  </span>
                ))}
                {scale.bottom.map((s) => (
                  <span key={`b${s.t}`} className="tier bottom" style={{ left: x(s.t), width: x(s.end) - x(s.t) }}>
                    {x(s.end) - x(s.t) >= 14 ? s.label : ""}
                  </span>
                ))}
              </div>
            ) : (
              <div className="gantt-scale" style={{ left: COLS }}>
                {months
                  .filter((_, i) => PX_PER_DAY * 30 >= 48 || i % Math.ceil(48 / (PX_PER_DAY * 30)) === 0)
                  .map((m) => (
                    <span key={m.t} style={{ left: x(m.t) }}>
                      {m.label}
                    </span>
                  ))}
              </div>
            )}
          </div>
          {scale && scale.bottom.map((s) => <div key={`g${s.t}`} className="gantt-vline" style={{ left: COLS + x(s.t), top: HEAD, height: rows.length * ROW }} />)}
          {!classic && <div className="gantt-now" style={{ left: COLS + x(time), height: gridH }} />}
          {dd !== null && <div className="gantt-datadate" title={`${t.dataDate} ${fmtDate(dd)}`} style={{ left: COLS + x(dd), top: classic ? HEAD : 0, height: classic ? rows.length * ROW : gridH }} />}
          {rows.slice(first, last).map((r, i) => {
            const top = HEAD + (first + i) * ROW;
            if (r.kind === "wbs") {
              const depth = Math.min(r.depth, 4);
              return (
                <div key={`w${r.id}`} className={`gantt-row wbs band${depth}`} style={{ top, height: ROW }} onClick={() => toggleWbs(r.id)}>
                  <div className="gantt-cols" style={{ width: COLS, height: ROW }}>
                    {mode === "msp" ? (
                      <>
                        <span style={{ width: cols[0].width, textAlign: "right" }}>{rowNo.get(r.id) ?? ""}</span>
                        <span style={{ width: cols[1].width }} />
                        <span style={{ width: cols[2].width, textAlign: "center" }}>
                          <TaskModeIcon />
                        </span>
                        <span style={{ width: cols[3].width, paddingLeft: 4 + r.depth * 12 }}>
                          {collapsed.has(r.id) ? "▷" : "◢"} {r.label.replace(/^\S+\s/, "")}
                        </span>
                      </>
                    ) : (
                      <span style={{ width: nameSpan, paddingLeft: 6 + r.depth * 12 }}>
                        {collapsed.has(r.id) ? "⊞" : "⊟"} {r.label}
                      </span>
                    )}
                    {afterName.map((c) => (
                      <span key={c.key} style={{ width: c.width, textAlign: c.align }}>
                        {c.key === "start"
                          ? mode === "msp"
                            ? mspDate(r.start)
                            : fmtDate(r.start)
                          : c.key === "finish"
                            ? mode === "msp"
                              ? mspDate(r.finish)
                              : fmtDate(r.finish)
                            : c.key === "dur" && r.start !== null && r.finish !== null
                              ? dayWord(String(Math.max(0, Math.round(((r.finish - r.start) / DAY) * (6 / 7)))))
                              : ""}
                      </span>
                    ))}
                  </div>
                  {r.start !== null &&
                    r.finish !== null &&
                    (mode === "msp" ? (
                      <div className="msp-summary" style={{ left: COLS + x(r.start), width: Math.max(4, x(r.finish) - x(r.start)) }} />
                    ) : (
                      <div className="bar summary" style={{ left: COLS + x(r.start), width: Math.max(2, x(r.finish) - x(r.start)) }} />
                    ))}
                </div>
              );
            }
            const a = r.activity;
            const d = activityDates(a, sim.dateSource);
            const isMs = a.type === "milestone" || a.type === "finish-milestone";
            const res = (resourcesOf.get(a.id) ?? []).join(", ");
            const ctx: ColCtx = { a, start: d.start, finish: d.finish, hpd, rowNo, preds: predsOf.get(a.id) ?? [], linkCount: linkCount.get(a.id) ?? 0, resources: res };
            const cls = ["gantt-row", selectedActivity === a.id ? "selected" : ""].join(" ");
            return (
              <div key={a.id} className={cls} style={{ top, height: ROW }} onClick={(e) => onActivity(a.id, e.altKey)} onDoubleClick={() => d.start !== null && setTime(d.start)}>
                <div className="gantt-cols" style={{ width: COLS, height: ROW }}>
                  {cols.map((c, k) => (
                    <span
                      key={c.key}
                      style={{
                        width: c.width,
                        textAlign: c.align,
                        paddingLeft: k === 0 && mode !== "msp" ? 6 + r.depth * 12 : c.key === "name" && mode === "msp" ? 4 + r.depth * 12 + 12 : undefined,
                      }}
                      className={c.className?.(ctx)}
                      title={c.key === "name" ? a.name : undefined}
                    >
                      {c.render(ctx)}
                    </span>
                  ))}
                </div>
                {(!classic || tracking) && baseline(a)}
                {d.start !== null &&
                  d.finish !== null &&
                  (mode === "p6" ? (
                    p6Bars(a, d.start, d.finish)
                  ) : mode === "msp" ? (
                    mspBars(a, d.start, d.finish, res)
                  ) : isMs ? (
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
