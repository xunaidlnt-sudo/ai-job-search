// Excel workbook attached to reports: summary KPIs, activity lists, EVM curve
// and resource usage, built from the same functions as the dashboard.

import ExcelJS from "exceljs";
import { activityRows, kpi, portfolioRow, resourceHistogram, sCurves, type PortfolioRow } from "../core/dashboardData";
import { applySlices, progressCurve, progressTable } from "../core/progress";
import type { Dashboard, KpiMetric } from "../core/reporting";
import type { Schedule } from "../core/types";

const toDate = (t: number | null) => (t === null ? null : new Date(t));

const HEADER: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2123" } },
};

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; numFmt?: string }[]) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
  ws.getRow(1).eachCell((cell) => Object.assign(cell, { style: { ...cell.style, ...HEADER } }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

export async function buildWorkbook(s: Schedule, opts: { dashboard?: Dashboard; portfolio?: { id: string; schedule: Schedule }[] } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stratum 4D";
  wb.created = new Date();

  const metrics: KpiMetric[] = ["dataDate", "finish", "finishVariance", "percentComplete", "spi", "cpi", "bac", "ev", "ac", "eac", "vac", "activities", "critical", "late"];
  const sum = sheet(wb, "Summary", [
    { header: "Measure", key: "label", width: 26 },
    { header: "Value", key: "value", width: 18 },
    { header: "Note", key: "hint", width: 30 },
  ]);
  sum.addRow({ label: "Project", value: `${s.projectCode} – ${s.projectName}` });
  for (const m of metrics) {
    const k = kpi(s, m);
    sum.addRow({ label: k.label, value: k.value, hint: k.hint ?? "" });
  }

  // Weighted progress, using the dashboard's progress widget settings when it has one.
  const pw = opts.dashboard?.widgets.find((w) => w.kind === "progress");
  const sliced = applySlices(s, opts.dashboard?.slices);
  const pt = progressTable(sliced, { dimension: pw?.dimension ?? "wbs1", basis: pw?.basis ?? "cost", weightage: pw?.weightage });
  if (pt.rows.length) {
    const ws = sheet(wb, "Progress", [
      { header: pw?.title || "Overall", key: "label", width: 30 },
      { header: "Weightage", key: "weightage", width: 12, numFmt: "0.0%" },
      { header: "Cum. BL Plan %", key: "plan", width: 15, numFmt: "0.00%" },
      { header: "Cum. Actual %", key: "actual", width: 15, numFmt: "0.00%" },
      { header: "Variance wrt BL (%)", key: "variance", width: 20, numFmt: "0.00%" },
    ]);
    for (const r of pt.rows) ws.addRow(r);
    const total = ws.addRow({ ...pt.total, label: pw?.totalLabel || "TOTAL" });
    total.font = { bold: true };
    total.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBE5F1" } }));
    const curve = progressCurve(sliced, { basis: pw?.basis ?? "cost" });
    const cs = sheet(wb, "Progress S-Curve", [
      { header: "Period end", key: "t", width: 13, numFmt: "dd-mmm-yy" },
      { header: "Cum. BL Plan %", key: "plan", width: 15, numFmt: "0.00%" },
      { header: "Cum. Actual %", key: "actual", width: 15, numFmt: "0.00%" },
      { header: "Forecast %", key: "forecast", width: 13, numFmt: "0.00%" },
      { header: "Period Plan %", key: "periodPlan", width: 14, numFmt: "0.00%" },
      { header: "Period Actual %", key: "periodActual", width: 15, numFmt: "0.00%" },
    ]);
    for (const p of curve) cs.addRow({ ...p, t: new Date(p.t) });
  }

  const actCols = [
    { header: "Activity ID", key: "code", width: 14 },
    { header: "Name", key: "name", width: 42 },
    { header: "Status", key: "status", width: 12 },
    { header: "% Complete", key: "percent", width: 11 },
    { header: "Start", key: "start", width: 12, numFmt: "dd-mmm-yy" },
    { header: "Finish", key: "finish", width: 12, numFmt: "dd-mmm-yy" },
    { header: "Baseline Finish", key: "baselineFinish", width: 15, numFmt: "dd-mmm-yy" },
    { header: "Variance (d)", key: "varianceDays", width: 12 },
    { header: "Total Float (d)", key: "totalFloatDays", width: 14 },
    { header: "Critical", key: "critical", width: 9 },
  ];
  const addActs = (name: string, rows: ReturnType<typeof activityRows>) => {
    const ws = sheet(wb, name, actCols);
    for (const r of rows) ws.addRow({ ...r, start: toDate(r.start), finish: toDate(r.finish), baselineFinish: toDate(r.baselineFinish), critical: r.critical ? "Yes" : "" });
    ws.autoFilter = { from: "A1", to: "J1" };
  };
  addActs("Late & Critical", activityRows(s, "late"));
  addActs("Look-ahead 3 weeks", activityRows(s, "starting-soon", { days: 21 }));
  addActs("All Activities", activityRows(s, "all"));

  const curve = sCurves(s, (s.assignments ?? []).some((x) => x.budgetCost > 0) ? "cost" : "hours");
  if (curve.length) {
    const ws = sheet(wb, "S-Curve", [
      { header: "Week", key: "t", width: 12, numFmt: "dd-mmm-yy" },
      { header: "Planned", key: "pv", width: 14, numFmt: "#,##0" },
      { header: "Earned", key: "ev", width: 14, numFmt: "#,##0" },
      { header: "Actual", key: "ac", width: 14, numFmt: "#,##0" },
      { header: "Forecast", key: "forecast", width: 14, numFmt: "#,##0" },
    ]);
    for (const p of curve) ws.addRow({ ...p, t: new Date(p.t) });
  }

  const hist = resourceHistogram(s);
  if (hist.bars.length) {
    const ws = sheet(wb, "Resources by Week", [
      { header: "Week", key: "t", width: 12, numFmt: "dd-mmm-yy" },
      ...hist.resources.map((r) => ({ header: `${r.code} (${r.unit})`, key: r.id, width: 14, numFmt: "#,##0.0" })),
      { header: "Total", key: "total", width: 12, numFmt: "#,##0.0" },
    ]);
    for (const b of hist.bars) ws.addRow({ t: new Date(b.t), total: b.total, ...b.byResource });
  }

  if (opts.portfolio?.length) {
    const ws = sheet(wb, "Portfolio", [
      { header: "Project", key: "code", width: 14 },
      { header: "Name", key: "name", width: 34 },
      { header: "Data Date", key: "dataDate", width: 12, numFmt: "dd-mmm-yy" },
      { header: "Finish", key: "finish", width: 12, numFmt: "dd-mmm-yy" },
      { header: "Variance (d)", key: "varianceDays", width: 12 },
      { header: "% Complete", key: "percent", width: 11, numFmt: "0.0%" },
      { header: "SPI", key: "spi", width: 8, numFmt: "0.00" },
      { header: "CPI", key: "cpi", width: 8, numFmt: "0.00" },
      { header: "Late", key: "late", width: 8 },
    ]);
    for (const p of opts.portfolio) {
      const r: PortfolioRow = portfolioRow(p.id, p.schedule);
      ws.addRow({ ...r, dataDate: toDate(r.dataDate), finish: toDate(r.finish) });
    }
  }

  // Uint8Array so the same code runs in the browser (download) and in Node (email attachment).
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
