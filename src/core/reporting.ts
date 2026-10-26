// Dashboards, report schedules and the shared settings model.
// Pure data and functions: used by the browser, the desktop app's main
// process and the server alike.

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
  | "banner"; // coloured section heading, e.g. "Progress 12-Oct-26"

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

export interface Widget {
  id: string;
  kind: WidgetKind;
  title: string;
  /** Grid width in twelfths (3 = quarter, 6 = half, 12 = full). */
  w: 3 | 4 | 6 | 8 | 12;
  /** Height in rows: 1 small, 2 medium, 3 large. */
  h: 1 | 2 | 3;
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
  /** Visual style: "classic" (Stratum) or "report" (navy banners, ruled tables). */
  theme?: "classic" | "report";
  updatedAt: string;
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
    return `${String(d.getUTCDate()).padStart(2, "0")}-${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}-${d.getUTCFullYear()}`;
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
      w("banner", "Progress {datadate}", { w: 12 }),
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
