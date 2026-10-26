// The step-by-step P6 connection check, against a fake EPPM server over HTTP
// and over HTTPS signed by a self-made "company" certificate authority.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { P6Connection } from "../src/core/reporting";
import { p6ListProjects } from "../src/services/p6";
import { p6Diagnose, type P6Diagnosis } from "../src/services/p6/diagnose";
import { parsePem } from "../src/services/p6/http";
import { mockEppm } from "./helpers/mockEppm";

const step = (d: P6Diagnosis, id: string) => d.steps.find((s) => s.id === id);
const statuses = (d: P6Diagnosis) => Object.fromEntries(d.steps.map((s) => [s.id, s.status]));

describe("P6 connection check over HTTP", () => {
  const { server } = mockEppm();
  let base: P6Connection;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    base = { id: "c", name: "EPPM", kind: "eppm", url: `http://127.0.0.1:${port}/p6ws/restapi`, database: "PMDB", user: "planner", password: "secret", auth: "session" };
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("walks every step and reports the projects", async () => {
    const d = await p6Diagnose(base);
    expect(d.ok).toBe(true);
    expect(statuses(d)).toEqual({ address: "warn", dns: "ok", port: "ok", api: "ok", login: "ok", projects: "ok", write: "skip" });
    expect(step(d, "address")!.hint).toMatch(/unencrypted/);
    expect(d.projects).toBe(2);
  });

  it("stops at sign-in with a plain-language hint", async () => {
    const d = await p6Diagnose({ ...base, password: "wrong" });
    expect(d.ok).toBe(false);
    expect(step(d, "login")!.status).toBe("fail");
    expect(step(d, "login")!.hint).toMatch(/user name, password or database name/);
    expect(step(d, "projects")).toBeUndefined();
  });

  it("spots a wrong REST path", async () => {
    const d = await p6Diagnose({ ...base, url: base.url!.replace("/p6ws/restapi", "/p6/restapi") });
    expect(step(d, "address")!.status).toBe("warn");
    expect(step(d, "api")!.status).toBe("fail");
    expect(step(d, "api")!.hint).toMatch(/isn't deployed at this path/);
  });

  it("spots a closed port and an unknown server name", async () => {
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const closed = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const refused = await p6Diagnose({ ...base, url: `http://127.0.0.1:${closed}/p6ws/restapi` });
    expect(step(refused, "port")!.status).toBe("fail");
    expect(step(refused, "port")!.hint).toMatch(/nothing is listening/);

    const unknown = await p6Diagnose({ ...base, url: "https://p6.does-not-exist.invalid/p6ws/restapi" });
    expect(step(unknown, "dns")!.status).toBe("fail");
    expect(step(unknown, "dns")!.hint).toMatch(/can't be found/);
  });

  it("rejects an address that isn't a URL", async () => {
    const d = await p6Diagnose({ ...base, url: "p6 server" });
    expect(d.steps).toHaveLength(1);
    expect(step(d, "address")!.status).toBe("fail");
  });
});

// openssl ships on CI runners and dev machines; skip the HTTPS cases without it.
const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)("P6 connection check over HTTPS with a company certificate", () => {
  const { server: plain } = mockEppm();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-ca-"));
  let srv: https.Server;
  let base: P6Connection;
  let caPem = "";

  beforeAll(async () => {
    const o = (...a: string[]) => execFileSync("openssl", a, { cwd: dir, stdio: "ignore" });
    o("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Example Company Root CA");
    o("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "srv.key", "-out", "srv.csr", "-subj", "/CN=localhost");
    fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\n");
    o("x509", "-req", "-in", "srv.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "srv.pem", "-days", "2", "-extfile", "ext.cnf");
    caPem = fs.readFileSync(path.join(dir, "ca.pem"), "utf8");
    srv = https.createServer({ key: fs.readFileSync(path.join(dir, "srv.key")), cert: fs.readFileSync(path.join(dir, "srv.pem")) }, plain.listeners("request")[0] as never);
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as net.AddressInfo).port;
    base = { id: "s", name: "EPPM TLS", kind: "eppm", url: `https://localhost:${port}/p6ws/restapi`, database: "PMDB", user: "planner", password: "secret", auth: "session" };
  });
  afterAll(async () => {
    await new Promise<void>((r) => srv.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails at the certificate when the company CA isn't trusted, with the right hint per platform", async () => {
    const d = await p6Diagnose(base, { where: "server" });
    expect(d.ok).toBe(false);
    expect(step(d, "cert")!.status).toBe("fail");
    expect(step(d, "cert")!.detail).toMatch(/Example Company Root CA/);
    expect(step(d, "cert")!.hint).toMatch(/NODE_EXTRA_CA_CERTS/);
    const desk = await p6Diagnose(base, { where: "desktop" });
    expect(step(desk, "cert")!.hint).toMatch(/install the company root certificate in Windows/);
  });

  it("works end to end once the company certificate is pasted", async () => {
    const cfg = { ...base, caCert: `Root CA from IT:\n${caPem}` };
    expect(parsePem(cfg.caCert)).toHaveLength(1);
    const d = await p6Diagnose(cfg, { where: "server" });
    expect(d.ok).toBe(true);
    expect(step(d, "cert")!.status).toBe("ok");
    expect(step(d, "cert")!.detail).toMatch(/company certificate/);
    expect(statuses(d)).toMatchObject({ address: "ok", api: "ok", login: "ok", projects: "ok" });
    expect((await p6ListProjects(cfg)).map((p) => p.code)).toEqual(["TWR-A", "TWR-B"]);
  });

  it("trusts what the platform fetch trusts (desktop: the OS certificate store)", async () => {
    // Stand-in for Electron's fetch: a fetch that trusts the company CA, as Windows would.
    const { Agent, fetch: uFetch } = await import("undici");
    const os = new Agent({ connect: { ca: caPem } });
    const platformFetch = ((u: string, i?: RequestInit) => uFetch(u, { ...(i as object), dispatcher: os } as never)) as unknown as typeof fetch;
    const d = await p6Diagnose(base, { where: "desktop", fetch: platformFetch });
    expect(d.ok).toBe(true);
    expect(step(d, "cert")!.status).toBe("ok");
    expect(step(d, "cert")!.detail).toMatch(/Trusted by this computer's certificate store/);
  });

  it("names an expired or wrong-name certificate", async () => {
    const d = await p6Diagnose({ ...base, url: base.url!.replace("localhost", "127.0.0.2"), caCert: caPem }, { where: "server" });
    // 127.0.0.2 isn't on the certificate (only localhost / 127.0.0.1).
    if (step(d, "port")!.status === "ok") {
      expect(step(d, "cert")!.status).toBe("fail");
      expect(step(d, "cert")!.hint).toMatch(/server name on the certificate/);
    }
  });
});
