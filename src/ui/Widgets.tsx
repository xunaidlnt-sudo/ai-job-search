import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  activityRows,
  compact,
  fmtDay,
  kpi,
  lookahead,
  milestoneRows,
  portfolioRow,
  resourceHistogram,
  sCurves,
  statusMix,
  type ActivityRow,
  type MilestoneState,
} from "../core/dashboardData";
import { applySlices, groupOf, groupValues, progressCurve, progressTable } from "../core/progress";
import { quantityCurve } from "../core/quantities";
import { widgetCols, widgetRows, type Dashboard, type KpiMetric, type TableColumn, type TableFilter, type Widget, type WidgetKind } from "../core/reporting";
import { scheduleRange } from "../core/simulation";
import type { Schedule } from "../core/types";
import { Donut, Gauge, GroupBars, LineChart, OTHER, PeriodBars, pct, pct2, SERIES, STATUS, StackedBars } from "./charts";
import { useStore } from "./store";

export type WidgetGroup = "Numbers" | "Charts" | "Tables" | "Layout";

export const WIDGET_KINDS: { kind: WidgetKind; label: string; group: WidgetGroup; hint: string; defaults: Partial<Widget> }[] = [
  { kind: "kpi", label: "KPI tile", group: "Numbers", hint: "One number: SPI, finish date, % complete…", defaults: { w: 3, h: 1, metric: "spi" } },
  { kind: "gauge", label: "Gauge", group: "Numbers", hint: "Dial with red / amber / green bands", defaults: { w: 3, h: 1.5, metric: "spi", good: 1, bad: 0.9 } },
  { kind: "info", label: "Key figures table", group: "Numbers", hint: "Label and value rows, computed or typed", defaults: { w: 6, h: 2, rows: [{ label: "Overall progress", metric: "percentComplete" }, { label: "Remarks", metric: null, value: "" }] } },
  { kind: "donut", label: "Status donut", group: "Numbers", hint: "Activity status, float bands or critical share", defaults: { w: 3, h: 2, split: "status" } },
  { kind: "scurve", label: "Cost / hours S-curve", group: "Charts", hint: "Planned, earned, actual and forecast", defaults: { w: 6, h: 2, measure: "cost" } },
  { kind: "pscurve", label: "Progress S-curve (%)", group: "Charts", hint: "Cumulative plan vs actual % with period bars", defaults: { w: 12, h: 3, basis: "cost", step: "month" } },
  { kind: "phasecurves", label: "S-curve per phase", group: "Charts", hint: "One small S-curve per discipline (E, P, C…)", defaults: { w: 12, h: 2, dimension: "wbs1", basis: "cost", step: "month" } },
  { kind: "groupbars", label: "Plan vs actual by group", group: "Charts", hint: "Bars per discipline, WBS or activity code", defaults: { w: 6, h: 2, dimension: "wbs1", basis: "cost" } },
  { kind: "histogram", label: "Resource histogram", group: "Charts", hint: "Weekly labour and plant hours", defaults: { w: 6, h: 2 } },
  { kind: "quantity", label: "Quantity curve", group: "Charts", hint: "Installed quantity from the 3D model", defaults: { w: 6, h: 2 } },
  { kind: "table", label: "Activity table", group: "Tables", hint: "Pick the filter, columns and sort", defaults: { w: 12, h: 2, filter: "critical", limit: 15 } },
  { kind: "milestones", label: "Milestone tracker", group: "Tables", hint: "Baseline vs forecast, days late, status", defaults: { w: 6, h: 2.5, limit: 12 } },
  { kind: "lookahead", label: "Look-ahead", group: "Tables", hint: "Work starting or running in the next weeks", defaults: { w: 6, h: 2.5, weeks: 3, limit: 30 } },
  { kind: "progress", label: "Progress table (BL plan vs actual)", group: "Tables", hint: "Weighted rows with a TOTAL line", defaults: { w: 12, h: 2, dimension: "wbs1", basis: "cost", totalLabel: "TOTAL" } },
  { kind: "portfolio", label: "Portfolio table", group: "Tables", hint: "One row per project in the database", defaults: { w: 12, h: 2 } },
  { kind: "banner", label: "Section banner", group: "Layout", hint: "Coloured heading across the page", defaults: { w: 12, h: 0.5, title: "Progress {datadate}" } },
  { kind: "text", label: "Text / note", group: "Layout", hint: "Commentary, with {project} and {datadate}", defaults: { w: 12, h: 1, text: "Notes for this report." } },
  { kind: "image", label: "Image / logo", group: "Layout", hint: "Logo, site photo or a drawing", defaults: { w: 3, h: 1.5, fit: "contain" } },
  { kind: "slicer", label: "Filter buttons (slicer)", group: "Layout", hint: "Click to filter every widget", defaults: { w: 4, h: 1, dimension: "wbs1" } },
];

export const TABLE_COLUMNS: { id: TableColumn; label: string }[] = [
  { id: "code", label: "ID" },
  { id: "name", label: "Name" },
  { id: "wbs", label: "WBS" },
  { id: "status", label: "Status" },
  { id: "percent", label: "%" },
  { id: "start", label: "Start" },
  { id: "finish", label: "Finish" },
  { id: "blStart", label: "BL Start" },
  { id: "blFinish", label: "BL Finish" },
  { id: "actualStart", label: "Act. Start" },
  { id: "actualFinish", label: "Act. Finish" },
  { id: "variance", label: "Var (d)" },
  { id: "totalFloat", label: "TF (d)" },
  { id: "origDur", label: "Orig. Dur (d)" },
  { id: "remDur", label: "Rem. Dur (d)" },
  { id: "critical", label: "Critical" },
];
export const DEFAULT_COLUMNS: TableColumn[] = ["code", "name", "percent", "start", "finish", "blFinish", "variance", "totalFloat"];

/** Fill {project} and {datadate} in titles and notes. */
export function fillText(t: string, s: Schedule | null): string {
  return t.replace(/\{datadate\}/g, fmtDay(s?.dataDate ?? null)).replace(/\{project\}/g, s ? `${s.projectCode} – ${s.projectName}` : "");
}

/** A widget's schedule: dashboard slicers (unless ignored), then its own filters. */
export function widgetSchedule(raw: Schedule | null, w: Widget, slices: Dashboard["slices"]): Schedule | null {
  if (!raw || w.kind === "slicer") return raw;
  let s = raw;
  if (!w.ignoreSlicers && slices?.length) s = applySlices(s, slices);
  if (w.where?.length) s = applySlices(s, w.where);
  return s;
}

/** Card wrapper shared by the editor, the dashboard and the PDF. */
export function WidgetFrame({
  w,
  dash,
  schedule,
  className = "",
  children,
  header,
  tools,
  ...rest
}: {
  w: Widget;
  dash: Dashboard;
  schedule: Schedule | null;
  className?: string;
  children: ReactNode;
  header?: ReactNode;
  tools?: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const st = w.style ?? {};
  const border = st.border ?? dash.page?.border ?? "card";
  const accent = st.accent ?? dash.page?.accent;
  const style: CSSProperties & Record<string, string | number | undefined> = {
    gridColumn: `span ${widgetCols(w.w)}`,
    gridRow: `span ${widgetRows(w.h)}`,
    background: st.background,
    color: st.color,
    textAlign: st.align,
    "--w-accent": accent,
    "--w-scale": st.fontScale,
  };
  const hide = st.hideTitle || w.kind === "banner";
  return (
    <section {...rest} className={`widget kind-${w.kind} border-${border} head-${st.header ?? "plain"} ${className}`} style={style} data-cols={widgetCols(w.w)}>
      {(!hide || tools) && (
        <header className={hide ? "title-hidden" : ""}>
          {header}
          {!hide && <span className="widget-title">{fillText(w.title, schedule)}</span>}
          {tools}
        </header>
      )}
      <div className="widget-body">{children}</div>
    </section>
  );
}

export const KPI_LABELS: Record<KpiMetric, string> = {
  finish: "Forecast finish",
  finishVariance: "Finish variance vs baseline",
  dataDate: "Data date",
  percentComplete: "% complete",
  spi: "SPI",
  cpi: "CPI",
  bac: "Budget (BAC)",
  eac: "Estimate at completion (EAC)",
  vac: "Variance at completion (VAC)",
  ev: "Earned value (EV)",
  ac: "Actual cost (AC)",
  activities: "Number of activities",
  critical: "Open critical activities",
  late: "Late against baseline",
  startingSoon: "Starting soon",
};

export const FILTER_LABELS: Record<TableFilter, string> = {
  critical: "Critical (open)",
  late: "Late or critical",
  "in-progress": "In progress",
  "starting-soon": "Starting soon",
  "finishing-soon": "Finishing soon",
  "negative-float": "Negative float",
  all: "All activities",
};

export interface PortfolioEntry {
  id: string;
  schedule: Schedule;
}

export interface SliceProps {
  slices: { dimension: string; values: string[] }[];
  onSlices?: (s: { dimension: string; values: string[] }[]) => void;
  /** The schedule before slicers are applied (slicers list every value). */
  raw: Schedule | null;
}

export function WidgetView({ w, schedule, portfolio, slice }: { w: Widget; schedule: Schedule | null; portfolio: PortfolioEntry[] | null; slice?: SliceProps }) {
  if (w.kind === "text") return <div className="widget-text">{fillText(w.text ?? "", schedule)}</div>;
  if (w.kind === "portfolio") return <PortfolioTable entries={portfolio} />;
  if (w.kind === "banner") return <div className="report-banner">{fillText(w.title, schedule)}</div>;
  if (w.kind === "image")
    return w.image ? <img className="widget-image" src={w.image} alt={w.title} style={{ objectFit: w.fit ?? "contain" }} /> : <p className="muted">Choose an image in the widget settings.</p>;
  if (!schedule) return <p className="muted">No project selected for this widget.</p>;
  switch (w.kind) {
    case "progress":
      return <ProgressTableView w={w} schedule={schedule} />;
    case "pscurve":
      return <ProgressSCurve w={w} schedule={schedule} />;
    case "info":
      return <InfoTable w={w} schedule={schedule} />;
    case "slicer":
      return <Slicer w={w} raw={slice?.raw ?? schedule} slice={slice} />;
    case "kpi": {
      const k = kpiFormatted(schedule, w);
      return (
        <div className="kpi" title={k.hint}>
          <div className={`kpi-value ${k.tone ?? ""}`}>{k.value}</div>
          {k.hint && <div className="muted kpi-hint">{k.hint}</div>}
        </div>
      );
    }
    case "gauge":
      return <GaugeWidget w={w} schedule={schedule} />;
    case "donut":
      return <DonutWidget w={w} schedule={schedule} />;
    case "groupbars":
      return <GroupBarsWidget w={w} schedule={schedule} />;
    case "phasecurves":
      return <PhaseCurves w={w} schedule={schedule} />;
    case "milestones":
      return <MilestoneTable w={w} schedule={schedule} />;
    case "lookahead":
      return <Lookahead w={w} schedule={schedule} />;
    case "scurve":
      return <SCurve schedule={schedule} measure={w.measure} w={w} />;
    case "histogram":
      return <Histogram schedule={schedule} />;
    case "table":
      return <ActivityTable schedule={schedule} w={w} />;
    case "quantity":
      return <QuantityWidget schedule={schedule} quantityKey={w.quantityKey} />;
    default:
      return null;
  }
}

function SCurve({ schedule, measure, w }: { schedule: Schedule; measure?: "cost" | "hours"; w: Widget }) {
  const hasCost = (schedule.assignments ?? []).some((x) => x.budgetCost > 0);
  const m = measure === "hours" || !hasCost ? "hours" : "cost";
  const pts = useMemo(() => sCurves(schedule, m), [schedule, m]);
  if (!pts.length) return <p className="muted">No cost or labour data in this project.</p>;
  return (
    <LineChart
      title=""
      unit={m === "hours" ? "h" : ""}
      area={w.chart === "area"}
      legend={w.showLegend !== false}
      series={[
        { id: "pv", label: "Planned", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.pv })) },
        { id: "ev", label: "Earned", color: SERIES[1], points: pts.map((p) => ({ t: p.t, v: p.ev })) },
        { id: "ac", label: "Actual", color: SERIES[2], points: pts.map((p) => ({ t: p.t, v: p.ac })) },
        { id: "fc", label: "Forecast", color: SERIES[3], dashed: true, points: pts.map((p) => ({ t: p.t, v: p.forecast })) },
      ].filter((x) => !w.hiddenSeries?.includes(x.id))}
      markers={schedule.dataDate !== null ? [{ t: schedule.dataDate, label: "Data date", color: "#1f6feb" }] : []}
    />
  );
}

function Histogram({ schedule }: { schedule: Schedule }) {
  const res = (schedule.resources ?? []).filter((r) => r.type !== "material");
  const hist = useMemo(() => resourceHistogram(schedule, { resourceIds: res.map((r) => r.id) }), [schedule, res]);
  const color = new Map((schedule.resources ?? []).map((r, i) => [r.id, i < SERIES.length ? SERIES[i] : OTHER]));
  return (
    <StackedBars
      title=""
      bars={hist.bars.map((b) => ({ t: b.t, values: b.byResource }))}
      series={hist.resources.map((r) => ({ id: r.id, label: r.code, color: color.get(r.id)! }))}
      unit="h"
      marker={schedule.dataDate !== null ? { t: schedule.dataDate, label: "Data date", color: "#1f6feb" } : undefined}
    />
  );
}

function cellOf(r: ActivityRow, c: TableColumn, s: Schedule): { text: string; sort: number | string; cls?: string } {
  switch (c) {
    case "code":
      return { text: r.code, sort: r.code };
    case "name":
      return { text: r.name, sort: r.name };
    case "wbs":
      return { text: groupOf(r.activity, "wbs2", s), sort: groupOf(r.activity, "wbs2", s) };
    case "status":
      return { text: r.status === "complete" ? "Complete" : r.status === "in-progress" ? "In progress" : "Not started", sort: r.status };
    case "percent":
      return { text: String(Math.round(r.percent)), sort: r.percent };
    case "start":
      return { text: fmtDay(r.start), sort: r.start ?? 0 };
    case "finish":
      return { text: fmtDay(r.finish), sort: r.finish ?? 0 };
    case "blStart":
      return { text: fmtDay(r.baselineStart), sort: r.baselineStart ?? 0 };
    case "blFinish":
      return { text: fmtDay(r.baselineFinish), sort: r.baselineFinish ?? 0 };
    case "actualStart":
      return { text: fmtDay(r.actualStart), sort: r.actualStart ?? 0 };
    case "actualFinish":
      return { text: fmtDay(r.actualFinish), sort: r.actualFinish ?? 0 };
    case "variance":
      return { text: r.varianceDays === null ? "" : String(r.varianceDays), sort: r.varianceDays ?? -Infinity, cls: (r.varianceDays ?? 0) > 0 ? "bad" : "" };
    case "totalFloat":
      return { text: r.totalFloatDays === null ? "" : String(r.totalFloatDays), sort: r.totalFloatDays ?? Infinity, cls: (r.totalFloatDays ?? 0) < 0 ? "bad" : "" };
    case "origDur":
      return { text: r.origDurDays === null ? "" : String(r.origDurDays), sort: r.origDurDays ?? 0 };
    case "remDur":
      return { text: r.remDurDays === null ? "" : String(r.remDurDays), sort: r.remDurDays ?? 0 };
    case "critical":
      return { text: r.critical ? "Yes" : "", sort: r.critical ? 1 : 0, cls: r.critical ? "bad" : "" };
    default: {
      const v = groupOf(r.activity, c.slice(4), s);
      return { text: v, sort: v };
    }
  }
}

export function columnLabel(c: TableColumn): string {
  if (c.startsWith("dim:")) {
    const d = c.slice(4);
    return d === "wbs1" ? "WBS L1" : d === "wbs2" ? "WBS L2" : d.replace(/^(code|user):/, "");
  }
  return TABLE_COLUMNS.find((x) => x.id === c)?.label ?? c;
}

function ActivityTable({ schedule, w }: { schedule: Schedule; w: Widget }) {
  const [localSort, setLocalSort] = useState<Widget["sort"] | null>(null);
  const sort = localSort ?? w.sort;
  const cols = w.columns?.length ? w.columns : DEFAULT_COLUMNS;
  const rows = useMemo(() => {
    const all = activityRows(schedule, w.filter ?? "critical", { days: w.days });
    if (sort) {
      const k = (r: ActivityRow) => cellOf(r, sort.by, schedule).sort;
      all.sort((a, b) => {
        const x = k(a);
        const y = k(b);
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -c : c;
      });
    }
    return w.limit ? all.slice(0, w.limit) : all;
  }, [schedule, w.filter, w.days, w.limit, sort]);
  if (!rows.length) return <p className="muted">None.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c}
              className="sortable"
              onClick={() => setLocalSort({ by: c, desc: sort?.by === c ? !sort.desc : false })}
              aria-sort={sort?.by === c ? (sort.desc ? "descending" : "ascending") : undefined}
            >
              {columnLabel(c)}
              {sort?.by === c ? (sort.desc ? " ▾" : " ▴") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {cols.map((c) => {
              const v = cellOf(r, c, schedule);
              return (
                <td key={c} className={v.cls}>
                  {c === "code" ? <b>{v.text}</b> : v.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** KPI value with the widget's decimals, prefix/suffix and thresholds. */
export function kpiFormatted(schedule: Schedule, w: Widget) {
  const k = kpi(schedule, w.metric ?? "spi", { measure: w.measure, days: w.days });
  const numeric = k.raw !== null && !["finish", "dataDate", "finishVariance"].includes(w.metric ?? "");
  let value = k.value;
  if (numeric && w.decimals !== undefined) {
    const raw = w.metric === "percentComplete" ? k.raw! * 100 : k.raw!;
    value = ["bac", "eac", "vac", "ev", "ac"].includes(w.metric ?? "") && Math.abs(raw) >= 1e4 ? compact(raw) : raw.toFixed(w.decimals);
    if (w.metric === "percentComplete" && w.suffix === undefined) value += "%";
  }
  if (w.prefix) value = w.prefix + value;
  if (w.suffix) value = value + w.suffix;
  let tone = k.tone;
  if (k.raw !== null && w.good !== undefined && w.bad !== undefined) {
    const v = w.metric === "percentComplete" ? k.raw * 100 : k.raw;
    const up = w.good >= w.bad;
    tone = up ? (v >= w.good ? "good" : v < w.bad ? "bad" : undefined) : v <= w.good ? "good" : v > w.bad ? "bad" : undefined;
  }
  return { ...k, value, tone };
}

function GaugeWidget({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const metric = w.metric ?? "spi";
  const k = kpi(schedule, metric, { measure: w.measure, days: w.days });
  const isPct = metric === "percentComplete";
  const ratio = metric === "spi" || metric === "cpi";
  // % complete: the needle is actual; green from the baseline plan %.
  const plan = isPct ? progressTable(schedule, { dimension: "wbs1", basis: w.basis ?? "cost" }).total.plan : null;
  const good = w.good ?? (isPct && plan !== null ? plan : undefined);
  const bad = w.bad ?? (isPct && plan !== null ? Math.max(0, plan - 0.05) : undefined);
  const dec = w.decimals ?? (ratio ? 2 : 1);
  const fmt = isPct ? (v: number) => `${(v * 100).toFixed(w.decimals ?? 0)}%` : (v: number) => `${w.prefix ?? ""}${v.toFixed(dec)}${w.suffix ?? ""}`;
  const max = isPct ? 1 : ratio ? 1.5 : Math.max(1, (good ?? k.raw ?? 1) * 1.5);
  const min = ratio ? 0.5 : 0;
  return (
    <div className="gauge-wrap">
      <Gauge value={k.raw} min={min} max={max} good={isPct && w.good !== undefined ? w.good / 100 : good} bad={isPct && w.bad !== undefined ? w.bad / 100 : bad} label={w.title} fmt={fmt} />
      {isPct && plan !== null && <div className="muted kpi-hint">Baseline plan {(plan * 100).toFixed(1)}%</div>}
    </div>
  );
}

const TONE_COLOR: Record<string, string> = { good: STATUS.good, warning: STATUS.warning, serious: STATUS.serious, critical: STATUS.critical, neutral: "#b9bec6", info: STATUS.info };

function DonutWidget({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const mix = useMemo(() => statusMix(schedule, w.split ?? "status"), [schedule, w.split]);
  return <Donut caption={w.split && w.split !== "status" ? "open" : "activities"} slices={mix.map((m) => ({ id: m.id, label: m.label, value: m.value, color: TONE_COLOR[m.tone] }))} />;
}

function GroupBarsWidget({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const t = useMemo(() => progressTable(schedule, { dimension: w.dimension ?? "wbs1", basis: w.basis ?? "cost", weightage: w.weightage }), [schedule, w.dimension, w.basis, w.weightage]);
  const series = [
    { id: "plan", label: "Cum. BL plan %", color: SERIES[0] },
    { id: "actual", label: "Cum. actual %", color: SERIES[1] },
    { id: "forecast", label: "Forecast %", color: SERIES[3] },
  ].filter((x) => !(w.hiddenSeries ?? ["forecast"]).includes(x.id));
  return (
    <GroupBars
      legend={w.showLegend !== false}
      fmt={(v) => `${(v * 100).toFixed(w.decimals ?? 1)}%`}
      series={series}
      rows={[...t.rows, { ...t.total, key: "__total", label: w.totalLabel || "TOTAL" }].map((r) => ({
        key: r.key,
        label: r.label,
        values: { plan: r.plan, actual: r.actual, forecast: r.forecast },
      }))}
    />
  );
}

function PhaseCurves({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const dim = w.dimension ?? "wbs1";
  const groups = useMemo(() => groupValues(schedule, dim).slice(0, 8), [schedule, dim]);
  const dd = schedule.dataDate;
  const curves = useMemo(
    () => groups.map((g) => ({ g, pts: progressCurve(applySlices(schedule, [{ dimension: dim, values: [g] }]), { basis: w.basis ?? "cost", step: w.step ?? "month" }) })).filter((c) => c.pts.length),
    [groups, schedule, dim, w.basis, w.step],
  );
  if (!curves.length) return <p className="muted">No weighted activities.</p>;
  return (
    <div className="phase-grid">
      {curves.map(({ g, pts }, i) => {
        const last = [...pts].reverse().find((p) => p.actual !== null);
        const planAt = pts.find((p) => dd !== null && p.t >= dd)?.plan ?? pts[pts.length - 1].plan;
        return (
          <div key={g} className="phase-cell">
            <div className="phase-head">
              <b>{g}</b>
              <span className="muted">
                Actual {pct(last?.actual ?? 0)} · Plan {pct(planAt)}
              </span>
            </div>
            <LineChart
              title=""
              yMax={1}
              fmt={(v) => pct(v)}
              legend={i === 0 && w.showLegend !== false}
              area={w.chart === "area"}
              compact
              series={[
                { id: "plan", label: "Plan", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.plan })) },
                { id: "actual", label: "Actual", color: SERIES[1], points: pts.map((p) => ({ t: p.t, v: p.actual })) },
                { id: "fc", label: "Forecast", color: SERIES[2], dashed: true, points: pts.filter((p) => dd === null || p.t >= dd - 31 * 86_400_000).map((p) => ({ t: p.t, v: p.forecast })) },
              ].filter((x) => !w.hiddenSeries?.includes(x.id))}
              markers={dd !== null ? [{ t: dd, label: "DD", color: "#0b2a8a" }] : []}
            />
          </div>
        );
      })}
    </div>
  );
}

const MS_LABEL: Record<MilestoneState, { label: string; tone: string; icon: string }> = {
  achieved: { label: "Achieved", tone: "good", icon: "✓" },
  "achieved-late": { label: "Achieved late", tone: "warning", icon: "✓" },
  "on-track": { label: "On track", tone: "good", icon: "●" },
  "at-risk": { label: "At risk", tone: "warning", icon: "▲" },
  late: { label: "Late", tone: "critical", icon: "■" },
};

function MilestoneTable({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const rows = useMemo(() => milestoneRows(schedule, { showDone: w.showDone, limit: w.limit, riskFloatDays: w.days ?? 5 }), [schedule, w.showDone, w.limit, w.days]);
  if (!rows.length) return <p className="muted">No milestones{w.showDone ? "" : " still open"}.</p>;
  return (
    <table className="data ms-table">
      <thead>
        <tr>
          <th>Milestone</th>
          <th>Baseline</th>
          <th>Forecast</th>
          <th>Var (d)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const st = MS_LABEL[r.state];
          return (
            <tr key={r.id}>
              <td>
                <b>{r.code}</b> {r.name}
              </td>
              <td>{fmtDay(r.baseline)}</td>
              <td>{fmtDay(r.forecast)}</td>
              <td className={(r.varianceDays ?? 0) > 0 ? "bad" : ""}>{r.varianceDays === null ? "" : r.varianceDays > 0 ? `+${r.varianceDays}` : r.varianceDays}</td>
              <td>
                <span className={`status-pill ${st.tone}`}>
                  <span aria-hidden>{st.icon}</span> {st.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Lookahead({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const weeks = useMemo(() => lookahead(schedule, w.weeks ?? 3, w.limit ?? 0), [schedule, w.weeks, w.limit]);
  if (!weeks.some((x) => x.rows.length)) return <p className="muted">Nothing starting or running in the window.</p>;
  return (
    <table className="data la-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Activity</th>
          <th>Start</th>
          <th>Finish</th>
          <th>%</th>
          <th>TF (d)</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((wk, i) => [
          <tr key={`h${i}`} className="la-week">
            <td colSpan={6}>
              Week {i + 1} · from {fmtDay(wk.from)} <span className="muted">({wk.rows.length})</span>
            </td>
          </tr>,
          ...wk.rows.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.code}</b>
              </td>
              <td>
                {r.critical && <span className="crit-dot" title="Critical" aria-label="Critical" />}
                {r.name}
              </td>
              <td>{fmtDay(r.start)}</td>
              <td>{fmtDay(r.finish)}</td>
              <td>{Math.round(r.percent)}</td>
              <td className={(r.totalFloatDays ?? 0) < 0 ? "bad" : ""}>{r.totalFloatDays ?? ""}</td>
            </tr>
          )),
        ])}
      </tbody>
    </table>
  );
}

function PortfolioTable({ entries }: { entries: PortfolioEntry[] | null }) {
  if (!entries) return <p className="muted">Loading projects…</p>;
  if (!entries.length) return <p className="muted">No projects in the database.</p>;
  const rows = entries.map((e) => portfolioRow(e.id, e.schedule));
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Project</th>
          <th>Name</th>
          <th>Data date</th>
          <th>Finish</th>
          <th>Var (d)</th>
          <th>% complete</th>
          <th>SPI</th>
          <th>CPI</th>
          <th>Late</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.projectId}>
            <td>
              <b>{r.code}</b>
            </td>
            <td>{r.name}</td>
            <td>{fmtDay(r.dataDate)}</td>
            <td>{fmtDay(r.finish)}</td>
            <td className={(r.varianceDays ?? 0) > 0 ? "bad" : ""}>{r.varianceDays ?? ""}</td>
            <td>{(r.percent * 100).toFixed(1)}%</td>
            <td className={r.spi !== null && r.spi < 0.95 ? "bad" : ""}>{r.spi?.toFixed(2) ?? "–"}</td>
            <td className={r.cpi !== null && r.cpi < 0.95 ? "bad" : ""}>{r.cpi?.toFixed(2) ?? "–"}</td>
            <td>{r.late}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuantityWidget({ schedule, quantityKey }: { schedule: Schedule; quantityKey?: string }) {
  const { elements, links, profiles, schedule: open } = useStore();
  const usable = open?.projectId === schedule.projectId && elements.length > 0;
  const key = quantityKey || "BaseQuantities.NetVolume";
  const pts = useMemo(() => {
    if (!usable) return [];
    const r = scheduleRange(schedule);
    if (!r) return [];
    return quantityCurve(
      schedule,
      elements,
      links,
      profiles,
      key,
      Array.from({ length: 31 }, (_, i) => r.start + ((r.finish - r.start) * i) / 30),
    );
  }, [usable, schedule, elements, links, profiles, key]);
  if (!usable) return <p className="muted">Quantity curves need the project's model open in Stratum.</p>;
  return (
    <LineChart
      title=""
      series={[
        { id: "cur", label: "Current plan", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.current })) },
        { id: "base", label: "Baseline", color: SERIES[1], dashed: true, points: pts.map((p) => ({ t: p.t, v: p.baseline })) },
      ]}
    />
  );
}

function ProgressTableView({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const t = useMemo(
    () => progressTable(schedule, { dimension: w.dimension ?? "wbs1", basis: w.basis ?? "cost", weightage: w.weightage }),
    [schedule, w.dimension, w.basis, w.weightage],
  );
  if (!t.rows.length) return <p className="muted">No weighted activities.</p>;
  return (
    <table className="ptable">
      <thead>
        <tr>
          <th className="ptable-dim">{w.title || "Overall"}</th>
          <th>Cum. BL Plan %</th>
          <th>Cum. Actual %</th>
          <th>Variance wrt BL (%)</th>
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.key}>
            <td className="ptable-dim">
              {r.label} ({pct(r.weightage)})
            </td>
            <td>{pct2(r.plan)}</td>
            <td>{pct2(r.actual)}</td>
            <td>{pct2(r.variance)}</td>
          </tr>
        ))}
        <tr className="ptable-total">
          <td className="ptable-dim">{w.totalLabel || "TOTAL"}</td>
          <td>{pct2(t.total.plan)}</td>
          <td>{pct2(t.total.actual)}</td>
          <td>{pct2(t.total.variance)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ProgressSCurve({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const pts = useMemo(() => progressCurve(schedule, { basis: w.basis ?? "cost", step: w.step ?? "month" }), [schedule, w.basis, w.step]);
  if (!pts.length) return <p className="muted">No weighted activities.</p>;
  const dd = schedule.dataDate;
  return (
    <div className="pscurve">
      <LineChart
        title="Cumulative progress"
        yMax={1}
        fmt={(v) => pct(v)}
        area={w.chart === "area"}
        legend={w.showLegend !== false}
        series={[
          { id: "plan", label: "Cum. BL Plan %", short: "Plan", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.plan })) },
          { id: "actual", label: "Cum. Actual %", short: "Actual", color: SERIES[1], points: pts.map((p) => ({ t: p.t, v: p.actual })) },
          { id: "fc", label: "Forecast %", short: "Forecast", color: SERIES[2], dashed: true, points: pts.filter((p) => dd === null || p.t >= dd - 31 * 86_400_000).map((p) => ({ t: p.t, v: p.forecast })) },
        ].filter((x) => !w.hiddenSeries?.includes(x.id))}
        markers={dd !== null ? [{ t: dd, label: `Data date ${fmtDay(dd)}`, color: "#0b2a8a" }] : []}
      />
      <PeriodBars
        title={w.step === "week" ? "Weekly progress" : "Monthly progress"}
        fmt={(v) => pct(v)}
        periods={pts.map((p) => ({ t: p.t, values: { plan: p.periodPlan, actual: p.periodActual } }))}
        series={[
          { id: "plan", label: "Planned in period", color: SERIES[0] },
          { id: "actual", label: "Achieved in period", color: SERIES[1] },
        ]}
      />
    </div>
  );
}

function InfoTable({ w, schedule }: { w: Widget; schedule: Schedule }) {
  const rows = w.rows ?? [];
  if (!rows.length) return <p className="muted">Add rows in the widget settings.</p>;
  return (
    <table className="itable">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.label}</td>
            <td>{r.metric ? kpi(schedule, r.metric).value : fillText(r.value || "–", schedule)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Slicer({ w, raw, slice }: { w: Widget; raw: Schedule; slice?: SliceProps }) {
  const dim = w.dimension ?? "wbs1";
  const values = useMemo(() => groupValues(raw, dim), [raw, dim]);
  const selected = slice?.slices.find((x) => x.dimension === dim)?.values ?? [];
  const toggle = (v: string) => {
    if (!slice?.onSlices) return;
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    const others = slice.slices.filter((x) => x.dimension !== dim);
    slice.onSlices(next.length ? [...others, { dimension: dim, values: next }] : others);
  };
  return (
    <div className="slicer">
      {values.map((v) => (
        <button key={v} className={selected.includes(v) ? "on" : ""} onClick={() => toggle(v)} disabled={!slice?.onSlices}>
          {v}
        </button>
      ))}
      {selected.length > 0 && slice?.onSlices && (
        <button className="link" onClick={() => slice.onSlices!(slice.slices.filter((x) => x.dimension !== dim))}>
          clear
        </button>
      )}
    </div>
  );
}

export { compact };

/** Report header: logo, title and subtitle from the dashboard's page set-up. */
export function PageHead({ dash, schedule, print = false }: { dash: Dashboard; schedule: Schedule | null; print?: boolean }) {
  const pg = dash.page ?? {};
  const title = pg.header ? fillText(pg.header, schedule) : print ? (schedule ? `${schedule.projectCode} – ${schedule.projectName}` : dash.name) : "";
  const sub = pg.subtitle ? fillText(pg.subtitle, schedule) : print ? `${dash.name} · Data date ${fmtDay(schedule?.dataDate ?? null)}` : "";
  if (!title && !sub && !pg.logo && !print) return null;
  return (
    <div className={`page-head ${print ? "" : "screen"}`}>
      {pg.logo ? (
        <img src={pg.logo} alt="" className="custom" />
      ) : dash.theme === "executive" ? (
        <img src="./stratum-logo-dark.png" alt="Stratum 4D" />
      ) : (
        <>
          <img src="./stratum-logo.png" alt="Stratum 4D" className="logo-light" />
          <img src="./stratum-logo-dark.png" alt="" className="logo-dark" />
        </>
      )}
      <div className="page-head-text">
        {title && <b>{title}</b>}
        {sub && <div className="muted">{sub}</div>}
      </div>
      {pg.showDataDate && schedule?.dataDate != null && (
        <div className="page-head-dd">
          <span className="muted">Data date</span>
          <b>{fmtDay(schedule.dataDate)}</b>
        </div>
      )}
    </div>
  );
}

/** CSS variables and classes for a dashboard's page set-up. */
export function pageStyle(dash: Dashboard): { className: string; style: CSSProperties & Record<string, string | number | undefined> } {
  const pg = dash.page ?? {};
  return {
    className: `${dash.theme === "report" ? "theme-report" : dash.theme === "executive" ? "theme-exec" : ""} orient-${pg.orientation ?? "landscape"}`,
    style: { "--page-accent": pg.accent, "--page-bg": pg.background, "--dash-gap": pg.gap !== undefined ? `${pg.gap}px` : undefined },
  };
}
