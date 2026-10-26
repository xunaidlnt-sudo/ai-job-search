// Built-in demo: a small two-storey RC frame with a matching P6 schedule.
// The schedule is emitted as real XER text and goes through the normal parser,
// so the demo exercises the same import path as a user's file.

import { standardCalendar, toP6CalendarData, workHoursBetween } from "./calendar";
import type { ModelElement, MotionPath } from "./types";

export interface DemoBox {
  element: ModelElement;
  /** Centre and size in metres (x, y up, z). */
  center: [number, number, number];
  size: [number, number, number];
  color: string;
}

const ACTIVITY_PSET = "Pset_Stratum.ActivityID";

interface DemoTask {
  id: string;
  code: string;
  name: string;
  wbs: string;
  start: string;
  finish: string;
  status: "TK_NotStart" | "TK_Active" | "TK_Complete";
  pct: number;
  /** Baseline dates when they differ from the current ones. */
  bStart?: string;
  bFinish?: string;
  float: number;
  type?: "TT_Task" | "TT_Mile" | "TT_FinMile";
  zone?: string;
}

const TASKS: DemoTask[] = [
  { id: "1000", code: "MS-000", name: "Notice to Proceed", wbs: "11", start: "2026-02-02 08:00", finish: "2026-02-02 08:00", status: "TK_Complete", pct: 100, float: 0, type: "TT_Mile" },
  { id: "1010", code: "SW-100", name: "Excavation", wbs: "11", start: "2026-02-02 08:00", finish: "2026-02-13 17:00", status: "TK_Complete", pct: 100, float: 0, zone: "Z0" },
  { id: "1020", code: "SW-110", name: "Pile Caps & Footings", wbs: "11", start: "2026-02-16 08:00", finish: "2026-03-06 17:00", status: "TK_Complete", pct: 100, bFinish: "2026-03-02 17:00", float: 0, zone: "Z0" },
  { id: "1030", code: "SW-120", name: "Ground Floor Slab", wbs: "11", start: "2026-03-09 08:00", finish: "2026-03-20 17:00", status: "TK_Complete", pct: 100, float: 0, zone: "Z0" },
  { id: "1040", code: "TW-010", name: "Scaffolding Erect & Strike", wbs: "14", start: "2026-03-23 08:00", finish: "2026-05-29 17:00", status: "TK_Active", pct: 55, float: 40 },
  { id: "1050", code: "ST-200", name: "Level 1 Columns", wbs: "12", start: "2026-03-23 08:00", finish: "2026-04-03 17:00", status: "TK_Complete", pct: 100, float: 0, zone: "Z1" },
  { id: "1060", code: "ST-210", name: "Level 1 Slab", wbs: "12", start: "2026-04-06 08:00", finish: "2026-04-24 17:00", status: "TK_Active", pct: 70, bFinish: "2026-04-17 17:00", float: 0, zone: "Z1" },
  { id: "1070", code: "ST-300", name: "Level 2 Columns", wbs: "12", start: "2026-04-27 08:00", finish: "2026-05-08 17:00", status: "TK_NotStart", pct: 0, bStart: "2026-04-20 08:00", bFinish: "2026-05-01 17:00", float: 0, zone: "Z2" },
  { id: "1080", code: "ST-310", name: "Roof Slab", wbs: "12", start: "2026-05-11 08:00", finish: "2026-05-29 17:00", status: "TK_NotStart", pct: 0, bStart: "2026-05-04 08:00", bFinish: "2026-05-22 17:00", float: 0, zone: "Z2" },
  { id: "1090", code: "TW-020", name: "Level 1 Falsework Erect & Strike", wbs: "14", start: "2026-04-06 08:00", finish: "2026-05-01 17:00", status: "TK_Active", pct: 60, float: 16 },
  { id: "1100", code: "EN-400", name: "External Walls Ground Floor", wbs: "13", start: "2026-04-27 08:00", finish: "2026-05-15 17:00", status: "TK_NotStart", pct: 0, float: 24, zone: "Z1" },
  { id: "1110", code: "EN-410", name: "External Walls Level 1", wbs: "13", start: "2026-06-01 08:00", finish: "2026-06-19 17:00", status: "TK_NotStart", pct: 0, float: 0, zone: "Z2" },
  { id: "1120", code: "MS-999", name: "Structure & Envelope Complete", wbs: "13", start: "2026-06-19 17:00", finish: "2026-06-19 17:00", status: "TK_NotStart", pct: 0, float: 0, type: "TT_FinMile" },
  { id: "1130", code: "LG-100", name: "Mobile Crane Lifts (L1 to Roof)", wbs: "14", start: "2026-03-23 08:00", finish: "2026-05-29 17:00", status: "TK_Active", pct: 45, float: 40 },
];

// Resources: [id, code, name, type, unit, rate]
const RESOURCES: [string, string, string, string, string, number][] = [
  ["1", "GANG", "Concrete Gang", "RT_Labor", "h", 55],
  ["2", "CARP", "Formwork Carpenters", "RT_Labor", "h", 48],
  ["3", "MASON", "Blockwork Masons", "RT_Labor", "h", 45],
  ["4", "SCAF", "Scaffolders", "RT_Labor", "h", 40],
  ["5", "EXC", "Excavator 30t", "RT_Equip", "h", 150],
  ["6", "CRANE", "Mobile Crane 60t", "RT_Equip", "h", 180],
  ["7", "C40", "Concrete C40/50", "RT_Mat", "m3", 120],
];

// Assignments per activity: [resource id, units per working hour or fixed quantity, fixed?]
const LOADING: Record<string, [string, number, boolean?][]> = {
  "SW-100": [["5", 1], ["4", 1]],
  "SW-110": [["1", 4], ["2", 3], ["7", 47, true]],
  "SW-120": [["1", 6], ["7", 63, true]],
  "TW-010": [["4", 3]],
  "ST-200": [["1", 3], ["2", 4], ["7", 8.5, true]],
  "ST-210": [["1", 6], ["2", 6], ["7", 62, true]],
  "ST-300": [["1", 3], ["2", 4], ["7", 8.5, true]],
  "ST-310": [["1", 6], ["2", 6], ["7", 62, true]],
  "TW-020": [["2", 4]],
  "EN-400": [["3", 6]],
  "EN-410": [["3", 6]],
  "LG-100": [["6", 0.5]],
};
// Actual cost runs a little over budget on some work.
const OVERRUN: Record<string, number> = { "SW-110": 1.12, "ST-210": 1.08 };

const RELS: [string, string, string, number][] = [
  ["1000", "1010", "PR_FS", 0],
  ["1010", "1020", "PR_FS", 0],
  ["1020", "1030", "PR_FS", 0],
  ["1030", "1050", "PR_FS", 0],
  ["1030", "1040", "PR_FS", 0],
  ["1050", "1060", "PR_FS", 0],
  ["1060", "1070", "PR_FS", 0],
  ["1050", "1090", "PR_FS", 0],
  ["1060", "1100", "PR_FS", 0],
  ["1070", "1080", "PR_FS", 0],
  ["1080", "1110", "PR_FS", 0],
  ["1110", "1120", "PR_FS", 0],
  ["1100", "1120", "PR_FS", 0],
  ["1030", "1130", "PR_FS", 0],
];

const CAL = standardCalendar("1", "Standard 5-day");
const ms = (d: string) => Date.parse(d.replace(" ", "T") + ":00Z");
/** Working hours on the demo calendar. */
function hours(a: string, b: string): number {
  return Math.round(workHoursBetween(CAL, ms(a), ms(b)));
}

export function demoXer(): string {
  const L: string[] = [];
  const t = (name: string, fields: string[], rows: string[][]) => {
    L.push(`%T\t${name}`, `%F\t${fields.join("\t")}`);
    for (const r of rows) L.push(`%R\t${r.join("\t")}`);
  };
  L.push("ERMHDR\t21.12\t2026-04-20\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD");
  t(
    "CALENDAR",
    ["clndr_id", "default_flag", "clndr_name", "proj_id", "clndr_type", "day_hr_cnt", "clndr_data"],
    [["1", "Y", CAL.name, "", "CA_Base", "8", toP6CalendarData(CAL)]],
  );
  t("PROJECT", ["proj_id", "proj_short_name", "clndr_id", "last_recalc_date"], [["100", "DEMO-RC", "1", "2026-04-20 08:00"]]);
  t(
    "PROJWBS",
    ["wbs_id", "proj_id", "parent_wbs_id", "wbs_short_name", "wbs_name", "seq_num", "proj_node_flag"],
    [
      ["10", "100", "", "DEMO-RC", "Demo RC Building", "0", "Y"],
      ["11", "100", "10", "1", "Substructure", "1", "N"],
      ["12", "100", "10", "2", "Superstructure", "2", "N"],
      ["13", "100", "10", "3", "Envelope", "3", "N"],
      ["14", "100", "10", "4", "Temporary Works", "4", "N"],
    ],
  );
  t("ACTVTYPE", ["actv_code_type_id", "actv_code_type"], [["1", "Zone"]]);
  t(
    "ACTVCODE",
    ["actv_code_id", "actv_code_type_id", "short_name", "actv_code_name"],
    ["Z0", "Z1", "Z2"].map((z, i) => [`${20 + i}`, "1", z, `Zone ${z}`]),
  );
  t(
    "TASK",
    [
      "task_id", "proj_id", "wbs_id", "clndr_id", "task_code", "task_name", "task_type", "status_code", "phys_complete_pct",
      "total_float_hr_cnt", "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "act_start_date", "act_end_date",
      "early_start_date", "early_end_date", "target_start_date", "target_end_date", "driving_path_flag",
    ],
    TASKS.map((k) => {
      const actStart = k.status !== "TK_NotStart" ? k.start : "";
      const actEnd = k.status === "TK_Complete" ? k.finish : "";
      const dur = hours(k.start, k.finish);
      return [
        k.id, "100", k.wbs, "1", k.code, k.name, k.type ?? "TT_Task", k.status, String(k.pct), String(k.float),
        String(dur), String(k.status === "TK_Complete" ? 0 : Math.round(dur * (1 - k.pct / 100))), actStart, actEnd,
        k.start, k.finish, k.bStart ?? k.start, k.bFinish ?? k.finish, k.float === 0 ? "Y" : "N",
      ];
    }),
  );
  t(
    "TASKACTV",
    ["task_id", "actv_code_type_id", "actv_code_id", "proj_id"],
    TASKS.filter((k) => k.zone).map((k) => [k.id, "1", `${20 + ["Z0", "Z1", "Z2"].indexOf(k.zone!)}`, "100"]),
  );
  t("RSRC", ["rsrc_id", "rsrc_short_name", "rsrc_name", "rsrc_type", "unit_id"], RESOURCES.map(([id, code, name, type, unit]) => [id, code, name, type, unit]));
  t("UMEASURE", ["unit_id", "unit_abbrev", "unit_name"], [["h", "h", "Hour"], ["m3", "m3", "Cubic metre"]]);
  t("RSRCRATE", ["rsrc_rate_id", "rsrc_id", "cost_per_qty"], RESOURCES.map(([id, , , , , rate]) => [`r${id}`, id, String(rate)]));
  const rate = new Map(RESOURCES.map((r) => [r[0], r[5]]));
  const rows: string[][] = [];
  let n = 800;
  for (const k of TASKS) {
    const dur = hours(k.start, k.finish);
    for (const [rid, perHour, fixed] of LOADING[k.code] ?? []) {
      const budget = fixed ? perHour : perHour * dur;
      const done = k.status === "TK_Complete" ? 1 : k.pct / 100;
      const actual = budget * done * (OVERRUN[k.code] ?? 1);
      const remaining = k.status === "TK_Complete" ? 0 : budget * (1 - done) * (OVERRUN[k.code] ?? 1);
      const r = rate.get(rid)!;
      const f = (x: number) => String(Math.round(x * 100) / 100);
      rows.push([String(n++), k.id, rid, "100", f(budget), f(actual), f(remaining), f(budget * r), f(actual * r), f(remaining * r)]);
    }
  }
  t("TASKRSRC", ["taskrsrc_id", "task_id", "rsrc_id", "proj_id", "target_qty", "act_reg_qty", "remain_qty", "target_cost", "act_reg_cost", "remain_cost"], rows);
  t("UDFTYPE", ["udf_type_id", "table_name", "udf_type_name", "udf_type_label", "logical_data_type"], [["900", "TASK", "user_field_1", "Subcontractor", "FT_TEXT"]]);
  t(
    "UDFVALUE",
    ["udf_type_id", "fk_id", "proj_id", "udf_text"],
    [
      ["900", "1010", "100", "GroundWorks Ltd"],
      ["900", "1100", "100", "Masonry Co"],
      ["900", "1110", "100", "Masonry Co"],
    ],
  );
  t(
    "TASKPRED",
    ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id", "pred_type", "lag_hr_cnt"],
    RELS.map(([p, s, ty, lag], i) => [`${500 + i}`, s, p, "100", "100", ty, String(lag)]),
  );
  L.push("%E");
  return L.join("\r\n");
}

/** Build the demo geometry: a 3 x 2 bay frame, 2 storeys, with scaffold and formwork. */
export function demoModel(): DemoBox[] {
  const boxes: DemoBox[] = [];
  let n = 0;
  const add = (
    ifcType: string,
    name: string,
    activity: string,
    storey: string,
    center: [number, number, number],
    size: [number, number, number],
    color: string,
  ) => {
    n += 1;
    const id = `demo-${String(n).padStart(4, "0")}`;
    boxes.push({
      element: { id, expressId: n, ifcType, name, properties: { Storey: storey, [ACTIVITY_PSET]: activity, ...quantities(ifcType, size) } },
      center,
      size,
      color,
    });
  };

  const bayX = 6;
  const bayZ = 6;
  const nx = 3;
  const nz = 2;
  const width = nx * bayX;
  const depth = nz * bayZ;
  const h = 3.5;
  const concrete = "#b8b2a7";
  const slabColor = "#cfc9be";

  add("IfcEarthworksCut", "Excavation", "SW-100", "Foundation", [width / 2, -1.2, depth / 2], [width + 3, 2.4, depth + 3], "#8b6f47");
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = i * bayX;
      const z = j * bayZ;
      add("IfcFooting", `Footing F${i}${j}`, "SW-110", "Foundation", [x, -0.6, z], [1.8, 1.2, 1.8], concrete);
      add("IfcColumn", `Column L1-C${i}${j}`, "ST-200", "Level 1", [x, h / 2, z], [0.45, h, 0.45], concrete);
      add("IfcColumn", `Column L2-C${i}${j}`, "ST-300", "Level 2", [x, h + h / 2, z], [0.45, h, 0.45], concrete);
    }
  }
  add("IfcSlab", "Ground Floor Slab", "SW-120", "Ground", [width / 2, -0.1, depth / 2], [width + 1, 0.2, depth + 1], slabColor);
  add("IfcSlab", "Level 1 Slab", "ST-210", "Level 1", [width / 2, h, depth / 2], [width + 1, 0.25, depth + 1], slabColor);
  add("IfcSlab", "Roof Slab", "ST-310", "Roof", [width / 2, 2 * h, depth / 2], [width + 1, 0.25, depth + 1], slabColor);

  // Formwork / props under level 1 slab: temporary, struck later.
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      add(
        "IfcElementAssembly",
        `L1 Falsework B${i}${j}`,
        "TW-020",
        "Level 1",
        [i * bayX + bayX / 2, h / 2 - 0.1, j * bayZ + bayZ / 2],
        [bayX - 1, h - 0.4, bayZ - 1],
        "#c79a3a",
      );
    }
  }

  // External walls, ground floor and level 1, on the two long faces and the ends.
  const wallT = 0.25;
  const walls: [string, number, string][] = [
    ["EN-400", h / 2, "Ground"],
    ["EN-410", h + h / 2, "Level 1"],
  ];
  for (const [code, y, storey] of walls) {
    add("IfcWall", `${storey} Wall South`, code, storey, [width / 2, y, -0.35], [width + 0.9, h - 0.3, wallT], "#d9cfc0");
    add("IfcWall", `${storey} Wall North`, code, storey, [width / 2, y, depth + 0.35], [width + 0.9, h - 0.3, wallT], "#d9cfc0");
    add("IfcWall", `${storey} Wall West`, code, storey, [-0.35, y, depth / 2], [wallT, h - 0.3, depth + 0.45], "#d9cfc0");
    add("IfcWall", `${storey} Wall East`, code, storey, [width + 0.35, y, depth / 2], [wallT, h - 0.3, depth + 0.45], "#d9cfc0");
  }

  // Scaffold along the south face.
  add("IfcBuildingElementProxy", "Scaffold South", "TW-010", "Site", [width / 2, h, -1.6], [width + 3, 2 * h + 1, 1.2], "#e0a526");

  // Mobile crane: carrier, mast and jib, moved along a path during LG-100.
  add("IfcTransportElement", `${DEMO_CRANE_PREFIX} Carrier`, "LG-100", "Site", [-4, 0.9, -7], [7, 1.8, 2.6], "#d64545");
  add("IfcTransportElement", `${DEMO_CRANE_PREFIX} Mast`, "LG-100", "Site", [-4, 7, -7], [0.8, 10.5, 0.8], "#f2c94c");
  add("IfcTransportElement", `${DEMO_CRANE_PREFIX} Jib`, "LG-100", "Site", [1.5, 12, -7], [12, 0.6, 0.6], "#f2c94c");

  return boxes;
}

/** IFC-style base quantities for the demo boxes. */
function quantities(ifcType: string, [x, y, z]: [number, number, number]): Record<string, string> {
  const r = (v: number) => (Math.round(v * 100) / 100).toString();
  if (ifcType === "IfcWall") return { "BaseQuantities.NetSideArea": r(Math.max(x, z) * y), "BaseQuantities.Length": r(Math.max(x, z)) };
  if (["IfcColumn", "IfcSlab", "IfcFooting"].includes(ifcType)) return { "BaseQuantities.NetVolume": r(x * y * z) };
  if (ifcType === "IfcEarthworksCut") return { "BaseQuantities.GrossVolume": r(x * y * z) };
  return {};
}

export const DEMO_CRANE_PREFIX = "Mobile Crane";

/** The crane tracks along the south side while the frame goes up. */
export function demoPaths(boxes: DemoBox[]): MotionPath[] {
  const crane = boxes.filter((b) => b.element.name.startsWith(DEMO_CRANE_PREFIX)).map((b) => b.element.id);
  return [
    {
      id: "demo-crane-path",
      name: "Crane along south face",
      activityId: "1130",
      elementIds: crane,
      points: [
        [-4, 0, -7],
        [9, 0, -7],
        [22, 0, -7],
        [22, 0, 19],
      ],
      orient: false,
    },
  ];
}

export const DEMO_LINK_RULE = {
  id: "demo-rule",
  elementProperty: ACTIVITY_PSET,
  activityField: "code",
  match: "equals" as const,
  caseSensitive: false,
};

/** Which profile each demo activity should use (by code prefix). */
export function demoProfileFor(code: string): string {
  if (code === "SW-100") return "remove";
  if (code.startsWith("TW-") || code.startsWith("LG-")) return "temporary";
  return "install";
}
