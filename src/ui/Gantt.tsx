import { useEffect, useMemo, useRef, useState } from "react";
import { activityDates, scheduleRange } from "../core/simulation";
import { buildGanttRows, type GanttRow } from "../core/wbs";
import { DAY, fmtDate, useStore } from "./store";

const ROW = 24;
const COLS = 466; // width of the table columns left of the bars

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
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

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

  const rows = useMemo<GanttRow[]>(() => {
    if (!schedule) return [];
    const all = buildGanttRows(schedule, sim.dateSource, collapsed);
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter((r) => r.kind === "activity" && `${r.activity.code} ${r.activity.name}`.toLowerCase().includes(f));
  }, [schedule, sim.dateSource, collapsed, filter]);

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
  const x = (t: number) => ((t - origin) / DAY) * PX_PER_DAY;
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

  return (
    <div className="gantt">
      <div className="gantt-toolbar">
        <input placeholder="Filter activities…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted">{schedule.activities.length} activities</span>
        <button title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z / 1.5))}>−</button>
        <button title="Fit" onClick={() => setZoom(1)}>Fit</button>
        <button title="Zoom in" onClick={() => setZoom((z) => Math.min(40, z * 1.5))}>+</button>
      </div>
      <div
        className="gantt-body"
        ref={bodyRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="gantt-grid" style={{ height: rows.length * ROW + ROW, width: COLS + totalDays * PX_PER_DAY }}>
          <div className="gantt-head" style={{ width: COLS + totalDays * PX_PER_DAY }}>
            <div className="gantt-cols">
              <span style={{ width: 72 }}>Activity ID</span>
              <span style={{ width: 170 }}>Name</span>
              <span style={{ width: 64 }}>Start</span>
              <span style={{ width: 64 }}>Finish</span>
              <span style={{ width: 32 }}>%</span>
              <span style={{ width: 36 }} title="Total float (days)">TF</span>
              <span style={{ width: 28 }} title="Linked elements">🔗</span>
            </div>
            <div className="gantt-scale">
              {months.filter((_, i) => PX_PER_DAY * 30 >= 48 || i % Math.ceil(48 / (PX_PER_DAY * 30)) === 0).map((m) => (
                <span key={m.t} style={{ left: x(m.t) }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt-now" style={{ left: COLS + x(time), height: rows.length * ROW + ROW }} />
          {schedule.dataDate !== null && (
            <div className="gantt-datadate" title={`Data date ${fmtDate(schedule.dataDate)}`} style={{ left: COLS + x(schedule.dataDate), height: rows.length * ROW + ROW }} />
          )}
          {rows.slice(first, last).map((r, i) => {
            const top = ROW + (first + i) * ROW;
            if (r.kind === "wbs") {
              return (
                <div key={`w${r.id}`} className="gantt-row wbs" style={{ top }} onClick={() => toggleWbs(r.id)}>
                  <div className="gantt-cols">
                    <span style={{ width: 306, paddingLeft: 6 + r.depth * 12 }}>
                      {collapsed.has(r.id) ? "▸" : "▾"} {r.label}
                    </span>
                    <span style={{ width: 64 }}>{fmtDate(r.start)}</span>
                    <span style={{ width: 64 }}>{fmtDate(r.finish)}</span>
                  </div>
                  {r.start !== null && r.finish !== null && (
                    <div className="bar summary" style={{ left: COLS + x(r.start), width: Math.max(2, x(r.finish) - x(r.start)) }} />
                  )}
                </div>
              );
            }
            const a = r.activity;
            const d = activityDates(a, sim.dateSource);
            const isMs = a.type === "milestone" || a.type === "finish-milestone";
            const cls = ["gantt-row", selectedActivity === a.id ? "selected" : ""].join(" ");
            return (
              <div key={a.id} className={cls} style={{ top }} onClick={(e) => onActivity(a.id, e.altKey)} onDoubleClick={() => d.start !== null && setTime(d.start)}>
                <div className="gantt-cols">
                  <span style={{ width: 72, paddingLeft: 6 + r.depth * 12 }}>{a.code}</span>
                  <span style={{ width: 170 }} title={a.name}>
                    {a.name}
                  </span>
                  <span style={{ width: 64 }}>{fmtDate(d.start)}</span>
                  <span style={{ width: 64 }}>{fmtDate(d.finish)}</span>
                  <span style={{ width: 32 }}>{Math.round(a.percentComplete)}</span>
                  <span style={{ width: 36 }} className={a.totalFloatHours !== null && a.totalFloatHours < 0 ? "bad" : ""}>
                    {a.totalFloatHours === null ? "" : Math.round((a.totalFloatHours / hpd) * 10) / 10}
                  </span>
                  <span style={{ width: 28 }}>{linkCount.get(a.id) ?? ""}</span>
                </div>
                {a.baselineStart !== null && a.baselineFinish !== null && (
                  <div className="bar baseline" style={{ left: COLS + x(a.baselineStart), width: Math.max(2, x(a.baselineFinish) - x(a.baselineStart)) }} />
                )}
                {d.start !== null && d.finish !== null &&
                  (isMs ? (
                    <div className={`milestone ${a.critical ? "critical" : ""}`} style={{ left: COLS + x(d.start) - 6 }} />
                  ) : (
                    <div
                      className={`bar ${a.critical ? "critical" : ""} ${a.status}`}
                      style={{ left: COLS + x(d.start), width: Math.max(2, x(d.finish) - x(d.start)) }}
                    >
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
