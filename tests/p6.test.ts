import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { demoXer } from "../src/core/demo";
import type { P6Connection } from "../src/core/reporting";
import { parseXer, parseXerTables } from "../src/core/xer";
import { eppmDate, percentScale } from "../src/services/p6/eppm";
import { p6Import, p6ListProjects, p6Push, p6Test } from "../src/services/p6";
import { loadSqlJs } from "../src/services/sql";

// ---------------------------------------------------------------- EPPM mock

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function mockEppm() {
  const seen: Seen[] = [];
  const data: Record<string, Record<string, unknown>[]> = {
    project: [
      { ObjectId: 4501, Id: "TWR-A", Name: "Tower A", DataDate: "2026-03-04T08:00:00", ActivityDefaultCalendarObjectId: 7 },
      { ObjectId: 4502, Id: "TWR-B", Name: "Tower B", DataDate: "2026-03-04T08:00:00" },
    ],
    wbs: [
      { ObjectId: 10, Code: "STR", Name: "Structure", ParentObjectId: 4501, SequenceNumber: 1, ProjectObjectId: 4501 },
      { ObjectId: 11, Code: "L1", Name: "Level 1", ParentObjectId: 10, SequenceNumber: 2, ProjectObjectId: 4501 },
    ],
    activity: [
      {
        ObjectId: 9001, Id: "A100", Name: "Columns L1", ProjectObjectId: 4501, WBSObjectId: 11, CalendarObjectId: 7, Type: "Task Dependent", Status: "Completed",
        PhysicalPercentComplete: 1, PlannedDuration: 16, RemainingDuration: 0, TotalFloat: 0, StartDate: "2026-03-02T08:00:00", FinishDate: "2026-03-03T17:00:00",
        ActualStartDate: "2026-03-02T08:00:00", ActualFinishDate: "2026-03-03T17:00:00", PlannedStartDate: "2026-03-02T08:00:00", PlannedFinishDate: "2026-03-03T17:00:00", IsCritical: true,
      },
      {
        ObjectId: 9002, Id: "A110", Name: "Slab L1", ProjectObjectId: 4501, WBSObjectId: 11, CalendarObjectId: 7, Type: "Task Dependent", Status: "In Progress",
        PhysicalPercentComplete: 0.4, PlannedDuration: 24, RemainingDuration: 16, TotalFloat: 0, StartDate: "2026-03-04T08:00:00", FinishDate: "2026-03-06T17:00:00",
        ActualStartDate: "2026-03-04T08:00:00", PlannedStartDate: "2026-03-04T08:00:00", PlannedFinishDate: "2026-03-05T17:00:00",
        PrimaryConstraintType: "Start On or After", PrimaryConstraintDate: "2026-03-04T08:00:00",
      },
      {
        ObjectId: 9003, Id: "M999", Name: "Topped out", ProjectObjectId: 4501, WBSObjectId: 10, CalendarObjectId: 7, Type: "Finish Milestone", Status: "Not Started",
        PhysicalPercentComplete: 0, PlannedDuration: 0, RemainingDuration: 0, StartDate: "2026-03-06T17:00:00", FinishDate: "2026-03-06T17:00:00",
      },
    ],
    relationship: [
      { ObjectId: 1, PredecessorActivityObjectId: 9001, SuccessorActivityObjectId: 9002, Type: "Finish to Start", Lag: 0, SuccessorProjectObjectId: 4501 },
      { ObjectId: 2, PredecessorActivityObjectId: 9002, SuccessorActivityObjectId: 9003, Type: "Finish to Finish", Lag: 8, SuccessorProjectObjectId: 4501 },
    ],
    calendar: [{ ObjectId: 7, Name: "Site 5x8", HoursPerDay: 8, IsDefault: true }],
    resource: [{ ObjectId: 300, Id: "GANG", Name: "Concrete gang", ResourceType: "Labor", PricePerUnit: 55, UnitOfMeasureAbbreviation: "h" }],
    resourceAssignment: [{ ObjectId: 77, ActivityObjectId: 9002, ResourceObjectId: 300, PlannedUnits: 96, ActualUnits: 40, RemainingUnits: 56, PlannedCost: 5280, ActualCost: 2200, RemainingCost: 3080, ProjectObjectId: 4501 }],
    activityCodeAssignment: [{ ActivityObjectId: 9002, ActivityCodeTypeName: "Zone", ActivityCodeValue: "Z1", ProjectObjectId: 4501 }],
  };
  // Like a real server, some fields don't exist in this "release".
  const fieldsOf = (e: string) => [...new Set((data[e] ?? []).flatMap((r) => Object.keys(r)))];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const u = new URL(req.url!, "http://x");
      const parts = u.pathname.replace(/^\/p6ws\/restapi\/?/, "").split("/");
      if (parts[0] === "login" && req.method === "POST") {
        if (req.headers.username === "planner" && req.headers.password === "secret" && u.searchParams.get("DatabaseName") === "PMDB") {
          res.writeHead(200, { "Set-Cookie": ["JSESSIONID=abc123; Path=/p6ws; HttpOnly"] });
          return res.end("");
        }
        res.writeHead(401);
        return res.end("bad credentials");
      }
      if (parts[0] === "logout") return res.end();
      if (!String(req.headers.cookie ?? "").includes("JSESSIONID=abc123")) {
        res.writeHead(401);
        return res.end("no session");
      }
      const entity = parts[0];
      if (parts[1] === "fields") return res.end(fieldsOf(entity).join(","));
      if (req.method === "PUT") return res.end("");
      const fields = (u.searchParams.get("Fields") ?? "").split(",");
      const bad = fields.filter((f) => !fieldsOf(entity).includes(f));
      if (bad.length) {
        res.writeHead(400);
        return res.end(`Unknown field ${bad[0]}`);
      }
      let rows = data[entity] ?? [];
      const filter = u.searchParams.get("Filter");
      if (filter) {
        const m = /^(\w+) :eq: (\S+)$/.exec(filter);
        if (!m) {
          res.writeHead(400);
          return res.end("bad filter");
        }
        rows = rows.filter((r) => String(r[m[1]]) === m[2]);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])))));
    });
  });
  return { server, seen };
}

describe("P6 EPPM connector", () => {
  const { server, seen } = mockEppm();
  let cfg: P6Connection;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    cfg = { id: "c1", name: "EPPM", kind: "eppm", url: `http://127.0.0.1:${port}/p6ws/restapi/`, database: "PMDB", user: "planner", password: "secret", auth: "session" };
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("logs in with headers and lists projects using the session cookie", async () => {
    expect(await p6Test(cfg)).toBe("Connected. 2 project(s) visible.");
    const login = seen.find((x) => x.url.includes("/login"))!;
    expect(login.url).toContain("DatabaseName=PMDB");
    expect(login.headers.username).toBe("planner");
    const read = seen.find((x) => x.url.startsWith("/p6ws/restapi/project?"))!;
    expect(read.headers.cookie).toBe("JSESSIONID=abc123");
    await expect(p6Test({ ...cfg, password: "wrong" })).rejects.toThrow(/login failed \(401\)/);
  });

  it("imports a project: WBS, activities, logic, codes, constraints, resources", async () => {
    const s = await p6Import(cfg, "4501");
    expect(s.projectCode).toBe("TWR-A");
    expect(s.sourceFormat).toBe("p6-eppm");
    expect(s.p6Source?.projectObjectId).toBe("4501");
    expect(s.wbs.map((w) => w.name)).toEqual(["Structure", "Level 1"]);
    expect(s.wbs[1].parentId).toBe("10");
    const slab = s.activities.find((a) => a.code === "A110")!;
    expect(slab.status).toBe("in-progress");
    expect(slab.percentComplete).toBe(40); // fractions scaled to percent
    expect(slab.constraint).toEqual({ type: "start-on-or-after", date: Date.UTC(2026, 2, 4, 8) });
    expect(slab.codes.Zone).toBe("Z1");
    expect(s.activities.find((a) => a.code === "M999")!.type).toBe("finish-milestone");
    expect(s.relationships.find((r) => r.successorId === "9003")).toMatchObject({ type: "FF", lagHours: 8 });
    expect(s.resources![0]).toMatchObject({ code: "GANG", pricePerUnit: 55, type: "labor" });
    expect(s.assignments![0].budgetCost).toBe(5280);
    expect(s.calendars![0].hoursPerDay).toBe(8);
    // Only fields the server reported were requested (Activity has no EarlyStartDate here).
    const actRead = seen.filter((x) => x.url.startsWith("/p6ws/restapi/activity?")).pop()!;
    expect(decodeURIComponent(actRead.url)).not.toContain("EarlyStartDate");
    expect(decodeURIComponent(actRead.url).replace(/\+/g, " ")).toContain("Filter=ProjectObjectId :eq: 4501");
  });

  it("pushes progress back with PUT and lists what it cannot push", async () => {
    const s = await p6Import(cfg, "4501");
    const slab = s.activities.find((a) => a.code === "A110")!;
    slab.percentComplete = 75;
    slab.remainingDurationHours = 6;
    s.activities.push({ ...slab, id: "new-1", code: "A120" });
    const r = await p6Push(cfg, s);
    expect(r.updated).toBe(2); // the completed and in-progress activities
    expect(r.skipped).toEqual(["A120"]);
    const put = seen.filter((x) => x.method === "PUT").pop()!;
    const body = JSON.parse(put.body);
    expect(body.find((b: { ObjectId: number }) => b.ObjectId === 9002)).toMatchObject({ PhysicalPercentComplete: 0.75, RemainingDuration: 6, ActualStartDate: "2026-03-04T08:00:00" });
  });

  it("converts dates and detects the percent scale", () => {
    expect(eppmDate("2026-03-02T08:30:00-05:00")).toBe("2026-03-02 08:30");
    expect(eppmDate(null)).toBe("");
    expect(percentScale([0, 0.4, 1])).toBe(100);
    expect(percentScale([0, 40, 100])).toBe(1);
  });
});

// ---------------------------------------------------- P6 Professional (SQLite)

describe("P6 Professional database connector (SQLite)", () => {
  let file: string;
  beforeAll(async () => {
    // Build a P6-shaped database from the demo XER tables, plus a soft-deleted row and a baseline project.
    const SQL = await loadSqlJs();
    const db = new SQL.Database();
    const tables = parseXerTables(demoXer());
    tables.PROJECT.push({ proj_id: "101", proj_short_name: "DEMO-RC-BL1", last_recalc_date: "2026-01-01 08:00", clndr_id: "1", orig_proj_id: "100" } as never);
    tables.TASK.push({ ...tables.TASK[1], task_id: "1999", task_code: "DELETED-1", delete_session_id: "55" } as never);
    for (const [name, rows] of Object.entries(tables)) {
      const cols = [...new Set([...rows.flatMap((r) => Object.keys(r)), "delete_session_id", ...(name === "PROJECT" ? ["orig_proj_id"] : [])])];
      db.run(`create table ${name} (${cols.map((c) => `${c} ${c.endsWith("_date") ? "datetime" : "text"}`).join(", ")})`);
      for (const r of rows) {
        db.run(`insert into ${name} (${cols.join(",")}) values (${cols.map(() => "?").join(",")})`, cols.map((c) => ((r as Record<string, string>)[c] === "" || (r as Record<string, string>)[c] === undefined ? null : (r as Record<string, string>)[c])));
      }
    }
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p6pro-")), "PPMDBSQLite.db");
    fs.writeFileSync(file, Buffer.from(db.export()));
  });

  it("lists projects without baselines and imports one read-only", async () => {
    const cfg: P6Connection = { id: "c2", name: "P6 Pro", kind: "p6-sqlite", file };
    const list = await p6ListProjects(cfg);
    expect(list.map((p) => p.code)).toEqual(["DEMO-RC"]);
    expect(list[0].name).toBe("Demo RC Building");
    const before = fs.statSync(file).mtimeMs;
    const s = await p6Import(cfg, "100");
    const fromXer = parseXer(demoXer());
    expect(s.activities.map((a) => a.code).sort()).toEqual(fromXer.activities.map((a) => a.code).sort()); // deleted row excluded
    expect(s.activities.find((a) => a.code === "ST-210")).toMatchObject({ status: "in-progress", percentComplete: 70 });
    expect(s.assignments).toHaveLength(fromXer.assignments!.length);
    expect(s.calendars![0].week[1]).toEqual([[8, 12], [13, 17]]);
    expect(s.sourceFormat).toBe("p6-db");
    expect(fs.statSync(file).mtimeMs).toBe(before); // nothing written
    await expect(p6Push(cfg, s)).rejects.toThrow(/read-only/);
  });
});

// ------------------------------------------------- P6 Professional (SQL Server)
// Runs when STRATUM_TEST_MSSQL is set, e.g. "127.0.0.1,14330,sa,<password>".
const MSSQL = process.env.STRATUM_TEST_MSSQL;
(MSSQL ? describe : describe.skip)("P6 Professional database connector (SQL Server)", () => {
  const [host, port, user, password] = (MSSQL ?? "").split(",");
  beforeAll(async () => {
    const mssql = (await import("mssql")).default;
    const admin = await new mssql.ConnectionPool({ server: host, port: Number(port), user, password, options: { encrypt: true, trustServerCertificate: true } }).connect();
    await admin.request().query("if db_id('PMDB') is null create database PMDB");
    await admin.close();
    const pool = await new mssql.ConnectionPool({ server: host, port: Number(port), user, password, database: "PMDB", options: { encrypt: true, trustServerCertificate: true } }).connect();
    const tables = parseXerTables(demoXer());
    for (const [name, rows] of Object.entries(tables)) {
      const cols = [...new Set([...rows.flatMap((r) => Object.keys(r)), "delete_session_id"])];
      // Real P6 uses datetime for *_date columns and varbinary for clndr_data.
      const type = (c: string) => (c.endsWith("_date") ? "datetime" : c === "clndr_data" ? "varbinary(max)" : "nvarchar(400)");
      await pool.request().query(`if object_id('dbo.${name}') is not null drop table dbo.${name}; create table dbo.${name} (${cols.map((c) => `[${c}] ${type(c)}`).join(", ")})`);
      for (const r of rows) {
        const req = pool.request();
        cols.forEach((c, i) => {
          const v = (r as Record<string, string>)[c];
          const val = v === undefined || v === "" ? null : c.endsWith("_date") ? new Date(v.replace(" ", "T") + ":00Z") : c === "clndr_data" ? Buffer.from(v, "latin1") : v;
          req.input(`p${i}`, val);
        });
        await req.query(`insert into dbo.${name} (${cols.map((c) => `[${c}]`).join(",")}) values (${cols.map((_, i) => `@p${i}`).join(",")})`);
      }
    }
    await pool.close();
  }, 120_000);

  it("lists and imports a project from SQL Server", async () => {
    const cfg: P6Connection = { id: "c3", name: "P6 SQL", kind: "p6-sqlserver", host, port: Number(port), service: "PMDB", schema: "dbo", user, password };
    expect((await p6ListProjects(cfg)).map((p) => p.code)).toEqual(["DEMO-RC"]);
    const s = await p6Import(cfg, "100");
    const fromXer = parseXer(demoXer());
    expect(s.activities).toHaveLength(fromXer.activities.length);
    const slab = s.activities.find((a) => a.code === "ST-210")!;
    expect(slab.actualStart).toBe(fromXer.activities.find((a) => a.code === "ST-210")!.actualStart);
    expect(s.calendars![0].week[1]).toEqual([[8, 12], [13, 17]]); // calendar read from varbinary
    expect(s.assignments).toHaveLength(fromXer.assignments!.length);
  }, 60_000);
});
