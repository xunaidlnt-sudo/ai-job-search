import { demoModel, demoProfileFor, demoXer, DEMO_LINK_RULE } from "../src/core/demo";
import { evm, evmByWbs, resourceHistogram, sCurves } from "../src/core/evm";
import { applyRules } from "../src/core/linking";
import { DEFAULT_PROFILES } from "../src/core/profiles";
import { COUNT_KEY, numericPropertyKeys, quantityCurve, takeoff, toNumber } from "../src/core/quantities";
import { parseXer } from "../src/core/xer";

const s = parseXer(demoXer());

describe("XER resources, costs, UDFs, calendars", () => {
  it("imports them", () => {
    expect(s.resources!.map((r) => r.code)).toContain("CRANE");
    expect(s.resources!.find((r) => r.code === "C40")!.type).toBe("material");
    expect(s.resources!.find((r) => r.code === "GANG")!.pricePerUnit).toBe(55);
    expect(s.assignments!.length).toBeGreaterThan(15);
    expect(s.activities.find((a) => a.code === "SW-100")!.userFields).toEqual({ Subcontractor: "GroundWorks Ltd" });
    expect(s.calendars![0].week[1]).toEqual([[8, 12], [13, 17]]);
    expect(s.defaultCalendarId).toBe("1");
  });
});

describe("earned value", () => {
  const m = evm(s, "cost");

  it("computes BAC, PV, EV, AC and indices at the data date", () => {
    expect(m.bac).toBeGreaterThan(0);
    expect(m.ev).toBeLessThan(m.bac);
    expect(m.ac).toBeGreaterThan(0);
    // ST-210 and SW-110 overran, so CPI < 1
    expect(m.cpi!).toBeLessThan(1);
    // ST-210 slipped past its baseline, so SPI < 1
    expect(m.spi!).toBeLessThan(1);
    expect(m.eac).toBeCloseTo(m.ac + m.etc);
    expect(m.vac).toBeCloseTo(m.bac - m.eac);
  });

  it("rolls up by WBS", () => {
    const rows = evmByWbs(s, "cost");
    const total = rows.reduce((t, r) => t + r.metrics.bac, 0);
    expect(total).toBeCloseTo(m.bac); // flat WBS, so the parts add up
    expect(rows.find((r) => r.wbs.name === "Substructure")!.metrics.earnedPct).toBeCloseTo(1);
  });

  it("works on labour hours", () => {
    const h = evm(s, "hours");
    expect(h.bac).toBeGreaterThan(1000);
    expect(h.bac).toBeLessThan(m.bac);
  });

  it("builds cumulative S-curves that end at BAC and EAC", () => {
    const pts = sCurves(s, "cost");
    expect(pts.length).toBeGreaterThan(10);
    const last = pts[pts.length - 1];
    expect(last.pv).toBeCloseTo(m.bac, 0);
    expect(last.forecast).toBeCloseTo(m.eac, 0);
    for (let i = 1; i < pts.length; i++) expect(pts[i].pv).toBeGreaterThanOrEqual(pts[i - 1].pv - 1e-6);
    const atDd = pts.filter((p) => p.ev !== null).pop()!;
    expect(atDd.ev!).toBeLessThanOrEqual(m.ev + 1);
    expect(pts.some((p) => p.ev === null)).toBe(true); // nothing earned after the data date
  });
});

describe("resource histogram", () => {
  it("spreads quantities by week and conserves the total", () => {
    const { bars, resources } = resourceHistogram(s, { resourceIds: ["1"] });
    expect(resources.map((r) => r.code)).toEqual(["GANG"]);
    const sum = bars.reduce((t, b) => t + b.total, 0);
    const expected = s.assignments!.filter((x) => x.resourceId === "1").reduce((t, x) => t + x.actualQty + (x.remainingQty || 0), 0);
    expect(sum).toBeCloseTo(expected, 0);
    const base = resourceHistogram(s, { baseline: true, resourceIds: ["1"] });
    expect(base.bars.reduce((t, b) => t + b.total, 0)).toBeCloseTo(s.assignments!.filter((x) => x.resourceId === "1").reduce((t, x) => t + x.budgetQty, 0), 0);
  });
});

describe("quantities", () => {
  const boxes = demoModel();
  const elements = boxes.map((b) => b.element);
  const links = applyRules([{ ...DEMO_LINK_RULE, profileId: "install" }], elements, s).map((l) => ({
    ...l,
    profileId: demoProfileFor(s.activities.find((a) => a.id === l.activityId)!.code),
  }));

  it("finds numeric quantity properties, quantity sets first", () => {
    const keys = numericPropertyKeys(elements);
    expect(keys[0]).toBe("BaseQuantities.NetVolume");
    expect(keys).toContain("BaseQuantities.NetVolume");
    expect(toNumber("12,5 m3")).toBe(12.5);
  });

  it("sums installed concrete by date", () => {
    const end = takeoff(s, elements, links, DEFAULT_PROFILES, "BaseQuantities.NetVolume", Date.UTC(2026, 6, 1));
    expect(end.installed).toBeCloseTo(end.total);
    const mid = takeoff(s, elements, links, DEFAULT_PROFILES, "BaseQuantities.NetVolume", s.dataDate!);
    expect(mid.installed).toBeGreaterThan(0);
    expect(mid.installed).toBeLessThan(mid.total);
    expect(mid.byType.find((r) => r.key === "IfcSlab")!.quantity).toBeGreaterThan(100);
    const count = takeoff(s, elements, links, DEFAULT_PROFILES, COUNT_KEY, s.dataDate!);
    expect(count.total).toBeGreaterThan(40);
  });

  it("draws a cumulative curve where baseline runs ahead of the late current plan", () => {
    const pts = [Date.UTC(2026, 3, 20), Date.UTC(2026, 4, 1)];
    const c = quantityCurve(s, elements, links, DEFAULT_PROFILES, "BaseQuantities.NetVolume", pts);
    expect(c[1].baseline).toBeGreaterThanOrEqual(c[1].current);
  });
});
