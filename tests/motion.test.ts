import { demoModel, demoPaths, demoXer } from "../src/core/demo";
import { combineClips, expandElements, growthClip, motionAt, pointAlong, splitElement } from "../src/core/motion";
import { DEFAULT_PROFILES } from "../src/core/profiles";
import { computeStates } from "../src/core/simulation";
import type { Activity, Link, ModelElement, Schedule } from "../src/core/types";
import { parseXer } from "../src/core/xer";

describe("motion paths", () => {
  it("interpolates by distance along the path", () => {
    const pts: [number, number, number][] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
    expect(pointAlong(pts, 0).point).toEqual([0, 0, 0]);
    expect(pointAlong(pts, 0.25).point).toEqual([5, 0, 0]);
    expect(pointAlong(pts, 0.75).point).toEqual([10, 0, 5]);
    expect(pointAlong(pts, 1).point).toEqual([10, 0, 10]);
  });

  it("moves the demo crane over its activity", () => {
    const s = parseXer(demoXer());
    const paths = demoPaths(demoModel());
    expect(paths[0].elementIds).toHaveLength(3);
    const lg = s.activities.find((a) => a.code === "LG-100")!;
    const before = motionAt(s, paths, lg.start! - 1).get(paths[0].elementIds[0])!;
    const mid = motionAt(s, paths, (lg.start! + lg.finish!) / 2).get(paths[0].elementIds[0])!;
    const after = motionAt(s, paths, lg.finish! + 1).get(paths[0].elementIds[0])!;
    expect(before.offset).toEqual([0, 0, 0]);
    expect(mid.offset[0]).toBeGreaterThan(0);
    expect(after.offset).toEqual([26, 0, 26]);
  });
});

describe("growth and segments", () => {
  it("clips by direction and progress", () => {
    expect(growthClip("bottom-up", 0.3)).toEqual({ axis: "y", lo: 0, hi: 0.3 });
    expect(growthClip("east-west", 0.25)).toEqual({ axis: "x", lo: 0.75, hi: 1 });
    expect(growthClip("none", 0.5)).toBeNull();
    expect(combineClips({ axis: "x", lo: 0.5, hi: 1 }, { axis: "x", lo: 0, hi: 0.5 })).toEqual({ axis: "x", lo: 0.5, hi: 0.75 });
  });

  it("adds growth to installing elements during their task", () => {
    const s = parseXer(demoXer());
    const slab = s.activities.find((a) => a.code === "ST-210")!;
    const profiles = DEFAULT_PROFILES.map((p) => (p.id === "install" ? { ...p, growth: "west-east" as const } : p));
    const links: Link[] = [{ elementId: "e", activityId: slab.id, profileId: "install" }];
    const mid = computeStates(s, links, profiles, ["e"], (slab.start! + slab.finish!) / 2).get("e")!;
    expect(mid.clip!.axis).toBe("x");
    expect(mid.clip!.hi).toBeCloseTo(0.5);
    const after = computeStates(s, links, profiles, ["e"], slab.finish! + 1).get("e")!;
    expect(after.clip ?? null).toBeNull();
  });

  it("splits an element into segments that replace it, and exposes groups", () => {
    const el: ModelElement = { id: "slab", expressId: 1, ifcType: "IfcSlab", name: "Roof Slab", properties: { Storey: "Roof" } };
    const segs = splitElement("slab", "x", 3, "Pour");
    expect(segs.map((s) => [s.from, s.to])).toEqual([[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]);
    const other: ModelElement = { ...el, id: "wall", name: "Wall" };
    const out = expandElements([el, other], segs, [{ id: "g", name: "Crane 1", color: "#f00", elementIds: ["wall"] }]);
    expect(out.map((e) => e.name)).toEqual(["Roof Slab – Pour 1", "Roof Slab – Pour 2", "Roof Slab – Pour 3", "Wall"]);
    expect(out[0].properties.Segment).toBe("Pour 1");
    expect(out[3].properties.Group).toBe("Crane 1");
  });
});

describe("large models", () => {
  it("computes 4D states for 50,000 elements quickly", () => {
    const base = parseXer(demoXer());
    const tmpl = base.activities.find((a) => a.code === "ST-210")!;
    const activities: Activity[] = Array.from({ length: 2000 }, (_, i) => ({
      ...tmpl,
      id: `a${i}`,
      code: `A${i}`,
      start: tmpl.start! + i * 3_600_000,
      finish: tmpl.finish! + i * 3_600_000,
    }));
    const s: Schedule = { ...base, activities, relationships: [] };
    const ids = Array.from({ length: 50_000 }, (_, i) => `e${i}`);
    const links: Link[] = ids.map((id, i) => ({ elementId: id, activityId: `a${i % 2000}`, profileId: "install" }));
    const t0 = performance.now();
    const states = computeStates(s, links, DEFAULT_PROFILES, ids, tmpl.start! + 5 * 86_400_000);
    const ms = performance.now() - t0;
    expect(states.size).toBe(50_000);
    expect(ms).toBeLessThan(500);
  });
});
