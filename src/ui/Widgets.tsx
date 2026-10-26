import { useMemo } from "react";
import { activityRows, compact, fmtDay, kpi, portfolioRow, resourceHistogram, sCurves } from "../core/dashboardData";
import { groupValues, progressCurve, progressTable } from "../core/progress";
import { quantityCurve } from "../core/quantities";
import type { KpiMetric, TableFilter, Widget, WidgetKind } from "../core/reporting";
import { scheduleRange } from "../core/simulation";
import type { Schedule } from "../core/types";
import { LineChart, OTHER, PeriodBars, pct, pct2, SERIES, StackedBars } from "./charts";
import { useStore } from "./store";

export const WIDGET_KINDS: { kind: WidgetKind; label: string; defaults: Partial<Widget> }[] = [
  { kind: "kpi", label: "KPI tile", defaults: { w: 3, h: 1, metric: "spi" } },
  { kind: "scurve", label: "S-curve", defaults: { w: 6, h: 2, measure: "cost" } },
  { kind: "histogram", label: "Resource histogram", defaults: { w: 6, h: 2 } },
  { kind: "table", label: "Activity table", defaults: { w: 12, h: 2, filter: "critical", limit: 15 } },
  { kind: "portfolio", label: "Portfolio table", defaults: { w: 12, h: 2 } },
  { kind: "quantity", label: "Quantity curve", defaults: { w: 6, h: 2 } },
  { kind: "text", label: "Text / note", defaults: { w: 12, h: 1, text: "Notes for this report." } },
  { kind: "progress", label: "Progress table (BL plan vs actual)", defaults: { w: 12, h: 2, dimension: "wbs1", basis: "cost", totalLabel: "TOTAL" } },
  { kind: "pscurve", label: "Progress S-curve (%)", defaults: { w: 12, h: 3, basis: "cost", step: "month" } },
  { kind: "info", label: "Key figures table", defaults: { w: 6, h: 2, rows: [{ label: "Overall progress", metric: "percentComplete" }, { label: "Remarks", metric: null, value: "" }] } },
  { kind: "slicer", label: "Filter buttons (slicer)", defaults: { w: 4, h: 1, dimension: "wbs1" } },
  { kind: "banner", label: "Section banner", defaults: { w: 12, h: 1, title: "Progress {datadate}" } },
];

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
  if (w.kind === "text") return <div className="widget-text">{w.text}</div>;
  if (w.kind === "portfolio") return <PortfolioTable entries={portfolio} />;
  if (w.kind === "banner") return <div className="report-banner">{w.title.replace("{datadate}", fmtDay(schedule?.dataDate ?? null))}</div>;
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
      const k = kpi(schedule, w.metric ?? "spi", { measure: w.measure, days: w.days });
      return (
        <div className="kpi" title={k.hint}>
          <div className={`kpi-value ${k.tone ?? ""}`}>{k.value}</div>
          {k.hint && <div className="muted kpi-hint">{k.hint}</div>}
        </div>
      );
    }
    case "scurve":
      return <SCurve schedule={schedule} measure={w.measure} />;
    case "histogram":
      return <Histogram schedule={schedule} />;
    case "table":
      return <ActivityTable schedule={schedule} filter={w.filter ?? "critical"} days={w.days} limit={w.limit} />;
    case "quantity":
      return <QuantityWidget schedule={schedule} quantityKey={w.quantityKey} />;
    default:
      return null;
  }
}

function SCurve({ schedule, measure }: { schedule: Schedule; measure?: "cost" | "hours" }) {
  const hasCost = (schedule.assignments ?? []).some((x) => x.budgetCost > 0);
  const m = measure === "hours" || !hasCost ? "hours" : "cost";
  const pts = useMemo(() => sCurves(schedule, m), [schedule, m]);
  if (!pts.length) return <p className="muted">No cost or labour data in this project.</p>;
  return (
    <LineChart
      title=""
      unit={m === "hours" ? "h" : ""}
      series={[
        { id: "pv", label: "Planned", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.pv })) },
        { id: "ev", label: "Earned", color: SERIES[1], points: pts.map((p) => ({ t: p.t, v: p.ev })) },
        { id: "ac", label: "Actual", color: SERIES[2], points: pts.map((p) => ({ t: p.t, v: p.ac })) },
        { id: "fc", label: "Forecast", color: SERIES[3], dashed: true, points: pts.map((p) => ({ t: p.t, v: p.forecast })) },
      ]}
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

function ActivityTable({ schedule, filter, days, limit }: { schedule: Schedule; filter: TableFilter; days?: number; limit?: number }) {
  const rows = useMemo(() => activityRows(schedule, filter, { days, limit }), [schedule, filter, days, limit]);
  if (!rows.length) return <p className="muted">None.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>%</th>
          <th>Start</th>
          <th>Finish</th>
          <th>BL Finish</th>
          <th>Var (d)</th>
          <th>TF (d)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <b>{r.code}</b>
            </td>
            <td>{r.name}</td>
            <td>{Math.round(r.percent)}</td>
            <td>{fmtDay(r.start)}</td>
            <td>{fmtDay(r.finish)}</td>
            <td>{fmtDay(r.baselineFinish)}</td>
            <td className={(r.varianceDays ?? 0) > 0 ? "bad" : ""}>{r.varianceDays ?? ""}</td>
            <td className={(r.totalFloatDays ?? 0) < 0 ? "bad" : ""}>{r.totalFloatDays ?? ""}</td>
          </tr>
        ))}
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
        series={[
          { id: "plan", label: "Cum. BL Plan %", short: "Plan", color: SERIES[0], points: pts.map((p) => ({ t: p.t, v: p.plan })) },
          { id: "actual", label: "Cum. Actual %", short: "Actual", color: SERIES[1], points: pts.map((p) => ({ t: p.t, v: p.actual })) },
          { id: "fc", label: "Forecast %", short: "Forecast", color: SERIES[2], dashed: true, points: pts.filter((p) => dd === null || p.t >= dd - 31 * 86_400_000).map((p) => ({ t: p.t, v: p.forecast })) },
        ]}
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
            <td>{r.metric ? kpi(schedule, r.metric).value : r.value || "–"}</td>
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
