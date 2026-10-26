// Working-time calendars and work-hour arithmetic.
//
// All times are epoch ms read as UTC wall-clock time (the same convention as
// the XER reader), so a P6 "08:00" is 08:00 here regardless of the user's zone.

import type { Calendar } from "./types";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export function dayStart(t: number): number {
  return Math.floor(t / DAY) * DAY;
}

/** Monday–Friday, 08:00–12:00 and 13:00–17:00 (8 h/day). */
export function standardCalendar(id = "std", name = "Standard 5-day"): Calendar {
  const work: [number, number][] = [
    [8, 12],
    [13, 17],
  ];
  return { id, name, week: [[], work, work, work, work, work, []], holidays: [], hoursPerDay: 8 };
}

/** Seven days a week, 24 hours (for curing, lead times and similar). */
export function continuousCalendar(id = "24x7", name = "24/7"): Calendar {
  const all: [number, number][] = [[0, 24]];
  return { id, name, week: [all, all, all, all, all, all, all], holidays: [], hoursPerDay: 24 };
}

interface Index {
  holidays: Set<number>;
  workdays: Map<number, [number, number][]>;
}
const indexCache = new WeakMap<Calendar, Index>();

function index(cal: Calendar): Index {
  let ix = indexCache.get(cal);
  if (!ix) {
    ix = {
      holidays: new Set(cal.holidays.map(dayStart)),
      workdays: new Map((cal.workdays ?? []).map((w) => [dayStart(w.date), w.spans])),
    };
    indexCache.set(cal, ix);
  }
  return ix;
}

/** Working spans for the day starting at `day` (UTC midnight), as absolute ms intervals. */
export function spansOn(cal: Calendar, day: number): [number, number][] {
  const ix = index(cal);
  let spans: [number, number][];
  const override = ix.workdays.get(day);
  if (override) spans = override;
  else if (ix.holidays.has(day)) spans = [];
  else spans = cal.week[new Date(day).getUTCDay()] ?? [];
  return spans.map(([a, b]) => [day + a * HOUR, day + b * HOUR]);
}

function hasAnyWork(cal: Calendar): boolean {
  return cal.week.some((d) => d.some(([a, b]) => b > a)) || (cal.workdays ?? []).length > 0;
}

const MAX_DAYS = 365 * 60;

/**
 * Add working hours to t. A result that lands exactly on the end of a working
 * span stays there (a task finishing at 17:00 finishes at 17:00, not 08:00 the
 * next morning). Adding 0 returns t unchanged.
 */
export function addWorkHours(cal: Calendar, t: number, hours: number): number {
  if (hours < 0) return subtractWorkHours(cal, t, -hours);
  if (hours === 0) return t;
  if (!hasAnyWork(cal)) throw new Error(`Calendar "${cal.name}" has no working time`);
  let rem = hours * HOUR;
  for (let day = dayStart(t), i = 0; i < MAX_DAYS; day += DAY, i++) {
    for (const [a, b] of spansOn(cal, day)) {
      const s = Math.max(t, a);
      if (s >= b) continue;
      const avail = b - s;
      if (rem <= avail) return s + rem;
      rem -= avail;
    }
  }
  throw new Error("Date arithmetic ran past 60 years; check the calendar");
}

/** Subtract working hours. A result exactly on the start of a span stays there. */
export function subtractWorkHours(cal: Calendar, t: number, hours: number): number {
  if (hours < 0) return addWorkHours(cal, t, -hours);
  if (hours === 0) return t;
  if (!hasAnyWork(cal)) throw new Error(`Calendar "${cal.name}" has no working time`);
  let rem = hours * HOUR;
  for (let day = dayStart(t), i = 0; i < MAX_DAYS; day -= DAY, i++) {
    const spans = spansOn(cal, day);
    for (let k = spans.length - 1; k >= 0; k--) {
      const [a, b] = spans[k];
      const e = Math.min(t, b);
      if (e <= a) continue;
      const avail = e - a;
      if (rem <= avail) return e - rem;
      rem -= avail;
    }
  }
  throw new Error("Date arithmetic ran past 60 years; check the calendar");
}

/** Earliest working moment at or after t (a start date). */
export function nextWorkStart(cal: Calendar, t: number): number {
  if (!hasAnyWork(cal)) return t;
  for (let day = dayStart(t), i = 0; i < MAX_DAYS; day += DAY, i++) {
    for (const [a, b] of spansOn(cal, day)) {
      if (t < b) return Math.max(t, a);
    }
  }
  return t;
}

/** Latest working moment at or before t (a finish date). */
export function prevWorkEnd(cal: Calendar, t: number): number {
  if (!hasAnyWork(cal)) return t;
  for (let day = dayStart(t), i = 0; i < MAX_DAYS; day -= DAY, i++) {
    const spans = spansOn(cal, day);
    for (let k = spans.length - 1; k >= 0; k--) {
      const [a, b] = spans[k];
      if (t > a) return Math.min(t, b);
    }
  }
  return t;
}

/** Working hours between a and b (negative when b < a). */
export function workHoursBetween(cal: Calendar, a: number, b: number): number {
  if (b < a) return -workHoursBetween(cal, b, a);
  let total = 0;
  for (let day = dayStart(a); day < b; day += DAY) {
    for (const [s, e] of spansOn(cal, day)) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (hi > lo) total += hi - lo;
    }
  }
  return total / HOUR;
}

// ---------------------------------------------------------------------------
// P6 calendar data (CALENDAR.clndr_data)
//
// P6 stores calendars as nested "(0||Name(args)(children))" records. Weekdays
// are numbered 1 = Sunday .. 7 = Saturday; exception dates are serial day
// numbers counted from 1899-12-30. An exception with no time spans is a
// holiday; one with spans is a working day with those hours.
// ---------------------------------------------------------------------------

const P6_EPOCH = Date.UTC(1899, 11, 30);

function hhmm(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}

function spansIn(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /s\|(\d{1,2}:\d{2})\|f\|(\d{1,2}:\d{2})|f\|(\d{1,2}:\d{2})\|s\|(\d{1,2}:\d{2})/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const s = hhmm(m[1] ?? m[4]);
    let f = hhmm(m[2] ?? m[3]);
    if (f === 0) f = 24; // "f|00:00" means midnight at the end of the day
    if (f > s) spans.push([s, f]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

export function parseP6CalendarData(id: string, name: string, data: string, hoursPerDay?: number): Calendar {
  const week: [number, number][][] = [[], [], [], [], [], [], []];
  const holidays: number[] = [];
  const workdays: { date: number; spans: [number, number][] }[] = [];

  const dowStart = data.indexOf("DaysOfWeek");
  const excStart = data.indexOf("Exceptions");
  if (dowStart >= 0) {
    const block = data.slice(dowStart, excStart > dowStart ? excStart : undefined);
    const heads = [...block.matchAll(/\(0\|\|([1-7])\(\)\(/g)];
    heads.forEach((h, i) => {
      const from = (h.index ?? 0) + h[0].length;
      const to = i + 1 < heads.length ? heads[i + 1].index : block.length;
      week[Number(h[1]) - 1] = spansIn(block.slice(from, to));
    });
  }
  if (excStart >= 0) {
    const block = data.slice(excStart);
    const heads = [...block.matchAll(/\(0\|\|\d+\(d\|(\d+)\)\(/g)];
    heads.forEach((h, i) => {
      const from = (h.index ?? 0) + h[0].length;
      const to = i + 1 < heads.length ? heads[i + 1].index : block.length;
      const date = P6_EPOCH + Number(h[1]) * DAY;
      const spans = spansIn(block.slice(from, to));
      if (spans.length) workdays.push({ date, spans });
      else holidays.push(date);
    });
  }
  const parsedAny = week.some((d) => d.length);
  const cal: Calendar = parsedAny
    ? { id, name, week, holidays, workdays, hoursPerDay: hoursPerDay ?? 8 }
    : { ...standardCalendar(id, name), holidays, workdays, hoursPerDay: hoursPerDay ?? 8 };
  return cal;
}

/** Encode a calendar back into P6 clndr_data (used by the XER exporter for new calendars). */
export function toP6CalendarData(cal: Calendar): string {
  const t = (h: number) => `${String(Math.floor(h % 24 === 0 && h > 0 ? 0 : h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const spans = (list: [number, number][]) => list.map(([a, b], i) => `(0||${i}(s|${t(a)}|f|${t(b)})())`).join("");
  const days = cal.week.map((d, i) => `(0||${i + 1}()(${spans(d)}))`).join("");
  const ex = [
    ...cal.holidays.map((d) => ({ d, s: [] as [number, number][] })),
    ...(cal.workdays ?? []).map((w) => ({ d: w.date, s: w.spans })),
  ]
    .map((e, i) => `(0||${i}(d|${Math.round((dayStart(e.d) - P6_EPOCH) / DAY)})(${spans(e.s)}))`)
    .join("");
  return `(0||CalendarData()((0||DaysOfWeek()(${days}))(0||Exceptions()(${ex}))))`;
}
