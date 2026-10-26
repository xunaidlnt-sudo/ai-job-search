// Dashboards, report schedules and the shared settings model.
// Pure data and functions: used by the browser, the desktop app's main
// process and the server alike.
import { monthShort } from "./dates";

export type WidgetKind =
  | "kpi" // one number: SPI, CPI, finish date, % complete…
  | "scurve" // cumulative PV/EV/AC/forecast
  | "histogram" // weekly resource usage
  | "table" // activity list with a filter
  | "quantity" // installed quantity curve
  | "portfolio" // one row per project in the database
  | "text" // heading or note
  | "progress" // weighted progress table: Cum. BL Plan %, Cum. Actual %, Variance
  | "pscurve" // cumulative progress % S-curve (plan / actual / forecast) with period bars
  | "info" // key figures table: label + value (computed or entered)
  | "slicer" // filter buttons for a dimension (Discipline, Package…)
  | "banner" // coloured section heading, e.g. "Progress 12-Oct-26"
  | "gauge" // dial for SPI, CPI or % complete with red/amber/green bands
  | "milestones" // milestone tracker: baseline vs forecast, days late, status
  | "lookahead" // 2–6 week look-ahead grouped by week
  | "groupbars" // plan vs actual % by discipline / WBS / code
  | "phasecurves" // one progress S-curve per discipline (E, P, C…)
  | "donut" // status mix: progress status, float bands or critical share
  | "image"; // logo, photo or site picture

export type KpiMetric =
  | "finish"
  | "finishVariance"
  | "dataDate"
  | "percentComplete"
  | "spi"
  | "cpi"
  | "bac"
  | "eac"
  | "vac"
  | "ev"
  | "ac"
  | "activities"
  | "critical"
  | "late"
  | "startingSoon";

export type TableFilter = "critical" | "late" | "in-progress" | "starting-soon" | "finishing-soon" | "negative-float" | "all";

/** Columns an activity table can show. "dim:<dimension>" shows a WBS level or activity code. */
export type TableColumn =
  | "code"
  | "name"
  | "wbs"
  | "status"
  | "percent"
  | "start"
  | "finish"
  | "blStart"
  | "blFinish"
  | "actualStart"
  | "actualFinish"
  | "variance"
  | "totalFloat"
  | "origDur"
  | "remDur"
  | "critical"
  | `dim:${string}`;

export interface WidgetStyle {
  /** Accent for the header bar and chart highlights. */
  accent?: string;
  /** Card background. */
  background?: string;
  /** Text colour of the body. */
  color?: string;
  hideTitle?: boolean;
  /** Header look: plain text, a filled bar in the accent colour, or underlined. */
  header?: "plain" | "filled" | "underline";
  /** Body text size, 0.8–1.6. */
  fontScale?: number;
  align?: "left" | "center" | "right";
  border?: "card" | "line" | "none";
}

export interface Widget {
  id: string;
  kind: WidgetKind;
  title: string;
  /** Grid width in twelfths, 1–12 (3 = quarter, 6 = half, 12 = full). */
  w: number;
  /** Height in units of about 130 px, 0.5–8 in half steps. */
  h: number;
  style?: WidgetStyle;
  /** Filters on this widget only, on top of the dashboard slicers. */
  where?: { dimension: string; values: string[] }[];
  /** Ignore the dashboard's slicer buttons. */
  ignoreSlicers?: boolean;
  /** Activity table: columns in order, and sort. */
  columns?: TableColumn[];
  sort?: { by: TableColumn; desc?: boolean };
  /** KPI / gauge: decimals, prefix and suffix, and the red/green limits. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Value at or beyond which the tile turns green; with bad, the direction follows. */
  good?: number;
  bad?: number;
  /** Charts: line or area, legend, which series to show. */
  chart?: "line" | "area";
  showLegend?: boolean;
  hiddenSeries?: string[];
  /** Look-ahead length in weeks. */
  weeks?: number;
  /** Donut: what to split by. */
  split?: "status" | "float" | "critical";
  /** Milestones: show achieved ones too. */
  showDone?: boolean;
  /** Image as a data URL. */
  image?: string;
  fit?: "contain" | "cover";
  /** Project to read; null = the dashboard's project. */
  projectId?: string | null;
  metric?: KpiMetric;
  measure?: "cost" | "hours";
  filter?: TableFilter;
  /** Window for "starting/finishing soon", days. */
  days?: number;
  limit?: number;
  quantityKey?: string;
  text?: string;
  /** Grouping for progress tables and slicers: "wbs1", "wbs2", "code:<Type>", "user:<Field>". */
  dimension?: string;
  /** What weights activities in progress widgets. */
  basis?: "cost" | "hours" | "duration" | "equal";
  /** Manual row weightage in percent, e.g. { Engineering: 7, Procurement: 50 }. */
  weightage?: Record<string, number>;
  /** Label of the TOTAL row, e.g. "TOTAL EPC". */
  totalLabel?: string;
  /** Rows of an "info" table. */
  rows?: InfoRow[];
  /** Step of the progress S-curve. */
  step?: "month" | "week";
}

export interface InfoRow {
  label: string;
  /** A computed measure, or null for a value typed in each period. */
  metric: KpiMetric | null;
  value?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  /** Default project for the widgets; null for portfolio dashboards. */
  projectId: string | null;
  widgets: Widget[];
  /** Current slicer selections, applied to every widget. */
  slices?: { dimension: string; values: string[] }[];
  /** Visual style: "classic" (Stratum), "report" (navy banners, ruled tables) or "executive" (dark tiles). */
  theme?: "classic" | "report" | "executive";
  /** Page set-up: header, logo, footer, colours, spacing. */
  page?: DashboardPage;
  /** Listed under Templates; "New from template" copies it. */
  isTemplate?: boolean;
  updatedAt: string;
}

export interface DashboardPage {
  orientation?: "landscape" | "portrait";
  /** Shown above the widgets on screen and in the PDF. Placeholders {project}, {datadate}. */
  header?: string;
  subtitle?: string;
  /** Company logo as a data URL (kept small: under 300 kB). */
  logo?: string;
  footer?: string;
  /** Main colour: banners, headers, chart highlight. */
  accent?: string;
  /** Page background behind the cards. */
  background?: string;
  /** Space between widgets in px. */
  gap?: number;
  /** Default card look for widgets without their own. */
  border?: "card" | "line" | "none";
  showDataDate?: boolean;
}

export type Frequency = "daily" | "weekly" | "monthly";

export interface ReportSchedule {
  id: string;
  name: string;
  dashboardId: string;
  /** Overrides the dashboard's project; null keeps it. */
  projectId: string | null;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  frequency: Frequency;
  /** "HH:MM" in the schedule's time zone. */
  time: string;
  /** Weekly: 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Monthly: day of month 1–28, or -1 for the last day. */
  monthDay: number;
  /** Minutes east of UTC (Dubai = 240). */
  utcOffsetMinutes: number;
  formats: ("pdf" | "xlsx")[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ReportRun {
  id: string;
  scheduleId: string;
  at: string;
  status: "sent" | "failed";
  message: string;
  manual: boolean;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** true = TLS from the start (465); false = STARTTLS if offered (587/25). */
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export type P6ConnectionKind = "eppm" | "p6-sqlserver" | "p6-oracle" | "p6-sqlite";

export interface P6Connection {
  id: string;
  name: string;
  kind: P6ConnectionKind;
  /** EPPM: REST prefix, e.g. https://p6.company.com/p6ws/restapi */
  url?: string;
  /** EPPM database name (the "DatabaseName" login parameter). */
  database?: string;
  /** EPPM: "session" (username/password login) or "bearer" (OAuth token, e.g. Oracle cloud). */
  auth?: "session" | "bearer";
  token?: string;
  /** Database host/port/service for P6 Professional. */
  host?: string;
  port?: number;
  /** SQL Server database name or Oracle service name. */
  service?: string;
  /** Table owner/schema, e.g. dbo (SQL Server) or ADMUSER (Oracle). */
  schema?: string;
  /** SQLite: path to the P6 Professional .db file. */
  file?: string;
  user?: string;
  password?: string;
  /** Optional company root certificate(s), PEM, trusted for this connection on top of the built-in list. */
  caCert?: string;
}

export type InterfaceMode = "p6" | "msp" | "4d";
export type StorageKind = "local" | "server";

export const uid = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function newSchedule(dashboardId: string): ReportSchedule {
  return {
    id: uid("sch"),
    name: "Weekly progress report",
    dashboardId,
    projectId: null,
    to: [],
    cc: [],
    subject: "{project} – progress report {date}",
    body: "Hello,\n\nPlease find attached the {project} progress report as of {datadate}.\n\nRegards",
    frequency: "weekly",
    time: "08:00",
    weekdays: [1],
    monthDay: 1,
    utcOffsetMinutes: 240,
    formats: ["pdf", "xlsx"],
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
  };
}

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * Next time a schedule should run strictly after `from` (UTC ms). Works in
 * the schedule's fixed UTC offset, so "08:00 Dubai" is 04:00 UTC every day.
 */
export function computeNextRun(s: Pick<ReportSchedule, "frequency" | "time" | "weekdays" | "monthDay" | "utcOffsetMinutes">, from: number): number {
  const [hh, mm] = s.time.split(":").map((x) => Number(x) || 0);
  const off = s.utcOffsetMinutes * MIN;
  // Work in "local wall time expressed as UTC".
  const local = from + off;
  const day0 = Math.floor(local / DAY) * DAY;
  for (let i = 0; i < 400; i++) {
    const day = day0 + i * DAY;
    const at = day + (hh * 60 + mm) * MIN;
    if (at <= local) continue;
    const d = new Date(day);
    if (s.frequency === "weekly" && !(s.weekdays.length ? s.weekdays : [1]).includes(d.getUTCDay())) continue;
    if (s.frequency === "monthly") {
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const want = s.monthDay === -1 ? last : Math.min(Math.max(1, s.monthDay), last);
      if (d.getUTCDate() !== want) continue;
    }
    return at - off;
  }
  throw new Error("Could not compute the next run within 400 days");
}

/** Replace {project}, {date}, {datadate} in subject/body templates. */
export function fillTemplate(t: string, vars: { project: string; date: number; dataDate: number | null; utcOffsetMinutes: number }): string {
  const fmt = (ms: number) => {
    const d = new Date(ms + vars.utcOffsetMinutes * MIN);
    return `${String(d.getUTCDate()).padStart(2, "0")}-${monthShort(d)}-${d.getUTCFullYear()}`;
  };
  return t
    .replace(/\{project\}/g, vars.project)
    .replace(/\{date\}/g, fmt(vars.date))
    .replace(/\{datadate\}/g, vars.dataDate !== null ? fmt(vars.dataDate) : "n/a");
}

/** EPC-style progress report: key figures, weighted progress table, S-curve, slicers. */
export function progressReportDashboard(projectId: string | null): Dashboard {
  const w = (kind: WidgetKind, title: string, extra: Partial<Widget>): Widget => ({ id: uid("w"), kind, title, w: 6, h: 1, ...extra });
  return {
    id: uid("dash"),
    name: "Monthly progress report",
    projectId,
    theme: "report",
    updatedAt: new Date().toISOString(),
    slices: [],
    widgets: [
      w("info", "Key figures", {
        w: 8,
        h: 2,
        rows: [
          { label: "Overall progress (actual)", metric: "percentComplete" },
          { label: "POI %", metric: null, value: "" },
          { label: "Total man-months spent against ACE", metric: null, value: "" },
          { label: "Provisions to be liquidated", metric: null, value: "" },
          { label: "WISA attendance %", metric: null, value: "" },
        ],
      }),
      w("kpi", "Schedule Data Date", { w: 4, metric: "dataDate" }),
      w("slicer", "Discipline", { w: 4, dimension: "wbs1" }),
      w("banner", "Progress {datadate}", { w: 12, h: 0.5 }),
      w("progress", "Overall", { w: 12, h: 2, dimension: "wbs1", basis: "cost", totalLabel: "TOTAL EPC" }),
      w("pscurve", "Progress S-curve", { w: 12, h: 3, basis: "cost", step: "month" }),
    ],
  };
}

/** A starter dashboard so a new user has something useful straight away. */
export function defaultDashboard(projectId: string | null): Dashboard {
  const w = (kind: WidgetKind, title: string, extra: Partial<Widget>): Widget => ({ id: uid("w"), kind, title, w: 3, h: 1, ...extra });
  return {
    id: uid("dash"),
    name: "Project status",
    projectId,
    updatedAt: new Date().toISOString(),
    widgets: [
      w("kpi", "Forecast finish", { metric: "finish" }),
      w("kpi", "Finish variance vs baseline", { metric: "finishVariance" }),
      w("kpi", "Schedule performance (SPI)", { metric: "spi" }),
      w("kpi", "Cost performance (CPI)", { metric: "cpi" }),
      w("scurve", "Progress S-curve", { w: 8, h: 2, measure: "cost" }),
      w("kpi", "Critical activities", { metric: "critical", w: 4 }),
      w("kpi", "Late against baseline", { metric: "late", w: 4 }),
      w("table", "Critical and late activities", { filter: "late", w: 12, h: 2, limit: 15 }),
      w("table", "Starting in the next 14 days", { filter: "starting-soon", days: 14, w: 6, h: 2, limit: 12 }),
      w("histogram", "Labour and plant usage", { w: 6, h: 2 }),
    ],
  };
}

/**
 * Planning engineer's dashboard, built from what project controls people
 * share as their weekly P6 dashboards: SPI/CPI gauges, milestone tracker,
 * plan vs actual by discipline, separate E/P/C S-curves and a look-ahead.
 */
export function planningDashboard(projectId: string | null): Dashboard {
  const w = (kind: WidgetKind, title: string, extra: Partial<Widget>): Widget => ({ id: uid("w"), kind, title, w: 3, h: 1, ...extra });
  return {
    id: uid("dash"),
    name: "Planning dashboard",
    projectId,
    theme: "classic",
    page: { header: "{project}", subtitle: "Weekly schedule update · data date {datadate}", accent: "#0b4f8a", showDataDate: true },
    updatedAt: new Date().toISOString(),
    slices: [],
    widgets: [
      w("gauge", "Schedule performance (SPI)", { metric: "spi", good: 1, bad: 0.9 }),
      w("gauge", "Cost performance (CPI)", { metric: "cpi", good: 1, bad: 0.9 }),
      w("gauge", "Physical progress", { metric: "percentComplete" }),
      w("kpi", "Forecast finish", { metric: "finish" }),
      w("slicer", "Discipline", { w: 12, h: 0.5, dimension: "wbs1" }),
      w("groupbars", "Plan vs actual by discipline", { w: 6, h: 2, dimension: "wbs1", basis: "cost" }),
      w("donut", "Activity status", { w: 3, h: 2, split: "status" }),
      w("donut", "Float health", { w: 3, h: 2, split: "float" }),
      w("phasecurves", "Progress by phase", { w: 12, h: 2, dimension: "wbs1", basis: "cost", step: "month" }),
      w("milestones", "Milestone tracker", { w: 6, h: 2.5, limit: 12 }),
      w("lookahead", "3-week look-ahead", { w: 6, h: 2.5, weeks: 3, limit: 30 }),
    ],
  };
}

/** Built-in starting points shown under "New". */
export const BUILTIN_TEMPLATES: { id: string; name: string; hint: string; make: (projectId: string | null) => Dashboard }[] = [
  { id: "planning", name: "Planning dashboard", hint: "Gauges, milestones, look-ahead, E/P/C curves", make: planningDashboard },
  { id: "progress", name: "Progress report (EPC style)", hint: "Key figures, weighted progress, S-curve", make: progressReportDashboard },
  { id: "status", name: "Project status", hint: "KPIs, S-curve, critical and late work", make: defaultDashboard },
];

/** Copy a dashboard (or template) with fresh ids. */
export function cloneDashboard(d: Dashboard, name: string, asTemplate = false): Dashboard {
  return {
    ...structuredClone(d),
    id: uid("dash"),
    name,
    isTemplate: asTemplate || undefined,
    updatedAt: new Date().toISOString(),
    widgets: d.widgets.map((w) => ({ ...structuredClone(w), id: uid("w") })),
  };
}

/** Grid rows a widget spans (rows are 52 px + 12 px gap; h 1 = 2 rows). */
export const widgetRows = (h: number) => Math.max(1, Math.round((Number(h) || 1) * 2));
export const widgetCols = (w: number) => Math.min(12, Math.max(1, Math.round(Number(w) || 6)));
