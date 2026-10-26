import {
  addWorkHours,
  continuousCalendar,
  nextWorkStart,
  parseP6CalendarData,
  prevWorkEnd,
  standardCalendar,
  subtractWorkHours,
  toP6CalendarData,
  workHoursBetween,
} from "../src/core/calendar";
import { scheduleCpm, ScheduleLoopError } from "../src/core/cpm";
import { demoXer } from "../src/core/demo";
import type { Activity, Relationship, Schedule } from "../src/core/types";
import { parseXer } from "../src/core/xer";

const T = (s: string) => Date.parse(s.replace(" ", "T") + ":00Z");
const cal = standardCalendar();
const MON = "2026-03-02"; // a Monday

describe("calendar arithmetic", () => {
  it("adds working hours across lunch, evenings and weekends", () => {
    expect(addWorkHours(cal, T(`${MON} 08:00`), 8)).toBe(T(`${MON} 17:00`));
    expect(addWorkHours(cal, T(`${MON} 08:00`), 5)).toBe(T(`${MON} 14:00`));
    expect(addWorkHours(cal, T("2026-03-06 13:00"), 8)).toBe(T("2026-03-09 12:00")); // Fri -> Mon
    expect(addWorkHours(cal, T(`${MON} 08:00`), 0)).toBe(T(`${MON} 08:00`));
  });

  it("subtracts, snaps and measures", () => {
    expect(subtractWorkHours(cal, T("2026-03-09 12:00"), 8)).toBe(T("2026-03-06 13:00"));
    expect(nextWorkStart(cal, T("2026-03-06 17:00"))).toBe(T("2026-03-09 08:00"));
    expect(prevWorkEnd(cal, T("2026-03-09 08:00"))).toBe(T("2026-03-06 17:00"));
    expect(workHoursBetween(cal, T(`${MON} 08:00`), T("2026-03-09 08:00"))).toBe(40);
    expect(workHoursBetween(continuousCalendar(), T(`${MON} 00:00`), T("2026-03-03 00:00"))).toBe(24);
  });

  it("skips holidays", () => {
    const hol = { ...standardCalendar(), holidays: [T("2026-03-03 00:00")] };
    expect(addWorkHours(hol, T(`${MON} 08:00`), 16)).toBe(T("2026-03-04 17:00"));
  });

  it("parses P6 clndr_data and round-trips it", () => {
    const data =
      "(0||CalendarData()(  (0||DaysOfWeek()(    (0||1()())    (0||2()(      (0||0(s|07:00|f|12:00)())      (0||1(s|13:00|f|16:00)())))" +
      "    (0||3()(      (0||0(s|07:00|f|12:00)())      (0||1(s|13:00|f|16:00)())))    (0||4()(      (0||0(s|07:00|f|12:00)())      (0||1(s|13:00|f|16:00)())))" +
      "    (0||5()(      (0||0(s|07:00|f|12:00)())      (0||1(s|13:00|f|16:00)())))    (0||6()(      (0||0(s|07:00|f|12:00)())      (0||1(s|13:00|f|16:00)())))" +
      "    (0||7()())))  (0||VIEW(ShowTotal|Y)())  (0||Exceptions()(    (0||0(d|46085)())    (0||1(d|46087)(      (0||0(s|08:00|f|12:00)())))))))";
    const c = parseP6CalendarData("1", "Site", data, 8);
    expect(c.week[1]).toEqual([
      [7, 12],
      [13, 16],
    ]);
    expect(c.week[0]).toEqual([]);
    expect(c.week[6]).toEqual([]);
    expect(c.holidays).toEqual([Date.UTC(2026, 2, 4)]); // serial 46085 = 4 Mar 2026 (Excel-style day count)
    expect(c.workdays![0].spans).toEqual([[8, 12]]);
    const again = parseP6CalendarData("1", "Site", toP6CalendarData(c), 8);
    expect(again.week).toEqual(c.week);
    expect(again.holidays).toEqual(c.holidays);
  });
});

function act(id: string, hours: number, extra: Partial<Activity> = {}): Activity {
  return {
    id,
    code: id,
    name: id,
    wbsId: null,
    type: "task",
    status: "not-started",
    percentComplete: 0,
    start: null,
    finish: null,
    baselineStart: null,
    baselineFinish: null,
    actualStart: null,
    actualFinish: null,
    totalFloatHours: null,
    originalDurationHours: hours,
    remainingDurationHours: hours,
    critical: false,
    calendarId: null,
    codes: {},
    ...extra,
  };
}
const rel = (p: string, s: string, type: Relationship["type"] = "FS", lagHours = 0): Relationship => ({
  id: `${p}-${s}`,
  predecessorId: p,
  successorId: s,
  type,
  lagHours,
});
function sched(activities: Activity[], relationships: Relationship[], dataDate = T(`${MON} 08:00`)): Schedule {
  return { projectId: "p", projectCode: "P", projectName: "P", dataDate, activities, wbs: [], relationships, calendars: [cal] };
}
const get = (s: Schedule, id: string) => s.activities.find((a) => a.id === id)!;

describe("CPM", () => {
  it("chains finish-to-start and finds the critical path and float", () => {
    const r = scheduleCpm(
      sched(
        [act("A", 16), act("B", 8), act("C", 8), act("END", 0, { type: "finish-milestone" })],
        [rel("A", "B"), rel("B", "END"), rel("A", "C"), rel("C", "END")],
      ),
    );
    const s = r.schedule;
    expect(get(s, "A").finish).toBe(T("2026-03-03 17:00"));
    expect(get(s, "B").start).toBe(T("2026-03-04 08:00"));
    expect(get(s, "B").finish).toBe(T("2026-03-04 17:00"));
    expect(get(s, "END").finish).toBe(T("2026-03-04 17:00"));
    expect(get(s, "A").critical).toBe(true);
    expect(get(s, "C").totalFloatHours).toBe(0); // same length as B
    expect(r.projectFinish).toBe(T("2026-03-04 17:00"));
  });

  it("gives float to the shorter branch", () => {
    const r = scheduleCpm(sched([act("A", 8), act("B", 24), act("C", 8), act("D", 8)], [rel("A", "B"), rel("A", "C"), rel("B", "D"), rel("C", "D")]));
    expect(get(r.schedule, "C").totalFloatHours).toBe(16);
    expect(get(r.schedule, "C").freeFloatHours).toBe(16);
    expect(get(r.schedule, "C").critical).toBe(false);
    expect(r.criticalPath).toEqual(["A", "B", "D"]);
  });

  it("handles SS and FF with lags", () => {
    const r = scheduleCpm(sched([act("A", 40), act("B", 16), act("C", 8)], [rel("A", "B", "SS", 8), rel("A", "C", "FF", 4)]));
    expect(get(r.schedule, "B").start).toBe(T("2026-03-03 08:00")); // A start + 8h
    // A finishes Fri 17:00; C must finish 4h later => Mon 12:00, so it starts Fri 12:00... 8h back = Fri 13:00? (12:00 lunch) => Fri 13:00 -> Mon 12:00
    expect(get(r.schedule, "C").finish).toBe(T("2026-03-09 12:00"));
    expect(get(r.schedule, "C").start).toBe(T("2026-03-06 13:00"));
  });

  it("respects start-no-earlier-than and finish-no-later-than constraints", () => {
    const r = scheduleCpm(
      sched(
        [
          act("A", 8, { constraint: { type: "start-on-or-after", date: T("2026-03-05 08:00") } }),
          act("B", 8, { constraint: { type: "finish-on-or-before", date: T("2026-03-05 17:00") } }),
        ],
        [rel("A", "B")],
      ),
    );
    expect(get(r.schedule, "A").start).toBe(T("2026-03-05 08:00"));
    expect(get(r.schedule, "B").finish).toBe(T("2026-03-06 17:00"));
    expect(get(r.schedule, "B").totalFloatHours).toBe(-8); // late by a day
    expect(get(r.schedule, "B").critical).toBe(true);
  });

  it("schedules progress from the data date with retained logic", () => {
    const r = scheduleCpm(
      sched(
        [
          act("A", 0, { status: "complete", actualStart: T("2026-02-23 08:00"), actualFinish: T("2026-02-27 17:00"), percentComplete: 100 }),
          act("B", 16, { status: "in-progress", actualStart: T("2026-02-26 08:00"), originalDurationHours: 40, remainingDurationHours: 16 }),
          act("C", 8),
        ],
        [rel("A", "B"), rel("B", "C")],
        T("2026-03-04 08:00"),
      ),
    );
    const b = get(r.schedule, "B");
    expect(b.start).toBe(T("2026-02-26 08:00")); // actual start kept
    expect(b.finish).toBe(T("2026-03-05 17:00")); // 16h from data date
    expect(get(r.schedule, "C").start).toBe(T("2026-03-06 08:00"));
    expect(get(r.schedule, "A").finish).toBe(T("2026-02-27 17:00"));
  });

  it("reports logic loops by activity id", () => {
    expect(() => scheduleCpm(sched([act("A", 8), act("B", 8)], [rel("A", "B"), rel("B", "A")]))).toThrow(ScheduleLoopError);
  });

  it("derives level-of-effort dates from its neighbours and warns on open ends", () => {
    const r = scheduleCpm(
      sched([act("A", 8), act("LOE", 0, { type: "loe" }), act("B", 8)], [rel("A", "B"), rel("A", "LOE", "SS"), rel("LOE", "B", "FF")]),
    );
    expect(get(r.schedule, "LOE").start).toBe(get(r.schedule, "A").start);
    expect(get(r.schedule, "LOE").finish).toBe(get(r.schedule, "B").finish);
    expect(r.warnings.some((w) => w.startsWith("B: no successor"))).toBe(true);
  });

  it("reschedules the demo project", () => {
    const demo = parseXer(demoXer());
    const r = scheduleCpm(demo);
    expect(r.projectFinish).toBeGreaterThan(demo.dataDate!);
    const codes = r.criticalPath.map((id) => get(r.schedule, id).code);
    expect(codes).toContain("ST-310");
    // Completed work is untouched.
    expect(get(r.schedule, "1010").finish).toBe(get(demo, "1010").actualFinish);
  });
});
