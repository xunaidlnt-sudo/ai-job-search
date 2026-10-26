// The 220 kV GIS substation sample: parses, schedules cleanly, links fully,
// and its EPC weights come out close to a typical substation contract.
import { describe, expect, it } from "vitest";
import { scheduleCpm } from "../src/core/cpm";
import { GIS_PROJECT_CODE, gisModel, gisPaths, gisXer, uaeCalendar } from "../src/core/demoGis";
import { applyRules } from "../src/core/linking";
import { progressTable } from "../src/core/progress";
import { parseXerTables, xerToSchedule } from "../src/core/xer";

describe("220 kV GIS sample project", () => {
  const s = xerToSchedule(parseXerTables(gisXer()));

  it("imports as a P6 project with EPC WBS, codes, resources and a UAE calendar", () => {
    expect(s.projectCode).toBe(GIS_PROJECT_CODE);
    expect(s.activities).toHaveLength(46);
    const top = s.wbs.filter((w) => !w.parentId).map((w) => w.name);
    expect(top).toEqual(["General", "Engineering", "Procurement", "Construction"]);
    expect(new Set(s.activities.map((a) => a.codes.Discipline))).toEqual(new Set(["GEN", "ENG", "PRC", "CIV", "ELE", "TST"]));
    expect(s.resources?.length).toBe(15);
    const cal = s.calendars!.find((c) => c.name.startsWith("UAE"))!;
    expect(cal.week[0]).toEqual([]); // Sunday off
    expect(cal.week[6].length).toBeGreaterThan(0); // Saturday worked
    expect(cal.holidays.length).toBe(uaeCalendar().holidays.length);
  });

  it("weights General / Engineering / Procurement / Construction about 3 / 7 / 52 / 38 by cost", () => {
    const t = progressTable(s, { dimension: "wbs1", basis: "cost" } as never);
    const w = Object.fromEntries(t.rows.map((r) => [r.label, Math.round(r.weightage * 100)]));
    expect(w).toEqual({ General: 3, Engineering: 7, Procurement: 52, Construction: 38 });
    expect(t.total.actual).toBeGreaterThan(0.7);
    expect(t.total.actual).toBeLessThan(t.total.plan);
  });

  it("reschedules (F9) without loops or open ends, finishing on the planned date, critical through the transformers", () => {
    const r = scheduleCpm(s, { dataDate: s.dataDate! });
    expect(r.warnings).toEqual([]);
    expect(new Date(r.projectFinish).toISOString().slice(0, 10)).toMatch(/^2027-08-1[2-4]$/);
    const crit = r.schedule.activities.filter((a) => a.critical).map((a) => a.code);
    expect(crit).toEqual(expect.arrayContaining(["P-3030", "P-3040", "C-5030", "C-6010"]));
  });

  it("links every model element to an activity by the shared property", () => {
    const els = gisModel().map((b) => b.element);
    const links = applyRules([{ id: "r", elementProperty: "Pset_Stratum.ActivityID", activityField: "code", match: "equals", caseSensitive: false, profileId: "install" }], els, s);
    expect(new Set(links.map((l) => l.elementId)).size).toBe(els.length);
    const paths = gisPaths(gisModel());
    expect(paths[0].elementIds).toHaveLength(3);
  });
});
