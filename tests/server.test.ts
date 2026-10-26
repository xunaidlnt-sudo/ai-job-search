import { SMTPServer } from "smtp-server";
import { demoXer } from "../src/core/demo";
import { DEFAULT_PROFILES } from "../src/core/profiles";
import { defaultDashboard, newSchedule } from "../src/core/reporting";
import { parseXer } from "../src/core/xer";
import { buildServer } from "../src/server/app";
import { StratumApi } from "../src/services/api";
import { Repository } from "../src/services/repo";
import { aesBox } from "../src/services/secrets";
import { openPostgres, openSqlite, type SqlDriver } from "../src/services/sql";

const SECRET = "server-test-secret-0123456789";
const PG_URL = process.env.STRATUM_TEST_PG ?? "postgres://postgres@127.0.0.1:55432/stratum_test";

async function makeApp(driver: SqlDriver) {
  const repo = new Repository(driver);
  await repo.migrate();
  const api = new StratumApi({ repo, box: aesBox(SECRET), renderPdf: async () => Buffer.from("%PDF fake") });
  const { app } = await buildServer({ repo, api, jwtSecret: SECRET });
  return { app, repo };
}

const project = () => ({ format: "stratum-project", version: 2, savedAt: "", modelFileName: null, schedule: parseXer(demoXer()), links: [], rules: [], profiles: DEFAULT_PROFILES });

async function scenario(driver: SqlDriver, smtpPort: number, mails: string[]) {
  const { app } = await makeApp(driver);
  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const r = await app.inject({ method: method as "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };

  expect((await call("GET", "/api/status")).body).toMatchObject({ needsSetup: true, pdf: true });
  expect((await call("GET", "/api/projects")).status).toBe(401);
  expect((await call("POST", "/api/setup", undefined, { email: "admin@co.com", name: "Admin", password: "short" })).status).toBe(400);
  const setup = await call("POST", "/api/setup", undefined, { email: "admin@co.com", name: "Admin", password: "correct horse" });
  expect(setup.status).toBe(200);
  expect((await call("POST", "/api/setup", undefined, { email: "x@co.com", name: "X", password: "another one" })).status).toBe(409);
  expect((await call("POST", "/api/login", undefined, { email: "admin@co.com", password: "nope" })).status).toBe(401);
  const admin = (await call("POST", "/api/login", undefined, { email: "ADMIN@co.com", password: "correct horse" })).body.token as string;
  expect((await call("GET", "/api/me", admin)).body.role).toBe("admin");

  // Users and roles
  expect((await call("PUT", "/api/users/u-viewer", admin, { email: "viewer@co.com", name: "Viewer", role: "viewer", password: "viewer-pass" })).status).toBe(200);
  const viewer = (await call("POST", "/api/login", undefined, { email: "viewer@co.com", password: "viewer-pass" })).body.token as string;
  expect((await call("GET", "/api/users", viewer)).status).toBe(403);
  expect((await call("PUT", "/api/projects/p1", viewer, { project: project() })).status).toBe(403);

  // Projects with save conflicts
  expect((await call("PUT", "/api/projects/p1", admin, { project: project() })).body.version).toBe(1);
  expect((await call("PUT", "/api/projects/p1", admin, { project: project(), expectedVersion: 1 })).body.version).toBe(2);
  const conflict = await call("PUT", "/api/projects/p1", admin, { project: project(), expectedVersion: 1 });
  expect(conflict.status).toBe(409);
  expect(conflict.body.version).toBe(2);
  const list = (await call("GET", "/api/projects", viewer)).body;
  expect(list[0]).toMatchObject({ id: "p1", code: "DEMO-RC", version: 2, updatedBy: "admin@co.com" });
  expect((await call("GET", "/api/projects/p1", viewer)).body.project.schedule.activities).toHaveLength(14);

  // Email settings: password never comes back
  await call("PUT", "/api/settings/smtp", admin, { host: "127.0.0.1", port: smtpPort, secure: false, user: "", password: "smtp-pass", from: "stratum@co.com" });
  const smtp = (await call("GET", "/api/settings/smtp", admin)).body;
  expect(smtp.password).toBe("••••••••");
  expect((await call("GET", "/api/settings/smtp", viewer)).status).toBe(403);
  expect((await call("POST", "/api/settings/smtp/test", admin, { smtp, to: "pm@co.com" })).body.message).toMatch(/Test email sent/);

  // Dashboard + schedule + send now
  const dash = defaultDashboard("p1");
  await call("PUT", `/api/dashboards/${dash.id}`, admin, dash);
  const bad = await call("PUT", "/api/schedules/s1", admin, { ...newSchedule(dash.id), id: "s1", to: ["not an email"] });
  expect(bad.status).toBe(400);
  const saved = (await call("PUT", "/api/schedules/s1", admin, { ...newSchedule(dash.id), id: "s1", to: ["pm@co.com"] })).body;
  expect(Date.parse(saved.nextRunAt)).toBeGreaterThan(Date.now());
  const before = mails.length;
  const run = (await call("POST", "/api/schedules/s1/run", admin)).body;
  expect(run.status).toBe("sent");
  expect(mails.length).toBe(before + 1);
  expect(mails[mails.length - 1]).toContain("application/pdf");
  expect((await call("GET", "/api/schedules/s1/runs", viewer)).body).toHaveLength(1);

  // Render tokens are read-only
  const render = (await call("POST", "/api/render-token", viewer, { dashboardId: dash.id })).body.token;
  expect((await call("GET", `/api/dashboards/${dash.id}`, render)).status).toBe(200);
  expect((await call("PUT", "/api/projects/p1", render, { project: project() })).status).toBe(401);

  await app.close();
}

describe("Stratum Server", () => {
  const mails: string[] = [];
  let smtp: SMTPServer;
  const port = 3600 + Math.floor(Math.random() * 1000);
  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _s, cb) {
        let raw = "";
        stream.on("data", (c) => (raw += c.toString()));
        stream.on("end", () => {
          mails.push(raw);
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(port, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => smtp.close(() => r())));

  it("works end to end on SQLite", async () => {
    await scenario(await openSqlite(null), port, mails);
  });

  it("works end to end on PostgreSQL", async () => {
    let d: SqlDriver;
    try {
      d = await openPostgres(PG_URL);
    } catch {
      console.warn("PostgreSQL not reachable; skipping");
      return;
    }
    for (const t of ["projects", "dashboards", "schedules", "runs", "settings", "users"]) await d.exec(`drop table if exists ${t}`);
    await scenario(d, port, mails);
  });
});
