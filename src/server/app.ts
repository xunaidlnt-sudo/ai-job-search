// Stratum Server: the shared, multi-user database host.
//
//   - Users with roles (admin / planner / viewer), bcrypt passwords, JWT sessions.
//   - REST API over the StratumApi service layer.
//   - Serves the web app, so the team just opens the server's address.
//   - Runs report schedules every minute and renders PDFs with headless Chromium.

import bcrypt from "bcryptjs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { uid } from "../core/reporting";
import { StratumApi } from "../services/api";
import { Repository, VersionConflictError, type UserRecord } from "../services/repo";

export type Role = UserRecord["role"];

export interface ServerOptions {
  repo: Repository;
  api: StratumApi;
  jwtSecret: string;
  staticDir?: string | null;
  /** Lifetime of a login session. */
  sessionHours?: number;
  log?: boolean;
}

interface Claims {
  sub: string;
  email: string;
  name: string;
  role: Role;
  /** Render tokens can only read one dashboard. */
  scope?: "render";
}

const RANK: Record<Role, number> = { viewer: 0, planner: 1, admin: 2 };

export async function buildServer(o: ServerOptions) {
  const app = Fastify({ logger: o.log ?? false, bodyLimit: 200 * 1024 * 1024 });
  const { api, repo } = o;

  const sign = (c: Claims, hours: number) => jwt.sign(c, o.jwtSecret, { expiresIn: `${hours}h` });

  const auth = (min: Role) => async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    try {
      const c = jwt.verify(token, o.jwtSecret) as Claims;
      if (c.scope === "render" && req.method !== "GET") throw new Error("read-only token");
      if (RANK[c.role] < RANK[min]) return reply.code(403).send({ error: `Needs ${min} access` });
      (req as FastifyRequest & { user: Claims }).user = c;
    } catch {
      return reply.code(401).send({ error: "Please sign in" });
    }
  };
  const userOf = (req: FastifyRequest) => (req as FastifyRequest & { user: Claims }).user;

  // The desktop app (app:// origin) and other front ends call the API directly.
  // Auth is a bearer token, never a cookie, so allowing any origin is safe here.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof VersionConflictError) return reply.code(409).send({ error: err.message, version: err.current });
    const code = (err as { statusCode?: number }).statusCode;
    reply.code(code && code >= 400 && code < 600 ? code : 400).send({ error: err.message });
  });

  // ---- setup and sessions
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/status", async () => ({ needsSetup: (await repo.countUsers()) === 0, pdf: api.canRenderPdf, server: true }));

  app.post<{ Body: { email: string; name: string; password: string } }>("/api/setup", async (req, reply) => {
    if ((await repo.countUsers()) > 0) return reply.code(409).send({ error: "Already set up" });
    const { email, name, password } = req.body ?? ({} as never);
    if (!email || !password || password.length < 8) return reply.code(400).send({ error: "Email and a password of at least 8 characters are required" });
    const u: UserRecord = { id: uid("usr"), email, name: name || email, role: "admin", passwordHash: await bcrypt.hash(password, 10) };
    await repo.saveUser(u);
    return { token: sign({ sub: u.id, email: u.email, name: u.name, role: u.role }, o.sessionHours ?? 12), user: { id: u.id, email: u.email, name: u.name, role: u.role } };
  });

  app.post<{ Body: { email: string; password: string } }>("/api/login", async (req, reply) => {
    const u = await repo.getUserByEmail(req.body?.email ?? "");
    if (!u || !(await bcrypt.compare(req.body?.password ?? "", u.passwordHash))) return reply.code(401).send({ error: "Wrong email or password" });
    return { token: sign({ sub: u.id, email: u.email, name: u.name, role: u.role }, o.sessionHours ?? 12), user: { id: u.id, email: u.email, name: u.name, role: u.role } };
  });

  app.get("/api/me", { preHandler: auth("viewer") }, async (req) => userOf(req));

  // ---- users (admin)
  app.get("/api/users", { preHandler: auth("admin") }, async () => repo.listUsers());
  app.put<{ Params: { id: string }; Body: { email: string; name: string; role: Role; password?: string } }>("/api/users/:id", { preHandler: auth("admin") }, async (req) => {
    const b = req.body;
    if (!["admin", "planner", "viewer"].includes(b.role)) throw new Error("Invalid role");
    const existing = (await repo.listUsers()).find((x) => x.id === req.params.id);
    const old = existing ? await repo.getUserByEmail(existing.email) : null;
    if (!old && !b.password) throw new Error("A password is required for a new user");
    if (b.password && b.password.length < 8) throw new Error("Password must be at least 8 characters");
    await repo.saveUser({
      id: req.params.id,
      email: b.email,
      name: b.name || b.email,
      role: b.role,
      passwordHash: b.password ? await bcrypt.hash(b.password, 10) : old!.passwordHash,
    });
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/users/:id", { preHandler: auth("admin") }, async (req) => {
    if (userOf(req).sub === req.params.id) throw new Error("You cannot delete your own account");
    await repo.deleteUser(req.params.id);
    return { ok: true };
  });

  // ---- projects
  app.get("/api/projects", { preHandler: auth("viewer") }, async () => api.listProjects());
  app.get<{ Params: { id: string } }>("/api/projects/:id", { preHandler: auth("viewer") }, async (req, reply) => {
    const p = await api.getProject(req.params.id);
    return p ?? reply.code(404).send({ error: "Project not found" });
  });
  app.put<{ Params: { id: string }; Body: { project: never; expectedVersion?: number } }>("/api/projects/:id", { preHandler: auth("planner") }, async (req) => ({
    version: await api.saveProject(req.params.id, req.body.project, req.body.expectedVersion, userOf(req).email),
  }));
  app.delete<{ Params: { id: string } }>("/api/projects/:id", { preHandler: auth("planner") }, async (req) => {
    await api.deleteProject(req.params.id);
    return { ok: true };
  });

  // ---- dashboards
  app.get("/api/dashboards", { preHandler: auth("viewer") }, async () => api.listDashboards());
  app.get<{ Params: { id: string } }>("/api/dashboards/:id", { preHandler: auth("viewer") }, async (req, reply) => (await api.getDashboard(req.params.id)) ?? reply.code(404).send({ error: "Not found" }));
  app.put<{ Params: { id: string }; Body: never }>("/api/dashboards/:id", { preHandler: auth("planner") }, async (req) => {
    await api.saveDashboard({ ...(req.body as object), id: req.params.id } as never);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/dashboards/:id", { preHandler: auth("planner") }, async (req) => {
    await api.deleteDashboard(req.params.id);
    return { ok: true };
  });

  // ---- report schedules
  app.get("/api/schedules", { preHandler: auth("viewer") }, async () => api.listSchedules());
  app.put<{ Params: { id: string }; Body: never }>("/api/schedules/:id", { preHandler: auth("planner") }, async (req) => api.saveSchedule({ ...(req.body as object), id: req.params.id } as never));
  app.delete<{ Params: { id: string } }>("/api/schedules/:id", { preHandler: auth("planner") }, async (req) => {
    await api.deleteSchedule(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/schedules/:id/run", { preHandler: auth("planner") }, async (req) => api.runScheduleNow(req.params.id));
  app.get<{ Params: { id: string } }>("/api/schedules/:id/runs", { preHandler: auth("viewer") }, async (req) => api.listRuns(req.params.id));
  app.get("/api/runs", { preHandler: auth("viewer") }, async () => api.listRuns());

  // ---- settings (admin)
  app.get("/api/settings/smtp", { preHandler: auth("admin") }, async () => (await api.getSmtp()) ?? {});
  app.put<{ Body: never }>("/api/settings/smtp", { preHandler: auth("admin") }, async (req) => {
    await api.setSmtp(req.body as never);
    return { ok: true };
  });
  app.post<{ Body: { smtp: never; to?: string } }>("/api/settings/smtp/test", { preHandler: auth("admin") }, async (req) => ({ message: await api.testSmtp(req.body.smtp, req.body.to) }));
  app.get("/api/settings/p6", { preHandler: auth("planner") }, async () => api.getP6());
  app.put<{ Body: never }>("/api/settings/p6", { preHandler: auth("admin") }, async (req) => {
    await api.setP6(req.body as never);
    return { ok: true };
  });
  app.get<{ Params: { key: string } }>("/api/settings/general/:key", { preHandler: auth("viewer") }, async (req) => ({ value: await api.getSetting(req.params.key) }));
  app.put<{ Params: { key: string }; Body: { value: unknown } }>("/api/settings/general/:key", { preHandler: auth("admin") }, async (req) => {
    await api.setSetting(req.params.key, req.body.value);
    return { ok: true };
  });

  // ---- P6
  app.post<{ Body: { connection: never } }>("/api/p6/test", { preHandler: auth("planner") }, async (req) => ({ message: await api.p6Test(req.body.connection) }));
  app.get<{ Params: { conn: string } }>("/api/p6/:conn/projects", { preHandler: auth("planner") }, async (req) => api.p6Projects(req.params.conn));
  app.post<{ Params: { conn: string }; Body: { objectId: string } }>("/api/p6/:conn/import", { preHandler: auth("planner") }, async (req) => api.p6Import(req.params.conn, req.body.objectId));
  app.post<{ Params: { conn: string }; Body: { schedule: never } }>("/api/p6/:conn/push", { preHandler: auth("planner") }, async (req) => api.p6Push(req.params.conn, req.body.schedule));

  // ---- render tokens (used by the PDF renderer; also lets a user preview a report)
  app.post<{ Body: { dashboardId: string } }>("/api/render-token", { preHandler: auth("viewer") }, async (req) => {
    const u = userOf(req);
    return { token: sign({ sub: u.sub, email: u.email, name: u.name, role: "viewer", scope: "render" }, 0.25) };
  });

  // ---- web app
  if (o.staticDir && fs.existsSync(path.join(o.staticDir, "index.html"))) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: path.resolve(o.staticDir), index: ["index.html"] });
  }

  /** A render token for the server's own PDF renderer. */
  const internalRenderToken = () => sign({ sub: "system", email: "system@stratum", name: "Report renderer", role: "viewer", scope: "render" }, 0.25);

  // Returned in a wrapper: a Fastify instance is "thenable", so awaiting it directly would start it.
  return { app, internalRenderToken };
}
