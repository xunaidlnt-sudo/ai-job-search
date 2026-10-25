import { demoModel, demoXer } from "../src/core/demo";
import { linkHealth } from "../src/core/health";
import { applyRules, suggestRules } from "../src/core/linking";
import type { Link, Schedule } from "../src/core/types";
import { diffSchedules, remapLinks } from "../src/core/update";
import { parseXer } from "../src/core/xer";

const DAY = 86_400_000;
const base = parseXer(demoXer());
const elements = demoModel().map((b) => b.element);

/** Simulate next week's update: new internal ids, one activity slips, one removed, one added. */
function nextUpdate(s: Schedule): Schedule {
  const next = structuredClone(s);
  for (const a of next.activities) a.id = `n${a.id}`;
  const roof = next.activities.find((a) => a.code === "ST-310")!;
  roof.start! += 7 * DAY;
  roof.finish! += 7 * DAY;
  const slab = next.activities.find((a) => a.code === "ST-210")!;
  slab.percentComplete = 90;
  next.activities = next.activities.filter((a) => a.code !== "EN-410");
  next.activities.push({ ...roof, id: "nNEW", code: "ST-320", name: "Roof Waterproofing" });
  next.dataDate = (s.dataDate ?? 0) + 7 * DAY;
  return next;
}

describe("schedule update", () => {
  const next = nextUpdate(base);

  it("reports added, removed and changed activities", () => {
    const d = diffSchedules(base, next);
    expect(d.added.map((a) => a.code)).toEqual(["ST-320"]);
    expect(d.removed.map((a) => a.code)).toEqual(["EN-410"]);
    const roof = d.changed.find((c) => c.code === "ST-310")!;
    expect(roof.finishShiftDays).toBe(7);
    expect(d.changed.find((c) => c.code === "ST-210")!.pctTo).toBe(90);
    expect(d.dataDateTo! - d.dataDateFrom!).toBe(7 * DAY);
  });

  it("carries links across by Activity ID even when P6 task ids change", () => {
    const links = applyRules(
      [{ id: "r", elementProperty: "Pset_Stratum.ActivityID", activityField: "code", match: "equals", profileId: "install", caseSensitive: false }],
      elements,
      base,
    );
    const { links: kept, dropped } = remapLinks(base, next, links);
    expect(kept.every((l) => l.activityId.startsWith("n"))).toBe(true);
    // EN-410 was removed, so its 4 wall links are dropped.
    expect(dropped).toHaveLength(4);
    expect(kept.length + dropped.length).toBe(links.length);
  });
});

describe("link health", () => {
  it("finds unlinked work, unlinked elements, orphans and double installs", () => {
    const links: Link[] = [
      { elementId: elements[0].id, activityId: "1010", profileId: "install" },
      { elementId: elements[1].id, activityId: "1020", profileId: "install" },
      { elementId: elements[1].id, activityId: "1050", profileId: "install" },
      { elementId: "gone", activityId: "1020", profileId: "install" },
      { elementId: elements[2].id, activityId: "missing", profileId: "install" },
    ];
    const h = linkHealth(base, elements, links);
    expect(h.unlinkedActivities.map((a) => a.code)).not.toContain("SW-110");
    expect(h.unlinkedActivities.map((a) => a.code)).not.toContain("MS-000"); // milestones are not expected to have geometry
    expect(h.unlinkedActivities.length).toBe(11 - 3);
    expect(h.unlinkedElements).toHaveLength(elements.length - 2);
    expect(h.orphanElementLinks).toHaveLength(1);
    expect(h.orphanActivityLinks).toHaveLength(1);
    expect(h.duplicateInstalls).toHaveLength(1);
    expect(h.coverage.activities).toBeCloseTo(3 / 11);
  });
});

describe("rule suggestions", () => {
  it("finds the property that holds the activity id", () => {
    const [best] = suggestRules(elements, base);
    expect(best.elementProperty).toBe("Pset_Stratum.ActivityID");
    expect(best.activityField).toBe("code");
    expect(best.elementMatches).toBe(elements.length);
    expect(best.activityMatches).toBe(11);
  });

  it("returns nothing when no property matches", () => {
    const plain = elements.map((e) => ({ ...e, name: "x", properties: {} }));
    expect(suggestRules(plain, base)).toEqual([]);
  });
});
