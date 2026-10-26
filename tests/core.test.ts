import { demoModel, demoProfileFor, demoXer, DEMO_LINK_RULE } from "../src/core/demo";
import { applyRules, mergeLinks, unlink } from "../src/core/linking";
import { DEFAULT_PROFILES } from "../src/core/profiles";
import { parseProject, serializeProject } from "../src/core/project";
import { computeStates, phaseAt, scheduleRange, statusAt } from "../src/core/simulation";
import type { Link, Schedule } from "../src/core/types";
import { buildGanttRows } from "../src/core/wbs";
import { decodeXer, listXerProjects, parseXer, parseXerDate, parseXerTables } from "../src/core/xer";

const utc = (s: string) => Date.parse(s + "Z");

describe("XER parser", () => {
  const schedule = parseXer(demoXer());

  it("reads project header and data date", () => {
    expect(schedule.projectCode).toBe("DEMO-RC");
    expect(schedule.projectName).toBe("Demo RC Building");
    expect(schedule.dataDate).toBe(utc("2026-04-20T08:00"));
  });

  it("reads activities with types, status and dates", () => {
    expect(schedule.activities).toHaveLength(14);
    const slab = schedule.activities.find((a) => a.code === "ST-210")!;
    expect(slab.status).toBe("in-progress");
    expect(slab.percentComplete).toBe(70);
    expect(slab.actualStart).toBe(utc("2026-04-06T08:00"));
    expect(slab.actualFinish).toBeNull();
    expect(slab.baselineFinish).toBe(utc("2026-04-17T17:00"));
    expect(slab.finish).toBe(utc("2026-04-24T17:00"));
    expect(slab.codes.Zone).toBe("Z1");
    expect(schedule.activities.find((a) => a.code === "MS-000")!.type).toBe("milestone");
    expect(schedule.activities.find((a) => a.code === "MS-999")!.type).toBe("finish-milestone");
  });

  it("drops the project root WBS node and keeps hierarchy", () => {
    expect(schedule.wbs.map((w) => w.name)).toEqual(["Substructure", "Superstructure", "Envelope", "Temporary Works"]);
    expect(schedule.wbs.every((w) => w.parentId === null)).toBe(true);
  });

  it("reads relationships with predecessor/successor the right way round", () => {
    const r = schedule.relationships.find((x) => x.successorId === "1010")!;
    expect(r.predecessorId).toBe("1000");
    expect(r.type).toBe("FS");
  });

  it("handles CRLF, windows-1252 and multiple projects", () => {
    const text = [
      "ERMHDR\t21.12",
      "%T\tPROJECT",
      "%F\tproj_id\tproj_short_name",
      "%R\t1\tA",
      "%R\t2\tB",
      "%T\tTASK",
      "%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code",
      "%R\t10\t1\tA1\tCafé fit-out\tTT_Task\tTK_NotStart",
      "%R\t20\t2\tB1\tOther\tTT_Task\tTK_NotStart",
      "%E",
    ].join("\r\n");
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const decoded = decodeXer(bytes);
    const tables = parseXerTables(decoded);
    expect(listXerProjects(tables).map((p) => p.code)).toEqual(["A", "B"]);
    const b = parseXer(decoded, { projectId: "2" });
    expect(b.activities.map((a) => a.code)).toEqual(["B1"]);
    expect(parseXer(decoded).activities[0].name).toBe("Café fit-out");
  });

  it("parses P6 dates and rejects junk", () => {
    expect(parseXerDate("2026-01-05 13:30")).toBe(utc("2026-01-05T13:30"));
    expect(parseXerDate("2026-01-05")).toBe(utc("2026-01-05T00:00"));
    expect(parseXerDate("")).toBeNull();
    expect(parseXerDate("not a date")).toBeNull();
  });

  it("throws on non-XER input", () => {
    expect(() => parseXer("hello")).toThrow(/PROJECT/);
  });
});

describe("linking", () => {
  const schedule = parseXer(demoXer());
  const elements = demoModel().map((b) => b.element);

  it("links every demo element by the activity-id property", () => {
    const links = applyRules([{ ...DEMO_LINK_RULE, profileId: "install" }], elements, schedule);
    expect(links).toHaveLength(elements.length);
    const byAct = new Set(links.map((l) => l.activityId));
    expect(byAct.size).toBe(12); // every non-milestone activity has geometry
  });

  it("supports contains/startsWith and activity codes", () => {
    const contains = applyRules(
      [{ id: "r", elementProperty: "Name", activityField: "name", match: "contains", profileId: "install", caseSensitive: false }],
      [{ id: "e1", expressId: 1, ifcType: "IfcSlab", name: "Roof Slab - pour 2", properties: {} }],
      schedule,
    );
    expect(contains.map((l) => l.activityId)).toEqual(["1080"]);
    const zone = applyRules(
      [{ id: "r", elementProperty: "Zone", activityField: "code:Zone", match: "equals", profileId: "install", caseSensitive: true }],
      [{ id: "e1", expressId: 1, ifcType: "IfcWall", name: "w", properties: { Zone: "Z2" } }],
      schedule,
    );
    expect(zone.map((l) => l.activityId).sort()).toEqual(["1070", "1080", "1110"]);
  });

  it("merges and unlinks", () => {
    const a: Link[] = [{ elementId: "e1", activityId: "x", profileId: "install" }];
    const merged = mergeLinks(a, [{ elementId: "e1", activityId: "x", profileId: "remove" }, { elementId: "e2", activityId: "x", profileId: "install" }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.elementId === "e1")!.profileId).toBe("remove");
    expect(unlink(merged, new Set(["e1"]))).toHaveLength(1);
  });
});

describe("simulation", () => {
  const schedule = parseXer(demoXer());
  const act = (code: string) => schedule.activities.find((a) => a.code === code)!;

  it("computes phase and progress", () => {
    const slab = act("ST-210");
    expect(phaseAt(slab, utc("2026-04-01T00:00"), "current").phase).toBe("before");
    const mid = phaseAt(slab, (slab.start! + slab.finish!) / 2, "current");
    expect(mid.phase).toBe("active");
    expect(mid.progress).toBeCloseTo(0.5);
    expect(phaseAt(slab, utc("2026-05-01T00:00"), "current").phase).toBe("after");
  });

  it("baseline dates shift the phase", () => {
    const l2 = act("ST-300");
    const t = utc("2026-04-22T12:00");
    expect(phaseAt(l2, t, "baseline").phase).toBe("active");
    expect(phaseAt(l2, t, "current").phase).toBe("before");
  });

  it("flags late work against the baseline", () => {
    expect(statusAt(act("ST-210"), utc("2026-04-20T12:00"))).toBe("late");
    expect(statusAt(act("ST-200"), utc("2026-04-20T12:00"))).toBe("complete");
  });

  it("applies install/remove/temporary profiles", () => {
    const sched: Schedule = {
      ...schedule,
      activities: [
        { ...act("ST-200"), id: "A", start: 100, finish: 200 },
        { ...act("ST-200"), id: "B", start: 300, finish: 400 },
      ],
    };
    const links: Link[] = [
      { elementId: "e", activityId: "A", profileId: "install" },
      { elementId: "e", activityId: "B", profileId: "remove" },
      { elementId: "tmp", activityId: "A", profileId: "temporary" },
    ];
    const at = (t: number) => computeStates(sched, links, DEFAULT_PROFILES, ["e", "tmp", "free"], t);
    expect(at(50).get("e")!.visible).toBe(false); // before install
    expect(at(150).get("e")!.color).toBe("#2e9d4f"); // installing
    expect(at(250).get("e")).toEqual({ visible: true, color: null, transparency: 0 }); // installed
    expect(at(350).get("e")!.color).toBe("#d64545"); // being removed
    expect(at(450).get("e")!.visible).toBe(false); // removed
    expect(at(50).get("tmp")!.visible).toBe(false);
    expect(at(150).get("tmp")!.visible).toBe(true);
    expect(at(250).get("tmp")!.visible).toBe(false);
    expect(at(150).get("free")!.transparency).toBeGreaterThan(0.5); // unlinked ghost
  });

  it("progressive fade makes installing elements more solid over time", () => {
    const sched: Schedule = { ...schedule, activities: [{ ...act("ST-200"), id: "A", start: 0, finish: 100 }] };
    const links: Link[] = [{ elementId: "e", activityId: "A", profileId: "install" }];
    const early = computeStates(sched, links, DEFAULT_PROFILES, ["e"], 10).get("e")!.transparency;
    const late = computeStates(sched, links, DEFAULT_PROFILES, ["e"], 90).get("e")!.transparency;
    expect(early).toBeGreaterThan(late);
  });

  it("schedule range spans first start to last finish", () => {
    const r = scheduleRange(schedule)!;
    expect(r.start).toBe(utc("2026-02-02T08:00"));
    expect(r.finish).toBe(utc("2026-06-19T17:00"));
  });

  it("demo profiles map temporary works correctly", () => {
    expect(demoProfileFor("TW-010")).toBe("temporary");
    expect(demoProfileFor("SW-100")).toBe("remove");
    expect(demoProfileFor("ST-200")).toBe("install");
  });
});

describe("gantt rows and project file", () => {
  const schedule = parseXer(demoXer());

  it("builds WBS rows with rolled-up dates and collapses", () => {
    const rows = buildGanttRows(schedule, "current");
    const sub = rows.find((r) => r.kind === "wbs" && r.label.includes("Substructure"));
    expect(sub && sub.kind === "wbs" && sub.start).toBe(utc("2026-02-02T08:00"));
    const collapsed = buildGanttRows(schedule, "current", new Set(["11"]));
    expect(collapsed.length).toBe(rows.length - 4); // Substructure holds 4 activities
  });

  it("round-trips a project file", () => {
    const text = serializeProject({ modelFileName: "a.ifc", schedule, links: [], rules: [], profiles: DEFAULT_PROFILES });
    const p = parseProject(text);
    expect(p.schedule!.activities).toHaveLength(14);
    expect(p.profiles).toHaveLength(5);
    expect(() => parseProject('{"format":"x"}')).toThrow();
  });
});
