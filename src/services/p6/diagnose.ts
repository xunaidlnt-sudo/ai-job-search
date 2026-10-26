// Step-by-step check of a P6 connection, so a failure says which link in the
// chain broke (name lookup, port, certificate, API path, login, access) and
// what to ask IT for. Each step stops the chain when it fails.

import * as dns from "node:dns/promises";
import * as fs from "node:fs";
import * as net from "node:net";
import * as tls from "node:tls";
import type { P6Connection } from "../../core/reporting";
import { openP6Db, p6DbListProjects } from "./db";
import { EppmClient, P6HttpError, eppmListProjects } from "./eppm";
import { caList, describeNetError, parsePem } from "./http";
import { eppmTransport, type P6Opts } from "./index";

export type StepStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  /** What to do about it, in plain words. */
  hint?: string;
}

export interface P6Diagnosis {
  ok: boolean;
  summary: string;
  steps: CheckStep[];
  projects?: number;
}

export interface DiagnoseOpts extends P6Opts {
  /** Where the check runs, for hints: the desktop app trusts the OS store; the server uses NODE_EXTRA_CA_CERTS. */
  where?: "desktop" | "server";
  timeoutMs?: number;
}

const DEFAULT_PORTS: Record<string, number> = { "p6-sqlserver": 1433, "p6-oracle": 1521 };

function tcpCheck(host: string, port: number, timeoutMs: number): Promise<{ ok: true; ms: number } | { ok: false; code: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host, port });
    const done = (r: { ok: true; ms: number } | { ok: false; code: string }) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs, () => done({ ok: false, code: "ETIMEDOUT" }));
    sock.once("connect", () => done({ ok: true, ms: Date.now() - t0 }));
    sock.once("error", (e: NodeJS.ErrnoException) => done({ ok: false, code: e.code ?? e.message }));
  });
}

interface CertInfo {
  authorized: boolean;
  error?: string;
  subject: string;
  issuer: string;
  validTo: string;
  expired: boolean;
  nameMismatch?: string;
}

function certCheck(host: string, port: number, ca: string[] | undefined, timeoutMs: number): Promise<CertInfo | { failed: string }> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ca, rejectUnauthorized: false });
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      resolve({ failed: "ETIMEDOUT" });
    });
    sock.once("error", (e: NodeJS.ErrnoException) => resolve({ failed: e.code ?? e.message }));
    sock.once("secureConnect", () => {
      const c = sock.getPeerCertificate();
      const nameErr = c && Object.keys(c).length ? tls.checkServerIdentity(host, c) : undefined;
      const validTo = c?.valid_to ?? "";
      const info: CertInfo = {
        authorized: sock.authorized,
        error: sock.authorizationError ? String(sock.authorizationError) : undefined,
        subject: c?.subject?.CN ? String(c.subject.CN) : "",
        issuer: c?.issuer?.CN ? String(c.issuer.CN) : c?.issuer?.O ? String(c.issuer.O) : "",
        validTo,
        expired: !!validTo && new Date(validTo).getTime() < Date.now(),
        nameMismatch: nameErr ? nameErr.message : undefined,
      };
      sock.end();
      resolve(info);
    });
  });
}

function certHint(where: DiagnoseOpts["where"]): string {
  return where === "desktop"
    ? "The server's certificate isn't trusted on this PC. Ask IT to install the company root certificate in Windows (or the macOS keychain), or paste it into “Company certificate” on this connection."
    : "The server's certificate isn't trusted. Paste the company root certificate into “Company certificate” on this connection, or set NODE_EXTRA_CA_CERTS on the Stratum Server to a file holding it and restart.";
}

const netHint = (kind: string, host: string, port: number) =>
  kind === "dns"
    ? `The name “${host}” can't be found. Check the spelling, or connect to the company network / VPN.`
    : kind === "refused"
      ? `${host} answered but nothing is listening on port ${port}. The P6 application may be stopped, or the port in the address is wrong.`
      : kind === "timeout"
        ? `No answer from ${host}:${port}. A firewall is blocking it, or you're not on the company network / VPN. Ask IT to allow this computer to reach that port.`
        : "";

export async function p6Diagnose(cfg: P6Connection, opts: DiagnoseOpts = {}): Promise<P6Diagnosis> {
  const steps: CheckStep[] = [];
  const timeout = opts.timeoutMs ?? 8000;
  const add = (s: CheckStep) => (steps.push(s), s);
  const finish = (projects?: number): P6Diagnosis => {
    const bad = steps.find((s) => s.status === "fail");
    const warn = steps.find((s) => s.status === "warn");
    return {
      ok: !bad,
      projects,
      steps,
      summary: bad ? `Stopped at “${bad.label}”: ${bad.detail}` : warn ? `Connected, with a warning: ${warn.detail}` : `Connected. ${projects ?? 0} project(s) visible.`,
    };
  };

  // ---- SQLite file: no network involved
  if (cfg.kind === "p6-sqlite") {
    if (!cfg.file || !fs.existsSync(cfg.file)) {
      add({ id: "file", label: "Database file", status: "fail", detail: cfg.file ? `Not found: ${cfg.file}` : "No file chosen", hint: "Pick the P6 Professional .db file (usually in your Documents or P6 install folder)." });
      return finish();
    }
    add({ id: "file", label: "Database file", status: "ok", detail: cfg.file });
    return dbSteps(cfg, opts, add, finish);
  }

  // ---- 1. Address
  let host = "";
  let port = 0;
  let https = false;
  let prefix = "";
  if (cfg.kind === "eppm") {
    let u: URL;
    try {
      u = new URL(cfg.url ?? "");
    } catch {
      add({ id: "address", label: "Address", status: "fail", detail: `“${cfg.url ?? ""}” is not a web address`, hint: "Use the P6 REST address, e.g. https://p6.company.com/p6ws/restapi" });
      return finish();
    }
    if (!/^https?:$/.test(u.protocol)) {
      add({ id: "address", label: "Address", status: "fail", detail: `${u.protocol} is not supported`, hint: "The address must start with https:// (or http:// on a test system)." });
      return finish();
    }
    https = u.protocol === "https:";
    host = u.hostname;
    port = Number(u.port) || (https ? 443 : 80);
    prefix = u.toString().replace(/\/+$/, "");
    const pathWarn = !/\/restapi$/i.test(u.pathname.replace(/\/+$/, ""));
    add({
      id: "address",
      label: "Address",
      status: !https || pathWarn ? "warn" : "ok",
      detail: `${https ? "HTTPS" : "HTTP"} to ${host}, port ${port}, path ${u.pathname}`,
      hint: !https
        ? "Plain HTTP sends the P6 password unencrypted. Fine on a test system; use https:// in production."
        : pathWarn
          ? "The P6 REST address normally ends in /p6ws/restapi."
          : undefined,
    });
  } else {
    host = cfg.host ?? "";
    port = cfg.port ?? DEFAULT_PORTS[cfg.kind] ?? 0;
    if (!host) {
      add({ id: "address", label: "Address", status: "fail", detail: "No database host given", hint: "Enter the database server name, e.g. p6db.company.local" });
      return finish();
    }
    add({ id: "address", label: "Address", status: "ok", detail: `${cfg.kind === "p6-oracle" ? "Oracle" : "SQL Server"} at ${host}, port ${port}` });
  }

  // ---- 2. Name lookup
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    add({ id: "dns", label: "Server name", status: "ok", detail: `${host} → ${addrs.map((a) => a.address).slice(0, 3).join(", ")}` });
  } catch (e) {
    add({ id: "dns", label: "Server name", status: "fail", detail: `${host} could not be found (${(e as NodeJS.ErrnoException).code ?? "lookup failed"})`, hint: netHint("dns", host, port) });
    return finish();
  }

  // ---- 3. Port
  const tcp = await tcpCheck(host, port, timeout);
  if (!tcp.ok) {
    const kind = tcp.code === "ECONNREFUSED" ? "refused" : tcp.code === "ETIMEDOUT" ? "timeout" : "other";
    add({
      id: "port",
      label: "Port open",
      status: "fail",
      detail: `${host}:${port} — ${kind === "refused" ? "connection refused" : kind === "timeout" ? "no answer" : tcp.code}`,
      hint: netHint(kind, host, port) || "The network refused the connection.",
    });
    return finish();
  }
  add({ id: "port", label: "Port open", status: "ok", detail: `${host}:${port} answered in ${tcp.ms} ms` });

  if (cfg.kind !== "eppm") return dbSteps(cfg, opts, add, finish);

  // ---- 4. Certificate (Node's view; the platform fetch may still trust it)
  let certStep: CheckStep | null = null;
  if (https) {
    const extra = parsePem(cfg.caCert);
    const c = await certCheck(host, port, caList(cfg), timeout);
    if ("failed" in c) {
      certStep = add({ id: "cert", label: "Certificate", status: "fail", detail: `Secure connection failed (${c.failed})`, hint: "The server didn't complete a secure (TLS) connection. Check that the port is the HTTPS one." });
      return finish();
    }
    const who = `${c.subject || host}, issued by ${c.issuer || "unknown"}, valid to ${c.validTo || "?"}`;
    if (c.expired) {
      certStep = add({ id: "cert", label: "Certificate", status: "fail", detail: `Expired: ${who}`, hint: "The P6 server's certificate has expired. IT needs to renew it." });
      return finish();
    }
    if (c.nameMismatch) {
      certStep = add({ id: "cert", label: "Certificate", status: "fail", detail: `Issued for a different name: ${who}`, hint: `Use the server name on the certificate (${c.subject}) in the address, or ask IT for a certificate that covers “${host}”.` });
      return finish();
    }
    certStep = c.authorized
      ? add({ id: "cert", label: "Certificate", status: "ok", detail: `Trusted${extra.length ? " (company certificate)" : ""}: ${who}` })
      : add({ id: "cert", label: "Certificate", status: "warn", detail: `Not in the built-in list (${c.error ?? "untrusted"}): ${who}`, hint: certHint(opts.where) });
  }

  // ---- 5. REST API present at this path
  const t = eppmTransport(cfg, opts);
  const platformTrust = !!opts.fetch && !parsePem(cfg.caCert).length;
  try {
    const r = await t.fetch(`${prefix}/project?Fields=ObjectId`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
    if (certStep?.status === "warn") {
      // Node didn't trust it but the platform request worked: the OS store does.
      certStep.status = "ok";
      certStep.detail = certStep.detail.replace(/^Not in the built-in list \([^)]*\)/, platformTrust ? "Trusted by this computer's certificate store" : "Trusted");
      certStep.hint = undefined;
    }
    if (r.status === 404) {
      add({ id: "api", label: "P6 REST API", status: "fail", detail: `Nothing at ${prefix} (404)`, hint: "The REST API isn't deployed at this path. Check the address ends in /p6ws/restapi, and ask the P6 admin whether P6 web services (REST) are deployed and running." });
      return finish();
    }
    if (r.status >= 500) {
      add({ id: "api", label: "P6 REST API", status: "fail", detail: `Server error ${r.status}`, hint: "The P6 application server answered with an error. Ask the P6 admin to check the p6ws application logs." });
      return finish();
    }
    add({ id: "api", label: "P6 REST API", status: "ok", detail: `Found at ${prefix} (answered ${r.status})` });
  } catch (e) {
    const d = describeNetError(e);
    if (d.kind === "cert") {
      if (certStep) {
        certStep.status = "fail";
        certStep.hint = certHint(opts.where);
      } else add({ id: "cert", label: "Certificate", status: "fail", detail: d.message, hint: certHint(opts.where) });
      return finish();
    }
    add({ id: "api", label: "P6 REST API", status: "fail", detail: d.message, hint: netHint(d.kind, host, port) || "The request didn't complete. A proxy may be blocking it; ask IT whether this computer needs a proxy to reach P6." });
    return finish();
  }

  // ---- 6. Login
  const client = new EppmClient(cfg, t.fetch, { cookieJar: t.cookieJar });
  try {
    await client.login();
    add({ id: "login", label: "Sign in", status: "ok", detail: cfg.auth === "bearer" ? "Using the access token" : `Signed in as ${cfg.user}${cfg.database ? ` to ${cfg.database}` : ""}` });
  } catch (e) {
    const st = e instanceof P6HttpError ? e.status : 0;
    add({
      id: "login",
      label: "Sign in",
      status: "fail",
      detail: (e as Error).message,
      hint:
        st === 401
          ? "P6 rejected the user name, password or database name. Check them with the P6 web client, and use the database name shown at the P6 login screen."
          : st === 403
            ? "The user exists but may not use the API. In P6 Admin, give this user module access for web services / REST API."
            : "Sign-in didn't complete. If P6 uses single sign-on, ask the admin for a service account allowed to sign in to the API, or use an access token.",
    });
    return finish();
  }

  // ---- 7. Project access
  try {
    const list = await eppmListProjects(client);
    add({
      id: "projects",
      label: "Project access",
      status: list.length ? "ok" : "warn",
      detail: list.length ? `${list.length} project(s) visible, e.g. ${list.slice(0, 3).map((p) => p.code).join(", ")}` : "Signed in, but this user can see no projects",
      hint: list.length ? undefined : "Give the user access to the projects' OBS nodes in P6 (Admin → Users → Project Access).",
    });
    add({ id: "write", label: "Update P6", status: "skip", detail: "Checked when you first send progress. The user needs rights to edit activities in those projects." });
    return finish(list.length);
  } catch (e) {
    const st = e instanceof P6HttpError ? e.status : 0;
    add({ id: "projects", label: "Project access", status: "fail", detail: (e as Error).message, hint: st === 403 ? "The user may not read projects through the API. Check module access and project security in P6." : undefined });
    return finish();
  } finally {
    await client.logout().catch(() => {});
  }
}

async function dbSteps(cfg: P6Connection, opts: DiagnoseOpts, add: (s: CheckStep) => CheckStep, finish: (n?: number) => P6Diagnosis): Promise<P6Diagnosis> {
  let db: Awaited<ReturnType<typeof openP6Db>>;
  try {
    db = await openP6Db(cfg, opts);
    add({ id: "login", label: "Sign in", status: "ok", detail: cfg.kind === "p6-sqlite" ? "Opened read-only" : `Signed in as ${cfg.user}` });
  } catch (e) {
    const m = (e as Error).message;
    add({
      id: "login",
      label: "Sign in",
      status: "fail",
      detail: m,
      hint: /login failed|ORA-01017|password/i.test(m)
        ? "The database rejected the user name or password. Use a read-only database login from your DBA."
        : /ORA-12514|service/i.test(m)
          ? "The Oracle service name is wrong. Ask the DBA for the P6 database service name."
          : /Cannot open database|does not exist/i.test(m)
            ? "The database name is wrong, or this login has no access to it."
            : undefined,
    });
    return finish();
  }
  try {
    const list = await p6DbListProjects(db);
    add({
      id: "projects",
      label: "P6 tables",
      status: list.length ? "ok" : "warn",
      detail: list.length ? `${list.length} project(s) found, e.g. ${list.slice(0, 3).map((p) => p.code).join(", ")}` : "The P6 tables are readable but hold no projects",
    });
    return finish(list.length);
  } catch (e) {
    const m = (e as Error).message;
    add({
      id: "projects",
      label: "P6 tables",
      status: "fail",
      detail: m,
      hint: /Invalid object name|ORA-00942|no such table/i.test(m)
        ? "The P6 tables weren't found. Set the schema (usually dbo on SQL Server, ADMUSER on Oracle), or the login lacks SELECT rights on them."
        : undefined,
    });
    return finish();
  } finally {
    await Promise.resolve(db.close()).catch(() => {});
  }
}
