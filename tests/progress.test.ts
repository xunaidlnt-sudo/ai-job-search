import { demoXer } from "../src/core/demo";
import { applySlices, dimensions, groupValues, progressCurve, progressTable, weights } from "../src/core/progress";
import type { Activity, Schedule } from "../src/core/types";
import { parseXer } from "../src/core/xer";

const s = parseXer(demoXer());

function act(id: string, wbsId: string, bs: string, bf: string, pct: number, hours: number, codes: Record<string, string> = {}): Activity {
  const t = (x: string) => Date.parse(x + "T00:00:00Z");
  return {
    id, code: id, name: id, wbsId, type: "task", status: pct >= 100 ? "complete" : pct > 0 ? "in-progress" : "not-started", percentComplete: pct,
    start: t(bs), finish: t(bf), baselineStart: t(bs), baselineFinish: t(bf), actualStart: pct > 0 ? t(bs) : null, actualFinish: pct >= 100 ? t(bf) : null,
    totalFloatHours: 0, originalDurationHours: hours, remainingDurationHours: hours, critical: false, calendarId: null, codes,
  };
}

describe("weighted progress", () => {
  const sched: Schedule = {
    projectId: "p", projectCode: "EPC", projectName: "EPC", dataDate: Date.parse("2026-01-11T00:00:00Z"),
    wbs: [
      { id: "E", parentId: null, code: "E", name: "Engineering", seq: 1 },
      { id: "C", parentId: null, code: "C", name: "Construction", seq: 2 },
      { id: "C1", parentId: "C", code: "C1", name: "Civil", seq: 3 },
    ],
    activities: [
      act("e1", "E", "2026-01-01", "2026-01-21", 50, 100, { Discipline: "Engineering" }), // 50% planned by 11-Jan, 50% actual
      act("c1", "C1", "2026-01-01", "2026-01-11", 20, 300, { Discipline: "Construction" }), // 100% planned, 20% actual
    ],
    relationships: [],
  };

  it("groups by top-level WBS with duration weights and a weighted total", () => {
    const t = progressTable(sched, { dimension: "wbs1", basis: "duration" });
    expect(t.rows.map((r) => r.label)).toEqual(["Engineering", "Construction"]); // WBS order, level-2 rolled into level 1
    const eng = t.rows[0];
    expect(eng.weightage).toBeCloseTo(0.25);
    expect(eng.plan).toBeCloseTo(0.5);
    expect(eng.actual).toBeCloseTo(0.5);
    const con = t.rows[1];
    expect(con.plan).toBeCloseTo(1);
    expect(con.variance).toBeCloseTo(-0.8);
    expect(t.total.plan).toBeCloseTo(0.25 * 0.5 + 0.75 * 1);
    expect(t.total.actual).toBeCloseTo(0.25 * 0.5 + 0.75 * 0.2);
  });

  it("uses manual weightage like General 3% / Engineering 7% …", () => {
    const t = progressTable(sched, { dimension: "code:Discipline", basis: "duration", weightage: { Engineering: 60, Construction: 40 } });
    expect(t.rows.find((r) => r.key === "Engineering")!.weightage).toBeCloseTo(0.6);
    expect(t.total.actual).toBeCloseTo(0.6 * 0.5 + 0.4 * 0.2);
  });

  it("filters with slicers and lists dimensions and values", () => {
    expect(dimensions(sched).map((d) => d.value)).toContain("code:Discipline");
    expect(groupValues(sched, "code:Discipline")).toEqual(["Construction", "Engineering"]);
    const only = applySlices(sched, [{ dimension: "code:Discipline", values: ["Engineering"] }]);
    expect(only.activities.map((a) => a.id)).toEqual(["e1"]);
    expect(applySlices(sched, [{ dimension: "wbs1", values: [] }]).activities).toHaveLength(2);
  });

  it("weights by cost from resource assignments on the demo", () => {
    const w = weights(s, "cost");
    expect(w.get("1060")).toBeGreaterThan(w.get("1050")!); // L1 slab costs more than L1 columns
    const t = progressTable(s, { dimension: "wbs1", basis: "cost" });
    expect(t.total.weightage).toBeCloseTo(1);
    expect(t.rows.find((r) => r.label === "Substructure")!.actual).toBeCloseTo(1);
    expect(t.total.variance).toBeLessThan(0); // demo is behind
  });

  it("builds a monthly cumulative S-curve that reaches 100%", () => {
    const pts = progressCurve(s, { basis: "cost" });
    expect(pts.length).toBeGreaterThanOrEqual(5);
    expect(pts[pts.length - 1].plan).toBeCloseTo(1);
    expect(pts[pts.length - 1].forecast).toBeCloseTo(1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].plan).toBeGreaterThanOrEqual(pts[i - 1].plan - 1e-9);
    expect(pts.some((p) => p.actual === null)).toBe(true); // no actuals after the data date
    const sumPeriods = pts.reduce((t, p) => t + p.periodPlan, 0);
    expect(sumPeriods).toBeCloseTo(1);
  });
});
