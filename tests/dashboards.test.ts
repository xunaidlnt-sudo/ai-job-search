import { lookahead, milestoneRows, statusMix } from "../src/core/dashboardData";
import { BUILTIN_TEMPLATES, cloneDashboard, planningDashboard, widgetCols, widgetRows } from "../src/core/reporting";
import type { Activity, Schedule } from "../src/core/types";
import { widgetSchedule } from "../src/ui/Widgets";

const t = (x: string) => Date.parse(x + "T00:00:00Z");
function act(id: string, p: Partial<Activity>): Activity {
  return {
    id, code: id, name: id, wbsId: "W", type: "task", status: "not-started", percentComplete: 0,
    start: null, finish: null, baselineStart: null, baselineFinish: null, actualStart: null, actualFinish: null,
    totalFloatHours: 80, originalDurationHours: 80, remainingDurationHours: 80, critical: false, calendarId: null, codes: {},
    ...p,
  };
}

// Data date Wednesday 14-Oct-26; that week starts Monday 12-Oct.
const s: Schedule = {
  projectId: "p", projectCode: "GIS", projectName: "220 kV GIS", dataDate: t("2026-10-14"),
  wbs: [{ id: "W", parentId: null, code: "C", name: "Construction", seq: 1 }, { id: "E", parentId: null, code: "E", name: "Engineering", seq: 0 }],
  activities: [
    act("M1", { type: "finish-milestone", status: "complete", finish: t("2026-09-01"), baselineFinish: t("2026-08-25") }),
    act("M2", { type: "finish-milestone", finish: t("2026-12-10"), baselineFinish: t("2026-12-01"), totalFloatHours: -56 }),
    act("M3", { type: "milestone", start: t("2027-02-01"), baselineStart: t("2027-02-01"), totalFloatHours: 16 }),
    act("M4", { type: "finish-milestone", finish: t("2027-05-01"), baselineFinish: t("2027-05-01"), totalFloatHours: 400 }),
    act("A1", { status: "in-progress", percentComplete: 40, start: t("2026-10-01"), finish: t("2026-10-30"), critical: true, totalFloatHours: 0 }),
    act("A2", { start: t("2026-10-20"), finish: t("2026-11-10"), totalFloatHours: -8 }),
    act("A3", { start: t("2026-10-28"), finish: t("2026-11-20") }),
    act("A4", { start: t("2026-12-01"), finish: t("2026-12-20") }),
    act("A5", { status: "complete", percentComplete: 100, start: t("2026-09-01"), finish: t("2026-09-20"), wbsId: "E" }),
  ],
  relationships: [],
};

describe("milestone tracker", () => {
  it("rates open milestones late, at risk or on track, sorted by date", () => {
    const rows = milestoneRows(s);
    expect(rows.map((r) => [r.code, r.state, r.varianceDays])).toEqual([
      ["M2", "late", 9],
      ["M3", "at-risk", 0], // 2 days float < 5
      ["M4", "on-track", 0],
    ]);
  });
  it("includes achieved ones on request and flags late achievement", () => {
    const rows = milestoneRows(s, { showDone: true });
    expect(rows[0]).toMatchObject({ code: "M1", state: "achieved-late", varianceDays: 7 });
  });
});

describe("look-ahead", () => {
  it("groups running and upcoming work by week from the data date's Monday", () => {
    const w = lookahead(s, 3);
    expect(w.map((x) => new Date(x.from).toISOString().slice(0, 10))).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(w.map((x) => x.rows.map((r) => r.code))).toEqual([["A1"], ["A2"], ["A3"]]);
  });
});

describe("status mix", () => {
  it("counts progress status and float bands of open work", () => {
    expect(statusMix(s, "status").map((x) => x.value)).toEqual([1, 1, 3]);
    const f = Object.fromEntries(statusMix(s, "float").map((x) => [x.id, x.value]));
    expect(f).toMatchObject({ negative: 1, zero: 1, low: 2, healthy: 0 }); // 10 days counts as low
    expect(statusMix(s, "critical").map((x) => x.value)).toEqual([1, 3]);
  });
});

describe("widget filters and templates", () => {
  it("applies the widget's own filter and can ignore dashboard slicers", () => {
    const slices = [{ dimension: "wbs1", values: ["Engineering"] }];
    const w = { id: "w", kind: "table" as const, title: "", w: 6, h: 1 };
    expect(widgetSchedule(s, w, slices)!.activities.filter((a) => a.type === "task").map((a) => a.code)).toEqual(["A5"]);
    expect(widgetSchedule(s, { ...w, ignoreSlicers: true }, slices)!.activities.length).toBe(s.activities.length);
    const own = widgetSchedule(s, { ...w, ignoreSlicers: true, where: [{ dimension: "wbs1", values: ["Construction"] }] }, slices)!;
    expect(own.activities.some((a) => a.code === "A5")).toBe(false);
  });
  it("clones with fresh ids and keeps settings", () => {
    const d = planningDashboard("p");
    const c = cloneDashboard(d, "Copy", true);
    expect(c.id).not.toBe(d.id);
    expect(c.isTemplate).toBe(true);
    expect(c.widgets.map((w) => w.kind)).toEqual(d.widgets.map((w) => w.kind));
    expect(new Set([...c.widgets, ...d.widgets].map((w) => w.id)).size).toBe(d.widgets.length * 2);
    expect(BUILTIN_TEMPLATES.map((x) => x.id)).toContain("planning");
  });
  it("maps free sizes onto the grid", () => {
    expect([widgetCols(0), widgetCols(5), widgetCols(40)]).toEqual([6, 5, 12]);
    expect([widgetRows(0.5), widgetRows(1), widgetRows(3), widgetRows(2.5)]).toEqual([1, 2, 6, 5]);
  });
});
