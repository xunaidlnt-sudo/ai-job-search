import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { demoXer } from "../src/core/demo";
import { DEFAULT_PROFILES } from "../src/core/profiles";
import type { StratumProject } from "../src/core/project";
import { computeNextRun, defaultDashboard, fillTemplate, newSchedule } from "../src/core/reporting";
import { parseXer } from "../src/core/xer";
import { buildWorkbook } from "../src/services/excel";
import { parseRecipients, smtpMailer } from "../src/services/mailer";
import { Repository, VersionConflictError } from "../src/services/repo";
import { runDue, runSchedule } from "../src/services/runner";
import { aesBox, getSmtp, MASK, maskSmtp, setSmtp } from "../src/services/secrets";
import { openPostgres, openSqlite } from "../src/services/sql";

const PG_URL = process.env.STRATUM_TEST_PG ?? "postgres://postgres@127.0.0.1:55432/stratum_test";
const U = (s: string) => Date.parse(s);

function demoProject(): StratumProject {
  return {
    format: "stratum-project",
    version: 2,
    savedAt: "",
    modelFileName: null,
    schedule: parseXer(demoXer()),
    links: [],
    rules: [],
    profiles: DEFAULT_PROFILES,
  };
}

describe("report schedule timing", () => {
  const base = { time: "08:00", weekdays: [1], monthDay: 1, utcOffsetMinutes: 240 };
  it("daily at 08:00 Dubai is 04:00 UTC", () => {
    expect(computeNextRun({ ...base, frequency: "daily" }, U("2026-03-02T03:00:00Z"))).toBe(U("2026-03-02T04:00:00Z"));
    expect(computeNextRun({ ...base, frequency: "daily" }, U("2026-03-02T04:00:00Z"))).toBe(U("2026-03-03T04:00:00Z"));
  });
  it("weekly on chosen weekdays", () => {
    // 2026-03-02 is a Monday; ask for Wednesday and Friday
    expect(computeNextRun({ ...base, frequency: "weekly", weekdays: [3, 5] }, U("2026-03-02T10:00:00Z"))).toBe(U("2026-03-04T04:00:00Z"));
    expect(computeNextRun({ ...base, frequency: "weekly", weekdays: [3, 5] }, U("2026-03-04T05:00:00Z"))).toBe(U("2026-03-06T04:00:00Z"));
  });
  it("monthly on a day, or the last day", () => {
    expect(computeNextRun({ ...base, frequency: "monthly", monthDay: 15 }, U("2026-03-20T00:00:00Z"))).toBe(U("2026-04-15T04:00:00Z"));
    expect(computeNextRun({ ...base, frequency: "monthly", monthDay: -1 }, U("2026-02-10T00:00:00Z"))).toBe(U("2026-02-28T04:00:00Z"));
  });
  it("respects the local date across midnight UTC", () => {
    // 23:30 local Dubai on Sunday = 19:30 UTC; next Monday 08:00 local
    expect(computeNextRun({ ...base, frequency: "weekly", weekdays: [1] }, U("2026-03-01T19:30:00Z"))).toBe(U("2026-03-02T04:00:00Z"));
  });
  it("fills subject templates", () => {
    expect(fillTemplate("{project} report {date} (DD {datadate})", { project: "T1", date: U("2026-03-02T21:00:00Z"), dataDate: U("2026-03-01T08:00:00Z"), utcOffsetMinutes: 240 })).toBe(
      "T1 report 03-Mar-2026 (DD 01-Mar-2026)",
    );
  });
});

describe("secrets", () => {
  it("seals and opens, and masks for the UI", () => {
    const box = aesBox("a-long-enough-secret-key");
    const sealed = box.seal("hunter2");
    expect(sealed).not.toContain("hunter2");
    expect(box.open(sealed)).toBe("hunter2");
    expect(() => aesBox("short")).toThrow();
    expect(maskSmtp({ host: "h", port: 587, secure: false, user: "u", password: "p", from: "f" })!.password).toBe(MASK);
  });
});

async function repoContract(make: () => Promise<Repository>) {
  const repo = await make();
  await repo.migrate();
  await repo.migrate(); // idempotent
  const p = demoProject();
  expect(await repo.saveProject("p1", p, { user: "a@x.com" })).toBe(1);
  const list = await repo.listProjects();
  expect(list.find((x) => x.id === "p1")!.code).toBe("DEMO-RC");
  const got = await repo.getProject("p1");
  expect(got!.project.schedule!.activities).toHaveLength(14);
  expect(await repo.saveProject("p1", p, { expectedVersion: 1 })).toBe(2);
  await expect(repo.saveProject("p1", p, { expectedVersion: 1 })).rejects.toBeInstanceOf(VersionConflictError);

  const d = defaultDashboard("p1");
  await repo.saveDashboard(d);
  await repo.saveDashboard({ ...d, name: "Renamed" });
  expect((await repo.listDashboards()).map((x) => x.name)).toContain("Renamed");

  const s = { ...newSchedule(d.id), nextRunAt: "2026-03-02T04:00:00.000Z", to: ["pm@example.com"] };
  await repo.saveSchedule(s);
  expect(await repo.dueSchedules(new Date("2026-03-02T03:59:00Z"))).toHaveLength(0);
  expect(await repo.dueSchedules(new Date("2026-03-02T04:00:00Z"))).toHaveLength(1);
  await repo.saveSchedule({ ...s, enabled: false });
  expect(await repo.dueSchedules(new Date("2026-03-03T00:00:00Z"))).toHaveLength(0);

  await repo.setSetting("mode", "p6");
  await repo.setSetting("mode", "msp");
  expect(await repo.getSetting("mode")).toBe("msp");

  await repo.saveUser({ id: "u1", email: "Admin@Example.com", name: "Admin", role: "admin", passwordHash: "x" });
  expect((await repo.getUserByEmail("admin@example.com"))!.id).toBe("u1");
  expect(await repo.countUsers()).toBe(1);

  await repo.deleteProject("p1");
  expect(await repo.getProject("p1")).toBeNull();
  await repo.close();
}

describe("repository", () => {
  it("works on SQLite and persists to a file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-"));
    const file = path.join(dir, "stratum.db");
    await repoContract(async () => new Repository(await openSqlite(file)));
    const again = new Repository(await openSqlite(file));
    expect(await again.getSetting("mode")).toBe("msp");
    await again.close();
  });

  it("works on PostgreSQL", async () => {
    let driver;
    try {
      driver = await openPostgres(PG_URL);
    } catch {
      console.warn("PostgreSQL not reachable; skipping");
      return;
    }
    for (const t of ["projects", "dashboards", "schedules", "runs", "settings", "users"]) await driver.exec(`drop table if exists ${t}`);
    await repoContract(async () => new Repository(driver!));
  });
});

describe("excel report", () => {
  it("builds a workbook with summary, activity lists, curve and resources", async () => {
    const s = parseXer(demoXer());
    const buf = await buildWorkbook(s, { portfolio: [{ id: "p1", schedule: s }] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Progress", "Progress S-Curve", "Late & Critical", "Look-ahead 3 weeks", "All Activities", "S-Curve", "Resources by Week", "Portfolio"]);
    expect(wb.getWorksheet("All Activities")!.rowCount).toBe(1 + 14 - 0);
    expect(String(wb.getWorksheet("Summary")!.getCell("B2").value)).toContain("DEMO-RC");
  });
});

describe("email reports end to end", () => {
  const received: { to: string; raw: string }[] = [];
  let server: SMTPServer;
  const port = 2525 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c) => (raw += c.toString()));
        stream.on("end", () => {
          received.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), raw });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("parses recipient lists", () => {
    expect(parseRecipients("a@x.com; b@y.org,\nnot-an-email")).toEqual({ valid: ["a@x.com", "b@y.org"], invalid: ["not-an-email"] });
  });

  it("sends a scheduled report with PDF and Excel and moves the schedule on", async () => {
    const repo = new Repository(await openSqlite(null));
    await repo.migrate();
    const box = aesBox("test-secret-0123456789");
    await setSmtp(repo, box, { host: "127.0.0.1", port, secure: false, user: "", password: "", from: "stratum@example.com" });
    expect((await getSmtp(repo, box))!.host).toBe("127.0.0.1");
    await repo.saveProject("p1", demoProject());
    const dash = defaultDashboard("p1");
    await repo.saveDashboard(dash);
    const sched = { ...newSchedule(dash.id), to: ["pm@example.com"], cc: ["director@example.com"], nextRunAt: "2026-03-02T04:00:00.000Z" };
    await repo.saveSchedule(sched);

    const deps = {
      repo,
      renderPdf: async () => Buffer.from("%PDF-1.4 fake"),
      mailer: async () => smtpMailer((await getSmtp(repo, box))!),
      now: () => new Date("2026-03-02T04:00:30Z"),
    };
    const runs = await runDue(deps);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("sent");
    expect(received).toHaveLength(1);
    expect(received[0].to).toBe("pm@example.com,director@example.com");
    const subject = received[0].raw.match(/^Subject: (.*(?:\r\n .*)*)/m)![1].replace(/\r\n /g, " ");
    const decoded = subject
      .replace(/\?=\s+=\?UTF-8\?Q\?/g, "")
      .replace(/^=\?UTF-8\?Q\?|\?=$/g, "")
      .replace(/_/g, " ");
    expect(decodeURIComponent(decoded.replace(/=([0-9A-F]{2})/g, "%$1"))).toBe("DEMO-RC \u2013 progress report 02-Mar-2026");
    expect(received[0].raw).toContain("application/pdf");
    expect(received[0].raw).toContain("spreadsheetml");
    const after = (await repo.getSchedule(sched.id))!;
    expect(after.lastRunAt).toBe("2026-03-02T04:00:30.000Z");
    expect(after.nextRunAt).toBe("2026-03-09T04:00:00.000Z"); // next Monday 08:00 Dubai
    expect((await repo.listRuns(sched.id))[0].status).toBe("sent");

    // A failing send is recorded, not thrown.
    const bad = await runSchedule({ ...deps, mailer: async () => smtpMailer({ host: "127.0.0.1", port: 1, secure: false, user: "", password: "", from: "x@y.z" }) }, after, true);
    expect(bad.status).toBe("failed");
    expect((await repo.getSchedule(sched.id))!.nextRunAt).toBe("2026-03-09T04:00:00.000Z"); // manual run keeps the plan
  });
});
