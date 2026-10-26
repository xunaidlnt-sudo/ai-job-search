// Sample project: a 220/33 kV GIS substation in Abu Dhabi, built EPC.
// Fictional: names, quantities and values are illustrative only.
//
// The schedule follows a typical UAE grid-substation job: engineering and
// authority approvals, long-lead procurement (GIS, power transformers),
// civil works for the GIS hall and control building, then electromechanical
// installation, testing and energisation. Data date 19-Oct-2026.

import type { Calendar, MotionPath } from "./types";
import { buildDemoXer, ms, type DemoBox, type DemoTask } from "./demo";

const ACTIVITY_PSET = "Pset_Stratum.ActivityID";

/** Six-day week (Mon–Sat, 07:00–16:00 with an hour's break), UAE public holidays. */
export function uaeCalendar(): Calendar {
  const work: [number, number][] = [
    [7, 12],
    [13, 16],
  ];
  // Islamic holidays follow the moon; these dates are approximate.
  const holidays = [
    "2025-12-02", "2025-12-03", "2026-01-01",
    "2026-03-19", "2026-03-20", "2026-03-21",
    "2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29",
    "2026-06-16", "2026-08-25", "2026-12-02", "2026-12-03",
    "2027-01-01", "2027-03-09", "2027-03-10", "2027-03-11",
    "2027-05-15", "2027-05-16", "2027-05-17", "2027-05-18",
  ].map((d) => Date.parse(`${d}T00:00:00Z`));
  return { id: "2", name: "UAE 6-day (Mon–Sat)", week: [[], work, work, work, work, work, work], holidays, hoursPerDay: 8 };
}

type Task = DemoTask & { codes: Record<string, string> };
const T = (
  id: string,
  code: string,
  name: string,
  wbs: string,
  start: string,
  finish: string,
  status: DemoTask["status"],
  pct: number,
  floatDays: number,
  codes: [string, string],
  extra: Partial<DemoTask> = {},
): Task => ({
  id,
  code,
  name,
  wbs,
  // Start milestones sit at the start of the day, finish milestones at its end.
  start: extra.type === "TT_FinMile" ? `${start} 16:00` : `${start} 07:00`,
  finish: extra.type === "TT_Mile" ? `${finish} 07:00` : `${finish} 16:00`,
  status,
  pct,
  float: floatDays * 8,
  codes: { Discipline: codes[0], Area: codes[1] },
  ...extra,
  bStart: extra.bStart ? `${extra.bStart} 07:00` : undefined,
  bFinish: extra.bFinish ? `${extra.bFinish} 16:00` : undefined,
});
const MILE = { type: "TT_Mile" as const };
const FMILE = { type: "TT_FinMile" as const };

// WBS ids: 20 project, 21 General, 22 Engineering, 23 Procurement, 24 Construction (241 Civil, 242 E&M, 243 T&C)
const TASKS: Task[] = [
  // ---- General
  T("2001", "G-1000", "Notice to Proceed", "21", "2025-09-01", "2025-09-01", "TK_Complete", 100, 0, ["GEN", "SITE"], MILE),
  T("2002", "G-1010", "Mobilisation & site establishment", "21", "2025-09-01", "2025-10-25", "TK_Complete", 100, 10, ["GEN", "SITE"]),
  T("2003", "G-1020", "Site facilities, HSE & supervision", "21", "2025-10-27", "2027-07-31", "TK_Active", 66, 0, ["GEN", "SITE"]),
  T("2004", "G-1030", "Authority permits & NOCs", "21", "2025-09-08", "2025-12-20", "TK_Complete", 100, 20, ["GEN", "SITE"]),
  T("2005", "G-1900", "Taking-over certificate", "21", "2027-08-14", "2027-08-14", "TK_NotStart", 0, 0, ["GEN", "SITE"], { ...FMILE, bStart: "2027-07-31", bFinish: "2027-07-31" }),
  // ---- Engineering
  T("2101", "E-2000", "Basic design & single line diagram", "22", "2025-09-08", "2025-11-15", "TK_Complete", 100, 0, ["ENG", "SITE"]),
  T("2102", "E-2010", "Geotechnical & topographic survey", "22", "2025-09-08", "2025-10-18", "TK_Complete", 100, 15, ["ENG", "SITE"]),
  T("2103", "E-2020", "Civil & structural design – GIS building", "22", "2025-10-20", "2026-01-31", "TK_Complete", 100, 0, ["ENG", "GIS"]),
  T("2104", "E-2030", "Primary design – layouts, earthing, cable sizing", "22", "2025-11-17", "2026-03-14", "TK_Complete", 100, 6, ["ENG", "SITE"]),
  T("2105", "E-2040", "Secondary design – protection, control & SCADA", "22", "2025-12-15", "2026-08-29", "TK_Complete", 100, 12, ["ENG", "CB"], { bFinish: "2026-07-25" }),
  T("2106", "E-2050", "Client approval of detailed design", "22", "2026-03-16", "2026-04-30", "TK_Complete", 100, 0, ["ENG", "SITE"], { bFinish: "2026-04-15" }),
  T("2107", "E-2060", "As-built drawings & O&M manuals", "22", "2027-06-01", "2027-07-31", "TK_NotStart", 0, 0, ["ENG", "SITE"]),
  // ---- Procurement
  T("2201", "P-3000", "220 kV GIS – design & manufacture", "23", "2025-12-01", "2026-07-31", "TK_Complete", 100, 0, ["PRC", "GIS"], { bFinish: "2026-07-11" }),
  T("2202", "P-3010", "220 kV GIS – FAT & shipping", "23", "2026-08-03", "2026-09-26", "TK_Complete", 100, 0, ["PRC", "GIS"], { bStart: "2026-07-13", bFinish: "2026-09-05" }),
  T("2203", "P-3020", "220 kV GIS delivered to site", "23", "2026-09-28", "2026-09-28", "TK_Complete", 100, 0, ["PRC", "GIS"], { ...MILE, bStart: "2026-09-07", bFinish: "2026-09-07" }),
  T("2204", "P-3030", "Power transformers 220/33 kV – manufacture", "23", "2026-01-05", "2026-10-31", "TK_Active", 85, 0, ["PRC", "TRF"], { bFinish: "2026-10-10" }),
  T("2205", "P-3040", "Power transformers – FAT, shipping & delivery", "23", "2026-11-02", "2026-12-31", "TK_NotStart", 0, 0, ["PRC", "TRF"], { bStart: "2026-10-12", bFinish: "2026-12-12" }),
  T("2206", "P-3050", "33 kV switchgear – manufacture & delivery", "23", "2026-02-02", "2026-09-19", "TK_Complete", 100, 18, ["PRC", "CB"]),
  T("2207", "P-3060", "Protection, control & SCADA panels", "23", "2026-04-06", "2026-11-28", "TK_Active", 70, 8, ["PRC", "CB"]),
  T("2208", "P-3070", "220 kV XLPE cables & accessories", "23", "2026-03-02", "2026-10-31", "TK_Active", 90, 6, ["PRC", "CBL"]),
  T("2209", "P-3080", "LVAC, DC & battery systems", "23", "2026-05-04", "2026-11-14", "TK_Active", 60, 14, ["PRC", "CB"]),
  // ---- Construction: civil
  T("2301", "C-4000", "Site clearance, levelling & temporary fencing", "241", "2025-10-27", "2025-12-06", "TK_Complete", 100, 0, ["CIV", "SITE"]),
  T("2302", "C-4010", "Piling – GIS building", "241", "2025-12-08", "2026-02-07", "TK_Complete", 100, 0, ["CIV", "GIS"], { bFinish: "2026-01-31" }),
  T("2303", "C-4020", "Raft foundation – GIS building", "241", "2026-02-09", "2026-03-28", "TK_Complete", 100, 0, ["CIV", "GIS"]),
  T("2304", "C-4030", "GIS building RC frame", "241", "2026-03-30", "2026-06-20", "TK_Complete", 100, 0, ["CIV", "GIS"]),
  T("2305", "C-4040", "GIS building roof steel & cladding", "241", "2026-06-22", "2026-08-29", "TK_Complete", 100, 0, ["CIV", "GIS"], { bFinish: "2026-08-15" }),
  T("2306", "C-4050", "EOT crane installation & load test", "241", "2026-08-31", "2026-09-19", "TK_Complete", 100, 0, ["CIV", "GIS"]),
  T("2307", "C-4060", "GIS building finishes & HVAC", "241", "2026-09-07", "2026-11-28", "TK_Active", 45, 10, ["CIV", "GIS"]),
  T("2308", "C-4070", "Control & 33 kV building – foundations & structure", "241", "2026-02-16", "2026-07-11", "TK_Complete", 100, 20, ["CIV", "CB"]),
  T("2309", "C-4080", "Transformer foundations, oil pits & firewall", "241", "2026-04-06", "2026-08-01", "TK_Complete", 100, 30, ["CIV", "TRF"]),
  T("2310", "C-4090", "Cable trenches & ducts", "241", "2026-05-04", "2026-10-31", "TK_Active", 75, 4, ["CIV", "CBL"]),
  T("2311", "C-4100", "Roads, drainage, boundary wall & gatehouse", "241", "2026-09-14", "2027-02-27", "TK_Active", 15, 40, ["CIV", "SITE"]),
  T("2312", "C-4900", "Mobile crane – transformer placing", "241", "2027-01-04", "2027-01-23", "TK_NotStart", 0, 0, ["CIV", "TRF"], { bStart: "2026-12-14", bFinish: "2027-01-02" }),
  // ---- Construction: electromechanical
  T("2401", "C-5000", "220 kV GIS installation – bays 1–5", "242", "2026-10-05", "2026-11-28", "TK_Active", 30, 6, ["ELE", "GIS"], { bStart: "2026-09-14", bFinish: "2026-11-07" }),
  T("2402", "C-5010", "220 kV GIS installation – bays 6–9", "242", "2026-11-30", "2027-01-23", "TK_NotStart", 0, 6, ["ELE", "GIS"], { bStart: "2026-11-09", bFinish: "2027-01-02" }),
  T("2403", "C-5020", "220 kV GIS HV testing", "242", "2027-01-25", "2027-02-20", "TK_NotStart", 0, 6, ["TST", "GIS"]),
  T("2404", "C-5030", "Transformer T1 – erection, oil filling & tests", "242", "2027-01-04", "2027-02-27", "TK_NotStart", 0, 0, ["ELE", "TRF"], { bStart: "2026-12-14", bFinish: "2027-02-06" }),
  T("2405", "C-5040", "Transformer T2 – erection, oil filling & tests", "242", "2027-01-18", "2027-03-13", "TK_NotStart", 0, 0, ["ELE", "TRF"], { bStart: "2026-12-28", bFinish: "2027-02-20" }),
  T("2406", "C-5050", "220 kV cable laying & terminations", "242", "2026-11-02", "2027-02-13", "TK_NotStart", 0, 10, ["ELE", "CBL"]),
  T("2407", "C-5060", "33 kV switchgear installation", "242", "2026-10-12", "2026-12-05", "TK_Active", 10, 12, ["ELE", "CB"]),
  T("2408", "C-5070", "Protection, control & SCADA panels installation", "242", "2026-12-07", "2027-03-06", "TK_NotStart", 0, 4, ["ELE", "CB"]),
  T("2409", "C-5080", "Earthing & lightning protection", "242", "2026-04-06", "2026-12-19", "TK_Active", 70, 30, ["ELE", "SITE"]),
  T("2410", "C-5090", "LVAC, DC & battery installation", "242", "2026-12-07", "2027-01-30", "TK_NotStart", 0, 14, ["ELE", "CB"]),
  // ---- Testing & commissioning
  T("2501", "C-6000", "Pre-commissioning & site acceptance tests", "243", "2027-03-15", "2027-05-29", "TK_NotStart", 0, 0, ["TST", "SITE"], { bStart: "2027-03-01", bFinish: "2027-05-15" }),
  T("2502", "C-6010", "220 kV energisation", "243", "2027-05-31", "2027-05-31", "TK_NotStart", 0, 0, ["TST", "SITE"], { ...MILE, bStart: "2027-05-17", bFinish: "2027-05-17" }),
  T("2503", "C-6020", "Trial operation & handover", "243", "2027-06-01", "2027-08-14", "TK_NotStart", 0, 0, ["TST", "SITE"], { bFinish: "2027-07-31" }),
];

// [id, code, name, type, unit, rate AED]
const RESOURCES: [string, string, string, string, string, number][] = [
  ["11", "DES", "Design engineers", "RT_Labor", "h", 260],
  ["12", "CIV", "Civil crew", "RT_Labor", "h", 38],
  ["13", "STF", "Steel fixers & formwork", "RT_Labor", "h", 36],
  ["14", "ELE", "Electrical technicians", "RT_Labor", "h", 55],
  ["15", "OEM", "GIS / transformer OEM specialists", "RT_Labor", "h", 420],
  ["16", "TST", "Testing & commissioning engineers", "RT_Labor", "h", 320],
  ["17", "CRN", "Mobile crane 200 t", "RT_Equip", "h", 950],
  ["18", "PIL", "Piling rig", "RT_Equip", "h", 1100],
  ["19", "GIS", "220 kV GIS, 9 bays", "RT_Mat", "lot", 36_000_000],
  ["20", "TRF", "Power transformer 220/33 kV", "RT_Mat", "ea", 6_500_000],
  ["21", "SWG", "33 kV switchgear", "RT_Mat", "lot", 4_200_000],
  ["22", "PNL", "Protection, control & SCADA", "RT_Mat", "lot", 3_800_000],
  ["23", "CAB", "220 kV XLPE cable system", "RT_Mat", "lot", 2_600_000],
  ["24", "AUX", "LVAC, DC & batteries", "RT_Mat", "lot", 900_000],
  ["25", "SUB", "Subcontract & lump-sum works", "RT_Mat", "AED", 1],
];

const LS = (aed: number): [string, number, boolean] => ["25", aed, true];
const LOADING: Record<string, [string, number, boolean?][]> = {
  "G-1010": [LS(600_000)],
  "G-1020": [LS(2_600_000)],
  "G-1030": [LS(250_000)],
  "E-2000": [["11", 3_400, true]],
  "E-2010": [LS(400_000)],
  "E-2020": [["11", 6_100, true]],
  "E-2030": [["11", 6_900, true]],
  "E-2040": [["11", 8_500, true]],
  "E-2050": [["11", 2_300, true]],
  "E-2060": [["11", 2_700, true]],
  "P-3000": [["19", 0.85, true]],
  "P-3010": [["19", 0.15, true]],
  "P-3030": [["20", 1.7, true]],
  "P-3040": [["20", 0.3, true]],
  "P-3050": [["21", 1, true]],
  "P-3060": [["22", 1, true]],
  "P-3070": [["23", 1, true]],
  "P-3080": [["24", 1, true]],
  "C-4000": [["12", 8], LS(900_000)],
  "C-4010": [["18", 1], ["12", 6], LS(2_900_000)],
  "C-4020": [["12", 14], ["13", 18], LS(2_100_000)],
  "C-4030": [["12", 16], ["13", 24], LS(3_900_000)],
  "C-4040": [["12", 12], ["17", 0.5], LS(3_300_000)],
  "C-4050": [["14", 4], ["15", 2], LS(650_000)],
  "C-4060": [["12", 10], ["14", 6], LS(1_800_000)],
  "C-4070": [["12", 10], ["13", 12], LS(3_000_000)],
  "C-4080": [["12", 8], ["13", 10], LS(1_700_000)],
  "C-4090": [["12", 10], LS(1_300_000)],
  "C-4100": [["12", 12], LS(2_500_000)],
  "C-4900": [["17", 1], LS(150_000)],
  "C-5000": [["15", 4], ["14", 8], LS(1_600_000)],
  "C-5010": [["15", 4], ["14", 8], LS(1_300_000)],
  "C-5020": [["16", 4], ["15", 2], LS(450_000)],
  "C-5030": [["15", 3], ["14", 6], ["17", 0.3], LS(500_000)],
  "C-5040": [["15", 3], ["14", 6], ["17", 0.3], LS(500_000)],
  "C-5050": [["14", 10], LS(1_000_000)],
  "C-5060": [["14", 8], LS(450_000)],
  "C-5070": [["14", 8], ["16", 1], LS(450_000)],
  "C-5080": [["14", 4], LS(600_000)],
  "C-5090": [["14", 6], LS(250_000)],
  "C-6000": [["16", 6], ["14", 6], LS(600_000)],
  "C-6020": [["16", 3], LS(300_000)],
};
const OVERRUN: Record<string, number> = { "C-4010": 1.06, "C-4040": 1.04, "E-2040": 1.08 };

const ID = Object.fromEntries(TASKS.map((t) => [t.code, t.id]));
const FS = (a: string, b: string, lagDays = 0): [string, string, string, number] => [ID[a], ID[b], "PR_FS", lagDays * 8];
const SS = (a: string, b: string, lagDays = 0): [string, string, string, number] => [ID[a], ID[b], "PR_SS", lagDays * 8];
const FF = (a: string, b: string, lagDays = 0): [string, string, string, number] => [ID[a], ID[b], "PR_FF", lagDays * 8];
const RELS: [string, string, string, number][] = [
  FS("G-1000", "G-1010"), FS("G-1000", "G-1030"), FS("G-1000", "E-2000"), FS("G-1000", "E-2010"),
  FS("G-1010", "G-1020"), FS("G-1010", "C-4000"), FF("C-6020", "G-1020"),
  FS("E-2010", "E-2020"), FS("E-2000", "E-2030"), SS("E-2030", "E-2040", 20), FS("E-2030", "E-2050"), FS("E-2020", "E-2050"),
  SS("E-2000", "P-3000", 60), FS("E-2050", "P-3030", -100), FS("P-3000", "P-3010"), FS("P-3010", "P-3020"),
  FS("P-3030", "P-3040"), SS("E-2030", "P-3050", 60), SS("E-2040", "P-3060", 90), SS("E-2030", "P-3070", 80), SS("E-2040", "P-3080", 110),
  FS("E-2020", "C-4010"), FS("C-4000", "C-4010"), FS("C-4010", "C-4020"), FS("C-4020", "C-4030"), FS("C-4030", "C-4040"), FS("C-4040", "C-4050"),
  SS("C-4040", "C-4060", 60), FS("E-2020", "C-4070"), SS("C-4030", "C-4080"), SS("C-4080", "C-4090", 25), SS("C-4060", "C-4100"),
  FS("P-3020", "C-5000"), FS("C-4050", "C-5000"), FS("C-5000", "C-5010"), FS("C-5010", "C-5020"),
  FS("P-3040", "C-4900"), FS("C-4080", "C-4900"), SS("C-4900", "C-5030"), SS("C-5030", "C-5040", 12),
  FS("P-3070", "C-5050"), FS("C-4090", "C-5050"), FS("C-4070", "C-5060"), FS("P-3050", "C-5060"),
  FS("C-5060", "C-5070"), FS("P-3060", "C-5070"), SS("C-4080", "C-5080"), FS("C-5060", "C-5090"), FS("P-3080", "C-5090"),
  FS("C-5020", "C-6000"), FS("C-5040", "C-6000"), FS("C-5050", "C-6000"), FS("C-5070", "C-6000"), FS("C-5090", "C-6000"), FS("C-5080", "C-6000"),
  FS("C-6000", "C-6010"), FS("C-6010", "C-6020"), SS("C-6020", "E-2060"), FS("C-6020", "G-1900"), FS("C-4100", "C-6000"), FS("G-1020", "G-1900"), FS("E-2060", "G-1900"),
];

export const GIS_PROJECT_CODE = "GIS-220";

export function gisXer(): string {
  return buildDemoXer({
    projId: "200",
    projCode: GIS_PROJECT_CODE,
    projName: "220/33 kV GIS Substation, Abu Dhabi (sample project)",
    dataDate: "2026-10-19 07:00",
    calendar: uaeCalendar(),
    currency: "AED",
    remainingFromDataDate: true,
    wbs: [
      ["20", "", GIS_PROJECT_CODE, "220/33 kV GIS Substation, Abu Dhabi (sample project)"],
      ["21", "20", "1", "General"],
      ["22", "20", "2", "Engineering"],
      ["23", "20", "3", "Procurement"],
      ["24", "20", "4", "Construction"],
      ["241", "24", "4.1", "Civil works"],
      ["242", "24", "4.2", "Electromechanical works"],
      ["243", "24", "4.3", "Testing & commissioning"],
    ],
    tasks: TASKS,
    codeNames: {
      Discipline: { GEN: "General", ENG: "Engineering", PRC: "Procurement", CIV: "Civil", ELE: "Electrical", TST: "Testing" },
      Area: { SITE: "Site-wide", GIS: "GIS building", TRF: "Transformer bays", CB: "Control & 33 kV building", CBL: "Cable routes" },
    },
    resources: RESOURCES,
    loading: LOADING,
    overrun: OVERRUN,
    rels: RELS,
    udfLabel: "Package",
    udf: {
      "2302": "Piling subcontract",
      "2304": "Civil subcontract",
      "2305": "Steel & cladding subcontract",
      "2307": "MEP subcontract",
      "2401": "GIS OEM",
      "2402": "GIS OEM",
      "2403": "GIS OEM",
      "2404": "Transformer OEM",
      "2405": "Transformer OEM",
      "2406": "Cable subcontract",
    },
    units: [["h", "Hour"], ["lot", "Lot"], ["ea", "Each"], ["AED", "UAE dirham"]],
  });
}

// ---------------------------------------------------------------- 3D model

export const GIS_CRANE_PREFIX = "Mobile Crane 200t";

/**
 * Site about 130 × 90 m. GIS hall to the south-west, transformer bays north
 * of it, control & 33 kV building to the east. The walls and roofs facing
 * the default camera are left off so the equipment inside stays visible.
 */
export function gisModel(): DemoBox[] {
  const boxes: DemoBox[] = [];
  let n = 0;
  const add = (ifcType: string, name: string, activity: string, storey: string, center: [number, number, number], size: [number, number, number], color: string, extra: Record<string, string> = {}) => {
    n += 1;
    const id = `gis-${String(n).padStart(4, "0")}`;
    const [x, y, z] = size;
    const r = (v: number) => (Math.round(v * 100) / 100).toString();
    const q: Record<string, string> = {};
    if (["IfcSlab", "IfcFooting", "IfcColumn", "IfcBeam", "IfcPile"].includes(ifcType)) q["BaseQuantities.NetVolume"] = r(x * y * z);
    if (ifcType === "IfcWall" || ifcType === "IfcCovering") q["BaseQuantities.NetSideArea"] = r(Math.max(x, z) * y);
    if (ifcType === "IfcCableSegment" || ifcType === "IfcCableCarrierSegment") q["BaseQuantities.Length"] = r(Math.max(x, z));
    boxes.push({ element: { id, expressId: n, ifcType, name, properties: { Storey: storey, [ACTIVITY_PSET]: activity, ...q, ...extra } }, center, size, color });
  };

  const concrete = "#b9b4aa";
  const steel = "#7e8a96";
  const gisGrey = "#8fa3b8";
  const cladding = "#c9d3dc";

  // Site
  add("IfcGeographicElement", "Site levelling & compacted fill", "C-4000", "Site", [65, -0.15, 45], [134, 0.3, 94], "#d8c39a");
  for (const [cx, cz, sx, sz] of [[115, 84, 9, 4], [115, 78, 9, 4], [124, 84, 6, 4]] as const)
    add("IfcBuildingElementProxy", "Site cabin", "G-1020", "Site", [cx, 1.4, cz], [sx, 2.8, sz], "#eef0f2");

  // GIS building: x 10–70, z 10–30
  for (let i = 0; i < 9; i++) for (const z of [11, 20, 29]) add("IfcPile", `Pile P${i + 1}-${z}`, "C-4010", "Foundation", [11 + i * 7.25, -6.5, z], [0.9, 12, 0.9], "#8f8a80");
  add("IfcFooting", "GIS building raft", "C-4020", "Foundation", [40, 0.6, 20], [62, 1.2, 22], concrete);
  for (let i = 0; i < 9; i++)
    for (const z of [10, 30]) add("IfcColumn", `GIS hall column C${i + 1}${z === 10 ? "S" : "N"}`, "C-4030", "GIS hall", [10 + i * 7.5, 7.7, z], [0.7, 13, 0.7], concrete);
  for (const z of [10, 30]) add("IfcBeam", `Crane girder ${z === 10 ? "south" : "north"}`, "C-4030", "GIS hall", [40, 12.2, z], [61, 0.9, 0.6], concrete);
  for (let i = 0; i < 9; i++) add("IfcBeam", `Roof truss T${i + 1}`, "C-4040", "Roof", [10 + i * 7.5, 14.6, 20], [0.5, 1.4, 21], steel);
  add("IfcCovering", "Cladding – south wall", "C-4040", "GIS hall", [40, 7.7, 9.6], [61, 13, 0.25], cladding);
  add("IfcCovering", "Cladding – west wall", "C-4040", "GIS hall", [9.6, 7.7, 20], [0.25, 13, 20.5], cladding);
  add("IfcCovering", "Cladding – east wall", "C-4040", "GIS hall", [70.4, 7.7, 20], [0.25, 13, 20.5], cladding);
  add("IfcBuildingElementProxy", "EOT crane bridge 10 t", "C-4050", "GIS hall", [22, 13, 20], [1.2, 1.1, 20], "#f2c94c");
  add("IfcFlowTerminal", "HVAC units – GIS hall", "C-4060", "GIS hall", [40, 1.9, 11.4], [30, 1.4, 1.2], "#dfe5ea");

  // 220 kV GIS: 9 bays, each a breaker, a bus section and a local control cubicle
  const bayUse = ["Line 1", "Line 2", "Transformer T1", "Bus coupler", "Transformer T2", "Line 3", "Line 4", "Bus section", "Spare"];
  for (let b = 0; b < 9; b++) {
    const x = 15 + b * 6;
    const act = b < 5 ? "C-5000" : "C-5010";
    const tag = { Bay: `Bay ${b + 1}`, BayUse: bayUse[b] };
    add("IfcSwitchingDevice", `GIS bay ${b + 1} circuit breaker (${bayUse[b]})`, act, "GIS hall", [x, 3.4, 21], [1.4, 4.2, 1.4], gisGrey, tag);
    add("IfcSwitchingDevice", `GIS bay ${b + 1} disconnector & earthing switch`, act, "GIS hall", [x, 2.4, 18.6], [1.0, 1.4, 2.6], gisGrey, tag);
    add("IfcCableSegment", `GIS bay ${b + 1} busbar section`, act, "GIS hall", [x, 4.6, 16.6], [6, 0.7, 0.7], "#6f8399", tag);
    add("IfcElectricDistributionBoard", `GIS bay ${b + 1} local control cubicle`, act, "GIS hall", [x, 2.2, 24.6], [0.9, 2.2, 0.7], "#e2e5e9", tag);
  }

  // Transformer bays: z 40–55
  for (const [t, x, act] of [["T1", 26, "C-5030"], ["T2", 50, "C-5040"]] as const) {
    add("IfcFooting", `Transformer ${t} foundation & oil pit`, "C-4080", "Transformer yard", [x, 0.5, 47], [12, 1, 10], concrete);
    add("IfcTransformer", `Power transformer ${t} 220/33 kV – tank`, act, "Transformer yard", [x, 3.3, 47], [6.2, 4.6, 3.6], "#5e6b77");
    for (const dz of [-2.6, 2.6]) add("IfcTransformer", `Power transformer ${t} – radiator bank`, act, "Transformer yard", [x, 3.1, 47 + dz], [4.6, 3.6, 0.9], "#717e8a");
    add("IfcTransformer", `Power transformer ${t} – conservator`, act, "Transformer yard", [x - 1.5, 6.3, 47], [4, 0.9, 0.9], "#5e6b77");
    for (const dx of [-1.8, 0, 1.8]) add("IfcTransformer", `Power transformer ${t} – HV bushing`, act, "Transformer yard", [x + dx, 6.9, 46], [0.35, 2.6, 0.35], "#b5653a");
  }
  add("IfcWall", "Firewall between T1 and T2", "C-4080", "Transformer yard", [38, 4.5, 47], [0.4, 9, 11], concrete);

  // Control & 33 kV building: x 82–112, z 40–55
  add("IfcSlab", "Control building foundation slab", "C-4070", "Control building", [97, 0.3, 47.5], [31, 0.6, 16], concrete);
  for (const [cx, cz, sx, sz, nm] of [
    [97, 40, 30.5, 0.3, "south"],
    [82, 47.5, 0.3, 15.5, "west"],
    [112, 47.5, 0.3, 15.5, "east"],
  ] as const)
    add("IfcWall", `Control building ${nm} wall`, "C-4070", "Control building", [cx, 3.6, cz], [sx, 6, sz], "#e3dccf");
  for (let i = 0; i < 12; i++) add("IfcElectricDistributionBoard", `33 kV switchgear panel J${i + 1}`, "C-5060", "Control building", [85 + i * 0.95, 1.8, 43], [0.85, 2.4, 1.6], "#9aa7b4");
  for (let i = 0; i < 10; i++) add("IfcElectricDistributionBoard", `Protection & control panel R${i + 1}`, "C-5070", "Control building", [86 + i * 0.9, 1.7, 51.5], [0.8, 2.2, 0.8], "#c8ced6");
  add("IfcElectricFlowStorageDevice", "Battery bank 110 V DC", "C-5090", "Control building", [106, 1.2, 51], [4, 1.2, 1.2], "#4f5b66");
  add("IfcElectricDistributionBoard", "LVAC & DC distribution boards", "C-5090", "Control building", [106, 1.5, 44], [4, 1.8, 0.8], "#c8ced6");

  // Cable trenches and 220 kV cables
  add("IfcCableCarrierSegment", "Cable trench – main east–west", "C-4090", "Site", [53, 0.15, 35], [86, 0.3, 1.4], "#a9a397");
  for (const x of [26, 50]) add("IfcCableCarrierSegment", `Cable trench – GIS to ${x === 26 ? "T1" : "T2"}`, "C-4090", "Site", [x, 0.15, 36.5], [1.4, 0.3, 7], "#a9a397");
  add("IfcCableCarrierSegment", "Cable trench – 220 kV incomers", "C-4090", "Site", [10, 0.15, 3], [1.4, 0.3, 14], "#a9a397");
  for (const [cx, cz, sx, sz, nm] of [
    [53, 35, 86, 0.25, "33 kV & control cables"],
    [26, 36.5, 0.25, 7, "220 kV cable to T1"],
    [50, 36.5, 0.25, 7, "220 kV cable to T2"],
    [10, 3, 0.25, 14, "220 kV incoming line cables"],
  ] as const)
    add("IfcCableSegment", `${nm}`, "C-5050", "Site", [cx, 0.42, cz], [sx, 0.25, sz], "#2f3337");

  // Earthing grid and lightning masts
  for (let i = 0; i <= 6; i++) add("IfcCableSegment", `Earthing conductor E-W ${i + 1}`, "C-5080", "Site", [62, 0.02, 6 + i * 13], [116, 0.06, 0.15], "#b87333");
  for (let i = 0; i <= 8; i++) add("IfcCableSegment", `Earthing conductor N-S ${i + 1}`, "C-5080", "Site", [4 + i * 14.5, 0.02, 45], [0.15, 0.06, 80], "#b87333");
  for (const [x, z] of [[6, 36], [70, 36], [6, 58], [70, 58]]) add("IfcBuildingElementProxy", "Lightning mast", "C-5080", "Site", [x, 10, z], [0.45, 20, 0.45], "#9aa0a6");

  // Boundary wall (in panels so it builds round the site), roads, gatehouse
  for (const [x0, z0, x1, z1] of [[-2, -2, 132, -2], [132, -2, 132, 92], [132, 92, -2, 92], [-2, 92, -2, -2]] as const) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const parts = Math.round(len / 22);
    for (let k = 0; k < parts; k++) {
      const a = (k + 0.5) / parts;
      const along = x0 === x1 ? [0.3, 3, len / parts] : [len / parts, 3, 0.3];
      add("IfcWall", "Boundary wall panel", "C-4100", "Site", [x0 + (x1 - x0) * a, 1.5, z0 + (z1 - z0) * a], along as [number, number, number], "#d6cdbd");
    }
  }
  add("IfcSlab", "Internal road – south", "C-4100", "Site", [65, 0.06, 4], [120, 0.12, 6], "#50555c");
  add("IfcSlab", "Internal road – east", "C-4100", "Site", [122, 0.06, 45], [6, 0.12, 80], "#50555c");
  add("IfcSlab", "Internal road – transformer access", "C-4100", "Site", [65, 0.06, 64], [114, 0.12, 6], "#50555c");
  add("IfcBuildingElementProxy", "Gatehouse", "C-4100", "Site", [124, 1.6, 6], [6, 3.2, 5], "#e3dccf");

  // Mobile crane used to place the transformers (moves along a path)
  add("IfcTransportElement", `${GIS_CRANE_PREFIX} carrier`, "C-4900", "Site", [118, 1.2, 70], [10, 2.4, 3], "#d64545");
  add("IfcTransportElement", `${GIS_CRANE_PREFIX} boom`, "C-4900", "Site", [118, 11, 70], [1, 17, 1], "#f2c94c");
  add("IfcTransportElement", `${GIS_CRANE_PREFIX} jib`, "C-4900", "Site", [112, 19, 70], [13, 0.8, 0.8], "#f2c94c");
  return boxes;
}

export function gisPaths(boxes: DemoBox[]): MotionPath[] {
  const crane = boxes.filter((b) => b.element.name.startsWith(GIS_CRANE_PREFIX)).map((b) => b.element.id);
  return [
    {
      id: "gis-crane-path",
      name: "200 t crane: gate → T1 → T2",
      activityId: "2312",
      elementIds: crane,
      points: [
        [118, 0, 70],
        [90, 0, 64],
        [32, 0, 60],
        [56, 0, 60],
      ],
      orient: false,
    },
  ];
}

/** Profile per activity: temporary works show only while active; slabs pour, walls rise. */
export function gisProfileFor(code: string, ifcType: string): string {
  if (code === "G-1020" || code === "C-4900") return "temporary";
  if (["IfcSlab", "IfcFooting", "IfcCableCarrierSegment"].includes(ifcType)) return "install-pour";
  if (["IfcWall", "IfcColumn", "IfcCovering", "IfcPile"].includes(ifcType)) return "install-rise";
  return "install";
}

export const GIS_DATA_DATE = ms("2026-10-19 07:00");
