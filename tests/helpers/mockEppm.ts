// Fake P6 EPPM REST server shared by the P6 tests.
import http from "node:http";

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function mockEppm() {
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
      if (!u.pathname.startsWith("/p6ws/restapi")) {
        res.writeHead(404);
        return res.end("Not Found");
      }
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

